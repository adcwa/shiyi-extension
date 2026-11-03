import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
await fs.mkdir(new URL('../src/vendor/', import.meta.url), { recursive: true });
// d3-dsv's general CSV converter uses dynamic compilation. Its equivalent
// closure keeps Mermaid's pie/XY inputs usable under MV3's strict script CSP.
const staticCSV = { name: 'static-csv-converter', setup(builder) {
  builder.onLoad({ filter: /(?:d3-dsv\/(?:src\/dsv|dist\/d3-dsv)|d3\/dist\/d3)\.(?:mjs|js)$/ }, async args => {
    const original = await fs.readFile(args.path, 'utf8');
    const start = original.indexOf('function objectConverter(columns) {'), end = original.indexOf('\nfunction customConverter', start);
    if (start < 0 || end < 0) throw new Error('Review d3-dsv converter before upgrading');
    return { contents: original.slice(0, start) + 'function objectConverter(columns) { return function(d) { return Object.fromEntries(columns.map((name, i) => [name, d[i] || ""])); }; }\n' + original.slice(end), loader: 'js' };
  });
} };
const result = await build({ entryPoints: [new URL('./summary-renderer-entry.js', import.meta.url).pathname], outfile: new URL('../src/vendor/summary-renderers.js', import.meta.url).pathname, bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', minify: true, legalComments: 'eof', logLevel: 'silent', plugins: [staticCSV], metafile: true });
let licenses = '点译 includes locally bundled renderers; no CDN or remote fonts.\n\n';
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs).filter(input => input.includes('node_modules/'))) {
  let directory = path.dirname(path.resolve(input));
  while (directory.includes('node_modules')) {
    try { const pkg = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')); if (pkg.name && pkg.version) { packages.set(pkg.name, { pkg, directory }); break; } } catch {}
    directory = path.dirname(directory);
  }
}
for (const [name, { pkg, directory }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  let license = '';
  for (const file of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'license', 'license.txt', 'license.md', 'LICENCE']) { try { license = await fs.readFile(path.join(directory, file), 'utf8'); break; } catch {} }
  licenses += `${name} ${pkg.version} (${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license)})\n${license || 'License identifier above; source notices are retained in the bundled script.'}\n\n`;
}
await fs.writeFile(new URL('../src/vendor/LICENSES.txt', import.meta.url), licenses);
console.log('Built local Markdown, Mermaid and MathML renderers.');
