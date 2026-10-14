import fc from 'fast-check';
import { Bytes8Simulator } from './simulators/Bytes8Simulator.js';
import { describeRelation, relationCase } from './utils/forgeries.js';
import { bytesLEToBigint, toBytesLE } from './utils/oracles.js';
import { PackWitnesses } from './witnesses/PackWitnesses.js';

/**
 * ZKIR v2 relation tests of the `Bytes8` witness circuits (INV-1, INV-4,
 * INV-18, INV-25). See `utils/forgeries.ts`.
 */

const BOUNDARY: [Uint8Array][] = [
  [new Uint8Array(8)],
  [new Uint8Array(8).fill(0xff)],
  [toBytesLE(1n, 8)],
];
const FORGERIES: [Uint8Array][] = [
  [Uint8Array.from([0x11, 0, 0xff, 7, 9, 0x80, 3, 0xc8])],
  [toBytesLE(1n << 56n, 8)],
];
const bytes8 = fc.tuple(fc.uint8Array({ minLength: 8, maxLength: 8 }));

describeRelation('MockBytes8', {
  simulator: () => Bytes8Simulator.create(),
  witnesses: () => PackWitnesses(),
  cases: [
    relationCase<Bytes8Simulator, [Uint8Array]>({
      circuit: 'unpack',
      call: (s, bytes) => s.unpack(bytes),
      oracle: (bytes) => Array.from(bytes, BigInt),
      boundary: BOUNDARY,
      random: bytes8,
      forgeries: FORGERIES,
    }),
    relationCase<Bytes8Simulator, [Uint8Array]>({
      circuit: 'bytesToUint64',
      call: (s, bytes) => s.bytesToUint64(bytes),
      oracle: (bytes) => bytesLEToBigint(bytes),
      boundary: BOUNDARY,
      random: bytes8,
      forgeries: FORGERIES,
    }),
  ],
});
