/**
 * NO COMPILED ARTIFACT REQUIRED: `test:harness` has no `compile` dependency.
 * `RelationForger` itself needs a compiled contract; the math specs test it.
 */

import { describe, expect, it } from 'vitest';
import { lenientSource, withLeaf, witnessLeaves } from '../forgery.js';

const GENERATED = `import * as __compactRuntime from '@midnight-ntwrk/compact-runtime';
__compactRuntime.checkRuntimeVersion('0.19.0');
function f(a, b) {
  __compactRuntime.assert(a < b, 'M: a < b');
  if (a > 1n) {
    throw new __compactRuntime.CompactError('cast failed: ' + a);
  }
  __compactRuntime.typeError('wit_x', 'return value', 'M.compact line 1', 'Uint<8>', a);
  return a;
}
${'//# sourceMapping'}URL=index.js.map
`;

describe('lenientSource', () => {
  const lenient = lenientSource(GENERATED, 'file:///runtime/index.js');

  it('imports the runtime from the given URL and reads the recorder', () => {
    expect(lenient).toContain(
      "import * as __compactRuntime from 'file:///runtime/index.js';",
    );
    expect(lenient).toContain(
      "globalThis[Symbol.for('@openzeppelin/compact-contracts/zkir/lenient')]",
    );
  });

  it('records assertions, casts and type checks instead of throwing', () => {
    expect(lenient).toContain("__lenient.assert(a < b, 'M: a < b');");
    expect(lenient).toContain("__lenient.fail('cast failed: ' + a);");
    expect(lenient).toContain("__lenient.typeError('wit_x',");
    expect(lenient).not.toMatch(/__compactRuntime\.(assert|typeError)\(/);
    expect(lenient).not.toContain('throw new __compactRuntime.CompactError');
    expect(lenient).toContain(
      "__compactRuntime.checkRuntimeVersion('0.19.0');",
    );
  });

  it('drops the source map comment', () => {
    expect(lenient).not.toContain('sourceMappingURL');
  });

  it('throws for a source without the runtime import', () => {
    expect(() => lenientSource('export {};', 'file:///x')).toThrow(
      'the runtime import was not found once',
    );
  });
});

describe('witnessLeaves and withLeaf', () => {
  const value = {
    quotient: { low: 1n, high: 2n },
    remainder: { low: 3n, high: 4n },
  };

  it('lists the leaves in declaration order', () => {
    expect(witnessLeaves(value)).toEqual([1n, 2n, 3n, 4n]);
    expect(witnessLeaves([5n, [6n, 7n]])).toEqual([5n, 6n, 7n]);
    expect(witnessLeaves(8n)).toEqual([8n]);
  });

  it('replaces one leaf and keeps the shape', () => {
    expect(withLeaf(value, 2, 9n)).toEqual({
      quotient: { low: 1n, high: 2n },
      remainder: { low: 9n, high: 4n },
    });
    expect(withLeaf([1n, 2n], 1, 0n)).toEqual([1n, 0n]);
  });

  it('rejects a leaf that does not exist and a value that is not a witness result', () => {
    expect(() => withLeaf(value, 4, 0n)).toThrow('witness value has no leaf 4');
    expect(() => witnessLeaves('x')).toThrow('unsupported witness value x');
    expect(() => withLeaf(['x'], 0, 0n)).toThrow('unsupported witness value x');
  });
});
