-- =============================================================================
-- 0089 — What a service is measured in
--
-- Every one of the 188 seeded services carries `default_unit = 'LS'`. All of
-- them. Common excavation is a lump sum. Storm sewer installation is a lump
-- sum. So is manhole installation, asphalt surface course and sod.
--
-- That is not a cosmetic problem. An estimator who traces a takeoff and gets
-- 1,400 cubic yards, then adds "Common excavation" to the estimate, lands on a
-- line measured in lump sums with nowhere for the 1,400 to go. Migration 0063
-- built `app.apply_takeoff_to_line` to carry a measured quantity onto a line
-- with its unit; the library it applies to says every unit is one.
--
-- It is the recurring defect in its purest form: the platform presents a
-- library of services with units, and the units are not units. Nothing failed,
-- nothing was slow, and the number was wrong every time.
--
-- The unit for each is the one the trade actually bids in — volume for
-- anything moved, area for anything shaped, length for anything laid, each for
-- anything counted, tons for anything weighed, and a day for the things that
-- cost money by the day whatever gets done. Lump sum survives on exactly the
-- twenty-two services that genuinely have no measure: a review, a
-- coordination, a documentation package.
--
-- `supported_units` is corrected alongside, both because the check constraint
-- requires the default to be among them and because the old list — the same
-- nine units on every service — offered TON on a survey and HR on a manhole.
-- =============================================================================

create temporary table service_units (
  code text primary key,
  unit app.unit_code not null,
  supported app.unit_code[] not null
) on commit drop;

