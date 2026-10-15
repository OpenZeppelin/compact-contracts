import fc from 'fast-check';
import { PackSimulator } from './simulators/PackSimulator.js';
import { describeRelation, relationCase } from './utils/forgeries.js';
import { toBytesLE } from './utils/oracles.js';
import { PackWitnesses } from './witnesses/PackWitnesses.js';

/**
 * ZKIR v2 relation tests of `Pack.unpack` for N = 8, 16 and 32 (INV-1,
 * INV-4, INV-18, INV-25). See `utils/forgeries.ts`.
 */

const unpack = (circuit: 'unpack8' | 'unpack16' | 'unpack32', n: number) =>
  relationCase<PackSimulator, [Uint8Array]>({
    circuit,
    call: (s, bytes) => s[circuit](bytes),
    oracle: (bytes) => Array.from(bytes, BigInt),
    boundary: [
      [new Uint8Array(n)],
      [new Uint8Array(n).fill(0xff)],
      [toBytesLE(1n, n)],
    ],
    random: fc.tuple(fc.uint8Array({ minLength: n, maxLength: n })),
    forgeries: [
      [Uint8Array.from({ length: n }, (_, i) => (i * 37 + 5) & 0xff)],
      [toBytesLE(0x80n, n)],
    ],
  });

describeRelation('MockPack', {
  simulator: () => PackSimulator.create(),
  witnesses: () => PackWitnesses(),
  cases: [unpack('unpack8', 8), unpack('unpack16', 16), unpack('unpack32', 32)],
});
