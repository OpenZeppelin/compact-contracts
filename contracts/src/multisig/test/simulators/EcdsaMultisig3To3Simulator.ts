import type { Secp256k1Point } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import type { EcdsaSignature } from '#test-utils/fixtures/ecdsa.js';
import {
  ledger,
  Contract as MockEcdsaMultisig3To3,
} from '../../../../artifacts/MockEcdsaMultisig3To3/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

type EcdsaMultisig3To3Args = readonly [
  instanceSalt: Uint8Array,
  signerCommitments: Uint8Array[],
];

const EcdsaMultisig3To3SimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockEcdsaMultisig3To3<EmptyPrivateState>,
  EcdsaMultisig3To3Args
>({
  contractFactory: (witnesses) =>
    new MockEcdsaMultisig3To3<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (instanceSalt, signerCommitments) => [
    instanceSalt,
    signerCommitments,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'MockEcdsaMultisig3To3',
});

export class EcdsaMultisig3To3Simulator extends EcdsaMultisig3To3SimulatorBase {
  static async create(
    instanceSalt: Uint8Array,
    signerCommitments: Uint8Array[],
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<EcdsaMultisig3To3Simulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [instanceSalt, signerCommitments],
      options,
    ) as Promise<EcdsaMultisig3To3Simulator>;
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
