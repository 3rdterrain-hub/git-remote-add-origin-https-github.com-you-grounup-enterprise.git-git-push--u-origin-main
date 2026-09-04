/**
 * Turns the P05 verdicts into a per-requirement verification ledger.
 *
 * Every P05 requirement is "{module} {aspect}", and every one carries the same
 * acceptance criterion: demonstrate it "with tenant-specific configuration,
 * role controls, version history, and traceable output".
 *
 * So a requirement is verified only when both halves hold: the module actually
 * has that aspect, and the module satisfies all four acceptance conditions.
 * Neither half is inferred — each cites a named test.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const G = join(ROOT, 'governance');

const ASPECTS = ['canonical model', 'configurable rules', 'auditability',
                 'permissions', 'import/export', 'validation and testing'];
/** The four conditions every acceptance criterion demands of the module. */
const CONDITIONS = ['tenant-specific configuration', 'role controls',
                    'version history', 'traceable output'];

const verdicts = JSON.parse(readFileSync(join(G, 'traceability/verification/P05-verdicts.json'), 'utf8'));
const p26 = JSON.parse(readFileSync(join(G, 'traceability/verification/P26-verdicts.json'), 'utf8'));
const p25 = JSON.parse(readFileSync(join(G, 'traceability/verification/P25-verdicts.json'), 'utf8'));
const p24 = JSON.parse(readFileSync(join(G, 'traceability/verification/P24-verdicts.json'), 'utf8'));
const p28 = JSON.parse(readFileSync(join(G, 'traceability/verification/P28-verdicts.json'), 'utf8'));
const p18 = JSON.parse(readFileSync(join(G, 'traceability/verification/P18-verdicts.json'), 'utf8'));
const p30 = JSON.parse(readFileSync(join(G, 'traceability/verification/P30-verdicts.json'), 'utf8'));
const p19 = JSON.parse(readFileSync(join(G, 'traceability/verification/P19-verdicts.json'), 'utf8'));
const p10 = JSON.parse(readFileSync(join(G, 'traceability/verification/P10-verdicts.json'), 'utf8'));
const p14 = JSON.parse(readFileSync(join(G, 'traceability/verification/P14-verdicts.json'), 'utf8'));
const p15 = JSON.parse(readFileSync(join(G, 'traceability/verification/P15-verdicts.json'), 'utf8'));
const p11 = JSON.parse(readFileSync(join(G, 'traceability/verification/P11-verdicts.json'), 'utf8'));
const p12 = JSON.parse(readFileSync(join(G, 'traceability/verification/P12-verdicts.json'), 'utf8'));
const p20 = JSON.parse(readFileSync(join(G, 'traceability/verification/P20-verdicts.json'), 'utf8'));
const p27 = JSON.parse(readFileSync(join(G, 'traceability/verification/P27-verdicts.json'), 'utf8'));
const p29 = JSON.parse(readFileSync(join(G, 'traceability/verification/P29-verdicts.json'), 'utf8'));
const p09 = JSON.parse(readFileSync(join(G, 'traceability/verification/P09-verdicts.json'), 'utf8'));
const p08 = JSON.parse(readFileSync(join(G, 'traceability/verification/P08-verdicts.json'), 'utf8'));

