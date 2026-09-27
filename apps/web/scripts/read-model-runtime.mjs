// Small Node runner for existing TypeScript server functions; never emits secrets.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import ts from 'typescript';
export const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = resolve(WEB, '../..');
const compiled = new Map();
export async function loadServerModule(relative) {
  const sourcePath = resolve(WEB, relative);
  async function compile(path) {
    if (compiled.has(path)) return compiled.get(path);
    const output = resolve(WEB, '.read-model-build', path.slice(WEB.length + 1).replace(/\.tsx?$/, '.mjs'));
    compiled.set(path, output);
    let source = (await readFile(path, 'utf8')).replace(/^import ["']server-only["'];?\s*$/gm, '');
    let js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const imports = [...js.matchAll(/from\s+["']([^"']+)["']/g)];
    for (const match of imports) {
      const name = match[1];
      if (!name.startsWith('.') && !name.startsWith('@/')) continue;
      const base = name.startsWith('@/') ? resolve(WEB, 'src', name.slice(2)) : resolve(dirname(path), name);
      let dependency;
      for (const ext of ['.ts', '.tsx']) { try { await readFile(base + ext); dependency = base + ext; break; } catch {} }
      if (!dependency) throw new Error(`Cannot resolve ${name}`);
      js = js.replaceAll(`"${name}"`, JSON.stringify(pathToFileURL(await compile(dependency)).href));
      js = js.replaceAll(`'${name}'`, JSON.stringify(pathToFileURL(await compile(dependency)).href));
    }
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, js);
    return output;
  }
  return import(pathToFileURL(await compile(sourcePath)).href);
}
export async function loadEnvironment() {
  for (const file of [resolve(ROOT, '.env'), resolve(ROOT, '.env.local'), resolve(WEB, '.env.local')]) {
    try {
      for (const line of (await readFile(file, 'utf8')).split(/\r?\n/)) {
        const m = line.match(/^([A-Za-z_][A-Za-z_0-9]*)=(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
      }
    } catch {}
  }
}
