import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockNativeShieldedTokenFamilyPublicSupply,
} from '../../../../artifacts/MockNativeShieldedTokenFamilyPublicSupply/contract/index.js';

/**
 * The family supply extension declares no witnesses, so the private state is
 * empty and the witnesses object is `{}`.
 */
export type NativeShieldedTokenFamilyPublicSupplyPrivateState = Record<
  string,
  never
>;
export const NativeShieldedTokenFamilyPublicSupplyPrivateState: NativeShieldedTokenFamilyPublicSupplyPrivateState =
  {};
export const NativeShieldedTokenFamilyPublicSupplyWitnesses = () => ({});

/** The extension needs no initialization, so the constructor is nullary. */
type NativeShieldedTokenFamilyPublicSupplyArgs = readonly [];

const NativeShieldedTokenFamilyPublicSupplySimulatorBase = createSimulator<
  NativeShieldedTokenFamilyPublicSupplyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof NativeShieldedTokenFamilyPublicSupplyWitnesses>,
  MockNativeShieldedTokenFamilyPublicSupply<NativeShieldedTokenFamilyPublicSupplyPrivateState>,
  NativeShieldedTokenFamilyPublicSupplyArgs
>({
  contractFactory: (witnesses) =>
    new MockNativeShieldedTokenFamilyPublicSupply<NativeShieldedTokenFamilyPublicSupplyPrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => NativeShieldedTokenFamilyPublicSupplyPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => NativeShieldedTokenFamilyPublicSupplyWitnesses(),
  artifactName: 'MockNativeShieldedTokenFamilyPublicSupply',
});

/**
 * NativeShieldedTokenFamilyPublicSupply (extension) Simulator.
 *
 * Drives the per-domain accounting blocks (`_addMinted` / `_addBurned`) and
 * getters directly; the extension imports no token module.
 */
export class NativeShieldedTokenFamilyPublicSupplySimulator extends NativeShieldedTokenFamilyPublicSupplySimulatorBase {
  static async create(
    options: SimulatorOptions<
      NativeShieldedTokenFamilyPublicSupplyPrivateState,
      ReturnType<typeof NativeShieldedTokenFamilyPublicSupplyWitnesses>
    > = {},
  ): Promise<NativeShieldedTokenFamilyPublicSupplySimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [],
      options,
    ) as Promise<NativeShieldedTokenFamilyPublicSupplySimulator>;
  }

  /** @description Adds `amount` to the exact minted total for `domain`. */
  public _addMinted(domain: Uint8Array, amount: bigint): Promise<[]> {
    return this.circuits.impure._addMinted(domain, amount);
  }

  /** @description Adds `amount` to the contract-mediated burned total for `domain`. */
  public _addBurned(domain: Uint8Array, amount: bigint): Promise<[]> {
    return this.circuits.impure._addBurned(domain, amount);
  }

  /** @description Returns the exact amount ever minted for `domain`. */
  public totalMinted(domain: Uint8Array): Promise<bigint> {
    return this.circuits.impure.totalMinted(domain);
  }

  /** @description Returns the contract-mediated amount burned for `domain`. */
  public totalBurned(domain: Uint8Array): Promise<bigint> {
    return this.circuits.impure.totalBurned(domain);
  }

  /** @description Returns `totalMinted(domain) - totalBurned(domain)`. */
  public totalSupply(domain: Uint8Array): Promise<bigint> {
    return this.circuits.impure.totalSupply(domain);
  }

  /**
   * @description TEST-ONLY: writes `_totalBurned(domain)` directly, bypassing
   * the `burned <= minted` invariant, to reach the otherwise-unreachable
   * `burned > minted` state and exercise the `totalSupply` clamp.
   */
  public unsafeSetBurned(domain: Uint8Array, amount: bigint): Promise<[]> {
    return this.circuits.impure.unsafeSetBurned(domain, amount);
  }
}
