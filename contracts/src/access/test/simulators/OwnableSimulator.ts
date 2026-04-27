import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockOwnable,
} from '../../../../artifacts/MockOwnable/contract/index.js';
import {
  OwnablePrivateState,
  OwnableWitnesses,
} from '../../witnesses/OwnableWitnesses.js';

/**
 * Type constructor args
 */
type OwnableArgs = readonly [
  initialOwner: Either<Uint8Array, ContractAddress>,
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
  defaultPrivateState: () => OwnablePrivateState.generate(),
  contractArgs: (initialOwner, isInit) => [initialOwner, isInit],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => OwnableWitnesses(),
});

/**
 * Ownable Simulator
 */
export class OwnableSimulator extends OwnableSimulatorBase {
  constructor(
    initialOwner: Either<Uint8Array, ContractAddress>,
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
  public owner(): Either<Uint8Array, ContractAddress> {
    return this.circuits.impure.owner();
  }

  /**
   * @description Transfers ownership of the contract to `newOwner`.
   * @param newOwner - The new owner.
   */
  public transferOwnership(newOwner: Either<Uint8Array, ContractAddress>) {
    this.circuits.impure.transferOwnership(newOwner);
  }

  /**
   * @description Unsafe variant of `transferOwnership`.
   * @param newOwner - The new owner.
   */
  public _unsafeTransferOwnership(
    newOwner: Either<Uint8Array, ContractAddress>,
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
  public _transferOwnership(newOwner: Either<Uint8Array, ContractAddress>) {
    this.circuits.impure._transferOwnership(newOwner);
  }

  /**
   * @description Unsafe variant of `_transferOwnership`.
   * @param newOwner - The new owner.
   */
  public _unsafeUncheckedTransferOwnership(
    newOwner: Either<Uint8Array, ContractAddress>,
  ) {
    this.circuits.impure._unsafeUncheckedTransferOwnership(newOwner);
  }

  /**
   * @description Computes an account identifier without on-chain state, allowing a user to derive
   * their identity commitment before submitting it in a grant or revoke operation.
   * @param {Bytes<32>} secretKey - A 32-byte cryptographically secure random value.
   * @returns {Bytes<32>} accountId - The computed account identifier.
   */
  public computeAccountId(secretKey: Uint8Array): Uint8Array {
    return this.circuits.pure.computeAccountId(secretKey);
  }

  public readonly privateState = {
    /**
     * @description Replaces the secret key in the private state. Used in tests to
     * simulate switching between different user identities or injecting incorrect
     * keys to test failure paths.
     * @param newSK - The new secret key to set.
     * @returns The updated private state.
     */
    injectSecretKey: (newSK: Uint8Array): OwnablePrivateState => {
      const updatedState = OwnablePrivateState.withSecretKey(newSK);
      this.circuitContextManager.updatePrivateState(updatedState);
      return updatedState;
    },

    /**
     * @description Returns the current secret key from the private state.
     * @returns The secret key.
     * @throws If the secret key is undefined.
     */
    getCurrentSecretKey: (): Uint8Array => {
      const sk = this.getPrivateState().secretKey;
      if (typeof sk === 'undefined') {
        throw new Error('Missing secret key');
      }
      return Uint8Array.from(sk);
    },
  };
}
