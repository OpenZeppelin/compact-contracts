import fc from 'fast-check';
import { Uint256Simulator } from './simulators/Uint256Simulator.js';
import { MAX_UINT256 } from './utils/consts.js';
import { describeRelation, relationCase } from './utils/forgeries.js';
import {
  fromU256,
  toBytesLE,
  toU256,
  toVecLE,
  type U256Limbs,
} from './utils/oracles.js';
import { Uint64Witnesses } from './witnesses/Uint64Witnesses.js';

/**
 * ZKIR v2 relation tests of the `Uint256` witness circuits (INV-1, INV-5,
 * INV-18, INV-25). See `utils/forgeries.ts`.
 */

const BOUNDARY: [U256Limbs][] = [
  [toU256(0n)],
  [toU256(1n)],
  [toU256(MAX_UINT256)],
  [toU256(1n << 192n)],
];
const FORGERIES: [U256Limbs][] = [
  [
    toU256(
      0x8000000000000002_0000000000000003_0102030405060708_ff00ff00ff00ff00n,
    ),
  ],
];
const u256 = fc.tuple(
  fc.bigInt({ min: 0n, max: MAX_UINT256 }).map((value) => toU256(value)),
);

describeRelation('MockUint256', {
  simulator: () => Uint256Simulator.create(),
  witnesses: () => {
    const { wit_uint64ToUnpackedBytes } = Uint64Witnesses();
    return { wit_uint64ToUnpackedBytes };
  },
  cases: [
    relationCase<Uint256Simulator, [U256Limbs]>({
      circuit: 'toUnpackedBytes',
      call: (s, value) => s.toUnpackedBytes(value),
      oracle: (value) => toVecLE(fromU256(value), 32),
      boundary: BOUNDARY,
      random: u256,
      forgeries: FORGERIES,
    }),
    relationCase<Uint256Simulator, [U256Limbs]>({
      circuit: 'toBytes',
      call: (s, value) => s.toBytes(value),
      oracle: (value) => toBytesLE(fromU256(value), 32),
      boundary: BOUNDARY,
      random: u256,
      forgeries: FORGERIES,
    }),
  ],
});
