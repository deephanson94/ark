/** Throwaway probe: print the Louvain regions themselves, so they can be read
 *  as names rather than as a number. `npx tsx scripts/probe-list.ts <dumps> <repos> <gamma>` */
import process from 'node:process';
import { louvain } from './prototype-louvain.js';
import { loadDumps } from './probe-region-stats.js';
import { bestDirectory } from './probe-nameable.js';

function prefixesOf(p: string): string[] {
  const parts = p.split('/'); const out = ['']; 
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}
const dumps = await loadDumps(process.argv[2] ?? '');
const want = new Set((process.argv[3] ?? '').split(',').filter((s) => s.length > 0));
const gamma = Number(process.argv[4] ?? 1);
for (const dump of dumps) {
  if (want.size > 0 && !want.has(dump.repo)) continue;
  const paths = dump.nodeRegion.map(([p]) => p);
  const filesUnder = new Map<string, number>();
  for (const p of paths) for (const x of prefixesOf(p)) filesUnder.set(x, (filesUnder.get(x) ?? 0) + 1);
  const degree = new Array<number>(dump.nodes).fill(0);
  for (const [a, b] of dump.edgeList) { if (a === b) continue; degree[a] = (degree[a] ?? 0) + 1; degree[b] = (degree[b] ?? 0) + 1; }
  const linked = new Array<number>(dump.nodes).fill(-1); const back: number[] = [];
  for (let i = 0; i < dump.nodes; i++) if ((degree[i] ?? 0) > 0) { linked[i] = back.length; back.push(i); }
  const edges: { from: number; to: number }[] = [];
  for (const [a, b] of dump.edgeList) { const x = linked[a] ?? -1, y = linked[b] ?? -1; if (x < 0 || y < 0 || x === y) continue; edges.push({ from: x, to: y }); }
  const r = louvain(back.length, edges, { resolution: gamma, maxSweeps: 32, maxLevels: 16 });
  const members = new Map<number, number[]>();
  for (let s = 0; s < back.length; s++) {
    const l = r.labels[s] ?? 0; const bucket = members.get(l);
    if (bucket === undefined) members.set(l, [back[s] ?? 0]); else bucket.push(back[s] ?? 0);
  }
  console.log(`\n### ${dump.repo} — ${members.size} Louvain regions over ${back.length} linked nodes (γ=${gamma})`);
  for (const [, m] of [...members.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const best = bestDirectory(m, paths, filesUnder);
    const dirs = new Map<string, number>();
    for (const n of m) { const p = paths[n] ?? ''; const s = p.lastIndexOf('/'); const d = s === -1 ? '(root)' : p.slice(0, s); dirs.set(d, (dirs.get(d) ?? 0) + 1); }
    const top = [...dirs.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(([d, c]) => `${d}×${c}`).join('  ');
    console.log(`${String(m.length).padStart(5)}  best=${(best.directory === '' ? '(root)' : best.directory).padEnd(26)} F1=${best.f1.toFixed(2)}  ${top}`);
  }
}
