import type { Secp256k1Point } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import type { EcdsaSignature } from '#test-utils/fixtures/ecdsa.js';
import {
  ledger,
  Contract as MockSecp256k1EcdsaMultisig1To1,
} from '../../../../artifacts/MockSecp256k1EcdsaMultisig1To1/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

type Secp256k1EcdsaMultisig1To1Args = readonly [
  instanceSalt: Uint8Array,
  signerCommitment: Uint8Array,
];

const Secp256k1EcdsaMultisig1To1SimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockSecp256k1EcdsaMultisig1To1<EmptyPrivateState>,
  Secp256k1EcdsaMultisig1To1Args
>({
  contractFactory: (witnesses) =>
    new MockSecp256k1EcdsaMultisig1To1<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (instanceSalt, signerCommitment) => [
    instanceSalt,
    signerCommitment,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'MockSecp256k1EcdsaMultisig1To1',
});

/** One-signer deploys; the 2-of-3 mock's `Vector<3>` cannot reach them. */
export class Secp256k1EcdsaMultisig1To1Simulator extends Secp256k1EcdsaMultisig1To1SimulatorBase {
  static async create(
    instanceSalt: Uint8Array,
    signerCommitment: Uint8Array,
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<Secp256k1EcdsaMultisig1To1Simulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [instanceSalt, signerCommitment],
      options,
    ) as Promise<Secp256k1EcdsaMultisig1To1Simulator>;
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
