import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockSupply,
} from '../../../../artifacts/MockConfidentialNoteFungibleTokenPrivateSupply/contract/index.js';
import {
  type ConfidentialNoteFungibleTokenPrivateSupplyPrivateState,
  ConfidentialNoteFungibleTokenPrivateSupplyWitnesses,
  ConfidentialNoteFungibleTokenPrivateSupplyPrivateState as PrivateState,
} from '../witnesses/ConfidentialNoteFungibleTokenPrivateSupplyWitnesses.js';

const ConfidentialNoteFungibleTokenPrivateSupplySimulatorBase = createSimulator<
  ConfidentialNoteFungibleTokenPrivateSupplyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialNoteFungibleTokenPrivateSupplyWitnesses>,
  MockSupply<ConfidentialNoteFungibleTokenPrivateSupplyPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new MockSupply<ConfidentialNoteFungibleTokenPrivateSupplyPrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialNoteFungibleTokenPrivateSupplyWitnesses(),
  artifactName: 'MockConfidentialNoteFungibleTokenPrivateSupply',
});

export class ConfidentialNoteFungibleTokenPrivateSupplySimulator extends ConfidentialNoteFungibleTokenPrivateSupplySimulatorBase {
  static async create(
    options: SimulatorOptions<
      ConfidentialNoteFungibleTokenPrivateSupplyPrivateState,
      ReturnType<typeof ConfidentialNoteFungibleTokenPrivateSupplyWitnesses>
    > = {},
  ): Promise<ConfidentialNoteFungibleTokenPrivateSupplySimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    return super.create(
      [],
      options,
    ) as Promise<ConfidentialNoteFungibleTokenPrivateSupplySimulator>;
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

  public rotateSupplyKey(newKey: JubjubPoint, total: bigint): Promise<[]> {
    return this.circuits.impure._rotateSupplyKey(newKey, total);
  }

  public readonly privateState = {
    set: async (
      partial: Partial<ConfidentialNoteFungibleTokenPrivateSupplyPrivateState>,
    ): Promise<ConfidentialNoteFungibleTokenPrivateSupplyPrivateState> => {
      const updated = { ...(await this.getPrivateState()), ...partial };
      this.setPrivateState(updated);
      return updated;
    },
  };
}
