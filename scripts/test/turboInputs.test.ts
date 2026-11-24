import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, SRC } from '../live/paths.ts';

/**
 * A `compile:<category>` cache entry is keyed on its `inputs`, so they must
 * cover every category its sources import, through any chain of imports. A
 * missing one serves stale artifacts after an edit to the imported module.
 */

const TURBO = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'turbo.json'), 'utf8'),
) as { tasks: Record<string, { inputs?: string[] }> };

/** The path of a file import, whole (`import "p";`) or selective
 * (`import { a } from "p";`). A module-name import has no path. */
const IMPORT = /^\s*import\b[^;]*?"([^"]+)"/gm;

/** `src/` categories the sources under `src/<category>` import directly. */
function directImports(category: string): string[] {
  const dir = path.join(SRC, category);
  const found = new Set<string>();
  for (const file of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.compact')) continue;
    const abs = path.join(dir, file);
    for (const [, spec] of readFileSync(abs, 'utf8').matchAll(IMPORT)) {
      const rel = path.relative(SRC, path.resolve(path.dirname(abs), spec));
      if (!rel.startsWith('..')) found.add(rel.split(path.sep)[0]);
    }
  }
  return [...found];
}

/** Every category a `compile:<category>` artifact is built from: itself and
 * all it reaches through imports. */
function importedCategories(category: string): string[] {
  const found = new Set<string>();
  const pending = [category];
  while (pending.length > 0) {
    const c = pending.pop();
    if (c === undefined || found.has(c)) continue;
    found.add(c);
    pending.push(...directImports(c));
  }
  return [...found].sort();
}

const CATEGORIES = readdirSync(SRC, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

describe('turbo compile inputs', () => {
  it.each(CATEGORIES)('compile:%s covers every category it reaches', (c) => {
    const inputs = TURBO.tasks[`compile:${c}`]?.inputs ?? [];

    expect(
      importedCategories(c).filter(
        (dep) => !inputs.includes(`src/${dep}/**/*.compact`),
      ),
    ).toStrictEqual([]);
  });
});
