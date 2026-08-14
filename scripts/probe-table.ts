/** PHASE 1 — render the survey rows written by `probe-supply.ts` as the tables the ADR carries. */
import { readFileSync } from 'node:fs';
import type { SupplyRow } from './probe-supply.js';

const rows = JSON.parse(readFileSync(process.argv[2] ?? '/tmp/ark-supply/_all.json', 'utf8')) as SupplyRow[];

/** The per-verb deck cap, from `src/verbs/sample.ts`. Reproduced so the table can say what bit. */
const capFor = (nodes: number): number => Math.max(40, Math.ceil(nodes / 8));

const pad = (s: string | number, n: number): string => String(s).padStart(n);
const R = (x: number, d = 1): string => x.toFixed(d);

console.log('## 1.1 The survey\n');
console.log('| repo | sha | nodes | edges/node | res% | closure med | closure mean | blast subjects | subj tainted% | boards | cap | verdict |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const b = r.verbs['blastRadius'];
  const cap = capFor(r.nodes);
  const boards = b?.generated ?? 0;
  const tainted = r.blastSubjects === 0 ? 0 : (r.blastSubjectsTainted / r.blastSubjects) * 100;
  const capped = b?.skipped['capped'] ?? 0;
  const ungraded = b?.skipped['ungradedLanguage'] ?? 0;
  // The classification rule, stated so it can be argued with. `capped > 0` means the deck cap
  // actually bit — supply exceeded what the product chose to ship. `uncertain > generated` means
  // guardrail 4 refused more subjects than the repo shipped boards. A repo that is neither (cobra)
  // is refused for a third reason entirely and must not be filed under taint: it has one package,
  // so there is nothing to predict, which is ADR-0024 §5's diagnosis and not a defect.
  const uncertain = b?.skipped['uncertain'] ?? 0;
  const verdict =
    ungraded > 0 ? 'ungraded language'
    : r.blastSubjects === 0 ? 'nothing to ask'
    : capped > 0 ? '**cap-limited**'
    : uncertain > boards ? '**taint-limited**'
    : 'nothing to predict';
  console.log(
    `| ${r.repo} | \`${r.sha.slice(0, 8)}\` | ${r.nodes} | ${R(r.edgesPerNode, 2)} | ${R(r.resolutionRate * 100)} | ` +
    `${R(r.closure.median)} | ${R(r.closure.mean)} | ${r.blastSubjects} | ${R(tainted)} | ${boards} | ${cap} | ${verdict} |`,
  );
}

console.log('\n## 1.2 Blast Radius refusals, per repo\n');
const REASONS = ['noDependents', 'uncertain', 'tooFewDistractors', 'ctrlF', 'duplicateKey', 'capped', 'ungradedLanguage'];
console.log(`| repo | considered | shipped | ${REASONS.join(' | ')} |`);
console.log(`|---|---|---|${REASONS.map(() => '---').join('|')}|`);
for (const r of rows) {
  const b = r.verbs['blastRadius'];
  if (b === undefined) { console.log(`| ${r.repo} | — | — | ${REASONS.map(() => '*deck refused*').join(' | ')} |`); continue; }
  console.log(
    `| ${r.repo} | ${b.considered} | ${b.generated} | ` +
    REASONS.map((k) => String(b.skipped[k] ?? 0)).join(' | ') + ' |',
  );
}

console.log('\n## 1.3 The other three verbs — boards shipped\n');
console.log('| repo | blast | companion | placement | archaeology | total | nodes | unprovable |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const g = (v: string): string => String(r.verbs[v]?.generated ?? '—');
  console.log(`| ${r.repo} | ${g('blastRadius')} | ${g('companion')} | ${g('placement')} | ${g('archaeology')} | ${r.totalChallenges} | ${r.nodes} | ${r.unprovableNodes} |`);
}

console.log('\n## 1.4 The other three verbs — refusals\n');
for (const verb of ['companion', 'placement', 'archaeology']) {
  const keys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.verbs[verb]?.skipped ?? {})) keys.add(k);
  const ks = [...keys].sort();
  console.log(`\n**${verb}**\n`);
  console.log(`| repo | considered | shipped | ${ks.join(' | ')} |`);
  console.log(`|---|---|---|${ks.map(() => '---').join('|')}|`);
  for (const r of rows) {
    const v = r.verbs[verb];
    if (v === undefined) continue;
    console.log(`| ${r.repo} | ${v.considered} | ${v.generated} | ${ks.map((k) => String(v.skipped[k] ?? 0)).join(' | ')} |`);
  }
}

// The distribution, not an average.
const eligible = rows.filter((r) => (r.verbs['blastRadius']?.skipped['ungradedLanguage'] ?? 0) === 0 && r.blastSubjects > 0);
const capLimited = eligible.filter((r) => (r.verbs['blastRadius']?.skipped['capped'] ?? 0) > 0);
const taintLimited = eligible.filter(
  (r) =>
    (r.verbs['blastRadius']?.skipped['capped'] ?? 0) === 0 &&
    (r.verbs['blastRadius']?.skipped['uncertain'] ?? 0) > (r.verbs['blastRadius']?.generated ?? 0),
);
const neither = eligible.filter((r) => !capLimited.includes(r) && !taintLimited.includes(r));
console.log('\n## 1.5 The distribution\n');
console.log(`eligible repos (a language that grades, ≥1 subject): ${eligible.length}`);
console.log(`  cap-limited      (the deck cap bit):          ${capLimited.length}  — ${capLimited.map((r) => r.repo).join(', ')}`);
console.log(`  taint-limited    (guardrail 4 refused more than it shipped): ${taintLimited.length}  — ${taintLimited.map((r) => r.repo).join(', ')}`);
console.log(`  neither          (nothing to predict):        ${neither.length}  — ${neither.map((r) => r.repo).join(', ')}`);
console.log('\nsubject-taint share, sorted:');
for (const r of [...eligible].sort((a, b) => a.blastSubjectsTainted / a.blastSubjects - b.blastSubjectsTainted / b.blastSubjects)) {
  const t = (r.blastSubjectsTainted / r.blastSubjects) * 100;
  console.log(`  ${r.repo.padEnd(22)} ${pad(R(t), 6)}%   res ${pad(R(r.resolutionRate * 100), 5)}%   closure~ ${pad(R(r.closure.median), 6)}   boards ${pad(r.verbs['blastRadius']?.generated ?? 0, 5)} / ${r.blastSubjects}`);
}
