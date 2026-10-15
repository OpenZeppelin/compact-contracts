import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { describe, expect, test } from 'vitest';
import { Bytes8Simulator } from './simulators/Bytes8Simulator.js';
import { Bytes32Simulator } from './simulators/Bytes32Simulator.js';
import { Field255Simulator } from './simulators/Field255Simulator.js';
import { PackSimulator } from './simulators/PackSimulator.js';
import { Uint64Simulator } from './simulators/Uint64Simulator.js';
import { Uint128Simulator } from './simulators/Uint128Simulator.js';
import { Uint256Simulator } from './simulators/Uint256Simulator.js';
import { toU256 } from './utils/oracles.js';

/**
 * The math mocks write a ledger counter (`_invocations`) only to make every
 * mock circuit impure. The counter is not exported, so the public state
 * that a simulator reads through its ledger extractor is empty, before and
 * after a call. These tests run on the dry backend only: on the live
 * backend each call is a proof, and the ported specs already make them.
 */

const cases: [
  string,
  () => Promise<{ getPublicState(): Promise<object> }>,
  (simulator: never) => Promise<unknown>,
][] = [
  [
    'MockPack',
    () => PackSimulator.create(),
    (s: PackSimulator) => s.unpack8(new Uint8Array(8)),
  ],
  [
    'MockBytes8',
    () => Bytes8Simulator.create(),
    (s: Bytes8Simulator) => s.bytesToUint64(new Uint8Array(8)),
  ],
  [
    'MockUint64',
    () => Uint64Simulator.create(),
    (s: Uint64Simulator) => s.div(7n, 2n),
  ],
  [
    'MockUint128',
    () => Uint128Simulator.create(),
    (s: Uint128Simulator) => s.sqrt(10n),
  ],
  [
    'MockUint256',
    () => Uint256Simulator.create(),
    (s: Uint256Simulator) => s.toBytes(toU256(5n)),
  ],
  [
    'MockBytes32',
    () => Bytes32Simulator.create(),
    (s: Bytes32Simulator) => s.isZero(new Uint8Array(32)),
  ],
  [
    'MockField255',
    () => Field255Simulator.create(),
    (s: Field255Simulator) => s.lt(1n, 2n),
  ],
];

describe.skipIf(isLiveBackend())('math mocks', () => {
  test.each(cases)(
    '%s exports no ledger field',
    async (_name, create, call) => {
      const simulator = await create();
      expect(await simulator.getPublicState()).toEqual({});
      await call(simulator as never);
      expect(await simulator.getPublicState()).toEqual({});
    },
  );
});
