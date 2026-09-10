/**
 * The four columns the writer forgot.
 *
 * Migration 0138 gave a line a price — `markup_rate`, `markup_amount`,
 * `total_price`, `unit_price` — added the columns, registered them as engine
 * outputs so nobody could type one by hand, and the Edge Function has put all
 * four into its payload since the day it was written.
 *
 * `app.record_engine_result`, the only writer of engine outputs, never
 * mentioned them. The payload carried the values in and the UPDATE dropped
 * them, so on every priced estimate the `+MARKUP` column read as an em dash and
 * `TOTAL` fell back to the line's *cost*, shown where its price belongs — a bid
 * of $28,475 sitting above a line that said $21,250, with nothing on screen to
 * say those were different quantities.
 *
 * Found by pricing a real estimate in a browser and reading the row. Every
 * layer had its own test and none of them crossed the join: the columns were
 * tested, the payload was tested, and the writer between them was not.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '11111111-1111-4111-8111-111111111111';

describe('a line keeps the price the engine gave it', () => {
  let h: Harness;
  let company = '';
  let version = '';
  let line = '';

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@ridge.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@ridge.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Ridgeline','ridgeline','grounup') as id`)))[0]!.id;

    const estimate = (await h.asService(() => h.sql<{ id: string }>(
      `insert into estimates (company_id, number, name, status)
       values ($1, 'E-2026-0001', 'Duct bank', 'draft') returning id`, [company])))[0]!.id;
    version = (await h.asService(() => h.sql<{ id: string }>(
      `insert into estimate_versions (company_id, estimate_id, version_number, status)
       values ($1, $2, 1, 'draft') returning id`, [company, estimate])))[0]!.id;
    line = (await h.asService(() => h.sql<{ id: string }>(
      `insert into estimate_line_items
         (company_id, estimate_version_id, description, unit, measured_quantity, sort_order)
       values ($1, $2, 'Electrical duct bank installation', 'LF', 500, 10)
       returning id`, [company, version])))[0]!.id;
  });

  it('starts with no price on the line, which is the default the columns carry', async () => {
    const [row] = await h.sql<Record<string, string>>(
      `select markup_rate, markup_amount, total_price, unit_price
         from estimate_line_items where id = $1`, [line]);
    expect(Number(row!.markup_amount)).toBe(0);
    expect(Number(row!.total_price)).toBe(0);
  });

  it('writes all four when the engine hands them over', async () => {
    await h.asService(() => h.sql(
      `select app.record_engine_result($1, 'engine-test',
         '{"direct_cost": 21250, "total_price": 28475, "bid_price": 28475}'::jsonb,
         $2::jsonb)`,
      [version, JSON.stringify([{
        id: line,
        total_direct_cost: 21250,
        unit_cost: 42.5,
        markup_rate: 0.34,
        markup_amount: 7225,
        total_price: 28475,
        unit_price: 56.95,
      }])]));

    const [row] = await h.sql<Record<string, string>>(
      `select total_direct_cost, unit_cost, markup_rate, markup_amount, total_price, unit_price
         from estimate_line_items where id = $1`, [line]);

    expect(Number(row!.total_direct_cost)).toBe(21_250);
    expect(Number(row!.unit_cost)).toBe(42.5);
    expect(Number(row!.markup_rate)).toBe(0.34);
    // The four that were being dropped.
    expect(Number(row!.markup_amount)).toBe(7_225);
    expect(Number(row!.total_price)).toBe(28_475);
    expect(Number(row!.unit_price)).toBe(56.95);
  });

  it('adds the line price to the same number the version carries', async () => {
    // The property the columns exist for: a bid that disagrees with the lines
    // it is made of is the one thing an estimator cannot explain to a customer.
    const [v] = await h.sql<{ total_price: string }>(
      `select total_price from estimate_versions where id = $1`, [version]);
    const [sum] = await h.sql<{ sum: string }>(
      `select coalesce(sum(total_price), 0) as sum
         from estimate_line_items where estimate_version_id = $1`, [version]);
    expect(Number(sum!.sum)).toBe(Number(v!.total_price));
  });

  it('leaves a value alone when the engine sends none for it', async () => {
    // `coalesce`, like every other column in this writer: a partial payload
    // updates what it names and does not blank the rest.
    await h.asService(() => h.sql(
      `select app.record_engine_result($1, 'engine-test', '{}'::jsonb, $2::jsonb)`,
      [version, JSON.stringify([{ id: line, unit_cost: 43 }])]));
    const [row] = await h.sql<Record<string, string>>(
      `select unit_cost, markup_amount, total_price from estimate_line_items where id = $1`,
      [line]);
    expect(Number(row!.unit_cost)).toBe(43);
    expect(Number(row!.markup_amount)).toBe(7_225);
    expect(Number(row!.total_price)).toBe(28_475);
  });

  it('still refuses a price typed by anybody but the engine', async () => {
    /*
     * The guard from migration 0058, which 0138 extended to cover these four.
     * Replacing the writer must not have loosened it: a price somebody typed is
     * a price nobody can reproduce.
     */
    await expect(h.asService(() => h.sql(
      `update estimate_line_items set total_price = 999999 where id = $1`, [line])))
      .rejects.toThrow();
    await expect(h.asService(() => h.sql(
      `update estimate_line_items set markup_amount = 1 where id = $1`, [line])))
      .rejects.toThrow();
  });
});
