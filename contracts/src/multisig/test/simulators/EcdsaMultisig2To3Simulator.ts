import type { Secp256k1Point } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import type { EcdsaSignature } from '#test-utils/fixtures/ecdsa.js';
import {
  ledger,
  Contract as MockEcdsaMultisig2To3,
  pureCircuits,
} from '../../../../artifacts/MockEcdsaMultisig2To3/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

type EcdsaMultisigArgs = readonly [
  instanceSalt: Uint8Array,
  signerCommitments: Uint8Array[],
  isInit: boolean,
  reinitialize: boolean,
];

const EcdsaMultisig2To3SimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockEcdsaMultisig2To3<EmptyPrivateState>,
  EcdsaMultisigArgs
>({
  contractFactory: (witnesses) =>
    new MockEcdsaMultisig2To3<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (instanceSalt, signerCommitments, isInit, reinitialize) => [
    instanceSalt,
    signerCommitments,
    isInit,
    reinitialize,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'MockEcdsaMultisig2To3',
});

export class EcdsaMultisig2To3Simulator extends EcdsaMultisig2To3SimulatorBase {
  static async create(
    instanceSalt: Uint8Array,
    signerCommitments: Uint8Array[],
    isInit: boolean,
    reinitialize = false,
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<EcdsaMultisig2To3Simulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [instanceSalt, signerCommitments, isInit, reinitialize],
      options,
    ) as Promise<EcdsaMultisig2To3Simulator>;
  }

  /** Off-chain commitment derivation, as a deployer computes constructor args. */
  public static calculateSignerId(
    pk: Secp256k1Point,
    salt: Uint8Array,
  ): Uint8Array {
    return pureCircuits.calculateSignerId(pk, salt);
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

  public isSigner(commitment: Uint8Array): Promise<boolean> {
    return this.circuits.impure.isSigner(commitment);
  }
}
