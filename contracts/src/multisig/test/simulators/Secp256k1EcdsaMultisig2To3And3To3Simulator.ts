import type { Secp256k1Point } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import type { EcdsaSignature } from '#test-utils/fixtures/ecdsa.js';
import {
  ledger,
  Contract as MockSecp256k1EcdsaMultisig2To3And3To3,
} from '../../../../artifacts/MockSecp256k1EcdsaMultisig2To3And3To3/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

type Secp256k1EcdsaMultisig2To3And3To3Args = readonly [
  instanceSalt: Uint8Array,
  signerCommitments: Uint8Array[],
  initializeThree: boolean,
];

const Secp256k1EcdsaMultisig2To3And3To3SimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockSecp256k1EcdsaMultisig2To3And3To3<EmptyPrivateState>,
  Secp256k1EcdsaMultisig2To3And3To3Args
>({
  contractFactory: (witnesses) =>
    new MockSecp256k1EcdsaMultisig2To3And3To3<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (instanceSalt, signerCommitments, initializeThree) => [
    instanceSalt,
    signerCommitments,
    initializeThree,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'MockSecp256k1EcdsaMultisig2To3And3To3',
});

/** Widths 2 and 3 over one shared `Signer` registry. */
export class Secp256k1EcdsaMultisig2To3And3To3Simulator extends Secp256k1EcdsaMultisig2To3And3To3SimulatorBase {
  static async create(
    instanceSalt: Uint8Array,
    signerCommitments: Uint8Array[],
    initializeThree: boolean,
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<Secp256k1EcdsaMultisig2To3And3To3Simulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [instanceSalt, signerCommitments, initializeThree],
      options,
    ) as Promise<Secp256k1EcdsaMultisig2To3And3To3Simulator>;
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

  public getThreshold2(): Promise<bigint> {
    return this.circuits.impure.getThreshold2();
  }

  public getThreshold3(): Promise<bigint> {
    return this.circuits.impure.getThreshold3();
  }
}
