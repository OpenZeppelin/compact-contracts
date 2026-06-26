import {
  CompactTypeBytes,
  CompactTypeVector,
  convertFieldToBytes,
  type MerkleTreePath,
  persistentHash,
  type WitnessContext,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ledger } from '../../../artifacts/MockShieldedAccessControl/contract/index.js';
import { ShieldedAccessControlSimulator } from './simulators/ShieldedAccessControlSimulator.js';
import { ShieldedAccessControlPrivateState } from './witnesses/ShieldedAccessControlWitnesses.js';

const INSTANCE_SALT = new Uint8Array(32).fill(48473095);
const COMMITMENT_DOMAIN = 'ShieldedAccessControl:commitment';
const NULLIFIER_DOMAIN = 'ShieldedAccessControl:nullifier';
const ACCOUNT_DOMAIN = 'ShieldedAccessControl:accountId';

const DEFAULT_MT_PATH: MerkleTreePath<Uint8Array> = {
  leaf: new Uint8Array(32),
  path: Array.from({ length: 20 }, () => ({
    sibling: { field: 0n },
    goes_left: false,
  })),
};

const RETURN_BAD_PATH = (
  ctx: WitnessContext<Ledger, ShieldedAccessControlPrivateState>,
  _commitment: Uint8Array,
): [ShieldedAccessControlPrivateState, MerkleTreePath<Uint8Array>] => {
  return [ctx.privateState, DEFAULT_MT_PATH];
};

// Helpers
const encodePadded32 = (value: string): Uint8Array => {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(value));
  return out;
};

const buildAccountIdHash = (sk: Uint8Array): Uint8Array => {
  const rt_type = new CompactTypeVector(3, new CompactTypeBytes(32));

  const bDomain = encodePadded32(ACCOUNT_DOMAIN);
  return persistentHash(rt_type, [sk, INSTANCE_SALT, bDomain]);
};

const buildRoleCommitmentHash = (
  role: Uint8Array,
  accountId: Uint8Array,
): Uint8Array => {
  const rt_type = new CompactTypeVector(4, new CompactTypeBytes(32));
  const bDomain = encodePadded32(COMMITMENT_DOMAIN);
  const commitment = persistentHash(rt_type, [
    role,
    accountId,
    INSTANCE_SALT,
    bDomain,
  ]);
  return commitment;
};

const buildNullifierHash = (commitment: Uint8Array): Uint8Array => {
  const rt_type = new CompactTypeVector(2, new CompactTypeBytes(32));
  const bDomain = new TextEncoder().encode(NULLIFIER_DOMAIN);

  const nullifier = persistentHash(rt_type, [commitment, bDomain]);
  return nullifier;
};

// SKs
const ADMIN_SK = Buffer.alloc(32, 'ADMIN_SECRET_KEY');
const OPERATOR_1_SK = Buffer.alloc(32, 'OPERATOR_1_SECRET_KEY');
const OPERATOR_2_SK = Buffer.alloc(32, 'OPERATOR_2_SECRET_KEY');
const OPERATOR_3_SK = Buffer.alloc(32, 'OPERATOR_3_SECRET_KEY');
const UNAUTHORIZED_SK = Buffer.alloc(32, 'UNAUTHORIZED_SECRET_KEY');
const BAD_SK = Buffer.alloc(32, 'BAD_SECRET_KEY');

// Roles
const ROLE_ADMIN = Buffer.from(convertFieldToBytes(32, 0n, ''));
const ROLE_OP1 = Buffer.from(convertFieldToBytes(32, 1n, ''));
const ROLE_OP2 = Buffer.from(convertFieldToBytes(32, 2n, ''));
const ROLE_OP3 = Buffer.from(convertFieldToBytes(32, 3n, ''));
const ROLE_NONEXISTENT = Buffer.from(convertFieldToBytes(32, 555n, ''));

// Derived ids
const ADMIN_ACCOUNT_ID = buildAccountIdHash(ADMIN_SK);
const OP1_ACCOUNT_ID = buildAccountIdHash(OPERATOR_1_SK);
const OP2_ACCOUNT_ID = buildAccountIdHash(OPERATOR_2_SK);
const OP3_ACCOUNT_ID = buildAccountIdHash(OPERATOR_3_SK);
const BAD_ACCOUNT_ID = buildAccountIdHash(BAD_SK);
const UNAUTHORIZED_ACCOUNT_ID = buildAccountIdHash(UNAUTHORIZED_SK);

// Commitments and nullifiers for common (role, accountId) pairings
const ADMIN_ROLE_COMMITMENT = buildRoleCommitmentHash(
  ROLE_ADMIN,
  ADMIN_ACCOUNT_ID,
);
const ADMIN_ROLE_NULLIFIER = buildNullifierHash(ADMIN_ROLE_COMMITMENT);

const OP1_ROLE_COMMITMENT = buildRoleCommitmentHash(ROLE_OP1, OP1_ACCOUNT_ID);

let contract: ShieldedAccessControlSimulator;

