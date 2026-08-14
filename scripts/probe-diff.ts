/** PHASE 3/4 — before/after over the corpus, from two `probe-supply` output directories. */
import { readFileSync } from 'node:fs';
import type { SupplyRow } from './probe-supply.js';

const a = JSON.parse(readFileSync(`${process.argv[2]}/_all.json`, 'utf8')) as SupplyRow[];
const b = JSON.parse(readFileSync(`${process.argv[3]}/_all.json`, 'utf8')) as SupplyRow[];
const byRepo = new Map(b.map((r) => [r.repo, r]));

const capFor = (nodes: number): number => Math.max(40, Math.ceil(nodes / 8));
const boards = (r: SupplyRow): number => r.verbs['blastRadius']?.generated ?? 0;
const taintShare = (r: SupplyRow): number =>
  r.blastSubjects === 0 ? 0 : (r.blastSubjectsTainted / r.blastSubjects) * 100;

console.log('| repo | res% | subjects tainted% | **blast boards** | deck total | cap | verdict |');
console.log('|---|---|---|---|---|---|---|');
let gained = 0;
let lost = 0;
for (const before of a) {
  const after = byRepo.get(before.repo);
  if (after === undefined) continue;
  const d = boards(after) - boards(before);
  gained += Math.max(0, d);
  lost += Math.max(0, -d);
  const cap = capFor(after.nodes);
  const verdict = d === 0 ? '—' : d > 0 ? `**+${d}**` : `**${d}**`;
  const capped = boards(after) >= cap ? ' *(at cap)*' : '';
  console.log(
    `| ${before.repo} | ${(before.resolutionRate * 100).toFixed(1)} → ${(after.resolutionRate * 100).toFixed(1)} | ` +
    `${taintShare(before).toFixed(1)} → ${taintShare(after).toFixed(1)} | ${boards(before)} → **${boards(after)}**${capped} | ` +
    `${before.totalChallenges} → ${after.totalChallenges} | ${cap} | ${verdict} |`,
  );
}
console.log(`\nblast boards gained: **${gained}**, lost: **${lost}**`);

// Taint that got *worse*. Resolving a specifier does not delete it, it turns it into an EDGE — and
// an edge can carry taint out of the target's own closure. The marginal probe in §2 removed sites
// without adding edges, so it is an upper bound and this is where that shows.
console.log('\nrepos whose subject-taint share ROSE (the new-edge effect §2 could not see):');
for (const before of a) {
  const after = byRepo.get(before.repo);
  if (after === undefined) continue;
  const d = taintShare(after) - taintShare(before);
  if (d > 0.05) console.log(`  ${before.repo.padEnd(20)} ${taintShare(before).toFixed(1)}% → ${taintShare(after).toFixed(1)}%  (+${d.toFixed(1)})`);
}
