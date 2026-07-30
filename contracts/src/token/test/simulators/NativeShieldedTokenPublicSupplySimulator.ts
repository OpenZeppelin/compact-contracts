import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockNativeShieldedTokenPublicSupply,
} from '../../../../artifacts/MockNativeShieldedTokenPublicSupply/contract/index.js';

/**
 * The supply extension declares no witnesses, so the private state is empty and
 * the witnesses object is `{}`.
 */
export type NativeShieldedTokenPublicSupplyPrivateState = Record<string, never>;
export const NativeShieldedTokenPublicSupplyPrivateState: NativeShieldedTokenPublicSupplyPrivateState =
  {};
export const NativeShieldedTokenPublicSupplyWitnesses = () => ({});

/** The supply extension needs no initialization, so the constructor is nullary. */
type NativeShieldedTokenPublicSupplyArgs = readonly [];

const NativeShieldedTokenPublicSupplySimulatorBase = createSimulator<
  NativeShieldedTokenPublicSupplyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof NativeShieldedTokenPublicSupplyWitnesses>,
  MockNativeShieldedTokenPublicSupply<NativeShieldedTokenPublicSupplyPrivateState>,
  NativeShieldedTokenPublicSupplyArgs
>({
  contractFactory: (witnesses) =>
    new MockNativeShieldedTokenPublicSupply<NativeShieldedTokenPublicSupplyPrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => NativeShieldedTokenPublicSupplyPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => NativeShieldedTokenPublicSupplyWitnesses(),
  artifactName: 'MockNativeShieldedTokenPublicSupply',
});

/**
 * NativeShieldedTokenPublicSupply (extension) Simulator.
 *
 * Drives the scalar accounting blocks (`_addMinted` / `_addBurned`) and getters
 * directly; the extension imports no token module.
 */
export class NativeShieldedTokenPublicSupplySimulator extends NativeShieldedTokenPublicSupplySimulatorBase {
  static async create(
    options: SimulatorOptions<
      NativeShieldedTokenPublicSupplyPrivateState,
      ReturnType<typeof NativeShieldedTokenPublicSupplyWitnesses>
    > = {},
  ): Promise<NativeShieldedTokenPublicSupplySimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [],
      options,
    ) as Promise<NativeShieldedTokenPublicSupplySimulator>;
  }

  /** @description Adds `amount` to the exact minted total. */
  public _addMinted(amount: bigint): Promise<[]> {
    return this.circuits.impure._addMinted(amount);
  }

  /** @description Adds `amount` to the contract-mediated burned total. */
  public _addBurned(amount: bigint): Promise<[]> {
    return this.circuits.impure._addBurned(amount);
  }

  /** @description Returns the exact amount ever minted. */
  public totalMinted(): Promise<bigint> {
    return this.circuits.impure.totalMinted();
  }

  /** @description Returns the contract-mediated amount burned (lower bound). */
  public totalBurned(): Promise<bigint> {
    return this.circuits.impure.totalBurned();
  }

  /** @description Returns `totalMinted() - totalBurned()` (upper bound on supply). */
  public totalSupply(): Promise<bigint> {
    return this.circuits.impure.totalSupply();
  }

  /**
   * @description TEST-ONLY: writes `_totalBurned` directly, bypassing the
   * `burned <= minted` invariant, to reach the otherwise-unreachable
   * `burned > minted` state and exercise the `totalSupply` clamp.
   */
  public unsafeSetBurned(amount: bigint): Promise<[]> {
    return this.circuits.impure.unsafeSetBurned(amount);
  }
}
