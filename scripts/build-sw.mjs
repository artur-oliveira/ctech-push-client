// Copies src/sw.js to dist/sw.js, stamping the package version into SW_VERSION. Any byte change makes the browser
// update the worker, so the version bump is what ships a new worker.
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';

const {version} = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const src = readFileSync(new URL('../src/sw.js', import.meta.url), 'utf8');
if (!src.includes('__SW_VERSION__')) throw new Error('src/sw.js lost the __SW_VERSION__ placeholder');
mkdirSync(new URL('../dist/', import.meta.url), {recursive: true});
writeFileSync(new URL('../dist/sw.js', import.meta.url), src.replace('__SW_VERSION__', version));
