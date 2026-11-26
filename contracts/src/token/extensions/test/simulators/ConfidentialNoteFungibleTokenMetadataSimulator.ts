import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockMetadata,
} from '../../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenMetadata/contract/index.js';

// The mock declares no witnesses, so the private state and witness set are
// both empty.
export type ConfidentialNoteFungibleTokenMetadataPrivateState = Record<
  string,
  never
>;
export const ConfidentialNoteFungibleTokenMetadataPrivateState: ConfidentialNoteFungibleTokenMetadataPrivateState =
  {};
export const ConfidentialNoteFungibleTokenMetadataWitnesses = () => ({});

type MetadataArgs = readonly [
  name: string,
  symbol: string,
  decimals: bigint,
  inits: bigint,
];

const ConfidentialNoteFungibleTokenMetadataSimulatorBase = createSimulator<
  ConfidentialNoteFungibleTokenMetadataPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialNoteFungibleTokenMetadataWitnesses>,
  MockMetadata<ConfidentialNoteFungibleTokenMetadataPrivateState>,
  MetadataArgs
>({
  contractFactory: (witnesses) =>
    new MockMetadata<ConfidentialNoteFungibleTokenMetadataPrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => ConfidentialNoteFungibleTokenMetadataPrivateState,
  contractArgs: (name, symbol, decimals, inits) => [
    name,
    symbol,
    decimals,
    inits,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialNoteFungibleTokenMetadataWitnesses(),
  artifactName: 'MockConfidentialNoteFungibleTokenMetadata',
});

/**
 * ConfidentialNoteFungibleTokenMetadata (standalone) simulator.
 */
export class ConfidentialNoteFungibleTokenMetadataSimulator extends ConfidentialNoteFungibleTokenMetadataSimulatorBase {
  /**
   * @param inits The number of `initialize` calls the constructor makes: 0
   * leaves the contract uninitialized, 2 reaches the second-call guard.
   */
  static async create(
    name: string,
    symbol: string,
    decimals: bigint,
    inits: bigint,
    options: SimulatorOptions<
      ConfidentialNoteFungibleTokenMetadataPrivateState,
      ReturnType<typeof ConfidentialNoteFungibleTokenMetadataWitnesses>
    > = {},
  ): Promise<ConfidentialNoteFungibleTokenMetadataSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [name, symbol, decimals, inits],
      options,
    ) as Promise<ConfidentialNoteFungibleTokenMetadataSimulator>;
  }

  public name(): Promise<string> {
    return this.circuits.impure.name();
  }

  public symbol(): Promise<string> {
    return this.circuits.impure.symbol();
  }

  public decimals(): Promise<bigint> {
    return this.circuits.impure.decimals();
  }
}
