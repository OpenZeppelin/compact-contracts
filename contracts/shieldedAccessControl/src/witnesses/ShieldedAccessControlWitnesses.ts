import { Buffer } from 'node:buffer';
import {
  constructorContext,
  decodeCoinPublicKey,
  type MerkleTreePath,
  QueryContext,
  type WitnessContext,
} from '@midnight-ntwrk/compact-runtime';
import { encodeContractAddress } from '@midnight-ntwrk/ledger';
import { sampleContractAddress } from '@midnight-ntwrk/zswap';
import {
  type ContractAddress,
  type Either,
  type Ledger,
  Contract as MockShieldedAccessControl,
  type ZswapCoinPublicKey,
} from '../artifacts/MockShieldedAccessControl/contract/index.cjs'; // Combined imports

const { hkdfSync } = await import('node:crypto');

const KEYLEN = 32;

/**
 * @description The respective `nonce` value for a given `roleId` should be at the same index
 * for each array of `Buffer`s
 */
export type ShieldedAccessControlPrivateState = {
  secretKey: Buffer;
  nonces: Buffer[];
  roleIds: Buffer[];
};

/**
 * @description Generates a nonce value using the following scheme: HKDF-SHA256(SK, "role-nonce" | roleId | PK)
 * @param secretKey - The secret key associated with the contract.
 * @param roleId - The role identifier.
 * @param salt - A salt value.
 * @param account - The public key of an account.
 *
 * @returns A unique nonce value for `roleId`
 */
function generateNonce(
  secretKey: Buffer,
  roleId: Buffer,
  salt: Buffer,
  account: Buffer,
): Buffer {
  const domainString = Buffer.from('role-nonce');
  const info = Buffer.concat([domainString, roleId, account]);
  const nonce = hkdfSync('sha256', secretKey, salt, info, KEYLEN);

  return Buffer.from(nonce);
}

/**
 * @description A stub function that simulates a successful role approval
 * @param account - The public key of an account.
 * @param roleId - The role identifier.
 * @param nonce - The nonce associated with `roleId`.
 *
 * @returns Whether the account was approved for a role
 */
function sendRoleRequestToAdmin(
  _account: Buffer,
  _roleId: Buffer,
  _nonce: Buffer,
) {
  return true;
}

export const ShieldedAccessControlWitnesses = {
  /**
   * @description Typescript implementation of the `getRoleCommitmentPath` witness function.
   * @param privateState - The current private state.
   * @param ledger - A snapshot of the current ledger state.
   * @param roleCommitment - The role commitment to query.
   * @param index - The index of `roleCommitment`in the Merkle tree.
   *
   * @returns An array of the private state and the Merkle tree path of `roleCommitment`
   * in the `_operatorRoles` Merkle tree.
   */
  getRoleCommitmentPath: (
    {
      ledger,
      privateState,
    }: WitnessContext<Ledger, ShieldedAccessControlPrivateState>,
    roleCommitment: Uint8Array,
    index: bigint,
  ): [ShieldedAccessControlPrivateState, MerkleTreePath<Uint8Array>] => {
    const merkleTreePath =
      ledger.ShieldedAccessControl__operatorRoles.pathForLeaf(
        index,
        roleCommitment,
      );
    return [privateState, merkleTreePath];
  },
  /**
   * @description Typescript implementation of the `recoverNonce` witness function. Simulates calls to the `hasRole` circuit
   * to determine if the account has the specified role. Updates the private state with any found roles.
   * @param privateState - The current private state.
   * @param ledger - A snapshot of the current ledger state.
   * @param contractAddress - The address of the contract.
   * @param account - The public key associated with a role.
   * @param salt - A salt value.
   *
   * @returns An array of the new private state and the empty tuple
   */
  recoverRoles: (
    {
      ledger,
      privateState,
      contractAddress,
    }: WitnessContext<Ledger, ShieldedAccessControlPrivateState>,
    account: Uint8Array,
    salt: Uint8Array,
  ): [ShieldedAccessControlPrivateState, []] => {
    const roles = [ledger.ShieldedAccessControl_DEFAULT_ADMIN_ROLE];
    const coinPubKey = decodeCoinPublicKey(account);
    const newPrivateState: ShieldedAccessControlPrivateState = {
      secretKey: privateState.secretKey,
      roleIds: [],
      nonces: [],
    };

    const contract =
      new MockShieldedAccessControl<ShieldedAccessControlPrivateState>(
        ShieldedAccessControlWitnesses,
      );
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
    } = contract.initialState(
      constructorContext(
        { secretKey: privateState.secretKey, nonces: [], roleIds: [] },
        coinPubKey,
      ),
    );
    const circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      originalState: currentContractState,
      transactionContext: new QueryContext(
        currentContractState.data,
        contractAddress,
      ),
    };

    for (let i = 0; i < roles.length; i++) {
      const role = roles[i];
      const nonce = generateNonce(
        privateState.secretKey,
        Buffer.from(role),
        Buffer.from(salt),
        Buffer.from(account),
      );
      const eitherAccount: Either<ZswapCoinPublicKey, ContractAddress> = {
        is_left: true,
        left: { bytes: account },
        right: { bytes: encodeContractAddress(sampleContractAddress()) },
      };

      try {
        const hasRole = contract.impureCircuits.hasRole(
          circuitContext,
          role,
          eitherAccount,
          nonce,
        );
        if (hasRole) {
          newPrivateState.nonces.push(nonce);
          newPrivateState.roleIds.push(Buffer.from(role));
        }
      } catch (err) {
        console.log(err);
      }
    }

    return [newPrivateState, []];
  },
  /**
   * @description Typescript implementation of the `requestRole` witness function.
   * @param privateState - The current private state.
   * @param roleId - The role identifier.
   * @param account - The public key requesting a role.
   * @param salt - A salt value.
   *
   * @returns An array of the new private state and an empty array
   */
  requestRole: (
    { privateState }: WitnessContext<Ledger, ShieldedAccessControlPrivateState>,
    roleId: Uint8Array,
    account: Uint8Array,
    salt: Uint8Array,
  ): [ShieldedAccessControlPrivateState, []] => {
    const saltBuff = Buffer.from(salt);
    const roleIdBuff = Buffer.from(roleId);
    const accountBuff = Buffer.from(account);
    const nonce = generateNonce(
      privateState.secretKey,
      roleIdBuff,
      saltBuff,
      accountBuff,
    );
    const isApproved = sendRoleRequestToAdmin(accountBuff, roleIdBuff, nonce);

    if (isApproved) {
      privateState.nonces.push(nonce);
      privateState.roleIds.push(roleIdBuff);
    }

    return [privateState, []];
  },
};
