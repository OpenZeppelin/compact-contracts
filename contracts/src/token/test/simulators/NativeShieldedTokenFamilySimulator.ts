import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  type Maybe,
  type QualifiedShieldedCoinInfo,
  type ShieldedCoinInfo,
  type ZswapCoinPublicKey,
  Contract as MockNativeShieldedTokenFamily,
  ledger,
} from '../../../../artifacts/MockNativeShieldedTokenFamily/contract/index.js';

/**
 * The family core module declares no witnesses, so the private state is empty
 * and the witnesses object is `{}`.
 */
export type NativeShieldedTokenFamilyPrivateState = Record<string, never>;
export const NativeShieldedTokenFamilyPrivateState: NativeShieldedTokenFamilyPrivateState =
  {};
export const NativeShieldedTokenFamilyWitnesses = () => ({});

/**
 * Type constructor args — mirrors `MockNativeShieldedTokenFamily`'s
 * constructor: `(name, symbol, decimals, init)`. The Family profile has no
 * sealed `_domain`; the domain is a per-call circuit parameter instead.
 */
type NativeShieldedTokenFamilyArgs = readonly [
  name: string,
  symbol: string,
  decimals: bigint,
  init: boolean,
];

const NativeShieldedTokenFamilySimulatorBase = createSimulator<
  NativeShieldedTokenFamilyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof NativeShieldedTokenFamilyWitnesses>,
  MockNativeShieldedTokenFamily<NativeShieldedTokenFamilyPrivateState>,
  NativeShieldedTokenFamilyArgs
>({
  contractFactory: (witnesses) =>
    new MockNativeShieldedTokenFamily<NativeShieldedTokenFamilyPrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => NativeShieldedTokenFamilyPrivateState,
  contractArgs: (name, symbol, decimals, init) => [name, symbol, decimals, init],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => NativeShieldedTokenFamilyWitnesses(),
  artifactName: 'MockNativeShieldedTokenFamily',
});

/**
 * NativeShieldedTokenFamily (Family profile) Simulator.
 *
 * Same core standard as the Fungible profile with an explicit `domain`
 * parameter on every issuance / burn circuit. Wraps the
 * `MockNativeShieldedTokenFamily` test contract, which composes the family core
 * module in isolation (no supply accounting, no derived-nonce extension).
 */
export class NativeShieldedTokenFamilySimulator extends NativeShieldedTokenFamilySimulatorBase {
  static async create(
    name: string,
    symbol: string,
    decimals: bigint,
    init: boolean,
    options: SimulatorOptions<
      NativeShieldedTokenFamilyPrivateState,
      ReturnType<typeof NativeShieldedTokenFamilyWitnesses>
    > = {},
  ): Promise<NativeShieldedTokenFamilySimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [name, symbol, decimals, init],
      options,
    ) as Promise<NativeShieldedTokenFamilySimulator>;
  }

  ///
  /// Metadata (family-wide)
  ///

  /** @description Returns the family name shared by all token types. */
  public name(): Promise<string> {
    return this.circuits.impure.name();
  }

  /** @description Returns the family symbol shared by all token types. */
  public symbol(): Promise<string> {
    return this.circuits.impure.symbol();
  }

  /** @description Returns the family-wide decimals. */
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
  /// State reads
  ///

  /** @description Whether the family module has been initialized. */
  public isInitialized(): Promise<boolean> {
    return this.circuits.impure.isInitialized();
  }
}
