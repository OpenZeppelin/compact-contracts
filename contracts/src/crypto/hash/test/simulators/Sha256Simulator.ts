// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.4.0-alpha.1 (crypto/hash/test/simulators/Sha256Simulator.ts)

import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockSha256,
} from '../../../../../artifacts/MockSha256/contract/index.js';

type EmptyPrivateState = Record<string, never>;
const EmptyPrivateState: EmptyPrivateState = {};
const emptyWitnesses = () => ({});

const Sha256SimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockSha256<EmptyPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) => new MockSha256<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'MockSha256',
});

export class Sha256Simulator extends Sha256SimulatorBase {
  static async create(
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<Sha256Simulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<Sha256Simulator>;
  }

  public digest(value: Uint8Array): Promise<Uint8Array> {
    return this.circuits.impure.digest(value);
  }

  public hashToField(msg: Uint8Array, DST: Uint8Array): Promise<bigint> {
    return this.circuits.impure.hashToField(msg, DST);
  }
}
