import { type BaseSimulatorOptions, createSimulator } from '../../src/index';
import {
  SampleZOwnablePrivateState,
  SampleZOwnableWitnesses,
} from '../fixtures/sample-contracts/witnesses/SampleZOwnableWitnesses';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as SampleZOwnable,
  type ZswapCoinPublicKey,
} from '../fixtures/test-artifacts/SampleZOwnable/contract/index.cjs';

/**
 * Type constructor args
 */
type SampleZOwnableArgs = readonly [
  owner: Uint8Array,
  instanceSalt: Uint8Array,
];

/**
 * Base simulator
 */
const SampleZOwnableSimulatorBase = createSimulator<
  SampleZOwnablePrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof SampleZOwnableWitnesses>,
  SampleZOwnableArgs
>({
  contractFactory: (witnesses) =>
    new SampleZOwnable<SampleZOwnablePrivateState>(witnesses),
  defaultPrivateState: () => SampleZOwnablePrivateState.generate(),
  contractArgs: (owner, instanceSalt) => {
    return [owner, instanceSalt];
  },
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => SampleZOwnableWitnesses(),
});

/**
 * SampleZOwnable Simulator
 */
export class SampleZOwnableSimulator extends SampleZOwnableSimulatorBase {
  constructor(
    ownerId: Uint8Array,
    instanceSalt: Uint8Array,
    options: BaseSimulatorOptions<
      SampleZOwnablePrivateState,
      ReturnType<typeof SampleZOwnableWitnesses>
    > = {},
  ) {
    super([ownerId, instanceSalt], options);
  }

  /**
   * @description Returns the current commitment representing the contract owner.
   * The full commitment is: `SHA256(SHA256(pk, nonce), instanceSalt, counter, domain)`.
   * @returns The current owner's commitment.
   */
  public owner(): Uint8Array {
    return this.circuits.impure.owner();
  }

  /**
   * @description Transfers ownership to `newOwnerId`.
   * `newOwnerId` must be precalculated and given to the current owner off chain.
   * @param newOwnerId The new owner's unique identifier (`SHA256(pk, nonce)`).
   */
  public transferOwnership(newOwnerId: Uint8Array) {
    this.circuits.impure.transferOwnership(newOwnerId);
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
   * @description Throws if called by any account whose id hash `SHA256(pk, nonce)` does not match
   * the stored owner commitment. Use this to only allow the owner to call specific circuits.
   */
  public assertOnlyOwner() {
    this.circuits.impure.assertOnlyOwner();
  }

  /**
   * @description Computes the owner commitment from the given `id` and `counter`.
   * @param id - The unique identifier of the owner calculated by `SHA256(pk, nonce)`.
   * @param counter - The current counter or round. This increments by `1`
   * after every transfer to prevent duplicate commitments given the same `id`.
   * @returns The commitment derived from `id` and `counter`.
   */
  public _computeOwnerCommitment(id: Uint8Array, counter: bigint): Uint8Array {
    return this.circuits.impure._computeOwnerCommitment(id, counter);
  }

  /**
   * @description Computes the unique identifier (`id`) of the owner from their
   * public key and a secret nonce.
   * @param pk - The public key of the identity being committed.
   * @param nonce - A private nonce to scope the commitment.
   * @returns The computed owner ID.
   */
  public _computeOwnerId(
    pk: Either<ZswapCoinPublicKey, ContractAddress>,
    nonce: Uint8Array,
  ): Uint8Array {
    return this.circuits.pure._computeOwnerId(pk, nonce);
  }

  /**
   * @description Transfers ownership to owner id `newOwnerId` without
   * enforcing permission checks on the caller.
   * @param newOwnerId - The unique identifier of the new owner calculated by `SHA256(pk, nonce)`.
   */
  public _transferOwnership(newOwnerId: Uint8Array) {
    this.circuits.impure._transferOwnership(newOwnerId);
  }

  public readonly privateState = {
    /**
     * @description Contextually sets a new nonce into the private state.
     * @param newNonce The secret nonce.
     * @returns The SampleZOwnable private state after setting the new nonce.
     */
    injectSecretNonce: (
      newNonce: Buffer<ArrayBufferLike>,
    ): SampleZOwnablePrivateState => {
      const currentState =
        this.circuitContextManager.getContext().currentPrivateState;
      const updatedState = { ...currentState, secretNonce: newNonce };
      this.circuitContextManager.updatePrivateState(updatedState);
      return updatedState;
    },

    /**
     * @description Returns the secret nonce given the context.
     * @returns The secret nonce.
     */
    getCurrentSecretNonce: (): Uint8Array => {
      return this.circuitContextManager.getContext().currentPrivateState
        .secretNonce;
    },
  };
}
