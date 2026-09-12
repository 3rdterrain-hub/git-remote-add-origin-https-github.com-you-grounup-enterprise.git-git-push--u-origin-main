-- =============================================================================
-- GENERATED — do not edit.
--
-- A verbatim copy of `supabase/seed/0013_material_prices.sql`, so the catalog can be applied
-- by `supabase db push` rather than by a direct database connection. The seed
-- file is the source; this is the delivery. `npm run seed:migrations`
-- regenerates it and a governance test fails if the two ever differ.
--
-- Everything below is idempotent — `on conflict do nothing` throughout — so
-- applying it twice changes nothing, which is what makes it safe as a
-- migration.
-- =============================================================================

-- =============================================================================
-- 0013 — The prices that were always in the file
--
-- Seed 0009 shipped 333 materials and 5 prices, and said why: a price list
-- belongs to the company that negotiated it, and a national average is worse
-- than nothing because it looks like a number. That reasoning stands. What was
-- wrong was the premise — that no price existed. The export the catalog was
-- built from carried names, categories and units; a *different* sheet in the
-- same workbook, `07_F_P_MATERIAL_LIBRARY`, carried 173 materials with a price
-- on every one of them, along with the unit each is actually sold by, its
-- density and its default waste. Nothing here is invented, averaged or
-- converted: every number below is read from that sheet.
--
-- 173 of the catalog's materials match it by name, and all 173 of them were
-- uncosted. They are costed now.
--
-- **The unit is corrected with the price, and that is not optional.** 0009
-- flagged that 37 materials were filed as `EA` when they are sold by the ton or
-- the yard, and refused to guess: "turning EA into TON on a guess puts a
-- per-ton price on a per-each material and every estimate built on one is then
-- wrong by a factor nobody will spot." The guess is what was refused, not the
-- correction — and the price library states the unit beside the price, so the
-- two arrive together or not at all. 133 units are corrected here, each one to
-- the unit its own price is quoted in.
--
-- **Every price is `estimated`, never `quoted`.** Migration 0121 keeps those
-- apart because they are different claims: a quote is a number a supplier
-- stands behind on a date, and this is a company's working price list. A
-- company that wants its own number clicks the cost and 0133 copies the
-- material into their library and puts their price on the copy — which is the
-- whole point of the three-tier shape, and is why nothing here is written as
-- though it were final.
--
-- **Density only where the source states it in lb/CF**, times 27, which is the
-- definition of a cubic yard rather than an estimate. The sheet states most
-- densities as lb per unit sold — lb/EA, lb/LF — and that is a different fact
-- from lb/CY; loading one into the other would be the per-ton-price mistake in
-- another column. 12 of the 173 qualify.
--
-- The 160 catalog materials with no row in the price library stay uncosted, and
-- read as `not_costed` rather than $0.00 — most of them are near-duplicates of
-- a material that is priced here ("#57 Stone", "#57 Stone (import)", "411"),
-- which is a separate problem and not one to paper over with a number.
--
-- Library: the shipped materials catalog.
-- =============================================================================

