import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockUtils,
  type ZswapCoinPublicKey,
} from '../../../../artifacts/MockUtils/contract/index.js';
import {
  UtilsPrivateState,
  UtilsWitnesses,
} from '../witnesses/UtilsWitnesses.js';

/**
 * Type constructor args
 */
type UtilsArgs = readonly [];

const UtilsSimulatorBase = createSimulator<
  UtilsPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof UtilsWitnesses>,
  MockUtils<UtilsPrivateState>,
  UtilsArgs
>({
  contractFactory: (witnesses) => new MockUtils<UtilsPrivateState>(witnesses),
  defaultPrivateState: () => UtilsPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => UtilsWitnesses(),
  artifactName: 'MockUtils',
});

/**
 * Utils Simulator
 */
export class UtilsSimulator extends UtilsSimulatorBase {
  static async create(
    options: SimulatorOptions<
      UtilsPrivateState,
      ReturnType<typeof UtilsWitnesses>
    > = {},
  ): Promise<UtilsSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<UtilsSimulator>;
  }

  /**
   * @description Returns whether `keyOrAddress` is the zero address.
   * @param keyOrAddress The target value to check, either a ZswapCoinPublicKey or a ContractAddress.
   * @returns Returns true if `keyOrAddress` is zero.
   */
  public isKeyOrAddressZero(
    keyOrAddress: Either<ZswapCoinPublicKey, ContractAddress>,
  ): Promise<boolean> {
    return this.circuits.pure.isKeyOrAddressZero(keyOrAddress);
  }

  /**
   * @description Returns whether `keyOrAddress` is equal to `other`. Assumes that a ZswapCoinPublicKey
   * and a ContractAddress can never be equal
   *
   * @public
   * @param {Either<ZswapCoinPublicKey, ContractAddress>} keyOrAddress The target value to check
   * @param {Either<ZswapCoinPublicKey, ContractAddress>} other The other value to check
   * @returns {boolean} Returns true if `keyOrAddress` is is equal to `other`.
   */
  public isKeyOrAddressEqual(
    keyOrAddress: Either<ZswapCoinPublicKey, ContractAddress>,
    other: Either<ZswapCoinPublicKey, ContractAddress>,
  ): Promise<boolean> {
    return this.circuits.pure.isKeyOrAddressEqual(keyOrAddress, other);
  }

  /**
   * @description Returns whether `key` is the zero address.
   * @param key The target value to check.
   * @returns Returns true if `key` is zero.
   */
  public isKeyZero(key: ZswapCoinPublicKey): Promise<boolean> {
    return this.circuits.pure.isKeyZero(key);
  }

  /**
   * @description Returns whether `keyOrAddress` is a ContractAddress type.
   * @param keyOrAddress The target value to check, either a ZswapCoinPublicKey or a ContractAddress.
   * @returns Returns true if `keyOrAddress` is a ContractAddress
   */
  public isContractAddress(
    keyOrAddress: Either<ZswapCoinPublicKey, ContractAddress>,
  ): Promise<boolean> {
    return this.circuits.pure.isContractAddress(keyOrAddress);
  }

  /**
   * @description  A helper function that returns the empty string: ""
   * @returns The empty string: ""
   */
  public emptyString(): Promise<string> {
    return this.circuits.pure.emptyString();
  }

  /**
   * @description Zeroes out the unused side of an `Either` value.
   * @param keyOrAddress The value to canonicalize.
   * @returns The canonicalized value.
   */
  public canonicalizeKeyOrAddress(
    keyOrAddress: Either<ZswapCoinPublicKey, ContractAddress>,
  ): Promise<Either<ZswapCoinPublicKey, ContractAddress>> {
    return this.circuits.pure.canonicalizeKeyOrAddress(keyOrAddress);
  }

  /**
   * @description Returns the current contract's address wrapped as a
   * right-variant `Either<ZswapCoinPublicKey, ContractAddress>`.
   * @returns The contract's own address as a recipient.
   */
  public selfAsRecipient(): Promise<
    Either<ZswapCoinPublicKey, ContractAddress>
  > {
    return this.circuits.impure.selfAsRecipient();
  }

  /**
   * @description The maximum value representable by a `Uint<128>`.
   * @returns `2^128 - 1`.
   */
  public UINT128_MAX(): Promise<bigint> {
    return this.circuits.pure.UINT128_MAX();
  }

  /**
   * @description Returns the canonical zero `Either<Bytes<32>, ContractAddress>` value
   * (left variant with zero `Bytes<32>`).
   * @returns The canonical zero value.
   */
  public zeroAccount(): Promise<Either<Uint8Array, ContractAddress>> {
    return this.circuits.pure.zeroAccount();
  }

  /**
   * @description Returns whether `target`'s active branch holds the zero value.
   * @param target The value to check.
   * @returns Returns true if the active branch is zero.
   */
  public isTargetZero(
    target: Either<Uint8Array, ContractAddress>,
  ): Promise<boolean> {
    return this.circuits.pure.isTargetZero(target);
  }

  /**
   * @description Computes an account identifier without on-chain state, allowing a user to
   * derive their identity commitment before submitting an operation.
   * @param secretKey A 32-byte cryptographically secure random value.
   * @returns The computed account identifier.
   */
  public computeAccountId(secretKey: Uint8Array): Promise<Uint8Array> {
    return this.circuits.pure.computeAccountId(secretKey);
  }
}