function readCsv(path) {
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const allRequirements = readCsv(join(G, 'requirements/ges-requirements.csv'));
const requirements = allRequirements.filter((r) => r.phase === 'P05');

/** Split "{Module} {aspect}" using the known aspect suffixes. */
function split(name) {
  for (const a of ASPECTS) {
    if (name.toLowerCase().endsWith(a)) {
      return { module: name.slice(0, name.length - a.length).trim(), aspect: a };
    }
  }
  return { module: name.trim(), aspect: '' };
}

const problems = [];
const ledger = [];

for (const r of requirements) {
  const { module, aspect } = split(r.name);
  const m = verdicts.modules[module];
  if (!m) { problems.push(`no verdict recorded for module "${module}" (${r.requirement_id})`); continue; }
  if (!aspect) { problems.push(`could not read an aspect from "${r.name}"`); continue; }

  // Condition evidence lives on the module and applies to every one of its
  // aspects; aspect evidence is specific to this requirement.
  const conditionEvidence = CONDITIONS
    .map((c) => (m.conditions[c] ? `${c}: ${m.conditions[c]}` : null))
    .filter(Boolean);
  const conditionGaps = CONDITIONS.filter((c) => !m.conditions[c]);

  const aspectEvidence = m.verified[aspect];
  const aspectGap = m.not_verified[aspect];
  if (!aspectEvidence && !aspectGap) {
    problems.push(`${module} / ${aspect}: no verdict either way (${r.requirement_id})`);
    continue;
  }

  /*
   * Both halves, strictly. The criterion says demonstrate the aspect *with*
   * tenant configuration, role controls, version history and traceable output.
   * An aspect that exists but whose module cannot show its work has not met
   * the criterion, and recording it as verified would be the ledger's first
   * lie.
   */
  const verified = Boolean(aspectEvidence) && conditionGaps.length === 0;
  ledger.push({
    requirement_id: r.requirement_id,
    module, aspect,
    verification: verified ? 'verified' : 'not_verified',
    module_exists: m.exists ? 'yes' : 'no',
    evidence: verified ? [`aspect: ${aspectEvidence}`, ...conditionEvidence].join(' || ') : '',
    gap: verified ? ''
      : aspectGap ?? `The aspect exists, but the module does not satisfy: ${conditionGaps.join(', ')}.`,
    unmet_conditions: conditionGaps.join('; '),
  });
}

if (problems.length) {
  console.error('The verdicts do not cover every requirement:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const cols = ['requirement_id', 'module', 'aspect', 'verification', 'module_exists', 'gap', 'unmet_conditions', 'evidence'];
const body = [cols.join(','), ...ledger.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';

const out = join(G, 'traceability/verification/P05-ledger.csv');
if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(out, 'utf8'); } catch { /* not generated yet */ }
  if (current !== body) { console.error('P05 verification ledger is out of date. Run: npm run verification'); process.exit(1); }
  console.log(`P05 verification ledger matches the verdicts (${ledger.length} requirements).`);
} else {
  writeFileSync(out, body);
}

const v = ledger.filter((r) => r.verification === 'verified').length;
const byModule = {};
for (const r of ledger) {
  byModule[r.module] ??= { verified: 0, total: 0, exists: r.module_exists };
  byModule[r.module].total++;
  if (r.verification === 'verified') byModule[r.module].verified++;
}
console.log(`P05: ${ledger.length} requirements, ${v} verified (${Math.round((v / ledger.length) * 100)}%), ${ledger.length - v} not verified\n`);
for (const [m, s] of Object.entries(byModule).sort((a, b) => b[1].verified - a[1].verified)) {
  console.log(`  ${String(s.verified)}/${s.total}  ${m}${s.exists === 'no' ? '  (not built)' : ''}`);
}


// ---------------------------------------------------------------------- P26
/*
 * P26 judges by domain against ten conditions, all required.
 *
 * Two of the ten are platform capabilities rather than per-domain ones, and
 * both are absent: nothing pins an estimate to the library rows that priced it,
 * and there is no scenario model. Those two block every domain, however
 * complete the domain itself is — which is the finding, not a technicality.
 */
const P26_CONDITIONS = p26.acceptance_conditions.conditions;
const p26Built = new Set(p26.domain_status.built);
const p26Partial = p26.domain_status.partial;
const p26NotBuilt = p26.domain_status.not_built;

const blocking = Object.entries(p26.platform_conditions)
  .filter(([, v]) => v.status !== 'met')
  .map(([k]) => k);

const p26Ledger = [];
for (const r of allRequirements.filter((x) => x.phase === 'P26')) {
  const domain = r.domain;
  const built = p26Built.has(domain);
  const domainGap = p26Partial[domain] ?? p26NotBuilt[domain] ?? '';
  const unmet = [...blocking];
  const verified = built && unmet.length === 0;
  p26Ledger.push({
    requirement_id: r.requirement_id,
    domain,
    verification: verified ? 'verified' : 'not_verified',
    domain_status: built ? 'built' : (p26Partial[domain] ? 'partial' : 'not_built'),
    unmet_conditions: unmet.join('; '),
    gap: verified ? ''
      : [domainGap, unmet.length
          ? `Blocked platform-wide by: ${unmet.map((c) => `${c} (${p26.platform_conditions[c].status})`).join(', ')}.`
          : ''].filter(Boolean).join(' '),
    met_conditions: P26_CONDITIONS.filter((c) => !unmet.includes(c)).join('; '),
  });
}

const p26Cols = ['requirement_id', 'domain', 'verification', 'domain_status',
                 'unmet_conditions', 'met_conditions', 'gap'];
const p26Body = [p26Cols.join(','),
  ...p26Ledger.map((r) => p26Cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
const p26Out = join(G, 'traceability/verification/P26-ledger.csv');
if (process.argv.includes('--check')) {
  let cur = '';
  try { cur = readFileSync(p26Out, 'utf8'); } catch { /* not generated yet */ }
  if (cur !== p26Body) { console.error('P26 verification ledger is out of date. Run: npm run verification'); process.exit(1); }
  console.log(`P26 verification ledger matches the verdicts (${p26Ledger.length} requirements).`);
} else {
  writeFileSync(p26Out, p26Body);
}

const p26v = p26Ledger.filter((r) => r.verification === 'verified').length;
console.log(`\nP26: ${p26Ledger.length} requirements, ${p26v} verified, ${p26Ledger.length - p26v} not verified`);
console.log(`  domains: ${p26.domain_status.built.length} built, ${Object.keys(p26Partial).length} partial, ${Object.keys(p26NotBuilt).length} not built`);
console.log(`  blocked platform-wide by: ${blocking.join(', ')}`);


// ---------------------------------------------------------------------- P25
/*
 * P25 judges by domain against eight conditions, all required. Five are
 * properties of the library tables themselves, assessed across the twelve
 * three-tier libraries an estimate is priced from — a guarantee that holds for
 * eleven and not the twelfth is not a guarantee.
 */
function buildDomainLedger(phase, spec, prefix) {
  const conditions = spec.acceptance_conditions.conditions;
  const built = new Set(spec.domain_status.built);
  const partial = spec.domain_status.partial;
  const notBuilt = spec.domain_status.not_built;
  const unmet = Object.entries(spec.platform_conditions)
    .filter(([, v]) => v.status !== 'met').map(([k]) => k);

  const ledger = [];
  for (const r of allRequirements.filter((x) => x.phase === phase)) {
    const domain = r.domain;
    const isBuilt = built.has(domain);
    const domainGap = partial[domain] ?? notBuilt[domain] ?? '';
    const verified = isBuilt && unmet.length === 0;
    ledger.push({
      requirement_id: r.requirement_id,
      domain,
      verification: verified ? 'verified' : 'not_verified',
      domain_status: isBuilt ? 'built' : (partial[domain] ? 'partial' : 'not_built'),
      unmet_conditions: unmet.join('; '),
      met_conditions: conditions.filter((c) => !unmet.includes(c)).join('; '),
      gap: verified ? ''
        : [domainGap, unmet.length
            ? `Blocked platform-wide by: ${unmet.map((c) => `${c} (${spec.platform_conditions[c].status})`).join(', ')}.`
            : ''].filter(Boolean).join(' '),
    });
  }

  const cols = ['requirement_id', 'domain', 'verification', 'domain_status',
                'unmet_conditions', 'met_conditions', 'gap'];
  const body = [cols.join(','),
    ...ledger.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
  const out = join(G, `traceability/verification/${phase}-ledger.csv`);
  if (process.argv.includes('--check')) {
    let cur = '';
    try { cur = readFileSync(out, 'utf8'); } catch { /* not generated yet */ }
    if (cur !== body) { console.error(`${phase} verification ledger is out of date. Run: npm run verification`); process.exit(1); }
    console.log(`${phase} verification ledger matches the verdicts (${ledger.length} requirements).`);
  } else {
    writeFileSync(out, body);
  }

  const v = ledger.filter((r) => r.verification === 'verified').length;
  console.log(`\n${phase}: ${ledger.length} requirements, ${v} verified, ${ledger.length - v} not verified`);
  console.log(`  domains: ${spec.domain_status.built.length} built, ${Object.keys(partial).length} partial, ${Object.keys(notBuilt).length} not built`);
  console.log(`  blocked platform-wide by: ${unmet.join(', ') || 'nothing'}`);
  return ledger;
}

buildDomainLedger('P25', p25, 'P25');
buildDomainLedger('P24', p24, 'P24');
buildDomainLedger('P28', p28, 'P28');
buildDomainLedger('P18', p18, 'P18');
buildDomainLedger('P30', p30, 'P30');
buildDomainLedger('P19', p19, 'P19');
buildDomainLedger('P14', p14, 'P14');
buildDomainLedger('P15', p15, 'P15');
buildDomainLedger('P11', p11, 'P11');
buildDomainLedger('P12', p12, 'P12');
buildDomainLedger('P20', p20, 'P20');
buildDomainLedger('P27', p27, 'P27');
buildDomainLedger('P29', p29, 'P29');
buildDomainLedger('P09', p09, 'P09');


// ------------------------------------------------------------- P10 and P08
/*
 * Neither phase carries any acceptance criteria — the column is empty for every
 * requirement — so each is judged against its own statement. Both factor
 * exactly into subjects by aspects: P10 is 16 by 15, P08 is 20 by 9. A
 * requirement is verified only where the aspect holds AND the subject exists,
 * with per-subject exceptions applied on top — an integration has no
 * posting-dated record for a period control to govern, and a subject with no
 * records at all has nothing for a records aspect to be true of.
 */
function buildAspectLedger(phase, spec) {
  const ledger = [];
  const problems = [];
  for (const r of allRequirements.filter((x) => x.phase === phase)) {
    const aspect = spec.aspects.find((a) => r.requirement.includes(a.match));
    const subject = spec.subjects[r.domain];
    if (!aspect) { problems.push(`no aspect matches ${r.requirement_id}`); continue; }
    if (!subject) { problems.push(`no subject verdict for "${r.domain}"`); continue; }

    const exception = spec.subject_exceptions?.[r.domain]?.[aspect.id];
    const aspectStatus = exception ? exception.split(' ')[0] : aspect.status;
    const verified = aspectStatus === 'met' && subject.exists === 'yes';

    ledger.push({
      requirement_id: r.requirement_id,
      domain: r.domain,
      aspect: aspect.name,
      verification: verified ? 'verified' : 'not_verified',
      subject_exists: subject.exists,
      aspect_status: aspectStatus,
      evidence: verified ? `${aspect.evidence} Subject: ${subject.note}` : '',
      gap: verified ? '' : [
        aspectStatus === 'met' ? '' : (exception ?? aspect.gap),
        subject.exists === 'yes' ? '' : `Subject ${subject.exists === 'no' ? 'not built' : 'partial'}: ${subject.note}`,
      ].filter(Boolean).join(' '),
    });
  }

  if (problems.length) {
    console.error(`The ${phase} verdicts do not cover every requirement:`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }

  const cols = ['requirement_id', 'domain', 'aspect', 'verification',
                'subject_exists', 'aspect_status', 'gap', 'evidence'];
  const body = [cols.join(','),
    ...ledger.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
  const out = join(G, `traceability/verification/${phase}-ledger.csv`);
  if (process.argv.includes('--check')) {
    let cur = '';
    try { cur = readFileSync(out, 'utf8'); } catch { /* not generated yet */ }
    if (cur !== body) { console.error(`${phase} verification ledger is out of date. Run: npm run verification`); process.exit(1); }
    console.log(`${phase} verification ledger matches the verdicts (${ledger.length} requirements).`);
  } else {
    writeFileSync(out, body);
  }

  const v = ledger.filter((r) => r.verification === 'verified').length;
  const metAspects = spec.aspects.filter((a) => a.status === 'met').length;
  const builtSubjects = Object.values(spec.subjects).filter((x) => x.exists === 'yes').length;
  console.log(`\n${phase}: ${ledger.length} requirements, ${v} verified, ${ledger.length - v} not verified`);
  console.log(`  aspects: ${metAspects} of ${spec.aspects.length} met`);
  console.log(`  subjects: ${builtSubjects} built, ` +
    `${Object.values(spec.subjects).filter((x) => x.exists === 'partial').length} partial, ` +
    `${Object.values(spec.subjects).filter((x) => x.exists === 'no').length} not built`);
}

buildAspectLedger('P10', p10);
buildAspectLedger('P08', p08);
