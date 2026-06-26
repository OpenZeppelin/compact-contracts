import type {
  MerkleTreePath,
  WitnessContext,
} from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockShieldedAccessControl,
} from '../../../../artifacts/MockShieldedAccessControl/contract/index.js';
import {
  ShieldedAccessControlPrivateState,
  ShieldedAccessControlWitnesses,
} from '../witnesses/ShieldedAccessControlWitnesses.js';

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
  artifactName: 'MockShieldedAccessControl',
});

/**
 * ShieldedAccessControlSimulator
 */
export class ShieldedAccessControlSimulator extends ShieldedAccessControlSimulatorBase {
  static async create(
    instanceSalt: Uint8Array,
    isInit: boolean,
    options: SimulatorOptions<
      ShieldedAccessControlPrivateState,
      ReturnType<typeof ShieldedAccessControlWitnesses>
    > = {},
  ): Promise<ShieldedAccessControlSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [instanceSalt, isInit],
      options,
    ) as Promise<ShieldedAccessControlSimulator>;
  }

  public DEFAULT_ADMIN_ROLE(): Promise<Uint8Array> {
    return this.circuits.pure.DEFAULT_ADMIN_ROLE();
  }

  public assertOnlyRole(role: Uint8Array): Promise<[]> {
    return this.circuits.impure.assertOnlyRole(role);
  }

  public canProveRole(role: Uint8Array): Promise<boolean> {
    return this.circuits.impure.canProveRole(role);
  }

  public grantRole(role: Uint8Array, accountId: Uint8Array): Promise<[]> {
    return this.circuits.impure.grantRole(role, accountId);
  }

  public _grantRole(role: Uint8Array, accountId: Uint8Array): Promise<[]> {
    return this.circuits.impure._grantRole(role, accountId);
  }

  public renounceRole(
    role: Uint8Array,
    callerConfirmation: Uint8Array,
  ): Promise<[]> {
    return this.circuits.impure.renounceRole(role, callerConfirmation);
  }

  public revokeRole(role: Uint8Array, accountId: Uint8Array): Promise<[]> {
    return this.circuits.impure.revokeRole(role, accountId);
  }

  public _revokeRole(role: Uint8Array, accountId: Uint8Array): Promise<[]> {
    return this.circuits.impure._revokeRole(role, accountId);
  }

  public getRoleAdmin(role: Uint8Array): Promise<Uint8Array> {
    return this.circuits.impure.getRoleAdmin(role);
  }

  public _setRoleAdmin(role: Uint8Array, adminRole: Uint8Array): Promise<[]> {
    return this.circuits.impure._setRoleAdmin(role, adminRole);
  }

  public computeRoleCommitment(
    role: Uint8Array,
    accountId: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.computeRoleCommitment(role, accountId);
  }

  public computeNullifier(roleCommitment: Uint8Array): Promise<Uint8Array> {
    return this.circuits.pure.computeNullifier(roleCommitment);
  }

  public computeAccountId(
    secretKey: Uint8Array,
    instanceSalt: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.pure.computeAccountId(secretKey, instanceSalt);
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
      newSK: Buffer<ArrayBufferLike>,
    ): Promise<ShieldedAccessControlPrivateState> => {
      const updated = { secretKey: newSK };
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

    /**
     * @description Searches the `_operatorRoles` Merkle tree for a leaf matching
     * the given role commitment using the ledger's `findPathForLeaf` method.
     * Returns the path if found, undefined otherwise.
     * @param roleCommitment - The role commitment to search for.
     * @returns The Merkle tree path if the commitment exists, undefined otherwise.
     */
    getCommitmentPathWithFindForLeaf: async (
      roleCommitment: Uint8Array,
    ): Promise<MerkleTreePath<Uint8Array> | undefined> => {
      return (
        await this.getPublicState()
      ).ShieldedAccessControl__operatorRoles.findPathForLeaf(roleCommitment);
    },

    /**
     * @description Returns the Merkle tree path for a given role commitment using
     * the witness implementation. Used to verify that the witness produces the
     * expected path, or to compare against `getCommitmentPathWithFindForLeaf`
     * to detect witness overrides or mismatches.
     * @param roleCommitment - The role commitment to find a path for.
     * @returns The Merkle tree path as returned by the witness.
     */
    getCommitmentPathWithWitnessImpl: async (
      roleCommitment: Uint8Array,
    ): Promise<MerkleTreePath<Uint8Array>> => {
      const context: WitnessContext<
        ShieldedAccessControlLedger,
        ShieldedAccessControlPrivateState
      > = {
        ledger: await this.getPublicState(),
        privateState: await this.getPrivateState(),
        contractAddress: '',
      };
      return this.witnesses.wit_getRoleCommitmentPath(
        context,
        roleCommitment,
      )[1];
    },
  };
}
