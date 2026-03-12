import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
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
} from '../../witnesses/UtilsWitnesses.js';

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
});

/**
 * Utils Simulator
 */
export class UtilsSimulator extends UtilsSimulatorBase {
  constructor(
    options: BaseSimulatorOptions<
      UtilsPrivateState,
      ReturnType<typeof UtilsWitnesses>
    > = {},
  ) {
    super([], options);
  }

  /**
   * @description Returns whether `keyOrAddress` is the zero address.
   * @param keyOrAddress The target value to check, either a ZswapCoinPublicKey or a ContractAddress.
   * @returns Returns true if `keyOrAddress` is zero.
   */
  public isKeyOrAddressZero(
    keyOrAddress: Either<ZswapCoinPublicKey, ContractAddress>,
  ): boolean {
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
  ): boolean {
    return this.circuits.pure.isKeyOrAddressEqual(keyOrAddress, other);
  }

  /**
   * @description Returns whether `key` is the zero address.
   * @param key The target value to check.
   * @returns Returns true if `key` is zero.
   */
  public isKeyZero(key: ZswapCoinPublicKey): boolean {
    return this.circuits.pure.isKeyZero(key);
  }

  /**
   * @description Returns whether `keyOrAddress` is a ContractAddress type.
   * @param keyOrAddress The target value to check, either a ZswapCoinPublicKey or a ContractAddress.
   * @returns Returns true if `keyOrAddress` is a ContractAddress
   */
  public isContractAddress(
    keyOrAddress: Either<ZswapCoinPublicKey, ContractAddress>,
  ): boolean {
    return this.circuits.pure.isContractAddress(keyOrAddress);
  }

  /**
   * @description  A helper function that returns the empty string: ""
   * @returns The empty string: ""
   */
  public emptyString(): string {
    return this.circuits.pure.emptyString();
  }
}
