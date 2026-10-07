import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockSecp256k1EcdsaMultisig2To1,
} from '../../../../artifacts/MockSecp256k1EcdsaMultisig2To1/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

type Secp256k1EcdsaMultisig2To1Args = readonly [
  instanceSalt: Uint8Array,
  signerCommitment: Uint8Array,
];

const Secp256k1EcdsaMultisig2To1SimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockSecp256k1EcdsaMultisig2To1<EmptyPrivateState>,
  Secp256k1EcdsaMultisig2To1Args
>({
  contractFactory: (witnesses) =>
    new MockSecp256k1EcdsaMultisig2To1<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (instanceSalt, signerCommitment) => [
    instanceSalt,
    signerCommitment,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'MockSecp256k1EcdsaMultisig2To1',
});

/** Width 2 over one signer; `create` must reject. */
export class Secp256k1EcdsaMultisig2To1Simulator extends Secp256k1EcdsaMultisig2To1SimulatorBase {
  static async create(
    instanceSalt: Uint8Array,
    signerCommitment: Uint8Array,
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<Secp256k1EcdsaMultisig2To1Simulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [instanceSalt, signerCommitment],
      options,
    ) as Promise<Secp256k1EcdsaMultisig2To1Simulator>;
  }

  public getThreshold(): Promise<bigint> {
    return this.circuits.impure.getThreshold();
  }
}
