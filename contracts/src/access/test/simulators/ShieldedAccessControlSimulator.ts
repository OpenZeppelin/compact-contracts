import type { MerkleTreePath } from '@midnight-ntwrk/compact-runtime';
import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  ledger,
  Contract as MockShieldedAccessControl,
  type ShieldedAccessControl_UpdateType as UpdateType,
} from '../../../../artifacts/MockShieldedAccessControl/contract/index.js';
import {
  ShieldedAccessControlPrivateState,
  ShieldedAccessControlWitnesses,
} from '../../witnesses/ShieldedAccessControlWitnesses.js';

type ShieldedAccessControlLedger = ReturnType<typeof ledger>;

/**
 * Type constructor args
 */
type ShieldedAccessControlArgs = readonly [
  instanceSalt: Uint8Array,
  isInit: boolean,
];

const ShieldedAccessControlSimulatorBase = createSimulator<
  ShieldedAccessControlPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ShieldedAccessControlWitnesses>,
  MockShieldedAccessControl<ShieldedAccessControlPrivateState>,
  ShieldedAccessControlArgs
>({
  contractFactory: (witnesses) =>
    new MockShieldedAccessControl<ShieldedAccessControlPrivateState>(witnesses),
  defaultPrivateState: () => ShieldedAccessControlPrivateState.generate(),
  contractArgs: (instanceSalt, isInit) => {
    return [instanceSalt, isInit];
  },
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () =>
    ShieldedAccessControlWitnesses<ShieldedAccessControlLedger>(),
});

/**
 * ShieldedAccessControlSimulator
 */
export class ShieldedAccessControlSimulator extends ShieldedAccessControlSimulatorBase {
  constructor(
    instanceSalt: Uint8Array,
    isInit: boolean,
    options: BaseSimulatorOptions<
      ShieldedAccessControlPrivateState,
      ReturnType<typeof ShieldedAccessControlWitnesses>
    > = {},
  ) {
    super([instanceSalt, isInit], options);
  }

  public DEFAULT_ADMIN_ROLE(): Uint8Array {
    return this.circuits.pure.DEFAULT_ADMIN_ROLE();
  }

  public assertOnlyRole(role: Uint8Array) {
    this.circuits.impure.assertOnlyRole(role);
  }

  public canProveRole(role: Uint8Array): boolean {
    return this.circuits.impure.canProveRole(role);
  }

  public _uncheckedCanProveRole(role: Uint8Array): boolean {
    return this.circuits.impure._uncheckedCanProveRole(role);
  }

  public grantRole(role: Uint8Array, accountId: Uint8Array) {
    this.circuits.impure.grantRole(role, accountId);
  }

  public _grantRole(role: Uint8Array, accountId: Uint8Array) {
    this.circuits.impure._grantRole(role, accountId);
  }

  public renounceRole(role: Uint8Array, callerConfirmation: Uint8Array) {
    this.circuits.impure.renounceRole(role, callerConfirmation);
  }

  public revokeRole(role: Uint8Array, accountId: Uint8Array) {
    this.circuits.impure.revokeRole(role, accountId);
  }

  public _revokeRole(role: Uint8Array, accountId: Uint8Array) {
    this.circuits.impure._revokeRole(role, accountId);
  }

  public _updateRole(
    role: Uint8Array,
    accountId: Uint8Array,
    updateType: UpdateType,
  ) {
    this.circuits.impure._updateRole(role, accountId, updateType);
  }

  public getRoleAdmin(role: Uint8Array): Uint8Array {
    return this.circuits.impure.getRoleAdmin(role);
  }

  public _setRoleAdmin(role: Uint8Array, adminRole: Uint8Array) {
    this.circuits.impure._setRoleAdmin(role, adminRole);
  }

  public _validateRole(role: Uint8Array, accountId: Uint8Array): boolean {
    return this.circuits.impure._validateRole(role, accountId);
  }

  public computeRoleCommitment(
    role: Uint8Array,
    accountId: Uint8Array,
  ): Uint8Array {
    return this.circuits.impure.computeRoleCommitment(role, accountId);
  }

  public computeNullifier(roleCommitment: Uint8Array): Uint8Array {
    return this.circuits.pure.computeNullifier(roleCommitment);
  }

  public _computeAccountId(): Uint8Array {
    return this.circuits.impure._computeAccountId();
  }

  public computeAccountId(
    secretKey: Uint8Array,
    instanceSalt: Uint8Array,
  ): Uint8Array {
    return this.circuits.pure.computeAccountId(
      secretKey,
      instanceSalt,
    );
  }

  public readonly privateState = {
    /**
     * @description Contextually sets a new key into the private state.
     * @param newSK The secret key.
     * @returns The ShieldedAccessControl private state after setting the new key.
     */
    injectSecretKey: (
      newSK: Buffer<ArrayBufferLike>,
    ): ShieldedAccessControlPrivateState => {
      const currentState = this.getPrivateState();
      const updatedState = {
        secretKey: {...currentState.secretKey }
      };
      updatedState.secretKey = newSK;
      this.circuitContextManager.updatePrivateState(updatedState);
      return updatedState;
    },

    /**
     * @description Returns the current secret key from the private state.
     * @returns The secret key.
     */
    getCurrentSecretKey: (): Uint8Array => {
      const sk = this.getPrivateState().secretKey;
      if (typeof sk === 'undefined') {
        throw new Error('Missing secret key');
      }
      return sk;
    },
    getCommitmentPathWithFindForLeaf: (
      roleCommitment: Uint8Array,
    ): MerkleTreePath<Uint8Array> | undefined => {
      return this.getPublicState().ShieldedAccessControl__operatorRoles.findPathForLeaf(
        roleCommitment,
      );
    },
    getCommitmentPathWithWitnessImpl: (
      roleCommitment: Uint8Array,
    ): MerkleTreePath<Uint8Array> => {
      return this.witnesses.wit_getRoleCommitmentPath(
        this.getWitnessContext(),
        roleCommitment,
      )[1];
    },
  };
}
