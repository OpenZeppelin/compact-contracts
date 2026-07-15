import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockSupply,
} from '../../../../artifacts/MockConfidentialNoteTokenSupply/contract/index.js';
import {
  type ConfidentialNoteTokenSupplyPrivateState,
  ConfidentialNoteTokenSupplyWitnesses,
  ConfidentialNoteTokenSupplyPrivateState as PrivateState,
} from '../witnesses/ConfidentialNoteTokenSupplyWitnesses.js';

const ConfidentialNoteTokenSupplySimulatorBase = createSimulator<
  ConfidentialNoteTokenSupplyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialNoteTokenSupplyWitnesses>,
  MockSupply<ConfidentialNoteTokenSupplyPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new MockSupply<ConfidentialNoteTokenSupplyPrivateState>(witnesses),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialNoteTokenSupplyWitnesses(),
  artifactName: 'MockConfidentialNoteTokenSupply',
});

export class ConfidentialNoteTokenSupplySimulator extends ConfidentialNoteTokenSupplySimulatorBase {
  static async create(
    options: SimulatorOptions<
      ConfidentialNoteTokenSupplyPrivateState,
      ReturnType<typeof ConfidentialNoteTokenSupplyWitnesses>
    > = {},
  ): Promise<ConfidentialNoteTokenSupplySimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    return super.create(
      [],
      options,
    ) as Promise<ConfidentialNoteTokenSupplySimulator>;
  }

  public initialize(supplyKey: JubjubPoint): Promise<[]> {
    return this.circuits.impure.initialize(supplyKey);
  }

  public addMinted(value: bigint): Promise<[]> {
    return this.circuits.impure._addMinted(value);
  }

  public addBurned(value: bigint): Promise<[]> {
    return this.circuits.impure._addBurned(value);
  }

  public attestSupply(total: bigint): Promise<[]> {
    return this.circuits.impure.attestSupply(total);
  }

  public readonly privateState = {
    set: async (
      partial: Partial<ConfidentialNoteTokenSupplyPrivateState>,
    ): Promise<ConfidentialNoteTokenSupplyPrivateState> => {
      const updated = { ...(await this.getPrivateState()), ...partial };
      this.setPrivateState(updated);
      return updated;
    },
  };
}
