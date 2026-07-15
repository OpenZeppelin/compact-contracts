import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockCNT,
} from '../../../../artifacts/MockConfidentialNoteToken/contract/index.js';
import {
  type ConfidentialNoteTokenPrivateState,
  ConfidentialNoteTokenWitnesses,
  type Note,
  ConfidentialNoteTokenPrivateState as PrivateState,
} from '../witnesses/ConfidentialNoteTokenWitnesses.js';

const ConfidentialNoteTokenSimulatorBase = createSimulator<
  ConfidentialNoteTokenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialNoteTokenWitnesses>,
  MockCNT<ConfidentialNoteTokenPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new MockCNT<ConfidentialNoteTokenPrivateState>(witnesses),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialNoteTokenWitnesses(),
  artifactName: 'MockConfidentialNoteToken',
});

export class ConfidentialNoteTokenSimulator extends ConfidentialNoteTokenSimulatorBase {
  static async create(
    options: SimulatorOptions<
      ConfidentialNoteTokenPrivateState,
      ReturnType<typeof ConfidentialNoteTokenWitnesses>
    > = {},
  ): Promise<ConfidentialNoteTokenSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    return super.create([], options) as Promise<ConfidentialNoteTokenSimulator>;
  }

  public initialize(issuerPk: bigint): Promise<[]> {
    return this.circuits.impure.initialize(issuerPk);
  }

  public mint(recipientPk: bigint, value: bigint): Promise<Note> {
    return this.circuits.impure.mint(recipientPk, value);
  }

  public transfer(recipientPk: bigint, value: bigint): Promise<[Note, Note]> {
    return this.circuits.impure.transfer(recipientPk, value);
  }

  public burn(value: bigint): Promise<Note> {
    return this.circuits.impure.burn(value);
  }

  public consumeNote(ownerPk: bigint): Promise<Note> {
    return this.circuits.impure._consumeNote(ownerPk);
  }

  public readonly privateState = {
    // Configure the caller's identity and the note being spent next.
    set: async (
      partial: Partial<ConfidentialNoteTokenPrivateState>,
    ): Promise<ConfidentialNoteTokenPrivateState> => {
      const updated = { ...(await this.getPrivateState()), ...partial };
      this.setPrivateState(updated);
      return updated;
    },
  };
}