update materials m
   set unit        = v.unit::app.unit_code,
       unit_cost   = v.price,
       cost_state  = 'estimated',
       /*
        * `cost_source`, not `source`. The row came from the catalog export and
        * still did; only the price came from the price library, and 0133 keeps
        * those apart for exactly this reason — overwriting `source` would lose
        * where the material itself came from to record where its number did.
        */
       cost_source = 'GrounUp material library (07_F_P_MATERIAL_LIBRARY), price_default',
       density_lb_per_cy = coalesce(v.density, m.density_lb_per_cy),
       default_waste_percent = v.waste,
       waste_basis = case when v.waste > 0
                          then 'Stated as waste_pct_default in the GrounUp material library'
                          else m.waste_basis end,
       updated_at  = now()
  from (values
  ('MAT-0001', 'TON', 32, 3375, 0.05),
  ('MAT-0002', 'TON', 42, 2700, 0.05),
  ('MAT-0008', 'TON', 28, 3456, 0.05),
  ('MAT-0009', 'TON', 58, 2700, 0.08),
  ('MAT-0012', 'TON', 48, 2565, 0.05),
  ('MAT-0014', 'TON', 55, 2835, 0.08),
  ('MAT-0016', 'TON', 24, 2700, 0.06),
  ('MAT-0017', 'SF', 12, null, 0.12),
  ('MAT-0023', 'TON', 95, 3915, 0.05),
  ('MAT-0024', 'TON', 110, 3915, 0.05),
  ('MAT-0025', 'EA', 18, null, 0.1),
  ('MAT-0026', 'GAL', 6.2, null, 0.03),
  ('MAT-0027', 'EA', 12, null, 0.03),
  ('MAT-0028', 'GAL', 8.5, null, 0.08),
  ('MAT-0029', 'GAL', 5.5, null, 0.03),
  ('MAT-0030', 'LB', 1.65, null, 0.1),
  ('MAT-0031', 'GAL', 42, null, 0.08),
  ('MAT-0032', 'LF', 210, null, 0.1),
  ('MAT-0033', 'SF', 58, null, 0.1),
  ('MAT-0034', 'LF', 32, null, 0.1),
  ('MAT-0035', 'SF', 68, null, 0.1),
  ('MAT-0036', 'EA', 325, null, 0.1),
  ('MAT-0037', 'LF', 175, null, 0.1),
  ('MAT-0038', 'LF', 0.22, null, 0.08),
  ('MAT-0039', 'EA', 9.5, null, 0.05),
  ('MAT-0040', 'LF', 0.85, null, 0.08),
  ('MAT-0041', 'EA', 165, null, 0.05),
  ('MAT-0042', 'CY', 165, null, 0.03),
  ('MAT-0043', 'CY', 175, null, 0.03),
  ('MAT-0051', 'GAL', 26, null, 0.03),
  ('MAT-0052', 'LF', 1.75, null, 0.05),
  ('MAT-0053', 'CY', 185, null, 0.03),
  ('MAT-0054', 'CY', 155, null, 0.03),
  ('MAT-0055', 'GAL', 18, null, 0.03),
  ('MAT-0057', 'CF', 8.5, 3780, 0.08),
  ('MAT-0060', 'CY', 325, null, 0.08),
  ('MAT-0070', 'TON', 145, 2700, 0),
  ('MAT-0071', 'CY', 18, null, 0),
  ('MAT-0072', 'EA', 385, null, 0.08),
  ('MAT-0074', 'EA', 75, null, 0.08),
  ('MAT-0076', 'EA', 110, null, 0.08),
  ('MAT-0077', 'EA', 950, null, 0.08),
  ('MAT-0079', 'EA', 425, null, 0.08),
  ('MAT-0082', 'EA', 625, null, 0.08),
  ('MAT-0089', 'SF', 0.62, null, 0.1),
  ('MAT-0090', 'SF', 0.84, null, 0.1),
  ('MAT-0091', 'LF', 0.45, null, 0.08),
  ('MAT-0092', 'GAL', 10, null, 0.1),
  ('MAT-0093', 'SF', 0.82, null, 0.1),
  ('MAT-0094', 'EA', 18, null, 0.12),
  ('MAT-0095', 'EA', 210, null, 0.05),
  ('MAT-0096', 'EA', 45, null, 0.05),
  ('MAT-0097', 'EA', 18, null, 0.05),
  ('MAT-0098', 'EA', 165, null, 0.05),
  ('MAT-0100', 'EA', 3.2, null, 0.05),
  ('MAT-0101', 'EA', 4.2, null, 0.05),
  ('MAT-0106', 'LF', 1.9, null, 0.08),
  ('MAT-0107', 'EA', 18, null, 0.05),
  ('MAT-0109', 'EA', 42, null, 0.05),
  ('MAT-0111', 'EA', 3.8, null, 0.05),
  ('MAT-0112', 'EA', 185, null, 0.05),
  ('MAT-0113', 'LF', 1.2, null, 0.08),
  ('MAT-0114', 'EA', 650, null, 0.05),
  ('MAT-0115', 'LF', 1.15, null, 0.08),
  ('MAT-0117', 'LF', 0.35, null, 0.08),
  ('MAT-0119', 'LF', 2.6, null, 0.1),
  ('MAT-0120', 'EA', 22, null, 0.1),
  ('MAT-0121', 'SF', 2.85, null, 0.1),
  ('MAT-0122', 'SF', 3.15, null, 0.1),
  ('MAT-0125', 'SF', 4.5, null, 0.1),
  ('MAT-0128', 'GAL', 22, null, 0.08),
  ('MAT-0130', 'SF', 6.8, null, 0.1),
  ('MAT-0131', 'SF', 2.2, null, 0.1),
  ('MAT-0132', 'SF', 2.75, null, 0.1),
  ('MAT-0136', 'LF', 1.15, null, 0.08),
  ('MAT-0137', 'SF', 1.9, null, 0.1),
  ('MAT-0140', 'CY', 12, null, 0.08),
  ('MAT-0141', 'SY', 3.6, null, 0.08),
  ('MAT-0142', 'SY', 1.45, null, 0.08),
  ('MAT-0143', 'TON', 155, null, 0.08),
  ('MAT-0144', 'TON', 165, null, 0.08),
  ('MAT-0145', 'CY', 18, null, 0.08),
  ('MAT-0148', 'EA', 1450, null, 0.05),
  ('MAT-0151', 'LF', 1.45, null, 0.08),
  ('MAT-0152', 'EA', 1850, null, 0.05),
  ('MAT-0153', 'EA', 28, null, 0.05),
  ('MAT-0155', 'LF', 2.2, null, 0.08),
  ('MAT-0156', 'EA', 1650, null, 0.05),
  ('MAT-0159', 'EA', 2250, null, 0.05),
  ('MAT-0160', 'EA', 140, null, 0.05),
  ('MAT-0161', 'LF', 7.5, null, 0.08),
  ('MAT-0162', 'LF', 10, null, 0.08),
  ('MAT-0170', 'LB', 0.95, null, 0.12),
  ('MAT-0171', 'BF', 1.45, null, 0.12),
  ('MAT-0172', 'SF', 0.72, null, 0.08),
  ('MAT-0173', 'SF', 0.88, null, 0.08),
  ('MAT-0174', 'SF', 1.4, null, 0.08),
  ('MAT-0175', 'SF', 1.2, null, 0.08),
  ('MAT-0181', 'TON', 62, 2430, 0.08),
  ('MAT-0183', 'LB', 5.2, null, 0.15),
  ('MAT-0185', 'LB', 1.35, null, 0.15),
  ('MAT-0187', 'CY', 42, null, 0.12),
  ('MAT-0191', 'CY', 38, null, 0.1),
  ('MAT-0192', 'EA', 28, null, 0.1),
  ('MAT-0193', 'SF', 0.55, null, 0.1),
  ('MAT-0196', 'EA', 225, null, 0.1),
  ('MAT-0198', 'LF', 3.6, null, 0.08),
  ('MAT-0199', 'LF', 0.95, null, 0.08),
  ('MAT-0201', 'LF', 1.45, null, 0.08),
  ('MAT-0203', 'LF', 4.2, null, 0.06),
  ('MAT-0205', 'LB', 2.2, null, 0.05),
  ('MAT-0206', 'LF', 10.5, null, 0.06),
  ('MAT-0210', 'LF', 13, null, 0.06),
  ('MAT-0214', 'EA', 3.6, null, 0.1),
  ('MAT-0226', 'GAL', 34, null, 0.1),
  ('MAT-0227', 'GAL', 78, null, 0.12),
  ('MAT-0228', 'GAL', 38, null, 0.1),
  ('MAT-0229', 'GAL', 32, null, 0.1),
  ('MAT-0230', 'GAL', 24, null, 0.1),
  ('MAT-0231', 'GAL', 36, null, 0.1),
  ('MAT-0246', 'LF', 14, null, 0.08),
  ('MAT-0247', 'LF', 4.8, null, 0.08),
  ('MAT-0248', 'EA', 85, null, 0.05),
  ('MAT-0249', 'LF', 0.65, null, 0.08),
  ('MAT-0250', 'EA', 35, null, 0.08),
  ('MAT-0253', 'LF', 2.2, null, 0.08),
  ('MAT-0256', 'EA', 18, null, 0.05),
  ('MAT-0257', 'EA', 1450, null, 0.05),
  ('MAT-0258', 'EA', 220, null, 0.05),
  ('MAT-0259', 'EA', 850, null, 0.05),
  ('MAT-0261', 'SQ', 145, null, 0.1),
  ('MAT-0262', 'LF', 2.4, null, 0.08),
  ('MAT-0263', 'SF', 2.25, null, 0.08),
  ('MAT-0265', 'LF', 1.9, null, 0.08),
  ('MAT-0266', 'SQ', 55, null, 0.08),
  ('MAT-0267', 'LF', 2.8, null, 0.08),
  ('MAT-0268', 'SF', 3.15, null, 0.1),
  ('MAT-0273', 'SQ', 18, null, 0.08),
  ('MAT-0274', 'SF', 8.5, null, 0.08),
  ('MAT-0275', 'SF', 2.1, null, 0.08),
  ('MAT-0279', 'EA', 18, null, 0.05),
  ('MAT-0280', 'LF', 1.15, null, 0.05),
  ('MAT-0281', 'SF', 18, null, 0.05),
  ('MAT-0282', 'BF', 1.35, null, 0.1),
  ('MAT-0283', 'SF', 0.78, null, 0.08),
  ('MAT-0284', 'SF', 1.15, null, 0.08),
  ('MAT-0285', 'SF', 1.55, null, 0.08),
  ('MAT-0302', 'SF', 2.8, null, 0.1),
  ('MAT-0303', 'EA', 18500, null, 0.05),
  ('MAT-0304', 'SF', 18, null, 0.08),
  ('MAT-0308', 'LF', 18, null, 0.05),
  ('MAT-0309', 'LB', 1.35, null, 0.08),
  ('MAT-0310', 'LB', 1.45, null, 0.08),
  ('MAT-0311', 'LB', 0.92, null, 0.05),
  ('MAT-0312', 'LB', 0.95, null, 0.05),
  ('MAT-0313', 'EA', 55, null, 0.05),
  ('MAT-0314', 'SF', 4.5, null, 0.05),
  ('MAT-0315', 'LB', 1.28, null, 0.08),
  ('MAT-0316', 'LB', 1.25, null, 0.08),
  ('MAT-0317', 'SF', 0.65, null, 0.05),
  ('MAT-0318', 'EA', 11, null, 0.1),
  ('MAT-0319', 'EA', 0.95, null, 0.1),
  ('MAT-0320', 'SF', 3.8, null, 0.12),
  ('MAT-0321', 'GAL', 32, null, 0.08),
  ('MAT-0322', 'SF', 4.8, null, 0.12),
  ('MAT-0323', 'SF', 8, null, 0.12),
  ('MAT-0324', 'EA', 16, null, 0.1),
  ('MAT-0325', 'EA', 18, null, 0.1),
  ('MAT-0328', 'LF', 2.2, null, 0.1),
  ('MAT-0329', 'LF', 2.4, null, 0.1),
  ('MAT-0331', 'LF', 1.35, null, 0.1),
  ('MAT-0332', 'LF', 1.55, null, 0.1),
  ('MAT-0333', 'LF', 3.6, null, 0.1)
) as v(code, unit, price, density, waste)
 where m.code = v.code
   and m.company_id is null
   /*
    * Only what nobody has costed. A company's own price is theirs, and a
    * catalog price already set came from somewhere that should not be
    * overwritten by a later run of this file — which is also what makes
    * applying it twice a no-op.
    */
   and m.cost_state = 'not_costed';
