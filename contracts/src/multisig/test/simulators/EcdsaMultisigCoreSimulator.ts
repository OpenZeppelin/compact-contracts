import type { Secp256k1Point } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import type { EcdsaSignature } from '#test-utils/fixtures/ecdsa.js';
import {
  ledger,
  Contract as MockEcdsaMultisigCore,
  pureCircuits,
} from '../../../../artifacts/MockEcdsaMultisigCore/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

type EcdsaMultisigCoreArgs = readonly [
  instanceSalt: Uint8Array,
  signerCommitments: Uint8Array[],
  threshold: bigint,
];

const EcdsaMultisigCoreSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockEcdsaMultisigCore<EmptyPrivateState>,
  EcdsaMultisigCoreArgs
>({
  contractFactory: (witnesses) =>
    new MockEcdsaMultisigCore<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (instanceSalt, signerCommitments, threshold) => [
    instanceSalt,
    signerCommitments,
    threshold,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'MockEcdsaMultisigCore',
});

/** Three signers at any threshold; `assertApprovals` at widths 1, 2 and 3. */
export class EcdsaMultisigCoreSimulator extends EcdsaMultisigCoreSimulatorBase {
  static async create(
    instanceSalt: Uint8Array,
    signerCommitments: Uint8Array[],
    threshold: bigint,
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<EcdsaMultisigCoreSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [instanceSalt, signerCommitments, threshold],
      options,
    ) as Promise<EcdsaMultisigCoreSimulator>;
  }

  /** Off-chain commitment derivation, as a deployer computes constructor args. */
  public static calculateSignerId(
    pk: Secp256k1Point,
    salt: Uint8Array,
  ): Uint8Array {
    return pureCircuits.calculateSignerId(pk, salt);
  }

  public assertApprovals1Approval(
    msgHash: Uint8Array,
    pubkeys: Secp256k1Point[],
    signatures: EcdsaSignature[],
  ): Promise<[]> {
    return this.circuits.impure.assertApprovals1Approval(
      msgHash,
      pubkeys,
      signatures,
    );
  }

  public assertApprovals2Approvals(
    msgHash: Uint8Array,
    pubkeys: Secp256k1Point[],
    signatures: EcdsaSignature[],
  ): Promise<[]> {
    return this.circuits.impure.assertApprovals2Approvals(
      msgHash,
      pubkeys,
      signatures,
    );
  }

  public assertApprovals3Approvals(
    msgHash: Uint8Array,
    pubkeys: Secp256k1Point[],
    signatures: EcdsaSignature[],
  ): Promise<[]> {
    return this.circuits.impure.assertApprovals3Approvals(
      msgHash,
      pubkeys,
      signatures,
    );
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
