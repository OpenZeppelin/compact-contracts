import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type Caller,
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockAccessControlCaller,
} from '../../../../artifacts/access/test/mocks/MockAccessControlCaller/contract/index.js';

// The mock declares no witnesses, so the private state and witness set are
// both empty.
export type AccessControlCallerPrivateState = Record<string, never>;
export const AccessControlCallerPrivateState: AccessControlCallerPrivateState =
  {};
export const AccessControlCallerWitnesses = () => ({});

/**
 * Type constructor args
 */
type AccessControlCallerArgs = readonly [];

const AccessControlCallerSimulatorBase = createSimulator<
  AccessControlCallerPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof AccessControlCallerWitnesses>,
  MockAccessControlCaller<AccessControlCallerPrivateState>,
  AccessControlCallerArgs
>({
  contractFactory: (witnesses) =>
    new MockAccessControlCaller<AccessControlCallerPrivateState>(witnesses),
  defaultPrivateState: () => AccessControlCallerPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => AccessControlCallerWitnesses(),
  artifactName: 'MockAccessControlCaller',
});

/**
 * AccessControl Simulator for the mock that takes the caller as an argument.
 *
 * Each method is a thin pass-through to the mock's matching circuit.
 */
export class AccessControlCallerSimulator extends AccessControlCallerSimulatorBase {
  static async create(
    options: SimulatorOptions<
      AccessControlCallerPrivateState,
      ReturnType<typeof AccessControlCallerWitnesses>
    > = {},
  ): Promise<AccessControlCallerSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<AccessControlCallerSimulator>;
  }

  /**
   * @description Returns whether `account` holds `roleId`.
   * @param roleId - The role identifier.
   * @param account - The account to query.
   * @returns Whether `account` holds `roleId`.
   */
  public hasRole(
    roleId: Uint8Array,
    account: Either<Uint8Array, ContractAddress>,
  ): Promise<boolean> {
    return this.circuits.impure.hasRole(roleId, account);
  }

  /**
   * @description Throws if `caller` does not hold `roleId`.
   * @param caller - The caller to act as.
   * @param roleId - The role identifier.
   */
  public assertOnlyRole(caller: Caller, roleId: Uint8Array): Promise<[]> {
    return this.circuits.impure.assertOnlyRole(caller, roleId);
  }

  /**
   * @description Grants `roleId` to `account`.
   * @param caller - The caller to act as.
   * @param roleId - The role identifier.
   * @param account - The grantee.
   */
  public grantRole(
    caller: Caller,
    roleId: Uint8Array,
    account: Either<Uint8Array, ContractAddress>,
  ): Promise<[]> {
    return this.circuits.impure.grantRole(caller, roleId, account);
  }

  /**
   * @description Revokes `roleId` from `account`.
   * @param caller - The caller to act as.
   * @param roleId - The role identifier.
   * @param account - The account to revoke from.
   */
  public revokeRole(
    caller: Caller,
    roleId: Uint8Array,
    account: Either<Uint8Array, ContractAddress>,
  ): Promise<[]> {
    return this.circuits.impure.revokeRole(caller, roleId, account);
  }

  /**
   * @description Revokes `roleId` from the caller's account.
   * @param caller - The caller to act as.
   * @param roleId - The role identifier.
   * @param callerConfirmation - The caller's account.
   */
  public renounceRole(
    caller: Caller,
    roleId: Uint8Array,
    callerConfirmation: Either<Uint8Array, ContractAddress>,
  ): Promise<[]> {
    return this.circuits.impure.renounceRole(
      caller,
      roleId,
      callerConfirmation,
    );
  }

  /**
   * @description Grants `roleId` to a key account, without access control.
   * @param roleId - The role identifier.
   * @param account - The grantee.
   * @returns Whether `roleId` was granted.
   */
  public _grantRole(
    roleId: Uint8Array,
    account: Either<Uint8Array, ContractAddress>,
  ): Promise<boolean> {
    return this.circuits.impure._grantRole(roleId, account);
  }

  /**
   * @description Grants `roleId` to any account, without access control.
   * @param roleId - The role identifier.
   * @param account - The grantee.
   * @returns Whether `roleId` was granted.
   */
  public _unsafeGrantRole(
    roleId: Uint8Array,
    account: Either<Uint8Array, ContractAddress>,
  ): Promise<boolean> {
    return this.circuits.impure._unsafeGrantRole(roleId, account);
  }
}

export type { Caller, ContractAddress, Either };
