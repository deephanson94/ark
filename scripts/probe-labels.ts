/** Throwaway: print ONLY the partition, so a mutation test hashes the answer
 *  and not the clock. `npx tsx scripts/probe-labels.ts <dumpdir>` */
import process from 'node:process';
import { louvain } from '../src/indexer/louvain.js';
import { loadDumps } from './probe-region-stats.js';
const dumps = await loadDumps(process.argv[2] ?? '');
for (const dump of dumps) {
  const degree = new Array<number>(dump.nodes).fill(0);
  for (const [a, b] of dump.edgeList) { if (a === b) continue; degree[a] = (degree[a] ?? 0) + 1; degree[b] = (degree[b] ?? 0) + 1; }
  const linked = new Array<number>(dump.nodes).fill(-1); const back: number[] = [];
  for (let i = 0; i < dump.nodes; i++) if ((degree[i] ?? 0) > 0) { linked[i] = back.length; back.push(i); }
  const edges: { from: number; to: number }[] = [];
  for (const [a, b] of dump.edgeList) { const x = linked[a] ?? -1, y = linked[b] ?? -1; if (x < 0 || y < 0 || x === y) continue; edges.push({ from: x, to: y }); }
  const r = louvain(back.length, edges, { resolution: 1, maxSweeps: 32, maxLevels: 16 });
  console.log(`${dump.repo} ${r.labels.join(',')}`);
}
