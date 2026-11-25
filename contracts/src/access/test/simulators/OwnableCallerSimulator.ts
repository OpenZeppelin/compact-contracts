import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type Caller,
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockOwnableCaller,
} from '../../../../artifacts/access/test/mocks/MockOwnableCaller/contract/index.js';

// The mock declares no witnesses, so the private state and witness set are
// both empty.
export type OwnableCallerPrivateState = Record<string, never>;
export const OwnableCallerPrivateState: OwnableCallerPrivateState = {};
export const OwnableCallerWitnesses = () => ({});

/**
 * Type constructor args
 */
type OwnableCallerArgs = readonly [
  initialOwner: Either<Uint8Array, ContractAddress>,
];

const OwnableCallerSimulatorBase = createSimulator<
  OwnableCallerPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof OwnableCallerWitnesses>,
  MockOwnableCaller<OwnableCallerPrivateState>,
  OwnableCallerArgs
>({
  contractFactory: (witnesses) =>
    new MockOwnableCaller<OwnableCallerPrivateState>(witnesses),
  defaultPrivateState: () => OwnableCallerPrivateState,
  contractArgs: (initialOwner) => [initialOwner],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => OwnableCallerWitnesses(),
  artifactName: 'MockOwnableCaller',
});

/**
 * Ownable Simulator for the mock that takes the caller as an argument.
 *
 * Each method is a thin pass-through to the mock's matching circuit.
 */
export class OwnableCallerSimulator extends OwnableCallerSimulatorBase {
  static async create(
    initialOwner: Either<Uint8Array, ContractAddress>,
    options: SimulatorOptions<
      OwnableCallerPrivateState,
      ReturnType<typeof OwnableCallerWitnesses>
    > = {},
  ): Promise<OwnableCallerSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [initialOwner],
      options,
    ) as Promise<OwnableCallerSimulator>;
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
   * @param caller - The caller to act as.
   * @param newOwner - The new owner.
   */
  public transferOwnership(
    caller: Caller,
    newOwner: Either<Uint8Array, ContractAddress>,
  ): Promise<[]> {
    return this.circuits.impure.transferOwnership(caller, newOwner);
  }

  /**
   * @description Unsafe variant of `transferOwnership`.
   * @param caller - The caller to act as.
   * @param newOwner - The new owner.
   */
  public _unsafeTransferOwnership(
    caller: Caller,
    newOwner: Either<Uint8Array, ContractAddress>,
  ): Promise<[]> {
    return this.circuits.impure._unsafeTransferOwnership(caller, newOwner);
  }

  /**
   * @description Leaves the contract without an owner.
   * @param caller - The caller to act as.
   */
  public renounceOwnership(caller: Caller): Promise<[]> {
    return this.circuits.impure.renounceOwnership(caller);
  }

  /**
   * @description Throws if `caller` is not the owner.
   * @param caller - The caller to act as.
   */
  public assertOnlyOwner(caller: Caller): Promise<[]> {
    return this.circuits.impure.assertOnlyOwner(caller);
  }
}

export type { Caller, ContractAddress, Either };
