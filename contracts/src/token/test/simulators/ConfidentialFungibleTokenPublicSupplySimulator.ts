import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockConfidentialFungibleTokenPublicSupply,
} from '../../../../artifacts/MockConfidentialFungibleTokenPublicSupply/contract/index.js';

/**
 * The supply extension declares no witnesses, so the private state is empty and
 * the witnesses object is `{}`.
 */
export type ConfidentialFungibleTokenPublicSupplyPrivateState = Record<string, never>;
export const ConfidentialFungibleTokenPublicSupplyPrivateState: ConfidentialFungibleTokenPublicSupplyPrivateState =
  {};
export const ConfidentialFungibleTokenPublicSupplyWitnesses = () => ({});

/** The supply extension needs no initialization, so the constructor is nullary. */
type ConfidentialFungibleTokenPublicSupplyArgs = readonly [];

const ConfidentialFungibleTokenPublicSupplySimulatorBase = createSimulator<
  ConfidentialFungibleTokenPublicSupplyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialFungibleTokenPublicSupplyWitnesses>,
  MockConfidentialFungibleTokenPublicSupply<ConfidentialFungibleTokenPublicSupplyPrivateState>,
  ConfidentialFungibleTokenPublicSupplyArgs
>({
  contractFactory: (witnesses) =>
    new MockConfidentialFungibleTokenPublicSupply<ConfidentialFungibleTokenPublicSupplyPrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => ConfidentialFungibleTokenPublicSupplyPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialFungibleTokenPublicSupplyWitnesses(),
  artifactName: 'MockConfidentialFungibleTokenPublicSupply',
});

/**
 * ConfidentialFungibleTokenPublicSupply (extension) Simulator.
 *
 * Drives the scalar accounting blocks (`_addSupply` / `_subSupply`) and the
 * `totalSupply` getter directly; the extension imports no token module.
 */
export class ConfidentialFungibleTokenPublicSupplySimulator extends ConfidentialFungibleTokenPublicSupplySimulatorBase {
  static async create(
    options: SimulatorOptions<
      ConfidentialFungibleTokenPublicSupplyPrivateState,
      ReturnType<typeof ConfidentialFungibleTokenPublicSupplyWitnesses>
    > = {},
  ): Promise<ConfidentialFungibleTokenPublicSupplySimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [],
      options,
    ) as Promise<ConfidentialFungibleTokenPublicSupplySimulator>;
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
