import type { Secp256k1Point } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import type { EcdsaSignature } from '#test-utils/fixtures/ecdsa.js';
import {
  ledger,
  Contract as MockEcdsaMultisig1To1,
} from '../../../../artifacts/MockEcdsaMultisig1To1/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

type EcdsaMultisig1To1Args = readonly [
  instanceSalt: Uint8Array,
  signerCommitment: Uint8Array,
];

const EcdsaMultisig1To1SimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockEcdsaMultisig1To1<EmptyPrivateState>,
  EcdsaMultisig1To1Args
>({
  contractFactory: (witnesses) =>
    new MockEcdsaMultisig1To1<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (instanceSalt, signerCommitment) => [
    instanceSalt,
    signerCommitment,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'MockEcdsaMultisig1To1',
});

/** One-signer deploys; the 2-of-3 mock's `Vector<3>` cannot reach them. */
export class EcdsaMultisig1To1Simulator extends EcdsaMultisig1To1SimulatorBase {
  static async create(
    instanceSalt: Uint8Array,
    signerCommitment: Uint8Array,
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<EcdsaMultisig1To1Simulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [instanceSalt, signerCommitment],
      options,
    ) as Promise<EcdsaMultisig1To1Simulator>;
  }

  public assertApprovals(
    msgHash: Uint8Array,
    pubkeys: Secp256k1Point[],
    signatures: EcdsaSignature[],
  ): Promise<[]> {
    return this.circuits.impure.assertApprovals(msgHash, pubkeys, signatures);
  }

  public getSignerCount(): Promise<bigint> {
    return this.circuits.impure.getSignerCount();
  }

  public getThreshold(): Promise<bigint> {
    return this.circuits.impure.getThreshold();
  }
}
