import type { Secp256k1Point } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import type { EcdsaSignature } from '#test-utils/fixtures/ecdsa.js';
import {
  ledger,
  Contract as MockEcdsaSignerManager,
  pureCircuits,
} from '../../../../artifacts/MockEcdsaSignerManager/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

type EcdsaSignerManagerArgs = readonly [
  instanceSalt: Uint8Array,
  signerCommitments: Uint8Array[],
  threshold: bigint,
];

const EcdsaSignerManagerSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockEcdsaSignerManager<EmptyPrivateState>,
  EcdsaSignerManagerArgs
>({
  contractFactory: (witnesses) =>
    new MockEcdsaSignerManager<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (instanceSalt, signerCommitments, threshold) => [
    instanceSalt,
    signerCommitments,
    threshold,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'MockEcdsaSignerManager',
});

export class EcdsaSignerManagerSimulator extends EcdsaSignerManagerSimulatorBase {
  static async create(
    instanceSalt: Uint8Array,
    signerCommitments: Uint8Array[],
    threshold: bigint,
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<EcdsaSignerManagerSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [instanceSalt, signerCommitments, threshold],
      options,
    ) as Promise<EcdsaSignerManagerSimulator>;
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
