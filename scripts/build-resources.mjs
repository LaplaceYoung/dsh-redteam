import { cp, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// Ship audited native modules and their provenance/licenses, not maintenance scripts.
const resources = [
  'vendor/runtime.mjs', 'vendor/runtime.d.mts', 'vendor/provenance.json', 'vendor/LICENSE', 'vendor/licenses',
  'evidence/runtime.mjs', 'evidence/runtime.d.mts', 'evidence/provenance.json', 'evidence/LICENSES',
  'session-evidence/runtime.mjs', 'session-evidence/runtime.d.mts', 'session-evidence/provenance.json', 'session-evidence/LICENSES',
];
for (const resource of resources) {
  const destination = `lib/rea-native/${resource}`;
  await mkdir(dirname(destination), { recursive: true });
  await cp(`src/rea-native/${resource}`, destination, { recursive: true });
}

// ARTEX policy text is copied verbatim; distribute its original license and source attribution.
await mkdir('lib/interception', { recursive: true });
await cp('src/interception/LICENSE-ARTEX.txt', 'lib/interception/LICENSE-ARTEX.txt');
await cp('docs/parity/interception-source.json', 'lib/interception/source.json');
