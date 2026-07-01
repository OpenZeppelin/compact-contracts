import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockNativeShieldedTokenFamilySupply,
} from '../../../../artifacts/MockNativeShieldedTokenFamilySupply/contract/index.js';

/**
 * The family supply extension declares no witnesses, so the private state is
 * empty and the witnesses object is `{}`.
 */
export type NativeShieldedTokenFamilySupplyPrivateState = Record<string, never>;
export const NativeShieldedTokenFamilySupplyPrivateState: NativeShieldedTokenFamilySupplyPrivateState =
  {};
export const NativeShieldedTokenFamilySupplyWitnesses = () => ({});

/** The extension needs no initialization, so the constructor is nullary. */
type NativeShieldedTokenFamilySupplyArgs = readonly [];

const NativeShieldedTokenFamilySupplySimulatorBase = createSimulator<
  NativeShieldedTokenFamilySupplyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof NativeShieldedTokenFamilySupplyWitnesses>,
  MockNativeShieldedTokenFamilySupply<NativeShieldedTokenFamilySupplyPrivateState>,
  NativeShieldedTokenFamilySupplyArgs
>({
  contractFactory: (witnesses) =>
    new MockNativeShieldedTokenFamilySupply<NativeShieldedTokenFamilySupplyPrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => NativeShieldedTokenFamilySupplyPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => NativeShieldedTokenFamilySupplyWitnesses(),
  artifactName: 'MockNativeShieldedTokenFamilySupply',
});

/**
 * NativeShieldedTokenFamilySupply (extension) Simulator.
 *
 * Drives the per-domain accounting blocks (`_addMinted` / `_addBurned`) and
 * getters directly; the extension imports no token module.
 */
export class NativeShieldedTokenFamilySupplySimulator extends NativeShieldedTokenFamilySupplySimulatorBase {
  static async create(
    options: SimulatorOptions<
      NativeShieldedTokenFamilySupplyPrivateState,
      ReturnType<typeof NativeShieldedTokenFamilySupplyWitnesses>
    > = {},
  ): Promise<NativeShieldedTokenFamilySupplySimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [],
      options,
    ) as Promise<NativeShieldedTokenFamilySupplySimulator>;
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
}
