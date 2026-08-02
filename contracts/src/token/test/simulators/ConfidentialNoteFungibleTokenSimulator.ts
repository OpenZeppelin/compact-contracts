import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockCore,
} from '../../../../artifacts/MockConfidentialNoteFungibleToken/contract/index.js';
import {
  type ConfidentialNoteFungibleTokenPrivateState,
  ConfidentialNoteFungibleTokenWitnesses,
  type Note,
  ConfidentialNoteFungibleTokenPrivateState as PrivateState,
} from '../witnesses/ConfidentialNoteFungibleTokenWitnesses.js';

const ConfidentialNoteFungibleTokenSimulatorBase = createSimulator<
  ConfidentialNoteFungibleTokenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialNoteFungibleTokenWitnesses>,
  MockCore<ConfidentialNoteFungibleTokenPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new MockCore<ConfidentialNoteFungibleTokenPrivateState>(witnesses),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialNoteFungibleTokenWitnesses(),
  artifactName: 'MockConfidentialNoteFungibleToken',
});

export class ConfidentialNoteFungibleTokenSimulator extends ConfidentialNoteFungibleTokenSimulatorBase {
  static async create(
    options: SimulatorOptions<
      ConfidentialNoteFungibleTokenPrivateState,
      ReturnType<typeof ConfidentialNoteFungibleTokenWitnesses>
    > = {},
  ): Promise<ConfidentialNoteFungibleTokenSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    return super.create(
      [],
      options,
    ) as Promise<ConfidentialNoteFungibleTokenSimulator>;
  }

  public mint(recipientPk: bigint, value: bigint): Promise<Note> {
    return this.circuits.impure._mint(recipientPk, value);
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
      partial: Partial<ConfidentialNoteFungibleTokenPrivateState>,
    ): Promise<ConfidentialNoteFungibleTokenPrivateState> => {
      const updated = { ...(await this.getPrivateState()), ...partial };
      this.setPrivateState(updated);
      return updated;
    },
  };
}
