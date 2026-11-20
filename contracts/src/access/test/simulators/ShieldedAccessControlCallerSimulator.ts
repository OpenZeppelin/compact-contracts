import type {
  MerkleTreePath,
  WitnessContext,
} from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type Caller,
  type ContractAddress,
  type Either,
  type Ledger,
  ledger,
  Contract as MockShieldedAccessControlCaller,
} from '../../../../artifacts/access/test/mocks/MockShieldedAccessControlCaller/contract/index.js';
import { ShieldedAccessControlPrivateState } from '../witnesses/ShieldedAccessControlWitnesses.js';

// The mock's only witness is the module's Merkle path lookup, which reads the
// ledger, so the private state is empty.
export type ShieldedAccessControlCallerPrivateState = Record<string, never>;
export const ShieldedAccessControlCallerPrivateState: ShieldedAccessControlCallerPrivateState =
  {};
export const ShieldedAccessControlCallerWitnesses = () => ({
  wit_getRoleCommitmentPath(
    context: WitnessContext<Ledger, ShieldedAccessControlCallerPrivateState>,
    roleCommitment: Uint8Array,
  ): [ShieldedAccessControlCallerPrivateState, MerkleTreePath<Uint8Array>] {
    return [
      context.privateState,
      ShieldedAccessControlPrivateState.getRoleCommitmentPath(
        context.ledger,
        roleCommitment,
      ),
    ];
  },
});

/**
 * Type constructor args
 */
type ShieldedAccessControlCallerArgs = readonly [instanceSalt: Uint8Array];

const ShieldedAccessControlCallerSimulatorBase = createSimulator<
  ShieldedAccessControlCallerPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ShieldedAccessControlCallerWitnesses>,
  MockShieldedAccessControlCaller<ShieldedAccessControlCallerPrivateState>,
  ShieldedAccessControlCallerArgs
>({
  contractFactory: (witnesses) =>
    new MockShieldedAccessControlCaller<ShieldedAccessControlCallerPrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => ShieldedAccessControlCallerPrivateState,
  contractArgs: (instanceSalt) => [instanceSalt],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ShieldedAccessControlCallerWitnesses(),
  artifactName: 'MockShieldedAccessControlCaller',
});

/**
 * ShieldedAccessControl Simulator for the mock that takes the caller and the
 * blinding as arguments.
 *
 * Each method is a thin pass-through to the mock's matching circuit.
 */
export class ShieldedAccessControlCallerSimulator extends ShieldedAccessControlCallerSimulatorBase {
  static async create(
    instanceSalt: Uint8Array,
    options: SimulatorOptions<
      ShieldedAccessControlCallerPrivateState,
      ReturnType<typeof ShieldedAccessControlCallerWitnesses>
    > = {},
  ): Promise<ShieldedAccessControlCallerSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [instanceSalt],
      options,
    ) as Promise<ShieldedAccessControlCallerSimulator>;
  }

  /**
   * @description Throws if `caller` cannot prove `role` under `blinding`.
   * @param caller - The caller to act as.
   * @param blinding - The caller's blinding factor.
   * @param role - The role identifier.
   */
  public assertOnlyRole(
    caller: Caller,
    blinding: Uint8Array,
    role: Uint8Array,
  ): Promise<[]> {
    return this.circuits.impure.assertOnlyRole(caller, blinding, role);
  }

  /**
   * @description Returns whether `caller` proves `role` under `blinding`.
   * @param caller - The caller to act as.
   * @param blinding - The caller's blinding factor.
   * @param role - The role identifier.
   * @returns Whether `caller` proves `role`.
   */
  public canProveRole(
    caller: Caller,
    blinding: Uint8Array,
    role: Uint8Array,
  ): Promise<boolean> {
    return this.circuits.impure.canProveRole(caller, blinding, role);
  }

  /**
   * @description Grants `role` to `accountCommitment`.
   * @param caller - The caller to act as.
   * @param blinding - The caller's blinding factor.
   * @param role - The role identifier.
   * @param accountCommitment - The grantee's account commitment.
   */
  public grantRole(
    caller: Caller,
    blinding: Uint8Array,
    role: Uint8Array,
    accountCommitment: Uint8Array,
  ): Promise<[]> {
    return this.circuits.impure.grantRole(
      caller,
      blinding,
      role,
      accountCommitment,
    );
  }

  /**
   * @description Revokes `role` from the caller's account commitment.
   * @param caller - The caller to act as.
   * @param blinding - The caller's blinding factor.
   * @param role - The role identifier.
   * @param accountCommitmentConfirmation - The caller's account commitment.
   */
  public renounceRole(
    caller: Caller,
    blinding: Uint8Array,
    role: Uint8Array,
    accountCommitmentConfirmation: Uint8Array,
  ): Promise<[]> {
    return this.circuits.impure.renounceRole(
      caller,
      blinding,
      role,
      accountCommitmentConfirmation,
    );
  }

  /**
   * @description Revokes `role` from `accountCommitment`.
   * @param caller - The caller to act as.
   * @param blinding - The caller's blinding factor.
   * @param role - The role identifier.
   * @param accountCommitment - The account commitment to revoke from.
   */
  public revokeRole(
    caller: Caller,
    blinding: Uint8Array,
    role: Uint8Array,
    accountCommitment: Uint8Array,
  ): Promise<[]> {
    return this.circuits.impure.revokeRole(
      caller,
      blinding,
      role,
      accountCommitment,
    );
  }

  /**
   * @description Grants `role` to `accountCommitment`, without access control.
   * @param role - The role identifier.
   * @param accountCommitment - The grantee's account commitment.
   */
  public _grantRole(
    role: Uint8Array,
    accountCommitment: Uint8Array,
  ): Promise<[]> {
    return this.circuits.impure._grantRole(role, accountCommitment);
  }
}

export type { Caller, ContractAddress, Either };