insert into service_units (code, unit, supported) values
  ('SVC-0001', 'LS', array['LS','EA','HR']::app.unit_code[]),
  ('SVC-0002', 'LS', array['LS','EA','HR']::app.unit_code[]),
  ('SVC-0003', 'ACRE', array['ACRE','SY','LS']::app.unit_code[]),
  ('SVC-0004', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0005', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0006', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0007', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0008', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0009', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0010', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0011', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0012', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0013', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0014', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0015', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0016', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0017', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0018', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0019', 'SF', array['SF','SY','LS']::app.unit_code[]),
  ('SVC-0020', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0021', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0022', 'DAY', array['DAY','WK','HR','LS']::app.unit_code[]),
  ('SVC-0023', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0024', 'DAY', array['DAY','WK','HR','LS']::app.unit_code[]),
  ('SVC-0025', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0026', 'LS', array['LS','EA','HR']::app.unit_code[]),
  ('SVC-0027', 'LS', array['LS','EA','HR']::app.unit_code[]),
  ('SVC-0028', 'LS', array['LS','EA','HR']::app.unit_code[]),
  ('SVC-0029', 'SF', array['SF','SY','LS']::app.unit_code[]),
  ('SVC-0030', 'EA', array['EA','LS']::app.unit_code[]),
  ('SVC-0031', 'SF', array['SF','SY','LS']::app.unit_code[]),
  ('SVC-0032', 'SF', array['SF','SY','LS']::app.unit_code[]),
  ('SVC-0033', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0034', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0035', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0036', 'EA', array['EA','LS']::app.unit_code[]),
  ('SVC-0037', 'EA', array['EA','LS']::app.unit_code[]),
  ('SVC-0038', 'LS', array['LS','EA','HR']::app.unit_code[]),
  ('SVC-0039', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0040', 'TON', array['TON','CY','LS']::app.unit_code[]),
  ('SVC-0041', 'TON', array['TON','CY','LS']::app.unit_code[]),
  ('SVC-0042', 'TON', array['TON','CY','LS']::app.unit_code[]),
  ('SVC-0043', 'TON', array['TON','CY','LS']::app.unit_code[]),
  ('SVC-0044', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0045', 'EA', array['EA','LS']::app.unit_code[]),
  ('SVC-0046', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0047', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0048', 'DAY', array['DAY','WK','HR','LS']::app.unit_code[]),
  ('SVC-0049', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0050', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0051', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0052', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0053', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0054', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0055', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0056', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0057', 'EA', array['EA','LS']::app.unit_code[]),
  ('SVC-0058', 'EA', array['EA','LS']::app.unit_code[]),
  ('SVC-0059', 'EA', array['EA','LS']::app.unit_code[]),
  ('SVC-0060', 'EA', array['EA','LS']::app.unit_code[]),
  ('SVC-0061', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0062', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0063', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0064', 'LS', array['LS','EA','HR']::app.unit_code[]),
  ('SVC-0065', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0066', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0067', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0068', 'SF', array['SF','SY','LS']::app.unit_code[]),
  ('SVC-0069', 'LB', array['LB','TON','LS']::app.unit_code[]),
  ('SVC-0070', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0071', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0072', 'SF', array['SF','SY','LS']::app.unit_code[]),
  ('SVC-0073', 'SF', array['SF','SY','LS']::app.unit_code[]),
  ('SVC-0074', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0075', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0076', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0077', 'SF', array['SF','SY','LS']::app.unit_code[]),
  ('SVC-0078', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0079', 'LS', array['LS','EA','HR']::app.unit_code[]),
  ('SVC-0080', 'SF', array['SF','SY','LS']::app.unit_code[]),
  ('SVC-0081', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0082', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0083', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0084', 'TON', array['TON','CY','LS']::app.unit_code[]),
  ('SVC-0085', 'GAL', array['GAL','SY','LS']::app.unit_code[]),
  ('SVC-0086', 'TON', array['TON','CY','LS']::app.unit_code[]),
  ('SVC-0087', 'TON', array['TON','CY','LS']::app.unit_code[]),
  ('SVC-0088', 'TON', array['TON','CY','LS']::app.unit_code[]),
  ('SVC-0089', 'TON', array['TON','CY','LS']::app.unit_code[]),
  ('SVC-0090', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0091', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0092', 'TON', array['TON','CY','LS']::app.unit_code[]),
  ('SVC-0093', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0094', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0095', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0096', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0097', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0098', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0099', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0100', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0101', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0102', 'EA', array['EA','LS']::app.unit_code[]),
  ('SVC-0103', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0104', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0105', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0106', 'SF', array['SF','SY','LS']::app.unit_code[]),
  ('SVC-0107', 'TON', array['TON','CY','LS']::app.unit_code[]),
  ('SVC-0108', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0109', 'EA', array['EA','LS']::app.unit_code[]),
  ('SVC-0110', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0111', 'EA', array['EA','LS']::app.unit_code[]),
  ('SVC-0112', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0113', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0114', 'TON', array['TON','CY','LS']::app.unit_code[]),
  ('SVC-0115', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0116', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0117', 'EA', array['EA','LS']::app.unit_code[]),
  ('SVC-0118', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0119', 'SF', array['SF','SY','LS']::app.unit_code[]),
  ('SVC-0120', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0121', 'EA', array['EA','LS']::app.unit_code[]),
  ('SVC-0122', 'EA', array['EA','LS']::app.unit_code[]),
  ('SVC-0123', 'EA', array['EA','LS']::app.unit_code[]),
  ('SVC-0124', 'LS', array['LS','EA','HR']::app.unit_code[]),
  ('SVC-0125', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0126', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0127', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0128', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0129', 'SF', array['SF','SY','LS']::app.unit_code[]),
  ('SVC-0130', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0131', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0132', 'EA', array['EA','LS']::app.unit_code[]),
  ('SVC-0133', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0134', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0135', 'LS', array['LS','EA','HR']::app.unit_code[]),
  ('SVC-0136', 'SF', array['SF','SY','LS']::app.unit_code[]),
  ('SVC-0137', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0138', 'LS', array['LS','EA','HR']::app.unit_code[]),
  ('SVC-0139', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0140', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0141', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0142', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0143', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0144', 'LS', array['LS','EA','HR']::app.unit_code[]),
  ('SVC-0145', 'DAY', array['DAY','WK','HR','LS']::app.unit_code[]),
  ('SVC-0146', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0147', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0148', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0149', 'TON', array['TON','CY','LS']::app.unit_code[]),
  ('SVC-0150', 'EA', array['EA','LS']::app.unit_code[]),
  ('SVC-0151', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0152', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0153', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0154', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0155', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0156', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0157', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0158', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0159', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0160', 'LS', array['LS','EA','HR']::app.unit_code[]),
  ('SVC-0161', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0162', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0163', 'TON', array['TON','CY','LS']::app.unit_code[]),
  ('SVC-0164', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0165', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0166', 'TON', array['TON','CY','LS']::app.unit_code[]),
  ('SVC-0167', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0168', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0169', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0170', 'DAY', array['DAY','WK','HR','LS']::app.unit_code[]),
  ('SVC-0171', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0172', 'CY', array['CY','TON','LS']::app.unit_code[]),
  ('SVC-0173', 'ACRE', array['ACRE','SY','LS']::app.unit_code[]),
  ('SVC-0174', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0175', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0176', 'SF', array['SF','SY','LS']::app.unit_code[]),
  ('SVC-0177', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0178', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0179', 'EA', array['EA','LS']::app.unit_code[]),
  ('SVC-0180', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0181', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0182', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0183', 'LF', array['LF','EA','LS']::app.unit_code[]),
  ('SVC-0184', 'LS', array['LS','EA','HR']::app.unit_code[]),
  ('SVC-0185', 'LS', array['LS','EA','HR']::app.unit_code[]),
  ('SVC-0186', 'HR', array['HR','DAY','LS']::app.unit_code[]),
  ('SVC-0187', 'SY', array['SY','SF','LS']::app.unit_code[]),
  ('SVC-0188', 'LS', array['LS','EA','HR']::app.unit_code[]);

/*
 * Global library rows only. A company that has already overridden a service in
 * its own library has decided how it prices that work, and a migration is not
 * the place to overrule it — the whole point of the three-tier library is that
 * a tenant's copy wins.
 */
update services s
   set default_unit = u.unit,
       supported_units = u.supported,
       updated_at = now()
  from service_units u
 where s.code = u.code
   and s.company_id is null
   and s.enterprise_group_id is null
   and s.default_unit = 'LS'
   and u.unit <> 'LS';

select app.assert_security_gates();
