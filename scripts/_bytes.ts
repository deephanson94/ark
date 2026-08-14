import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { createHash } from 'node:crypto';
const { atlas } = await buildIndex(indexOptions(process.argv[2]!));
console.log(createHash('sha256').update(JSON.stringify(atlas)).digest('hex').slice(0,16), process.argv[2]);
