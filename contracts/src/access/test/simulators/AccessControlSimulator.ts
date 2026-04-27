import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockAccessControl,
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
  defaultPrivateState: () => AccessControlPrivateState.generate(),
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
   * @description Returns the default admin role identifier.
   * @returns The default admin role identifier (zero bytes).
   */
  public DEFAULT_ADMIN_ROLE(): Uint8Array {
    return this.circuits.pure.DEFAULT_ADMIN_ROLE();
  }

  /**
   * @description Retrieves an account's permission for `roleId`.
   * @param roleId - The role identifier.
   * @param account - An Either wrapping a Bytes<32> identity commitment (left) or a ContractAddress (right).
   * @returns Whether an account has a specified role.
   */
  public hasRole(
    roleId: Uint8Array,
    account: Either<Uint8Array, ContractAddress>,
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
   * @param account - An Either wrapping a Bytes<32> identity commitment (left) or a ContractAddress (right).
   */
  public _checkRole(
    roleId: Uint8Array,
    account: Either<Uint8Array, ContractAddress>,
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
   * @param account - An Either wrapping a Bytes<32> identity commitment (left) or a ContractAddress (right).
   */
  public grantRole(
    roleId: Uint8Array,
    account: Either<Uint8Array, ContractAddress>,
  ) {
    this.circuits.impure.grantRole(roleId, account);
  }

  /**
   * @description Revokes an account's permission to use `roleId`.
   * @param roleId - The role identifier.
   * @param account - An Either wrapping a Bytes<32> identity commitment (left) or a ContractAddress (right).
   */
  public revokeRole(
    roleId: Uint8Array,
    account: Either<Uint8Array, ContractAddress>,
  ) {
    this.circuits.impure.revokeRole(roleId, account);
  }

  /**
   * @description Revokes `roleId` from the calling account.
   * @param roleId - The role identifier.
   * @param account - An Either wrapping a Bytes<32> identity commitment (left) or a ContractAddress (right).
   */
  public renounceRole(
    roleId: Uint8Array,
    account: Either<Uint8Array, ContractAddress>,
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
   * @param account - An Either wrapping a Bytes<32> identity commitment (left) or a ContractAddress (right).
   */
  public _grantRole(
    roleId: Uint8Array,
    account: Either<Uint8Array, ContractAddress>,
  ): boolean {
    return this.circuits.impure._grantRole(roleId, account);
  }

  /**
   * @description Grants an account permissions to use `roleId`. Internal function without access restriction.
   * DOES NOT restrict sending to a ContractAddress.
   * @param roleId - The role identifier.
   * @param account - An Either wrapping a Bytes<32> identity commitment (left) or a ContractAddress (right).
   */
  public _unsafeGrantRole(
    roleId: Uint8Array,
    account: Either<Uint8Array, ContractAddress>,
  ): boolean {
    return this.circuits.impure._unsafeGrantRole(roleId, account);
  }

  /**
   * @description Revokes an account's permission to use `roleId`. Internal function without access restriction.
   * @param roleId - The role identifier.
   * @param account - An Either wrapping a Bytes<32> identity commitment (left) or a ContractAddress (right).
   */
  public _revokeRole(
    roleId: Uint8Array,
    account: Either<Uint8Array, ContractAddress>,
  ): boolean {
    return this.circuits.impure._revokeRole(roleId, account);
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
    injectSecretKey: (newSK: Uint8Array): AccessControlPrivateState => {
      const currentState = this.getPrivateState();
      const updatedState = {
        ...currentState,
        ...AccessControlPrivateState.withSecretKey(newSK),
      };
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
      return sk;
    },
  };
}
