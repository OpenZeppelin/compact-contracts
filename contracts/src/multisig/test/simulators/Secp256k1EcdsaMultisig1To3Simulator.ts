import type { Secp256k1Point } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import type { EcdsaSignature } from '#test-utils/fixtures/ecdsa.js';
import {
  ledger,
  Contract as MockSecp256k1EcdsaMultisig1To3,
} from '../../../../artifacts/MockSecp256k1EcdsaMultisig1To3/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

type Secp256k1EcdsaMultisig1To3Args = readonly [
  instanceSalt: Uint8Array,
  signerCommitments: Uint8Array[],
];

const Secp256k1EcdsaMultisig1To3SimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockSecp256k1EcdsaMultisig1To3<EmptyPrivateState>,
  Secp256k1EcdsaMultisig1To3Args
>({
  contractFactory: (witnesses) =>
    new MockSecp256k1EcdsaMultisig1To3<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (instanceSalt, signerCommitments) => [
    instanceSalt,
    signerCommitments,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'MockSecp256k1EcdsaMultisig1To3',
});

export class Secp256k1EcdsaMultisig1To3Simulator extends Secp256k1EcdsaMultisig1To3SimulatorBase {
  static async create(
    instanceSalt: Uint8Array,
    signerCommitments: Uint8Array[],
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<Secp256k1EcdsaMultisig1To3Simulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [instanceSalt, signerCommitments],
      options,
    ) as Promise<Secp256k1EcdsaMultisig1To3Simulator>;
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
