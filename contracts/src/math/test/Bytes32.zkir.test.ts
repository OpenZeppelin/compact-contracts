import fc from 'fast-check';
import { Bytes32Simulator } from './simulators/Bytes32Simulator.js';
import { describeRelation, relationCase } from './utils/forgeries.js';
import { bytesLEToBigint, toBytesLE, toU256 } from './utils/oracles.js';
import { PackWitnesses } from './witnesses/PackWitnesses.js';

/**
 * ZKIR v2 relation tests of the `Bytes32` witness circuits (INV-1, INV-4,
 * INV-18, INV-25). See `utils/forgeries.ts`.
 */

const ZERO = new Uint8Array(32);
const MAX = new Uint8Array(32).fill(0xff);
const A = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 5) & 0xff);
const B = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 3) & 0xff);
const bytes32 = fc.uint8Array({ minLength: 32, maxLength: 32 });
const n = bytesLEToBigint;

const compare = (
  circuit: 'lt' | 'lte' | 'gt' | 'gte',
  oracle: (a: bigint, b: bigint) => boolean,
) =>
  relationCase<Bytes32Simulator, [Uint8Array, Uint8Array]>({
    circuit,
    call: (s, a, b) => s[circuit](a, b),
    oracle: (a, b) => oracle(n(a), n(b)),
    boundary: [
      [ZERO, ZERO],
      [ZERO, MAX],
      [MAX, ZERO],
      [MAX, MAX],
      [toBytesLE(1n << 255n, 32), toBytesLE((1n << 255n) - 1n, 32)],
    ],
    random: fc.tuple(bytes32, bytes32),
    forgeries: [[A, B]],
  });

describeRelation('MockBytes32', {
  simulator: () => Bytes32Simulator.create(),
  witnesses: () => PackWitnesses(),
  cases: [
    relationCase<Bytes32Simulator, [Uint8Array]>({
      circuit: 'unpack',
      call: (s, bytes) => s.unpack(bytes),
      oracle: (bytes) => Array.from(bytes, BigInt),
      boundary: [[ZERO], [MAX]],
      random: fc.tuple(bytes32),
      forgeries: [[A]],
    }),
    relationCase<Bytes32Simulator, [Uint8Array]>({
      circuit: 'bytesToU256',
      call: (s, bytes) => s.bytesToU256(bytes),
      oracle: (bytes) => toU256(n(bytes)),
      boundary: [[ZERO], [MAX], [toBytesLE(1n << 128n, 32)]],
      random: fc.tuple(bytes32),
      forgeries: [[A], [toBytesLE(1n << 200n, 32)]],
    }),
    compare('lt', (a, b) => a < b),
    compare('lte', (a, b) => a <= b),
    compare('gt', (a, b) => a > b),
    compare('gte', (a, b) => a >= b),
  ],
});
