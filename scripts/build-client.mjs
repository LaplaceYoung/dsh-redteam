import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

const result = await build({
  entryPoints: ['src/client-entry.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  external: ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
  write: false,
  target: 'es2022'
});
const body = result.outputFiles[0].text;
await mkdir('lib', { recursive: true });
await writeFile('lib/client.js', `window.__ModuleLoader__.load({id:'dsh-redteam',factory:(require)=>{const module={exports:{}};${body}\nreturn module.exports;}});\n`, 'utf8');
