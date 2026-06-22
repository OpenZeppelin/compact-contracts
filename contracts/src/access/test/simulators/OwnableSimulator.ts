import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockOwnable,
} from '../../../../artifacts/MockOwnable/contract/index.js';
import {
  OwnablePrivateState,
  OwnableWitnesses,
} from '../witnesses/OwnableWitnesses.js';

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
  artifactName: 'MockOwnable',
});

/**
 * Ownable Simulator
 */
export class OwnableSimulator extends OwnableSimulatorBase {
  static async create(
    initialOwner: Either<Uint8Array, ContractAddress>,
    isInit: boolean,
    options: SimulatorOptions<
      OwnablePrivateState,
      ReturnType<typeof OwnableWitnesses>
    > = {},
  ): Promise<OwnableSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [initialOwner, isInit],
      options,
    ) as Promise<OwnableSimulator>;
  }
  /**
   * @description Returns the current contract owner.
   * @returns The contract owner.
   */
  public owner(): Promise<Either<Uint8Array, ContractAddress>> {
    return this.circuits.impure.owner();
  }

  /**
   * @description Transfers ownership of the contract to `newOwner`.
   * @param newOwner - The new owner.
   */
  public transferOwnership(
    newOwner: Either<Uint8Array, ContractAddress>,
  ): Promise<[]> {
    return this.circuits.impure.transferOwnership(newOwner);
  }

  /**
   * @description Unsafe variant of `transferOwnership`.
   * @param newOwner - The new owner.
   */
  public _unsafeTransferOwnership(
    newOwner: Either<Uint8Array, ContractAddress>,
  ): Promise<[]> {
    return this.circuits.impure._unsafeTransferOwnership(newOwner);
  }

  /**
   * @description Leaves the contract without an owner.
   * It will not be possible to call `assertOnlyOnwer` circuits anymore.
   * Can only be called by the current owner.
   */
  public renounceOwnership(): Promise<[]> {
    return this.circuits.impure.renounceOwnership();
  }

  /**
   * @description Throws if called by any account other than the owner.
   * Use this to restrict access of specific circuits to the owner.
   */
  public assertOnlyOwner(): Promise<[]> {
    return this.circuits.impure.assertOnlyOwner();
  }

  /**
   * @description Transfers ownership of the contract to `newOwner` without
   * enforcing permission checks on the caller.
   * @param newOwner - The new owner.
   */
  public _transferOwnership(
    newOwner: Either<Uint8Array, ContractAddress>,
  ): Promise<[]> {
    return this.circuits.impure._transferOwnership(newOwner);
  }

  /**
   * @description Unsafe variant of `_transferOwnership`.
   * @param newOwner - The new owner.
   */
  public _unsafeUncheckedTransferOwnership(
    newOwner: Either<Uint8Array, ContractAddress>,
  ): Promise<[]> {
    return this.circuits.impure._unsafeUncheckedTransferOwnership(newOwner);
  }

  public readonly privateState = {
    /**
     * @description Replaces the secret key in the private state. Used in tests to
     * simulate switching between different user identities or injecting incorrect
     * keys to test failure paths.
     * @param newSK - The new secret key to set.
     * @returns The updated private state.
     */
    injectSecretKey: async (
      newSK: Uint8Array,
    ): Promise<OwnablePrivateState> => {
      const updated = OwnablePrivateState.withSecretKey(newSK);
      this.setPrivateState(updated);
      return updated;
    },

    /**
     * @description Returns the current secret key from the private state.
     * @returns The secret key.
     * @throws If the secret key is undefined.
     */
    getCurrentSecretKey: async (): Promise<Uint8Array> => {
      const sk = (await this.getPrivateState()).secretKey;
      if (typeof sk === 'undefined') {
        throw new Error('Missing secret key');
      }
      return Uint8Array.from(sk);
    },
  };
}