describe('ShieldedAccessControl', () => {
  describe('when not initialized', () => {
    beforeEach(async () => {
      contract = await ShieldedAccessControlSimulator.create(
        INSTANCE_SALT,
        false,
      );
    });

    const circuitsRequiringInit: [string, unknown[]][] = [
      ['canProveRole', [ROLE_ADMIN]],
      ['assertOnlyRole', [ROLE_ADMIN]],
      ['grantRole', [ROLE_ADMIN, ADMIN_ACCOUNT_ID]],
      ['revokeRole', [ROLE_ADMIN, ADMIN_ACCOUNT_ID]],
      ['renounceRole', [ROLE_ADMIN, ADMIN_ACCOUNT_ID]],
      ['_grantRole', [ROLE_ADMIN, ADMIN_ACCOUNT_ID]],
      ['_revokeRole', [ROLE_ADMIN, ADMIN_ACCOUNT_ID]],
      ['_setRoleAdmin', [ROLE_ADMIN, ROLE_ADMIN]],
    ];

    it.each(
      circuitsRequiringInit,
    )('%s should fail', async (circuitName, args) => {
      await expect(
        (
          contract[circuitName as keyof ShieldedAccessControlSimulator] as (
            ...a: unknown[]
          ) => Promise<unknown>
        )(...args),
      ).rejects.toThrow('ShieldedAccessControl: contract not initialized');
    });

    it('_grantRole should independently check initialization', async () => {
      await expect(
        contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID),
      ).rejects.toThrow('ShieldedAccessControl: contract not initialized');
    });

    it('_revokeRole should independently check initialization', async () => {
      await expect(
        contract._revokeRole(ROLE_OP1, OP1_ACCOUNT_ID),
      ).rejects.toThrow('ShieldedAccessControl: contract not initialized');
    });

    const circuitsNotRequiringInit: [string, unknown[]][] = [
      ['getRoleAdmin', [ROLE_ADMIN]],
      ['computeRoleCommitment', [ROLE_ADMIN, ADMIN_ACCOUNT_ID]],
      ['computeNullifier', [ADMIN_ROLE_COMMITMENT]],
      ['DEFAULT_ADMIN_ROLE', []],
      ['computeAccountId', [ADMIN_SK, INSTANCE_SALT]],
    ];

    it.each(
      circuitsNotRequiringInit,
    )('%s should succeed', async (circuitName, args) => {
      await (
        contract[circuitName as keyof ShieldedAccessControlSimulator] as (
          ...a: unknown[]
        ) => Promise<unknown>
      )(...args);
    });

    it('should fail with zero instanceSalt', async () => {
      await expect(
        ShieldedAccessControlSimulator.create(new Uint8Array(32), true),
      ).rejects.toThrow('ShieldedAccessControl: Instance salt must not be 0');
    });
  });

  describe('after initialization', () => {
    beforeEach(async () => {
      contract = await ShieldedAccessControlSimulator.create(
        INSTANCE_SALT,
        true,
        {
          privateState:
            ShieldedAccessControlPrivateState.withSecretKey(ADMIN_SK),
        },
      );
    });

    describe('DEFAULT_ADMIN_ROLE', () => {
      it('should return zero bytes', async () => {
        expect(await contract.DEFAULT_ADMIN_ROLE()).toStrictEqual(
          new Uint8Array(32),
        );
      });
    });

    describe('computeAccountId', () => {
      it('should match pre-computed accountId', async () => {
        expect(
          await contract.computeAccountId(ADMIN_SK, INSTANCE_SALT),
        ).toEqual(ADMIN_ACCOUNT_ID);
      });

      it('should produce different accountId with different key', async () => {
        expect(
          await contract.computeAccountId(BAD_SK, INSTANCE_SALT),
        ).not.toEqual(ADMIN_ACCOUNT_ID);
      });

      it('should produce different accountId with different salt', async () => {
        const differentSalt = new Uint8Array(32).fill(1);
        expect(
          await contract.computeAccountId(ADMIN_SK, differentSalt),
        ).not.toEqual(ADMIN_ACCOUNT_ID);
      });

      it('should accept zero-byte secret key', async () => {
        const zeroKey = new Uint8Array(32);
        expect(await contract.computeAccountId(zeroKey, INSTANCE_SALT)).toEqual(
          buildAccountIdHash(zeroKey),
        );
      });
    });

    describe('computeRoleCommitment', () => {
      it('should match pre-computed commitment', async () => {
        expect(
          await contract.computeRoleCommitment(ROLE_ADMIN, ADMIN_ACCOUNT_ID),
        ).toEqual(ADMIN_ROLE_COMMITMENT);
      });

      it('should differ with wrong role', async () => {
        expect(
          await contract.computeRoleCommitment(ROLE_OP1, ADMIN_ACCOUNT_ID),
        ).not.toEqual(ADMIN_ROLE_COMMITMENT);
      });

      it('should differ with wrong accountId', async () => {
        expect(
          await contract.computeRoleCommitment(ROLE_ADMIN, BAD_ACCOUNT_ID),
        ).not.toEqual(ADMIN_ROLE_COMMITMENT);
      });

      it('should differ with different instanceSalt', async () => {
        const newContract = await ShieldedAccessControlSimulator.create(
          new Uint8Array(32).fill(1),
          true,
          {
            privateState:
              ShieldedAccessControlPrivateState.withSecretKey(ADMIN_SK),
          },
        );
        expect(
          await newContract.computeRoleCommitment(ROLE_ADMIN, ADMIN_ACCOUNT_ID),
        ).not.toEqual(ADMIN_ROLE_COMMITMENT);
      });
    });

    describe('computeNullifier', () => {
      it('should match pre-computed nullifier', async () => {
        expect(await contract.computeNullifier(ADMIN_ROLE_COMMITMENT)).toEqual(
          ADMIN_ROLE_NULLIFIER,
        );
      });

      it('should differ with wrong commitment', async () => {
        expect(
          await contract.computeNullifier(OP1_ROLE_COMMITMENT),
        ).not.toEqual(ADMIN_ROLE_NULLIFIER);
      });
    });

    describe('assertOnlyRole', () => {
      beforeEach(async () => {
        await contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
      });

      describe('should fail', () => {
        it('when witness returns path for a different commitment', async () => {
          await contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
          contract.overrideWitness('wit_getRoleCommitmentPath', (ctx) => {
            const path =
              ctx.ledger.ShieldedAccessControl__operatorRoles.findPathForLeaf(
                OP1_ROLE_COMMITMENT,
              );
            if (path) return [ctx.privateState, path];
            throw new Error('Path should be defined');
          });

          await expect(contract.assertOnlyRole(ROLE_ADMIN)).rejects.toThrow(
            'ShieldedAccessControl: Path must contain leaf matching computed role commitment for the provided role, accountId pairing',
          );
        });

        it('when caller has wrong secret key', async () => {
          await contract.privateState.injectSecretKey(UNAUTHORIZED_SK);
          await expect(contract.assertOnlyRole(ROLE_ADMIN)).rejects.toThrow(
            'ShieldedAccessControl: unauthorized account',
          );
        });

        it('when witness provides invalid path', async () => {
          contract.overrideWitness(
            'wit_getRoleCommitmentPath',
            RETURN_BAD_PATH,
          );
          await expect(contract.assertOnlyRole(ROLE_ADMIN)).rejects.toThrow(
            'ShieldedAccessControl: unauthorized account',
          );
        });

        it('when role is revoked', async () => {
          await contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
          await expect(contract.assertOnlyRole(ROLE_ADMIN)).rejects.toThrow(
            'ShieldedAccessControl: unauthorized account',
          );
        });

        it('when role was never granted to anyone', async () => {
          await expect(
            contract.assertOnlyRole(ROLE_NONEXISTENT),
          ).rejects.toThrow('ShieldedAccessControl: unauthorized account');
        });
      });

      describe('should succeed', () => {
        it('when caller has correct key and valid path', async () => {
          await contract.assertOnlyRole(ROLE_ADMIN);
        });

        it('when caller holds multiple roles with same key', async () => {
          await contract._grantRole(ROLE_OP1, ADMIN_ACCOUNT_ID);
          await contract._grantRole(ROLE_OP2, ADMIN_ACCOUNT_ID);
          await contract._grantRole(ROLE_OP3, ADMIN_ACCOUNT_ID);

          await contract.assertOnlyRole(ROLE_ADMIN);
          await contract.assertOnlyRole(ROLE_OP1);
          await contract.assertOnlyRole(ROLE_OP2);
          await contract.assertOnlyRole(ROLE_OP3);
        });

        it('when role is revoked and re-issued with new accountId', async () => {
          await contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

          const newKey = Buffer.alloc(32, 'NEW_ADMIN_KEY');
          await contract.privateState.injectSecretKey(newKey);
          const newAccountId = buildAccountIdHash(newKey);
          await contract._grantRole(ROLE_ADMIN, newAccountId);

          await contract.assertOnlyRole(ROLE_ADMIN);
        });
      });
    });

    describe('canProveRole', () => {
      beforeEach(async () => {
        await contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
      });

      it('should fail when witness returns path for a different commitment', async () => {
        await contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
        contract.overrideWitness('wit_getRoleCommitmentPath', (ctx) => {
          const path =
            ctx.ledger.ShieldedAccessControl__operatorRoles.findPathForLeaf(
              OP1_ROLE_COMMITMENT,
            );
          if (path) return [ctx.privateState, path];
          throw new Error('Path should be defined');
        });

        await expect(contract.canProveRole(ROLE_ADMIN)).rejects.toThrow(
          'ShieldedAccessControl: Path must contain leaf matching computed role commitment for the provided role, accountId pairing',
        );
      });

      describe('should return true', () => {
        it('when caller has role', async () => {
          expect(await contract.canProveRole(ROLE_ADMIN)).toBe(true);
        });

        it('when caller holds multiple roles with same key', async () => {
          await contract._grantRole(ROLE_OP1, ADMIN_ACCOUNT_ID);
          await contract._grantRole(ROLE_OP2, ADMIN_ACCOUNT_ID);
          await contract._grantRole(ROLE_OP3, ADMIN_ACCOUNT_ID);

          expect(await contract.canProveRole(ROLE_ADMIN)).toBe(true);
          expect(await contract.canProveRole(ROLE_OP1)).toBe(true);
          expect(await contract.canProveRole(ROLE_OP2)).toBe(true);
          expect(await contract.canProveRole(ROLE_OP3)).toBe(true);
        });

        it('when role is revoked and re-issued with new accountId', async () => {
          await contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

          const newKey = Buffer.alloc(32, 'NEW_ADMIN_KEY');
          await contract.privateState.injectSecretKey(newKey);
          const newAccountId = buildAccountIdHash(newKey);
          await contract._grantRole(ROLE_ADMIN, newAccountId);

          expect(await contract.canProveRole(ROLE_ADMIN)).toBe(true);
        });

        it('when multiple users hold the same role', async () => {
          await contract._grantRole(ROLE_OP1, ADMIN_ACCOUNT_ID);

          // User 2
          await contract._grantRole(ROLE_OP1, OP2_ACCOUNT_ID);

          // User 3
          await contract._grantRole(ROLE_OP1, OP3_ACCOUNT_ID);

          // Prove as admin (who holds OP1)
          expect(await contract.canProveRole(ROLE_OP1)).toBe(true);

          // Prove as user 2
          await contract.privateState.injectSecretKey(OPERATOR_2_SK);
          expect(await contract.canProveRole(ROLE_OP1)).toBe(true);

          // Prove as user 3
          await contract.privateState.injectSecretKey(OPERATOR_3_SK);
          expect(await contract.canProveRole(ROLE_OP1)).toBe(true);
        });
      });

      describe('should return false', () => {
        it('when caller does not have role', async () => {
          expect(await contract.canProveRole(ROLE_OP1)).toBe(false);
        });

        it('when caller has wrong secret key', async () => {
          await contract.privateState.injectSecretKey(BAD_SK);
          expect(await contract.canProveRole(ROLE_ADMIN)).toBe(false);
        });

        it('when role is revoked', async () => {
          await contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
          expect(await contract.canProveRole(ROLE_ADMIN)).toBe(false);
        });

        it('when witness provides invalid path', async () => {
          contract.overrideWitness(
            'wit_getRoleCommitmentPath',
            RETURN_BAD_PATH,
          );
          expect(await contract.canProveRole(ROLE_ADMIN)).toBe(false);
        });

        it('when invalid witness path is provided for a revoked role', async () => {
          await contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
          contract.overrideWitness(
            'wit_getRoleCommitmentPath',
            RETURN_BAD_PATH,
          );
          expect(await contract.canProveRole(ROLE_ADMIN)).toBe(false);
        });
      });
    });

    describe('grantRole', () => {
      beforeEach(async () => {
        await contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
      });

      describe('should fail', () => {
        it('when caller does not have admin role', async () => {
          await contract.privateState.injectSecretKey(UNAUTHORIZED_SK);
          await expect(
            contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID),
          ).rejects.toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when granting to an already-revoked accountId', async () => {
          await contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
          await contract._revokeRole(ROLE_OP1, OP1_ACCOUNT_ID);

          await expect(
            contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID),
          ).rejects.toThrow('ShieldedAccessControl: role is already revoked');
        });

        it('when admin provides wrong secret key', async () => {
          await contract.privateState.injectSecretKey(BAD_SK);
          await expect(
            contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID),
          ).rejects.toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when admin provides invalid witness path', async () => {
          contract.overrideWitness(
            'wit_getRoleCommitmentPath',
            RETURN_BAD_PATH,
          );
          await expect(
            contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID),
          ).rejects.toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when admin role has been reassigned via _setRoleAdmin', async () => {
          await contract._setRoleAdmin(ROLE_OP2, ROLE_OP1);
          // ADMIN holds DEFAULT_ADMIN_ROLE but not ROLE_OP1
          await expect(
            contract.grantRole(ROLE_OP2, OP2_ACCOUNT_ID),
          ).rejects.toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when witness returns path for a different commitment', async () => {
          await contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
          contract.overrideWitness('wit_getRoleCommitmentPath', (ctx) => {
            const path =
              ctx.ledger.ShieldedAccessControl__operatorRoles.findPathForLeaf(
                OP1_ROLE_COMMITMENT,
              );
            if (path) return [ctx.privateState, path];
            throw new Error('Path should be defined');
          });

          await expect(
            contract.grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID),
          ).rejects.toThrow(
            'ShieldedAccessControl: Path must contain leaf matching computed role commitment for the provided role, accountId pairing',
          );
        });

        it('when admin with duplicate grants is revoked', async () => {
          await contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID); // duplicate
          await contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

          await expect(
            contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID),
          ).rejects.toThrow('ShieldedAccessControl: unauthorized account');
        });
      });

      describe('should succeed', () => {
        it('when caller has admin role', async () => {
          await contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
          await contract.privateState.injectSecretKey(OPERATOR_1_SK);
          expect(await contract.canProveRole(ROLE_OP1)).toBe(true);
        });

        it('when granting the same role multiple times to the same accountId', async () => {
          await contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
          await contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
          await contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID);

          await contract.privateState.injectSecretKey(OPERATOR_1_SK);
          expect(await contract.canProveRole(ROLE_OP1)).toBe(true);
        });

        it('when caller has custom admin role', async () => {
          await contract._setRoleAdmin(ROLE_OP2, ROLE_OP1);
          await contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID);

          // Switch to operator 1
          await contract.privateState.injectSecretKey(OPERATOR_1_SK);
          await contract.grantRole(ROLE_OP2, OP2_ACCOUNT_ID);
          await contract.privateState.injectSecretKey(OPERATOR_2_SK);
          expect(await contract.canProveRole(ROLE_OP2)).toBe(true);
        });

        it('when admin role is revoked and re-issued with new accountId', async () => {
          await contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

          const newKey = Buffer.alloc(32, 'NEW_ADMIN_KEY');
          await contract.privateState.injectSecretKey(newKey);
          const newAccountId = buildAccountIdHash(newKey);
          await contract._grantRole(ROLE_ADMIN, newAccountId);

          await contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
          await contract.privateState.injectSecretKey(OPERATOR_1_SK);
          expect(await contract.canProveRole(ROLE_OP1)).toBe(true);
        });

        it('when multiple admins exist', async () => {
          await contract._grantRole(ROLE_ADMIN, OP1_ACCOUNT_ID);
          await contract._grantRole(ROLE_ADMIN, OP2_ACCOUNT_ID);

          // Admin 1 can grant
          await contract.privateState.injectSecretKey(OPERATOR_1_SK);
          await contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID);

          // Admin 2 can grant
          await contract.privateState.injectSecretKey(OPERATOR_2_SK);
          await contract.grantRole(ROLE_OP2, OP2_ACCOUNT_ID);
        });

        it('when admin holds multiple roles', async () => {
          await contract._grantRole(ROLE_OP1, ADMIN_ACCOUNT_ID);
          await contract._grantRole(ROLE_OP2, ADMIN_ACCOUNT_ID);

          await contract.grantRole(ROLE_OP3, OP3_ACCOUNT_ID);
          await contract.privateState.injectSecretKey(OPERATOR_3_SK);
          expect(await contract.canProveRole(ROLE_OP3)).toBe(true);
        });

        it('when re-granting an active role (duplicate)', async () => {
          await contract.grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
          expect(await contract.canProveRole(ROLE_ADMIN)).toBe(true);
        });
      });
    });

    describe('_grantRole', () => {
      it('should insert commitment into Merkle tree', async () => {
        let root = (
          await contract.getPublicState()
        ).ShieldedAccessControl__operatorRoles.root();
        expect(root.field).toBe(0n);

        await contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

        root = (
          await contract.getPublicState()
        ).ShieldedAccessControl__operatorRoles.root();
        expect(root.field).not.toBe(0n);

        const path = (
          await contract.getPublicState()
        ).ShieldedAccessControl__operatorRoles.findPathForLeaf(
          ADMIN_ROLE_COMMITMENT,
        );
        expect(path).toBeDefined();
        expect(path?.leaf).toStrictEqual(ADMIN_ROLE_COMMITMENT);
      });

      it('should insert multiple commitments into Merkle tree', async () => {
        const root = (
          await contract.getPublicState()
        ).ShieldedAccessControl__operatorRoles.root();
        expect(root.field).toBe(0n);

        await contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        const root1 = (
          await contract.getPublicState()
        ).ShieldedAccessControl__operatorRoles.root();
        expect(root1.field).not.toBe(root.field);

        await contract._grantRole(ROLE_ADMIN, OP1_ACCOUNT_ID);
        const root2 = (
          await contract.getPublicState()
        ).ShieldedAccessControl__operatorRoles.root();
        expect(root2.field).not.toBe(root.field);
        expect(root2.field).not.toBe(root1.field);
      });

      it('should insert multiple leaves for the same (role, accountId)', async () => {
        const rootBefore = (
          await contract.getPublicState()
        ).ShieldedAccessControl__operatorRoles.root();

        await contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
        const rootAfterFirst = (
          await contract.getPublicState()
        ).ShieldedAccessControl__operatorRoles.root();

        await contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
        const rootAfterSecond = (
          await contract.getPublicState()
        ).ShieldedAccessControl__operatorRoles.root();

        // Each grant should change the root (new leaf inserted)
        expect(rootAfterFirst).not.toEqual(rootBefore);
        expect(rootAfterSecond).not.toEqual(rootAfterFirst);
      });

      it('should invalidate all duplicates with a single revocation', async () => {
        await contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
        await contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
        await contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);

        await contract.privateState.injectSecretKey(OPERATOR_1_SK);
        expect(await contract.canProveRole(ROLE_OP1)).toBe(true);

        await contract._revokeRole(ROLE_OP1, OP1_ACCOUNT_ID);

        expect(await contract.canProveRole(ROLE_OP1)).toBe(false);
      });

      it('should throw when granting to a revoked accountId', async () => {
        await contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        await contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

        await expect(
          contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID),
        ).rejects.toThrow('ShieldedAccessControl: role is already revoked');
      });

      it('should not update tree when granting to a revoked accountId', async () => {
        await contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        await contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

        const rootBefore = (
          await contract.getPublicState()
        ).ShieldedAccessControl__operatorRoles.root();
        await expect(
          contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID),
        ).rejects.toThrow('ShieldedAccessControl: role is already revoked');
        const rootAfter = (
          await contract.getPublicState()
        ).ShieldedAccessControl__operatorRoles.root();
        expect(rootBefore).toEqual(rootAfter);
      });

      it('should allow granting same role to new accountId after revoking different accountId', async () => {
        await contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
        await contract._revokeRole(ROLE_OP1, OP1_ACCOUNT_ID);

        // Different accountId for the same role
        await contract._grantRole(ROLE_OP1, OP2_ACCOUNT_ID);
        await contract.privateState.injectSecretKey(OPERATOR_2_SK);
        expect(await contract.canProveRole(ROLE_OP1)).toBe(true);
      });
    });

    describe('revokeRole', () => {
      beforeEach(async () => {
        await contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        await contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
      });

      describe('should fail', () => {
        it('when caller does not have admin role', async () => {
          await contract.privateState.injectSecretKey(UNAUTHORIZED_SK);
          await expect(
            contract.revokeRole(ROLE_OP1, OP1_ACCOUNT_ID),
          ).rejects.toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when re-revoking an already revoked role', async () => {
          await contract.revokeRole(ROLE_OP1, OP1_ACCOUNT_ID);
          await expect(
            contract.revokeRole(ROLE_OP1, OP1_ACCOUNT_ID),
          ).rejects.toThrow('ShieldedAccessControl: role is already revoked');
        });

        it('when admin provides wrong secret key', async () => {
          await contract.privateState.injectSecretKey(BAD_SK);
          await expect(
            contract.revokeRole(ROLE_OP1, OP1_ACCOUNT_ID),
          ).rejects.toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when admin provides invalid witness path', async () => {
          contract.overrideWitness(
            'wit_getRoleCommitmentPath',
            RETURN_BAD_PATH,
          );
          await expect(
            contract.revokeRole(ROLE_OP1, OP1_ACCOUNT_ID),
          ).rejects.toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when witness returns path for a different commitment', async () => {
          contract.overrideWitness('wit_getRoleCommitmentPath', (ctx) => {
            const path =
              ctx.ledger.ShieldedAccessControl__operatorRoles.findPathForLeaf(
                OP1_ROLE_COMMITMENT,
              );
            if (path) return [ctx.privateState, path];
            throw new Error('Path should be defined');
          });

          await expect(
            contract.revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID),
          ).rejects.toThrow(
            'ShieldedAccessControl: Path must contain leaf matching computed role commitment for the provided role, accountId pairing',
          );
        });
      });

      describe('should succeed', () => {
        it('when caller has admin role', async () => {
          await contract.revokeRole(ROLE_OP1, OP1_ACCOUNT_ID);
          await contract.privateState.injectSecretKey(OPERATOR_1_SK);
          expect(await contract.canProveRole(ROLE_OP1)).toBe(false);
        });

        it('when caller has custom admin role', async () => {
          await contract._setRoleAdmin(ROLE_OP2, ROLE_OP1);
          await contract._grantRole(ROLE_OP2, OP2_ACCOUNT_ID);

          await contract.privateState.injectSecretKey(OPERATOR_1_SK);
          await contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);

          await contract.revokeRole(ROLE_OP2, OP2_ACCOUNT_ID);
          await contract.privateState.injectSecretKey(OPERATOR_2_SK);
          expect(await contract.canProveRole(ROLE_OP2)).toBe(false);
        });

        it('when admin self-revokes then cannot further grant or revoke', async () => {
          await contract.revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

          await expect(
            contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID),
          ).rejects.toThrow('ShieldedAccessControl: unauthorized account');
          await expect(
            contract.revokeRole(ROLE_OP1, OP1_ACCOUNT_ID),
          ).rejects.toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when revoking a role that was never granted', async () => {
          await contract.revokeRole(ROLE_NONEXISTENT, ADMIN_ACCOUNT_ID);
          expect(await contract.canProveRole(ROLE_NONEXISTENT)).toBe(false);
        });

        it('when revoking a role from an unauthorized accountId that was never granted', async () => {
          await contract.revokeRole(ROLE_OP1, UNAUTHORIZED_ACCOUNT_ID);

          await expect(
            contract._grantRole(ROLE_OP1, UNAUTHORIZED_ACCOUNT_ID),
          ).rejects.toThrow('ShieldedAccessControl: role is already revoked');
        });

        it('when revoking a never-granted role should permanently block future grants', async () => {
          await contract.revokeRole(ROLE_NONEXISTENT, OP2_ACCOUNT_ID);

          await expect(
            contract._grantRole(ROLE_NONEXISTENT, OP2_ACCOUNT_ID),
          ).rejects.toThrow('ShieldedAccessControl: role is already revoked');
        });

        it('when admin role is revoked and re-issued then can revoke again', async () => {
          await contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

          const newKey = Buffer.alloc(32, 'NEW_ADMIN_KEY');
          await contract.privateState.injectSecretKey(newKey);
          const newAccountId = buildAccountIdHash(newKey);
          await contract._grantRole(ROLE_ADMIN, newAccountId);

          await contract.revokeRole(ROLE_OP1, OP1_ACCOUNT_ID);
          await contract.privateState.injectSecretKey(OPERATOR_1_SK);
          expect(await contract.canProveRole(ROLE_OP1)).toBe(false);
        });
      });
    });

    describe('_revokeRole', () => {
      beforeEach(async () => {
        await contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
      });

      it('should insert nullifier into set', async () => {
        expect(
          (
            await contract.getPublicState()
          ).ShieldedAccessControl__roleCommitmentNullifiers.size(),
        ).toBe(0n);

        await contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

        expect(
          (
            await contract.getPublicState()
          ).ShieldedAccessControl__roleCommitmentNullifiers.size(),
        ).toBe(1n);
        expect(
          (
            await contract.getPublicState()
          ).ShieldedAccessControl__roleCommitmentNullifiers.member(
            ADMIN_ROLE_NULLIFIER,
          ),
        ).toBe(true);
      });

      it('should throw when re-revoking', async () => {
        await contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        await expect(
          contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID),
        ).rejects.toThrow('ShieldedAccessControl: role is already revoked');
      });

      it('should not update nullifier set when re-revoking', async () => {
        await contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        const sizeBefore = (
          await contract.getPublicState()
        ).ShieldedAccessControl__roleCommitmentNullifiers.size();

        await expect(
          contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID),
        ).rejects.toThrow();
        const sizeAfter = (
          await contract.getPublicState()
        ).ShieldedAccessControl__roleCommitmentNullifiers.size();
        expect(sizeBefore).toEqual(sizeAfter);
      });

      it('should allow revoking a role that was never granted', async () => {
        await contract._revokeRole(ROLE_NONEXISTENT, ADMIN_ACCOUNT_ID);
      });
    });

    describe('renounceRole', () => {
      beforeEach(async () => {
        await contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
      });

      it('should allow caller to renounce their own role', async () => {
        await contract.renounceRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        expect(await contract.canProveRole(ROLE_ADMIN)).toBe(false);
      });

      it('should update nullifier set', async () => {
        expect(
          (
            await contract.getPublicState()
          ).ShieldedAccessControl__roleCommitmentNullifiers.size(),
        ).toBe(0n);
        await contract.renounceRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        expect(
          (
            await contract.getPublicState()
          ).ShieldedAccessControl__roleCommitmentNullifiers.size(),
        ).toBe(1n);
        expect(
          (
            await contract.getPublicState()
          ).ShieldedAccessControl__roleCommitmentNullifiers.member(
            ADMIN_ROLE_NULLIFIER,
          ),
        ).toBe(true);
      });

      it('should fail when caller provides wrong accountId', async () => {
        await expect(
          contract.renounceRole(ROLE_ADMIN, BAD_ACCOUNT_ID),
        ).rejects.toThrow('ShieldedAccessControl: bad confirmation');
      });

      it('should fail when caller has wrong secret key', async () => {
        await contract.privateState.injectSecretKey(UNAUTHORIZED_SK);
        await expect(
          contract.renounceRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID),
        ).rejects.toThrow('ShieldedAccessControl: bad confirmation');
      });

      it('should throw when role is already revoked', async () => {
        await contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        await expect(
          contract.renounceRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID),
        ).rejects.toThrow('ShieldedAccessControl: role is already revoked');
      });

      it('should permanently block re-grant to same accountId', async () => {
        await contract.renounceRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        await expect(
          contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID),
        ).rejects.toThrow('ShieldedAccessControl: role is already revoked');
      });

      it('should allow re-grant with new accountId after renounce', async () => {
        await contract.renounceRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

        const newKey = Buffer.alloc(32, 'NEW_ADMIN_KEY');
        await contract.privateState.injectSecretKey(newKey);
        const newAccountId = buildAccountIdHash(newKey);
        await contract._grantRole(ROLE_ADMIN, newAccountId);

        expect(await contract.canProveRole(ROLE_ADMIN)).toBe(true);
      });

      it('should not affect other roles held by same accountId', async () => {
        await contract._grantRole(ROLE_OP1, ADMIN_ACCOUNT_ID);
        await contract._grantRole(ROLE_OP2, ADMIN_ACCOUNT_ID);

        await contract.renounceRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

        expect(await contract.canProveRole(ROLE_ADMIN)).toBe(false);
        expect(await contract.canProveRole(ROLE_OP1)).toBe(true);
        expect(await contract.canProveRole(ROLE_OP2)).toBe(true);
      });

      // Pre-burn scenario: a user can burn a nullifier for a (role, accountId) pairing
      // that was never granted. This permanently blocks future grants to that accountId
      // for the specified role, but does not affect other accountIds holding the same role
      it('should allow renouncing a role never granted to this accountId', async () => {
        // OP1 has ROLE_OP1, but ADMIN does not
        await contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);

        // ADMIN renounces ROLE_OP1 despite never holding it
        await contract.renounceRole(ROLE_OP1, ADMIN_ACCOUNT_ID);

        // OP1's grant is unaffected — different accountId, different nullifier
        await contract.privateState.injectSecretKey(OPERATOR_1_SK);
        expect(await contract.canProveRole(ROLE_OP1)).toBe(true);

        // ADMIN's accountId is now burned for ROLE_OP1
        await expect(
          contract._grantRole(ROLE_OP1, ADMIN_ACCOUNT_ID),
        ).rejects.toThrow('ShieldedAccessControl: role is already revoked');
      });
    });

    describe('getRoleAdmin', () => {
      it('should return DEFAULT_ADMIN_ROLE when no admin set', async () => {
        expect(await contract.getRoleAdmin(ROLE_OP1)).toStrictEqual(
          new Uint8Array(32),
        );
        expect(await contract.getRoleAdmin(ROLE_OP1)).toStrictEqual(
          await contract.DEFAULT_ADMIN_ROLE(),
        );
      });

      it('should restore DEFAULT_ADMIN_ROLE grant/revoke authority after reset to zero bytes', async () => {
        await contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

        // Reassign OP1's admin to OP2
        await contract._setRoleAdmin(ROLE_OP1, ROLE_OP2);

        // DEFAULT_ADMIN_ROLE holder cannot grant ROLE_OP1 anymore
        await expect(
          contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID),
        ).rejects.toThrow('ShieldedAccessControl: unauthorized account');

        // Reset OP1's admin back to DEFAULT_ADMIN_ROLE
        await contract._setRoleAdmin(ROLE_OP1, new Uint8Array(32));

        // DEFAULT_ADMIN_ROLE holder can grant ROLE_OP1 again
        await contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
        await contract.privateState.injectSecretKey(OPERATOR_1_SK);
        expect(await contract.canProveRole(ROLE_OP1)).toBe(true);

        // And can revoke
        await contract.privateState.injectSecretKey(ADMIN_SK);
        await contract.revokeRole(ROLE_OP1, OP1_ACCOUNT_ID);
        await contract.privateState.injectSecretKey(OPERATOR_1_SK);
        expect(await contract.canProveRole(ROLE_OP1)).toBe(false);
      });

      it('should return admin role after _setRoleAdmin', async () => {
        await contract._setRoleAdmin(ROLE_OP1, ROLE_ADMIN);
        expect(await contract.getRoleAdmin(ROLE_OP1)).toEqual(
          new Uint8Array(ROLE_ADMIN),
        );
      });
    });

    describe('_setRoleAdmin', () => {
      it('should set admin role', async () => {
        await contract._setRoleAdmin(ROLE_OP1, ROLE_ADMIN);
        expect(await contract.getRoleAdmin(ROLE_OP1)).toEqual(
          new Uint8Array(ROLE_ADMIN),
        );
      });

      it('should update _adminRoles map', async () => {
        expect(
          (
            await contract.getPublicState()
          ).ShieldedAccessControl__adminRoles.isEmpty(),
        ).toBe(true);

        await contract._setRoleAdmin(ROLE_OP1, ROLE_ADMIN);
        await contract._setRoleAdmin(ROLE_OP2, ROLE_ADMIN);
        await contract._setRoleAdmin(ROLE_OP3, ROLE_ADMIN);

        expect(
          (
            await contract.getPublicState()
          ).ShieldedAccessControl__adminRoles.size(),
        ).toBe(3n);
      });

      it('should override existing admin role', async () => {
        await contract._setRoleAdmin(ROLE_OP1, ROLE_ADMIN);
        await contract._setRoleAdmin(ROLE_OP1, ROLE_OP2);
        expect(await contract.getRoleAdmin(ROLE_OP1)).toEqual(
          new Uint8Array(ROLE_OP2),
        );
      });

      it('should return DEFAULT_ADMIN_ROLE when reset to zero bytes', async () => {
        await contract._setRoleAdmin(ROLE_OP1, ROLE_ADMIN);
        await contract._setRoleAdmin(ROLE_OP1, new Uint8Array(32));
        expect(await contract.getRoleAdmin(ROLE_OP1)).toStrictEqual(
          await contract.DEFAULT_ADMIN_ROLE(),
        );
      });

      it('should allow a role to be its own admin', async () => {
        await contract._setRoleAdmin(ROLE_OP1, ROLE_OP1);
        expect(await contract.getRoleAdmin(ROLE_OP1)).toEqual(
          new Uint8Array(ROLE_OP1),
        );
      });

      it('when new admin revokes after _setRoleAdmin reassignment', async () => {
        await contract._setRoleAdmin(ROLE_OP2, ROLE_OP1);
        await contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
        await contract._grantRole(ROLE_OP2, OP2_ACCOUNT_ID);

        // Switch to operator 1 who is now admin of ROLE_OP2
        await contract.privateState.injectSecretKey(OPERATOR_1_SK);
        await contract.revokeRole(ROLE_OP2, OP2_ACCOUNT_ID);
        await contract.privateState.injectSecretKey(OPERATOR_2_SK);
        expect(await contract.canProveRole(ROLE_OP2)).toBe(false);
      });

      it('admin authority should not be transitive across role hierarchies', async () => {
        await contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        await contract._setRoleAdmin(ROLE_OP2, ROLE_OP1);
        await contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);

        // ADMIN can grant ROLE_OP1 (admin is DEFAULT_ADMIN_ROLE)
        await contract.grantRole(ROLE_OP1, OP2_ACCOUNT_ID);

        // But ADMIN cannot directly grant ROLE_OP2 (admin is ROLE_OP1, not DEFAULT_ADMIN_ROLE)
        await expect(
          contract.grantRole(ROLE_OP2, OP3_ACCOUNT_ID),
        ).rejects.toThrow('ShieldedAccessControl: unauthorized account');

        // OP1 holder can grant ROLE_OP2
        await contract.privateState.injectSecretKey(OPERATOR_1_SK);
        await contract.grantRole(ROLE_OP2, OP3_ACCOUNT_ID);
      });
    });

    describe('single key across multiple roles', () => {
      beforeEach(async () => {
        await contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        await contract._grantRole(ROLE_OP1, ADMIN_ACCOUNT_ID);
        await contract._grantRole(ROLE_OP2, ADMIN_ACCOUNT_ID);
        await contract._grantRole(ROLE_OP3, ADMIN_ACCOUNT_ID);
      });

      it('should prove all roles with same key', async () => {
        expect(await contract.canProveRole(ROLE_ADMIN)).toBe(true);
        expect(await contract.canProveRole(ROLE_OP1)).toBe(true);
        expect(await contract.canProveRole(ROLE_OP2)).toBe(true);
        expect(await contract.canProveRole(ROLE_OP3)).toBe(true);
      });

      it('revoking one role should not affect others', async () => {
        await contract._revokeRole(ROLE_OP2, ADMIN_ACCOUNT_ID);

        expect(await contract.canProveRole(ROLE_ADMIN)).toBe(true);
        expect(await contract.canProveRole(ROLE_OP1)).toBe(true);
        expect(await contract.canProveRole(ROLE_OP2)).toBe(false);
        expect(await contract.canProveRole(ROLE_OP3)).toBe(true);
      });
    });

    describe('cross-contract isolation', () => {
      it('should not validate a role granted on a different contract instance', async () => {
        await contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        expect(await contract.canProveRole(ROLE_ADMIN)).toBe(true);

        // Deploy a different contract with a different salt
        const differentSalt = new Uint8Array(32).fill(99);
        const contractB = await ShieldedAccessControlSimulator.create(
          differentSalt,
          true,
          {
            privateState:
              ShieldedAccessControlPrivateState.withSecretKey(ADMIN_SK),
          },
        );

        // Same key on contract B produces a different accountId (different salt)
        // so canProveRole should return false — role was never granted on B
        expect(await contractB.canProveRole(ROLE_ADMIN)).toBe(false);
      });

      it('should produce different commitments for same role and key across instances', async () => {
        const differentSalt = new Uint8Array(32).fill(99);
        const contractB = await ShieldedAccessControlSimulator.create(
          differentSalt,
          true,
          {
            privateState:
              ShieldedAccessControlPrivateState.withSecretKey(ADMIN_SK),
          },
        );

        const commitmentA = await contract.computeRoleCommitment(
          ROLE_ADMIN,
          ADMIN_ACCOUNT_ID,
        );
        const accountIdOnB = await contractB.computeAccountId(
          ADMIN_SK,
          differentSalt,
        );
        const commitmentB = await contractB.computeRoleCommitment(
          ROLE_ADMIN,
          accountIdOnB,
        );

        expect(commitmentA).not.toEqual(commitmentB);
      });
    });
  });

  describe('privateState helpers', () => {
    beforeEach(async () => {
      contract = await ShieldedAccessControlSimulator.create(
        INSTANCE_SALT,
        true,
        {
          privateState:
            ShieldedAccessControlPrivateState.withSecretKey(ADMIN_SK),
        },
      );
    });

    describe('getCurrentSecretKey', () => {
      it('should return the secret key from private state', async () => {
        expect(await contract.privateState.getCurrentSecretKey()).toEqual(
          ADMIN_SK,
        );
      });

      it('should throw when the secret key is undefined', async () => {
        await contract.privateState.injectSecretKey(undefined as never);

        await expect(
          contract.privateState.getCurrentSecretKey(),
        ).rejects.toThrow('Missing secret key');
      });
    });

    describe('getCommitmentPathWithFindForLeaf', () => {
      it('should return undefined when the commitment is not in the tree', async () => {
        const absentCommitment = buildRoleCommitmentHash(
          ROLE_NONEXISTENT,
          BAD_ACCOUNT_ID,
        );

        expect(
          await contract.privateState.getCommitmentPathWithFindForLeaf(
            absentCommitment,
          ),
        ).toBeUndefined();
      });

      it('should return a path when the commitment is in the tree', async () => {
        await contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);

        const path =
          await contract.privateState.getCommitmentPathWithFindForLeaf(
            OP1_ROLE_COMMITMENT,
          );

        expect(path).toBeDefined();
        expect(path?.leaf).toEqual(OP1_ROLE_COMMITMENT);
      });
    });

    describe('getCommitmentPathWithWitnessImpl', () => {
      it('should return a default path when the commitment is not in the tree', async () => {
        const absentCommitment = buildRoleCommitmentHash(
          ROLE_NONEXISTENT,
          BAD_ACCOUNT_ID,
        );

        const path =
          await contract.privateState.getCommitmentPathWithWitnessImpl(
            absentCommitment,
          );

        expect(path.leaf).toEqual(new Uint8Array(32));
      });

      it('should return a path matching findPathForLeaf when the commitment is in the tree', async () => {
        await contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);

        const witnessPath =
          await contract.privateState.getCommitmentPathWithWitnessImpl(
            OP1_ROLE_COMMITMENT,
          );
        const findPath =
          await contract.privateState.getCommitmentPathWithFindForLeaf(
            OP1_ROLE_COMMITMENT,
          );

        expect(witnessPath.leaf).toEqual(findPath?.leaf);
      });
    });
  });
});
