import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function walk(directory) { let out = []; for (const entry of await fs.readdir(directory, { withFileTypes: true })) { const full = path.join(directory, entry.name); out.push(...entry.isDirectory() ? await walk(full) : [full]); } return out; }
let count = 0;
for (const full of await walk(path.join(root, 'src'))) {
  const source = await fs.readFile(full, 'utf8');
  if (full.endsWith('.js')) {
    const result = spawnSync(process.execPath, ['--check', full], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
    // The bundled renderer contains user-facing grammar examples such as
    // `from "..."`; it is one IIFE with no runtime imports (esbuild bundles it).
    const imports = full.includes(`${path.sep}vendor${path.sep}`) ? [] : source.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/g);
    for (const match of imports) {
      const target = match[1] || match[2]; if (!target.startsWith('.')) throw new Error(`Unexpected runtime dependency: ${target}`);
      await fs.access(path.resolve(path.dirname(full), target));
    }
    if (/\beval\s*\(|\bnew\s+Function\b/.test(source)) throw new Error(`Dynamic execution in ${full}`);
    count++;
  }
  if (full.endsWith('.html') && (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(source) || /\son\w+\s*=/i.test(source))) throw new Error(`Inline script or handler in ${full}`);
}
const manifest = JSON.parse(await fs.readFile(path.join(root, 'src/manifest.json'), 'utf8'));
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const { VERSION } = await import('../src/lib/core.js');
if (manifest.version !== pkg.version || VERSION !== pkg.version) throw new Error('Package, manifest and displayed extension versions must match');
const origins = ['http://*/*', 'https://*/*'];
if (!manifest.permissions.includes('sidePanel') || manifest.side_panel?.default_path) throw new Error('Summary panels must be tab-specific, without a global manifest fallback');
const script = manifest.content_scripts?.[0];
if (manifest.manifest_version !== 3 || JSON.stringify(manifest.host_permissions) !== JSON.stringify(origins) || manifest.optional_host_permissions?.length || manifest.content_scripts?.length !== 1 || JSON.stringify(script.matches) !== JSON.stringify(origins) || script.all_frames !== false || manifest.permissions.includes('tabs') || !manifest.permissions.includes('contextMenus') || manifest.externally_connectable || manifest.web_accessible_resources) throw new Error('Unexpected page or context-menu permissions');
for (const file of [...script.js, ...script.css]) await fs.access(path.join(root, 'src', file));
console.log(`Checked ${count} scripts, local module imports, CSP-compatible HTML, HTTP(S)-only default injection, and native context-menu permission.`);
