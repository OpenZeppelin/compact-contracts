/**
 * Privacy claims for math/UintN, read from its source. The module reads only
 * its arguments, publishes nothing and has no failure path, so whether a call
 * wrapped stays private to the caller.
 */

import { readFileSync } from 'node:fs';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(
  new URL('../UintN.compact', import.meta.url),
  'utf8',
);

/** Source lines that are code, not comments. */
const CODE_LINES = SOURCE.split('\n')
  .map((line) => line.trim())
  .filter(
    (line) =>
      !line.startsWith('/*') && !line.startsWith('*') && !line.startsWith('//'),
  );

const linesMatching = (pattern: RegExp): string[] =>
  CODE_LINES.filter((line) => pattern.test(line));

describe.skipIf(isLiveBackend())('UintN privacy: the module surface', () => {
  it('should declare no ledger state', () => {
    expect(linesMatching(/\bledger\b/)).toStrictEqual([]);
  });

  it('should declare no witness', () => {
    expect(linesMatching(/\bwitness\b/)).toStrictEqual([]);
  });

  it('should not disclose', () => {
    expect(linesMatching(/\bdisclose\s*\(/)).toStrictEqual([]);
  });

  it('should not assert', () => {
    expect(linesMatching(/\bassert\s*\(/)).toStrictEqual([]);
  });

  it('should export MODULUS, wrappingAdd and wrappingSub as pure circuits', () => {
    const names = linesMatching(/^export pure circuit /).map(
      (line) => line.match(/^export pure circuit (\w+)/)?.[1],
    );

    expect(names).toStrictEqual(['MODULUS', 'wrappingAdd', 'wrappingSub']);
  });

  it('should not export an impure circuit', () => {
    expect(linesMatching(/^export circuit\b/)).toStrictEqual([]);
  });

  it('should contain no if or for statement', () => {
    expect(linesMatching(/\b(if|for)\s*\(/)).toStrictEqual([]);
  });

  it('should cast each select as a whole, outside its arms', () => {
    expect(linesMatching(/\?/)).toStrictEqual([
      'return (wraps ? sum - modulus : sum) as Uint<N>;',
      'return (a < b ? diff + MODULUS() : diff) as Uint<N>;',
    ]);
  });
});
