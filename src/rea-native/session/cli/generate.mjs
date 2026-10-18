import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, relative, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = dirname(fileURLToPath(import.meta.url));
const upstream = resolve(root, '../upstream/dist');
const names = ['cli.js', ...(await readdir(upstream)).filter(x => /^cli[A-Z].*\.js$/.test(x)), ...(await readdir(resolve(upstream, 'cli'))).filter(x => x.endsWith('.js')).map(x => `cli/${x}`)];
const copied = new Set(names);
const provenance = [];
for (const name of names) {
  const original = await readFile(resolve(upstream, name), 'utf8');
  let text = original.replace(/((?:from\s*|import\s*\()\s*["'])(\.[^"']+)(["'])/g, (_, lead, specifier, end) => {
    const target = posix.normalize(posix.join(posix.dirname(name), specifier));
    const destination = target === 'composition/directAnalysis.js' ? resolve(root, 'direct-analysis.mjs') : copied.has(target) ? resolve(root, 'source', target) : resolve(upstream, target);
    let path = relative(dirname(resolve(root, 'source', name)), destination).replaceAll('\\', '/');
    if (!path.startsWith('.')) path = `./${path}`;
    return lead + path + end;
  });
  const context = relative(dirname(resolve(root, 'source', name)), resolve(root, 'context.mjs')).replaceAll('\\', '/');
  const adaptations = [];
  if (text.includes('process.exitCode = 1;')) {
    text = `import { markFailure } from '${context}';\n` + text.replaceAll('process.exitCode = 1;', 'markFailure();');
    adaptations.push('process exit code becomes invocation failure');
  }
  if (name === 'cli/commandCancellation.js') {
    text = `import { currentInvocation } from '${context}';\nexport const withCommandCancellation = async operation => { const { signal } = currentInvocation(); signal.throwIfAborted(); return operation(signal); };\n`;
    adaptations.push('host abort signal replaces process signal listeners');
  }
  if (text.includes('process.stderr.write(`${JSON.stringify({ rea_progress: update })}\\n`);')) {
    text = `import { reportProgress } from '${context}';\n` + text.replaceAll('process.stderr.write(`${JSON.stringify({ rea_progress: update })}\\n`);', 'await reportProgress(update);');
    adaptations.push('progress callback replaces stderr');
  }
  const destination = resolve(root, 'source', name);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, text);
  provenance.push({ source: `upstream/dist/${name}`, sha256: createHash('sha256').update(original).digest('hex'), adaptedSha256: createHash('sha256').update(text).digest('hex'), adaptations });
}
await writeFile(resolve(root, 'provenance.json'), JSON.stringify({ version: '6.5.0', license: 'MIT', importRewriting: 'Local CLI boundaries; domain imports reuse bundled upstream source', files: provenance }, null, 2) + '\n');
console.log(JSON.stringify({ copied: names.length }));
