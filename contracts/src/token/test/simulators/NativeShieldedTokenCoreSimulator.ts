import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  type Maybe,
  Contract as MockNativeShieldedTokenCore,
  type QualifiedShieldedCoinInfo,
  type ShieldedCoinInfo,
  type ZswapCoinPublicKey,
} from '../../../../artifacts/MockNativeShieldedTokenCore/contract/index.js';

/**
 * The core module declares no witnesses, so the private state is empty and the
 * witnesses object is `{}`.
 */
export type NativeShieldedTokenCorePrivateState = Record<string, never>;
export const NativeShieldedTokenCorePrivateState: NativeShieldedTokenCorePrivateState =
  {};
export const NativeShieldedTokenCoreWitnesses = () => ({});

/**
 * Type constructor args — mirrors `MockNativeShieldedTokenCore`'s constructor:
 * `(name, symbol, decimals, init)`. The core profile has no sealed `_domain`;
 * the domain is a per-call circuit parameter on every issuance / burn circuit.
 */
type NativeShieldedTokenCoreArgs = readonly [
  name: string,
  symbol: string,
  decimals: bigint,
  init: boolean,
];

const NativeShieldedTokenCoreSimulatorBase = createSimulator<
  NativeShieldedTokenCorePrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof NativeShieldedTokenCoreWitnesses>,
  MockNativeShieldedTokenCore<NativeShieldedTokenCorePrivateState>,
  NativeShieldedTokenCoreArgs
>({
  contractFactory: (witnesses) =>
    new MockNativeShieldedTokenCore<NativeShieldedTokenCorePrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => NativeShieldedTokenCorePrivateState,
  contractArgs: (name, symbol, decimals, init) => [
    name,
    symbol,
    decimals,
    init,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => NativeShieldedTokenCoreWitnesses(),
  artifactName: 'MockNativeShieldedTokenCore',
});

/**
 * NativeShieldedTokenCore Simulator.
 *
 * Wraps the `MockNativeShieldedTokenCore` test contract, which composes the bare
 * domain-parameterized core module in isolation (no flavor wrapper, no supply
 * accounting, no derived-nonce extension). Exposes the raw init assertions
 * (`assertInitialized` / `assertNotInitialized`) that the single-token and
 * family wrappers do not surface.
 */
export class NativeShieldedTokenCoreSimulator extends NativeShieldedTokenCoreSimulatorBase {
  static async create(
    name: string,
    symbol: string,
    decimals: bigint,
    init: boolean,
    options: SimulatorOptions<
      NativeShieldedTokenCorePrivateState,
      ReturnType<typeof NativeShieldedTokenCoreWitnesses>
    > = {},
  ): Promise<NativeShieldedTokenCoreSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [name, symbol, decimals, init],
      options,
    ) as Promise<NativeShieldedTokenCoreSimulator>;
  }

  ///
  /// Metadata (contract-wide)
  ///

  /** @description Returns the token name. */
  public name(): Promise<string> {
    return this.circuits.impure.name();
  }

  /** @description Returns the token symbol. */
  public symbol(): Promise<string> {
    return this.circuits.impure.symbol();
  }

  /** @description Returns the decimals. */
  public decimals(): Promise<bigint> {
    return this.circuits.impure.decimals();
  }

  /**
   * @description Returns the coin color for `domain`
   * (`tokenType(domain, kernel.self())`), computed at call time.
   */
  public tokenColor(domain: Uint8Array): Promise<Uint8Array> {
    return this.circuits.impure.tokenColor(domain);
  }

  ///
  /// Mint / burn (per domain)
  ///

  /**
   * @description Mints `amount` of the `domain` token to `recipient` using a
   * caller-supplied nonce.
   */
  public _mint(
    domain: Uint8Array,
    recipient: Either<ZswapCoinPublicKey, ContractAddress>,
    amount: bigint,
    nonce: Uint8Array,
  ): Promise<ShieldedCoinInfo> {
    return this.circuits.impure._mint(domain, recipient, amount, nonce);
  }

  /** @description Burns `amount` from a same-tx `coin` of `domain`. */
  public _burn(
    domain: Uint8Array,
    coin: ShieldedCoinInfo,
    amount: bigint,
    refundTo: Either<ZswapCoinPublicKey, ContractAddress>,
  ): Promise<Maybe<ShieldedCoinInfo>> {
    return this.circuits.impure._burn(domain, coin, amount, refundTo);
  }

  /** @description Burns `amount` from a contract-held `coin` of `domain`. */
  public _burnFromSelf(
    domain: Uint8Array,
    coin: QualifiedShieldedCoinInfo,
    amount: bigint,
  ): Promise<Maybe<ShieldedCoinInfo>> {
    return this.circuits.impure._burnFromSelf(domain, coin, amount);
  }

  ///
  /// State reads and guards
  ///

  /** @description Whether the core module has been initialized. */
  public isInitialized(): Promise<boolean> {
    return this.circuits.impure.isInitialized();
  }

  /** @description Reverts unless the core module has been initialized. */
  public assertInitialized(): Promise<[]> {
    return this.circuits.impure.assertInitialized();
  }

  /** @description Reverts if the core module has already been initialized. */
  public assertNotInitialized(): Promise<[]> {
    return this.circuits.impure.assertNotInitialized();
  }
}
