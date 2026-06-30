import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockAccessControl,
} from '../../../../artifacts/MockAccessControl/contract/index.js';
import {
  AccessControlPrivateState,
  AccessControlWitnesses,
} from '../witnesses/AccessControlWitnesses.js';

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
  artifactName: 'MockAccessControl',
});

/**
 * AccessControl Simulator
 */
export class AccessControlSimulator extends AccessControlSimulatorBase {
  static async create(
    options: SimulatorOptions<
      AccessControlPrivateState,
      ReturnType<typeof AccessControlWitnesses>
    > = {},
  ): Promise<AccessControlSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<AccessControlSimulator>;
  }

  /**
   * @description Returns the default admin role identifier.
   * @returns The default admin role identifier (zero bytes).
   */
  public DEFAULT_ADMIN_ROLE(): Promise<Uint8Array> {
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
  ): Promise<boolean> {
    return this.circuits.impure.hasRole(roleId, account);
  }

  /**
   * @description Retrieves an account's permission for `roleId`.
   * @param roleId - The role identifier.
   */
  public assertOnlyRole(roleId: Uint8Array): Promise<[]> {
    return this.circuits.impure.assertOnlyRole(roleId);
  }

  /**
   * @description Retrieves an account's permission for `roleId`.
   * @param roleId - The role identifier.
   * @param account - An Either wrapping a Bytes<32> identity commitment (left) or a ContractAddress (right).
   */
  public _checkRole(
    roleId: Uint8Array,
    account: Either<Uint8Array, ContractAddress>,
  ): Promise<[]> {
    return this.circuits.impure._checkRole(roleId, account);
  }

  /**
   * @description Retrieves `roleId`'s admin identifier.
   * @param roleId - The role identifier.
   * @returns The admin identifier for `roleId`.
   */
  public getRoleAdmin(roleId: Uint8Array): Promise<Uint8Array> {
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
  ): Promise<[]> {
    return this.circuits.impure.grantRole(roleId, account);
  }

  /**
   * @description Revokes an account's permission to use `roleId`.
   * @param roleId - The role identifier.
   * @param account - An Either wrapping a Bytes<32> identity commitment (left) or a ContractAddress (right).
   */
  public revokeRole(
    roleId: Uint8Array,
    account: Either<Uint8Array, ContractAddress>,
  ): Promise<[]> {
    return this.circuits.impure.revokeRole(roleId, account);
  }

  /**
   * @description Revokes `roleId` from the calling account.
   * @param roleId - The role identifier.
   * @param account - An Either wrapping a Bytes<32> identity commitment (left) or a ContractAddress (right).
   */
  public renounceRole(
    roleId: Uint8Array,
    account: Either<Uint8Array, ContractAddress>,
  ): Promise<[]> {
    return this.circuits.impure.renounceRole(roleId, account);
  }

  /**
   * @description Sets the admin identifier for `roleId`.
   * @param roleId - The role identifier.
   * @param adminId - The admin role identifier.
   */
  public _setRoleAdmin(roleId: Uint8Array, adminId: Uint8Array): Promise<[]> {
    return this.circuits.impure._setRoleAdmin(roleId, adminId);
  }

  /**
   * @description Grants an account permissions to use `roleId`. Internal function without access restriction.
   * @param roleId - The role identifier.
   * @param account - An Either wrapping a Bytes<32> identity commitment (left) or a ContractAddress (right).
   */
  public _grantRole(
    roleId: Uint8Array,
    account: Either<Uint8Array, ContractAddress>,
  ): Promise<boolean> {
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
  ): Promise<boolean> {
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
  ): Promise<boolean> {
    return this.circuits.impure._revokeRole(roleId, account);
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
    ): Promise<AccessControlPrivateState> => {
      const cur = await this.getPrivateState();
      const updated = {
        ...cur,
        ...AccessControlPrivateState.withSecretKey(newSK),
      };
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
      return sk;
    },
  };
}
