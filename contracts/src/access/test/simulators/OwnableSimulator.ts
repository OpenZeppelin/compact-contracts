import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockOwnable,
  type ZswapCoinPublicKey,
} from '../../../../artifacts/MockOwnable/contract/index.js';
import {
  OwnablePrivateState,
  OwnableWitnesses,
} from '../../witnesses/OwnableWitnesses.js';

/**
 * Type constructor args
 */
type OwnableArgs = readonly [
  initialOwner: Either<ZswapCoinPublicKey, ContractAddress>,
  isInit: boolean,
];

const OwnableSimulatorBase = createSimulator<
  OwnablePrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof OwnableWitnesses>,
  MockOwnable<OwnablePrivateState>,
  OwnableArgs
>({
  contractFactory: (witnesses) =>
    new MockOwnable<OwnablePrivateState>(witnesses),
  defaultPrivateState: () => OwnablePrivateState,
  contractArgs: (initialOwner, isInit) => [initialOwner, isInit],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => OwnableWitnesses(),
});

/**
 * Ownable Simulator
 */
export class OwnableSimulator extends OwnableSimulatorBase {
  constructor(
    initialOwner: Either<ZswapCoinPublicKey, ContractAddress>,
    isInit: boolean,
    options: BaseSimulatorOptions<
      OwnablePrivateState,
      ReturnType<typeof OwnableWitnesses>
    > = {},
  ) {
    super([initialOwner, isInit], options);
  }
  /**
   * @description Returns the current contract owner.
   * @returns The contract owner.
   */
  public owner(): Either<ZswapCoinPublicKey, ContractAddress> {
    return this.circuits.impure.owner();
  }

  /**
   * @description Transfers ownership of the contract to `newOwner`.
   * @param newOwner - The new owner.
   */
  public transferOwnership(
    newOwner: Either<ZswapCoinPublicKey, ContractAddress>,
  ) {
    this.circuits.impure.transferOwnership(newOwner);
  }

  /**
   * @description Unsafe variant of `transferOwnership`.
   * @param newOwner - The new owner.
   */
  public _unsafeTransferOwnership(
    newOwner: Either<ZswapCoinPublicKey, ContractAddress>,
  ) {
    this.circuits.impure._unsafeTransferOwnership(newOwner);
  }

  /**
   * @description Leaves the contract without an owner.
   * It will not be possible to call `assertOnlyOnwer` circuits anymore.
   * Can only be called by the current owner.
   */
  public renounceOwnership() {
    this.circuits.impure.renounceOwnership();
  }

  /**
   * @description Throws if called by any account other than the owner.
   * Use this to restrict access of specific circuits to the owner.
   */
  public assertOnlyOwner() {
    this.circuits.impure.assertOnlyOwner();
  }

  /**
   * @description Transfers ownership of the contract to `newOwner` without
   * enforcing permission checks on the caller.
   * @param newOwner - The new owner.
   */
  public _transferOwnership(
    newOwner: Either<ZswapCoinPublicKey, ContractAddress>,
  ) {
    this.circuits.impure._transferOwnership(newOwner);
  }

  /**
   * @description Unsafe variant of `_transferOwnership`.
   * @param newOwner - The new owner.
   */
  public _unsafeUncheckedTransferOwnership(
    newOwner: Either<ZswapCoinPublicKey, ContractAddress>,
  ) {
    this.circuits.impure._unsafeUncheckedTransferOwnership(newOwner);
  }
}
