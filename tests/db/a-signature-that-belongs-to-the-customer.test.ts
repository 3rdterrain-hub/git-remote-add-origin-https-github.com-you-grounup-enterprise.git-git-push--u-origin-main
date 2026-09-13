/**
 * The customer answering for themselves.
 *
 * `app.record_proposal_outcome` has been the only way a customer's answer was
 * ever recorded: gated on `estimates.issue`, taking the customer's name as free
 * text. So an acceptance was a member of staff typing the customer's name, and
 * a disputed bid rested on that.
 *
 * These hold the three properties the signed link is built on — the token is
 * never stored, a link is a credential rather than a row anyone may read, and
 * one link answers once — and the one that matters most: the customer's answer
 * goes through the same path staff use, so there is still exactly one route to
 * "this bid was won".
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createHarness, type Harness } from './harness.js';

const OWNER = '44444444-4444-4444-8444-444444444444';

describe('a signature that belongs to the customer', () => {
  let h: Harness;
  let company = '';
  let estimate = '';
  let n = 0;

  const issuedProposal = async (): Promise<{ proposal: string; version: string }> => {
    const [v] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `insert into estimate_versions (company_id, estimate_id, version_number, status)
       values ($1,$2,$3,'draft') returning id`, [company, estimate, ++n]));
    await h.sql(
      `select app.record_engine_result($1,'grounup-engine@test',
         jsonb_build_object('total_price', 84250::numeric, 'bid_price', 84250::numeric))`,
      [v!.id]);
    const [snap] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `insert into library_snapshots (company_id, estimate_version_id, engine_version,
         entry_count, digest) values ($1,$2,'1.0.0',1,'0123456789abcdef') returning id`,
      [company, v!.id]));
    await h.asUser(OWNER, () => h.sql(
      `update estimate_versions set status='issued'::app.estimate_status,
         library_snapshot_id=$1, issued_at=now() where id=$2`, [snap!.id, v!.id]));
    const [p] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `insert into proposals (company_id, estimate_version_id, number, title,
         total_price, status, issued_at)
       values ($1,$2,$3,'Auburn Avenue site package',84250,'issued',now()) returning id`,
      [company, v!.id, `PRO-${n}`]));
    return { proposal: p!.id, version: v!.id };
  };

  beforeAll(async () => {
    h = await createHarness({ seed: true });
    await h.sql(`insert into auth.users (id, email) values ($1,'o@auburn.test')`, [OWNER]);
    await h.sql(`insert into user_profiles (id, email) values ($1,'o@auburn.test')
                 on conflict (id) do nothing`, [OWNER]);
    company = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `select app.provision_company('Auburn Civil','auburn-civil','grounup') as id`)))[0]!.id;
    estimate = (await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `insert into estimates (company_id, number, name, status)
       values ($1,'E-2026-0200','Auburn Avenue','issued') returning id`, [company])))[0]!.id;
  });

  it('returns the token once and stores only its hash', async () => {
    const { proposal } = await issuedProposal();
    const [link] = await h.asUser(OWNER, () => h.sql<{ token: string; link_id: string }>(
      `select * from app.create_proposal_share_link($1,'Marcus Ruiz','m@owner.test',30)`,
      [proposal]));
    expect(link!.token).toMatch(/^gp_[0-9a-f]{64}$/);

    const [row] = await h.asUser(OWNER, () => h.sql<{ token_hash: string; token_prefix: string }>(
      `select token_hash, token_prefix from proposal_share_links where id = $1`, [link!.link_id]));
    // The token itself appears nowhere. Only something derived from it.
    expect(row!.token_hash).not.toContain(link!.token);
    expect(row!.token_hash).toHaveLength(64);
    expect(link!.token.startsWith(row!.token_prefix)).toBe(true);
  });

  it('refuses to send a proposal that was never issued', async () => {
    const [v] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `insert into estimate_versions (company_id, estimate_id, version_number, status)
       values ($1,$2,$3,'draft') returning id`, [company, estimate, ++n]));
    const [p] = await h.asUser(OWNER, () => h.sql<{ id: string }>(
      `insert into proposals (company_id, estimate_version_id, number, title, status)
       values ($1,$2,$3,'Draft','draft') returning id`, [company, v!.id, `PRO-D${n}`]));
    await expect(h.asUser(OWNER, () => h.sql(
      `select * from app.create_proposal_share_link($1,'Marcus Ruiz',null,30)`, [p!.id])))
      .rejects.toThrow(/nothing to send for signature/);
  });

  it('will not issue a link nobody is named on', async () => {
    const { proposal } = await issuedProposal();
    await expect(h.asUser(OWNER, () => h.sql(
      `select * from app.create_proposal_share_link($1,'   ',null,30)`, [proposal])))
      .rejects.toThrow(/Say who the link is for/);
  });

  it('shows the customer the proposal, and counts that they opened it', async () => {
    const { proposal } = await issuedProposal();
    const [link] = await h.asUser(OWNER, () => h.sql<{ token: string; link_id: string }>(
      `select * from app.create_proposal_share_link($1,'Marcus Ruiz',null,30)`, [proposal]));

    const [seen] = await h.asAnon(() => h.sql<{ doc: Record<string, unknown> }>(
      `select public.open_proposal_by_token($1) as doc`, [link!.token]));
    expect(seen!.doc.number).toMatch(/^PRO-/);
    expect(seen!.doc.recipientName).toBe('Marcus Ruiz');
    expect(Number(seen!.doc.totalPrice)).toBe(84250);
    expect(seen!.doc.company).toMatchObject({ name: 'Auburn Civil' });

    const [after] = await h.asUser(OWNER, () => h.sql<{ opened_count: number; opened_at: string }>(
      `select opened_count, opened_at from proposal_share_links where id=$1`, [link!.link_id]));
    expect(after!.opened_count).toBe(1);
    expect(after!.opened_at).not.toBeNull();
  });

  it('does not recognize a token that was never issued', async () => {
    await expect(h.asAnon(() => h.sql(
      `select public.open_proposal_by_token('gp_notarealtoken')`)))
      .rejects.toThrow(/not recognized/);
  });

  it('records the acceptance, the evidence, and moves the estimate with it', async () => {
    const { proposal, version } = await issuedProposal();
    const [link] = await h.asUser(OWNER, () => h.sql<{ token: string }>(
      `select * from app.create_proposal_share_link($1,'Marcus Ruiz','m@owner.test',30)`,
      [proposal]));

    await h.asAnon(() => h.sql(
      `select public.respond_to_proposal_by_token($1,'accepted','Marcus Ruiz','Owner''s Rep',
         'm@owner.test','Marcus Ruiz', null,
         repeat('a',64), '203.0.113.7'::inet, 'Safari')`, [link!.token]));

    const [p] = await h.asUser(OWNER, () => h.sql<{ status: string; accepted_by_name: string }>(
      `select status, accepted_by_name from proposals where id=$1`, [proposal]));
    expect(p!.status).toBe('accepted');
    expect(p!.accepted_by_name).toBe('Marcus Ruiz');

    // The estimate followed, through the one path that does that.
    const [v] = await h.asUser(OWNER, () => h.sql<{ status: string }>(
      `select status from estimate_versions where id=$1`, [version]));
    expect(v!.status).toBe('awarded');

    const [sig] = await h.asUser(OWNER, () => h.sql<{
      outcome: string; signed_name: string; ip_address: string;
      total_price_at_signing: string; document_hash: string;
    }>(`select * from proposal_signatures where proposal_id=$1`, [proposal]));
    expect(sig!.outcome).toBe('accepted');
    expect(sig!.signed_name).toBe('Marcus Ruiz');
    expect(sig!.ip_address).toBe('203.0.113.7');
    // What the signature covered, so a proposal edited later cannot claim it.
    expect(Number(sig!.total_price_at_signing)).toBe(84250);
    expect(sig!.document_hash).toHaveLength(64);
  });

  it('spends the link, so the same one cannot answer twice', async () => {
    const { proposal } = await issuedProposal();
    const [link] = await h.asUser(OWNER, () => h.sql<{ token: string }>(
      `select * from app.create_proposal_share_link($1,'Marcus Ruiz',null,30)`, [proposal]));
    await h.asAnon(() => h.sql(
      `select public.respond_to_proposal_by_token($1,'accepted','Marcus Ruiz')`, [link!.token]));
    await expect(h.asAnon(() => h.sql(
      `select public.respond_to_proposal_by_token($1,'declined','Marcus Ruiz',null,null,null,'changed mind')`,
      [link!.token]))).rejects.toThrow(/already been answered/);
  });

  it('asks a declining customer why, so the contractor knows what to change', async () => {
    const { proposal } = await issuedProposal();
    const [link] = await h.asUser(OWNER, () => h.sql<{ token: string }>(
      `select * from app.create_proposal_share_link($1,'Marcus Ruiz',null,30)`, [proposal]));
    await expect(h.asAnon(() => h.sql(
      `select public.respond_to_proposal_by_token($1,'declined','Marcus Ruiz')`, [link!.token])))
      .rejects.toThrow(/Say why/);
  });

  it('refuses a link that was withdrawn, and will not withdraw one already answered', async () => {
    const { proposal } = await issuedProposal();
    const [a] = await h.asUser(OWNER, () => h.sql<{ token: string; link_id: string }>(
      `select * from app.create_proposal_share_link($1,'Marcus Ruiz',null,30)`, [proposal]));
    await h.asUser(OWNER, () => h.sql(
      `select app.revoke_proposal_share_link($1,'sent to the wrong address')`, [a!.link_id]));
    await expect(h.asAnon(() => h.sql(
      `select public.open_proposal_by_token($1)`, [a!.token]))).rejects.toThrow(/was withdrawn/);

    const [b] = await h.asUser(OWNER, () => h.sql<{ token: string; link_id: string }>(
      `select * from app.create_proposal_share_link($1,'Marcus Ruiz',null,30)`, [proposal]));
    await h.asAnon(() => h.sql(
      `select public.respond_to_proposal_by_token($1,'accepted','Marcus Ruiz')`, [b!.token]));
    await expect(h.asUser(OWNER, () => h.sql(
      `select app.revoke_proposal_share_link($1)`, [b!.link_id])))
      .rejects.toThrow(/already been answered and cannot be revoked/);
  });

  it('refuses an expired link and says when it went', async () => {
    const { proposal } = await issuedProposal();
    const [link] = await h.asUser(OWNER, () => h.sql<{ token: string; link_id: string }>(
      `select * from app.create_proposal_share_link($1,'Marcus Ruiz',null,1)`, [proposal]));
    await h.asService(() => h.sql(
      // `expires_at > created_at` is a real constraint and stays one: a link is
      // aged here by moving both, the way time would have.
      `update proposal_share_links
          set created_at = now() - interval '40 days',
              expires_at = now() - interval '39 days'
        where id=$1`, [link!.link_id]));
    await expect(h.asAnon(() => h.sql(
      `select public.open_proposal_by_token($1)`, [link!.token]))).rejects.toThrow(/expired on/);
  });

  it('lets an anonymous caller read neither table', async () => {
    /*
     * The link is a credential, not a lookup key. Everything the customer's
     * side does goes through a definer function that takes the raw token.
     */
    await expect(h.asAnon(() => h.sql(`select * from proposal_share_links`)))
      .rejects.toThrow();
    await expect(h.asAnon(() => h.sql(`select * from proposal_signatures`)))
      .rejects.toThrow();
  });

  it('will not let a signature be edited after the fact', async () => {
    const { proposal } = await issuedProposal();
    const [link] = await h.asUser(OWNER, () => h.sql<{ token: string }>(
      `select * from app.create_proposal_share_link($1,'Marcus Ruiz',null,30)`, [proposal]));
    await h.asAnon(() => h.sql(
      `select public.respond_to_proposal_by_token($1,'accepted','Marcus Ruiz')`, [link!.token]));
    await expect(h.asService(() => h.sql(
      `update proposal_signatures set signed_name='Somebody Else' where proposal_id=$1`, [proposal])))
      .rejects.toThrow();
  });
});
