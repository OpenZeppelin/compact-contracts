// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.4.0-alpha.1 (crypto/curves/bls12-381/test/simulators/FqSimulator.ts)

import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockFq,
  type Fq_UniformBytes as UniformBytes,
} from '../../../../../../artifacts/MockFq/contract/index.js';

export type { UniformBytes };

type EmptyPrivateState = Record<string, never>;
const EmptyPrivateState: EmptyPrivateState = {};
const emptyWitnesses = () => ({});

const FqSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockFq<EmptyPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) => new MockFq<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'MockFq',
});

export class FqSimulator extends FqSimulatorBase {
  static async create(
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<FqSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<FqSimulator>;
  }

  public fromUniformBytes(tv: UniformBytes): Promise<bigint> {
    return this.circuits.impure.fromUniformBytes(tv);
  }

  public truncatedLEOS2IP(S: Uint8Array): Promise<bigint> {
    return this.circuits.impure.truncatedLEOS2IP(S);
  }

  public truncatedI2LEOSP(x: bigint): Promise<Uint8Array> {
    return this.circuits.impure.truncatedI2LEOSP(x);
  }
}
