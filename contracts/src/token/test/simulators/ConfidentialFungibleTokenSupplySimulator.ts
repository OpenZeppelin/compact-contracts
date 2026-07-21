import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockConfidentialFungibleTokenSupply,
} from '../../../../artifacts/MockConfidentialFungibleTokenSupply/contract/index.js';

/**
 * The supply extension declares no witnesses, so the private state is empty and
 * the witnesses object is `{}`.
 */
export type ConfidentialFungibleTokenSupplyPrivateState = Record<string, never>;
export const ConfidentialFungibleTokenSupplyPrivateState: ConfidentialFungibleTokenSupplyPrivateState =
  {};
export const ConfidentialFungibleTokenSupplyWitnesses = () => ({});

/** The supply extension needs no initialization, so the constructor is nullary. */
type ConfidentialFungibleTokenSupplyArgs = readonly [];

const ConfidentialFungibleTokenSupplySimulatorBase = createSimulator<
  ConfidentialFungibleTokenSupplyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialFungibleTokenSupplyWitnesses>,
  MockConfidentialFungibleTokenSupply<ConfidentialFungibleTokenSupplyPrivateState>,
  ConfidentialFungibleTokenSupplyArgs
>({
  contractFactory: (witnesses) =>
    new MockConfidentialFungibleTokenSupply<ConfidentialFungibleTokenSupplyPrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => ConfidentialFungibleTokenSupplyPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialFungibleTokenSupplyWitnesses(),
  artifactName: 'MockConfidentialFungibleTokenSupply',
});

/**
 * ConfidentialFungibleTokenSupply (extension) Simulator.
 *
 * Drives the scalar accounting blocks (`_addSupply` / `_subSupply`) and the
 * `totalSupply` getter directly; the extension imports no token module.
 */
export class ConfidentialFungibleTokenSupplySimulator extends ConfidentialFungibleTokenSupplySimulatorBase {
  static async create(
    options: SimulatorOptions<
      ConfidentialFungibleTokenSupplyPrivateState,
      ReturnType<typeof ConfidentialFungibleTokenSupplyWitnesses>
    > = {},
  ): Promise<ConfidentialFungibleTokenSupplySimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [],
      options,
    ) as Promise<ConfidentialFungibleTokenSupplySimulator>;
  }

  /** @description Increases the public total supply by `value` (overflow-checked). */
  public _addSupply(value: bigint): Promise<[]> {
    return this.circuits.impure._addSupply(value);
  }

  /** @description Decreases the public total supply by `value` (underflow-checked). */
  public _subSupply(value: bigint): Promise<[]> {
    return this.circuits.impure._subSupply(value);
  }

  /** @description Returns the public total token supply. */
  public totalSupply(): Promise<bigint> {
    return this.circuits.impure.totalSupply();
  }
}
