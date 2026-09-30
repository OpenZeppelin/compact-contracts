import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockEcdsaMultisig2To1,
} from '../../../../artifacts/MockEcdsaMultisig2To1/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

type EcdsaMultisig2To1Args = readonly [
  instanceSalt: Uint8Array,
  signerCommitment: Uint8Array,
];

const EcdsaMultisig2To1SimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockEcdsaMultisig2To1<EmptyPrivateState>,
  EcdsaMultisig2To1Args
>({
  contractFactory: (witnesses) =>
    new MockEcdsaMultisig2To1<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (instanceSalt, signerCommitment) => [
    instanceSalt,
    signerCommitment,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'MockEcdsaMultisig2To1',
});

/** Width 2 over one signer; `create` must reject. */
export class EcdsaMultisig2To1Simulator extends EcdsaMultisig2To1SimulatorBase {
  static async create(
    instanceSalt: Uint8Array,
    signerCommitment: Uint8Array,
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<EcdsaMultisig2To1Simulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [instanceSalt, signerCommitment],
      options,
    ) as Promise<EcdsaMultisig2To1Simulator>;
  }

  public getThreshold(): Promise<bigint> {
    return this.circuits.impure.getThreshold();
  }
}
