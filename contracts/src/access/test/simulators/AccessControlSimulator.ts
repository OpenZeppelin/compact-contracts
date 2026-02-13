import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockAccessControl,
  type ZswapCoinPublicKey,
} from '../../../../artifacts/MockAccessControl/contract/index.js';
import {
  AccessControlPrivateState,
  AccessControlWitnesses,
} from '../../witnesses/AccessControlWitnesses.js';

/**
 * Type constructor args
 */
type AccessControlArgs = readonly [];

const AccessControlSimulatorBase = createSimulator<
  AccessControlPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof AccessControlWitnesses>,
  MockAccessControl<AccessControlPrivateState>,
  AccessControlArgs
>({
  contractFactory: (witnesses) =>
    new MockAccessControl<AccessControlPrivateState>(witnesses),
  defaultPrivateState: () => AccessControlPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => AccessControlWitnesses(),
});

/**
 * AccessControl Simulator
 */
export class AccessControlSimulator extends AccessControlSimulatorBase {
  constructor(
    options: BaseSimulatorOptions<
      AccessControlPrivateState,
      ReturnType<typeof AccessControlWitnesses>
    > = {},
  ) {
    super([], options);
  }

  /**
   * @description Retrieves an account's permission for `roleId`.
   * @param roleId - The role identifier.
   * @param account - A ZswapCoinPublicKey or a ContractAddress.
   * @returns Whether an account has a specified role.
   */
  public hasRole(
    roleId: Uint8Array,
    account: Either<ZswapCoinPublicKey, ContractAddress>,
  ): boolean {
    return this.circuits.impure.hasRole(roleId, account);
  }

  /**
   * @description Retrieves an account's permission for `roleId`.
   * @param roleId - The role identifier.
   */
  public assertOnlyRole(roleId: Uint8Array) {
    this.circuits.impure.assertOnlyRole(roleId);
  }

  /**
   * @description Retrieves an account's permission for `roleId`.
   * @param roleId - The role identifier.
   * @param account - A ZswapCoinPublicKey or a ContractAddress.
   */
  public _checkRole(
    roleId: Uint8Array,
    account: Either<ZswapCoinPublicKey, ContractAddress>,
  ) {
    this.circuits.impure._checkRole(roleId, account);
  }

  /**
   * @description Retrieves `roleId`'s admin identifier.
   * @param roleId - The role identifier.
   * @returns The admin identifier for `roleId`.
   */
  public getRoleAdmin(roleId: Uint8Array): Uint8Array {
    return this.circuits.impure.getRoleAdmin(roleId);
  }

  /**
   * @description Grants an account permissions to use `roleId`.
   * @param roleId - The role identifier.
   * @param account - A ZswapCoinPublicKey or a ContractAddress.
   */
  public grantRole(
    roleId: Uint8Array,
    account: Either<ZswapCoinPublicKey, ContractAddress>,
  ) {
    this.circuits.impure.grantRole(roleId, account);
  }

  /**
   * @description Revokes an account's permission to use `roleId`.
   * @param roleId - The role identifier.
   * @param account - A ZswapCoinPublicKey or a ContractAddress.
   */
  public revokeRole(
    roleId: Uint8Array,
    account: Either<ZswapCoinPublicKey, ContractAddress>,
  ) {
    this.circuits.impure.revokeRole(roleId, account);
  }

  /**
   * @description Revokes `roleId` from the calling account.
   * @param roleId - The role identifier.
   * @param account - A ZswapCoinPublicKey or a ContractAddress.
   */
  public renounceRole(
    roleId: Uint8Array,
    account: Either<ZswapCoinPublicKey, ContractAddress>,
  ) {
    this.circuits.impure.renounceRole(roleId, account);
  }

  /**
   * @description Sets the admin identifier for `roleId`.
   * @param roleId - The role identifier.
   * @param adminId - The admin role identifier.
   */
  public _setRoleAdmin(roleId: Uint8Array, adminId: Uint8Array) {
    this.circuits.impure._setRoleAdmin(roleId, adminId);
  }

  /**
   * @description Grants an account permissions to use `roleId`. Internal function without access restriction.
   * @param roleId - The role identifier.
   * @param account - A ZswapCoinPublicKey or a ContractAddress.
   */
  public _grantRole(
    roleId: Uint8Array,
    account: Either<ZswapCoinPublicKey, ContractAddress>,
  ): boolean {
    return this.circuits.impure._grantRole(roleId, account);
  }

  /**
   * @description Grants an account permissions to use `roleId`. Internal function without access restriction.
   * DOES NOT restrict sending to a ContractAddress.
   * @param roleId - The role identifier.
   * @param account - A ZswapCoinPublicKey or a ContractAddress.
   */
  public _unsafeGrantRole(
    roleId: Uint8Array,
    account: Either<ZswapCoinPublicKey, ContractAddress>,
  ): boolean {
    return this.circuits.impure._unsafeGrantRole(roleId, account);
  }

  /**
   * @description Revokes an account's permission to use `roleId`. Internal function without access restriction.
   * @param roleId - The role identifier.
   * @param account - A ZswapCoinPublicKey or a ContractAddress.
   */
  public _revokeRole(
    roleId: Uint8Array,
    account: Either<ZswapCoinPublicKey, ContractAddress>,
  ): boolean {
    return this.circuits.impure._revokeRole(roleId, account);
  }
}
