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
import { ShieldedAccessControlPrivateState } from '../witnesses/ShieldedAccessControlWitnesses.js';
import { ShieldedAccessControlSimulator } from './simulators/ShieldedAccessControlSimulator.js';

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
    beforeEach(() => {
      contract = new ShieldedAccessControlSimulator(INSTANCE_SALT, false);
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

    it.each(circuitsRequiringInit)('%s should fail', (circuitName, args) => {
      expect(() => {
        (
          contract[circuitName as keyof ShieldedAccessControlSimulator] as (
            ...a: unknown[]
          ) => unknown
        )(...args);
      }).toThrow('Initializable: contract not initialized');
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
    )('%s should succeed', (circuitName, args) => {
      expect(() => {
        (
          contract[circuitName as keyof ShieldedAccessControlSimulator] as (
            ...a: unknown[]
          ) => unknown
        )(...args);
      }).not.toThrow();
    });

    it('should fail with zero instanceSalt', () => {
      expect(() => {
        new ShieldedAccessControlSimulator(new Uint8Array(32), true);
      }).toThrow('ShieldedAccessControl: Instance salt must not be 0');
    });
  });

  describe('after initialization', () => {
    beforeEach(() => {
      contract = new ShieldedAccessControlSimulator(INSTANCE_SALT, true, {
        privateState: ShieldedAccessControlPrivateState.withSecretKey(ADMIN_SK),
      });
    });

    describe('DEFAULT_ADMIN_ROLE', () => {
      it('should return zero bytes', () => {
        expect(contract.DEFAULT_ADMIN_ROLE()).toStrictEqual(new Uint8Array(32));
      });
    });

    describe('computeAccountId', () => {
      it('should match pre-computed accountId', () => {
        expect(contract.computeAccountId(ADMIN_SK, INSTANCE_SALT)).toEqual(
          ADMIN_ACCOUNT_ID,
        );
      });

      it('should produce different accountId with different key', () => {
        expect(contract.computeAccountId(BAD_SK, INSTANCE_SALT)).not.toEqual(
          ADMIN_ACCOUNT_ID,
        );
      });

      it('should produce different accountId with different salt', () => {
        const differentSalt = new Uint8Array(32).fill(1);
        expect(contract.computeAccountId(ADMIN_SK, differentSalt)).not.toEqual(
          ADMIN_ACCOUNT_ID,
        );
      });

      it('should accept zero-byte secret key', () => {
        const zeroKey = new Uint8Array(32);
        expect(contract.computeAccountId(zeroKey, INSTANCE_SALT)).toEqual(
          buildAccountIdHash(zeroKey),
        );
      });
    });

    describe('computeRoleCommitment', () => {
      it('should match pre-computed commitment', () => {
        expect(
          contract.computeRoleCommitment(ROLE_ADMIN, ADMIN_ACCOUNT_ID),
        ).toEqual(ADMIN_ROLE_COMMITMENT);
      });

      it('should differ with wrong role', () => {
        expect(
          contract.computeRoleCommitment(ROLE_OP1, ADMIN_ACCOUNT_ID),
        ).not.toEqual(ADMIN_ROLE_COMMITMENT);
      });

      it('should differ with wrong accountId', () => {
        expect(
          contract.computeRoleCommitment(ROLE_ADMIN, BAD_ACCOUNT_ID),
        ).not.toEqual(ADMIN_ROLE_COMMITMENT);
      });

      it('should differ with different instanceSalt', () => {
        const newContract = new ShieldedAccessControlSimulator(
          new Uint8Array(32).fill(1),
          true,
          {
            privateState:
              ShieldedAccessControlPrivateState.withSecretKey(ADMIN_SK),
          },
        );
        expect(
          newContract.computeRoleCommitment(ROLE_ADMIN, ADMIN_ACCOUNT_ID),
        ).not.toEqual(ADMIN_ROLE_COMMITMENT);
      });
    });

    describe('computeNullifier', () => {
      it('should match pre-computed nullifier', () => {
        expect(contract.computeNullifier(ADMIN_ROLE_COMMITMENT)).toEqual(
          ADMIN_ROLE_NULLIFIER,
        );
      });

      it('should differ with wrong commitment', () => {
        expect(contract.computeNullifier(OP1_ROLE_COMMITMENT)).not.toEqual(
          ADMIN_ROLE_NULLIFIER,
        );
      });
    });

    describe('assertOnlyRole', () => {
      beforeEach(() => {
        contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
      });

      describe('should fail', () => {
        it('when witness returns path for a different commitment', () => {
          contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
          contract.overrideWitness('wit_getRoleCommitmentPath', () => {
            const ps = contract.getPrivateState();
            const path = contract
              .getPublicState()
              .ShieldedAccessControl__operatorRoles.findPathForLeaf(
                OP1_ROLE_COMMITMENT,
              );
            if (path) return [ps, path];
            throw new Error('Path should be defined');
          });

          expect(() => contract.assertOnlyRole(ROLE_ADMIN)).toThrow(
            'ShieldedAccessControl: Path must contain leaf matching computed role commitment for the provided role, accountId pairing',
          );
        });

        it('when caller has wrong secret key', () => {
          contract.privateState.injectSecretKey(UNAUTHORIZED_SK);
          expect(() => contract.assertOnlyRole(ROLE_ADMIN)).toThrow(
            'ShieldedAccessControl: unauthorized account',
          );
        });

        it('when witness provides invalid path', () => {
          contract.overrideWitness(
            'wit_getRoleCommitmentPath',
            RETURN_BAD_PATH,
          );
          expect(() => contract.assertOnlyRole(ROLE_ADMIN)).toThrow(
            'ShieldedAccessControl: unauthorized account',
          );
        });

        it('when role is revoked', () => {
          contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
          expect(() => contract.assertOnlyRole(ROLE_ADMIN)).toThrow(
            'ShieldedAccessControl: unauthorized account',
          );
        });

        it('when role was never granted to anyone', () => {
          expect(() => contract.assertOnlyRole(ROLE_NONEXISTENT)).toThrow(
            'ShieldedAccessControl: unauthorized account',
          );
        });
      });

      describe('should succeed', () => {
        it('when caller has correct key and valid path', () => {
          expect(() => contract.assertOnlyRole(ROLE_ADMIN)).not.toThrow();
        });

        it('when caller holds multiple roles with same key', () => {
          contract._grantRole(ROLE_OP1, ADMIN_ACCOUNT_ID);
          contract._grantRole(ROLE_OP2, ADMIN_ACCOUNT_ID);
          contract._grantRole(ROLE_OP3, ADMIN_ACCOUNT_ID);

          expect(() => {
            contract.assertOnlyRole(ROLE_ADMIN);
            contract.assertOnlyRole(ROLE_OP1);
            contract.assertOnlyRole(ROLE_OP2);
            contract.assertOnlyRole(ROLE_OP3);
          }).not.toThrow();
        });

        it('when role is revoked and re-issued with new accountId', () => {
          contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

          const newKey = Buffer.alloc(32, 'NEW_ADMIN_KEY');
          contract.privateState.injectSecretKey(newKey);
          const newAccountId = buildAccountIdHash(newKey);
          contract._grantRole(ROLE_ADMIN, newAccountId);

          expect(() => contract.assertOnlyRole(ROLE_ADMIN)).not.toThrow();
        });
      });
    });

    describe('canProveRole', () => {
      beforeEach(() => {
        contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
      });

      it('should fail when witness returns path for a different commitment', () => {
        contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
        contract.overrideWitness('wit_getRoleCommitmentPath', () => {
          const ps = contract.getPrivateState();
          const path = contract
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.findPathForLeaf(
              OP1_ROLE_COMMITMENT,
            );
          if (path) return [ps, path];
          throw new Error('Path should be defined');
        });

        expect(() => contract.canProveRole(ROLE_ADMIN)).toThrow(
          'ShieldedAccessControl: Path must contain leaf matching computed role commitment for the provided role, accountId pairing',
        );
      });

      describe('should return true', () => {
        it('when caller has role', () => {
          expect(contract.canProveRole(ROLE_ADMIN)).toBe(true);
        });

        it('when caller holds multiple roles with same key', () => {
          contract._grantRole(ROLE_OP1, ADMIN_ACCOUNT_ID);
          contract._grantRole(ROLE_OP2, ADMIN_ACCOUNT_ID);
          contract._grantRole(ROLE_OP3, ADMIN_ACCOUNT_ID);

          expect(contract.canProveRole(ROLE_ADMIN)).toBe(true);
          expect(contract.canProveRole(ROLE_OP1)).toBe(true);
          expect(contract.canProveRole(ROLE_OP2)).toBe(true);
          expect(contract.canProveRole(ROLE_OP3)).toBe(true);
        });

        it('when role is revoked and re-issued with new accountId', () => {
          contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

          const newKey = Buffer.alloc(32, 'NEW_ADMIN_KEY');
          contract.privateState.injectSecretKey(newKey);
          const newAccountId = buildAccountIdHash(newKey);
          contract._grantRole(ROLE_ADMIN, newAccountId);

          expect(contract.canProveRole(ROLE_ADMIN)).toBe(true);
        });

        it('when multiple users hold the same role', () => {
          contract._grantRole(ROLE_OP1, ADMIN_ACCOUNT_ID);

          // User 2
          contract._grantRole(ROLE_OP1, OP2_ACCOUNT_ID);

          // User 3
          contract._grantRole(ROLE_OP1, OP3_ACCOUNT_ID);

          // Prove as admin (who holds OP1)
          expect(contract.canProveRole(ROLE_OP1)).toBe(true);

          // Prove as user 2
          contract.privateState.injectSecretKey(OPERATOR_2_SK);
          expect(contract.canProveRole(ROLE_OP1)).toBe(true);

          // Prove as user 3
          contract.privateState.injectSecretKey(OPERATOR_3_SK);
          expect(contract.canProveRole(ROLE_OP1)).toBe(true);
        });
      });

      describe('should return false', () => {
        it('when caller does not have role', () => {
          expect(contract.canProveRole(ROLE_OP1)).toBe(false);
        });

        it('when caller has wrong secret key', () => {
          contract.privateState.injectSecretKey(BAD_SK);
          expect(contract.canProveRole(ROLE_ADMIN)).toBe(false);
        });

        it('when role is revoked', () => {
          contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
          expect(contract.canProveRole(ROLE_ADMIN)).toBe(false);
        });

        it('when witness provides invalid path', () => {
          contract.overrideWitness(
            'wit_getRoleCommitmentPath',
            RETURN_BAD_PATH,
          );
          expect(contract.canProveRole(ROLE_ADMIN)).toBe(false);
        });

        it('when invalid witness path is provided for a revoked role', () => {
          contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
          contract.overrideWitness(
            'wit_getRoleCommitmentPath',
            RETURN_BAD_PATH,
          );
          expect(contract.canProveRole(ROLE_ADMIN)).toBe(false);
        });
      });
    });

    describe('grantRole', () => {
      beforeEach(() => {
        contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
      });

      describe('should fail', () => {
        it('when caller does not have admin role', () => {
          contract.privateState.injectSecretKey(UNAUTHORIZED_SK);
          expect(() => contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID)).toThrow(
            'ShieldedAccessControl: unauthorized account',
          );
        });

        it('when granting to an already-revoked accountId', () => {
          contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
          contract._revokeRole(ROLE_OP1, OP1_ACCOUNT_ID);

          expect(() => contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID)).toThrow(
            'ShieldedAccessControl: role is already revoked',
          );
        });

        it('when admin provides wrong secret key', () => {
          contract.privateState.injectSecretKey(BAD_SK);
          expect(() => contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID)).toThrow(
            'ShieldedAccessControl: unauthorized account',
          );
        });

        it('when admin provides invalid witness path', () => {
          contract.overrideWitness(
            'wit_getRoleCommitmentPath',
            RETURN_BAD_PATH,
          );
          expect(() => contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID)).toThrow(
            'ShieldedAccessControl: unauthorized account',
          );
        });

        it('when admin role has been reassigned via _setRoleAdmin', () => {
          contract._setRoleAdmin(ROLE_OP2, ROLE_OP1);
          // ADMIN holds DEFAULT_ADMIN_ROLE but not ROLE_OP1
          expect(() => contract.grantRole(ROLE_OP2, OP2_ACCOUNT_ID)).toThrow(
            'ShieldedAccessControl: unauthorized account',
          );
        });

        it('when witness returns path for a different commitment', () => {
          contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
          contract.overrideWitness('wit_getRoleCommitmentPath', () => {
            const ps = contract.getPrivateState();
            const path = contract
              .getPublicState()
              .ShieldedAccessControl__operatorRoles.findPathForLeaf(
                OP1_ROLE_COMMITMENT,
              );
            if (path) return [ps, path];
            throw new Error('Path should be defined');
          });

          expect(() =>
            contract.grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID),
          ).toThrow(
            'ShieldedAccessControl: Path must contain leaf matching computed role commitment for the provided role, accountId pairing',
          );
        });

        it('when admin with duplicate grants is revoked', () => {
          contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID); // duplicate
          contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

          expect(() => contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID)).toThrow(
            'ShieldedAccessControl: unauthorized account',
          );
        });
      });

      describe('should succeed', () => {
        it('when caller has admin role', () => {
          expect(() =>
            contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID),
          ).not.toThrow();
          contract.privateState.injectSecretKey(OPERATOR_1_SK);
          expect(contract.canProveRole(ROLE_OP1)).toBe(true);
        });

        it('when granting the same role multiple times to the same accountId', () => {
          expect(() =>
            contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID),
          ).not.toThrow();
          expect(() =>
            contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID),
          ).not.toThrow();
          expect(() =>
            contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID),
          ).not.toThrow();

          contract.privateState.injectSecretKey(OPERATOR_1_SK);
          expect(contract.canProveRole(ROLE_OP1)).toBe(true);
        });

        it('when caller has custom admin role', () => {
          contract._setRoleAdmin(ROLE_OP2, ROLE_OP1);
          contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID);

          // Switch to operator 1
          contract.privateState.injectSecretKey(OPERATOR_1_SK);
          expect(() =>
            contract.grantRole(ROLE_OP2, OP2_ACCOUNT_ID),
          ).not.toThrow();
          contract.privateState.injectSecretKey(OPERATOR_2_SK);
          expect(contract.canProveRole(ROLE_OP2)).toBe(true);
        });

        it('when admin role is revoked and re-issued with new accountId', () => {
          contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

          const newKey = Buffer.alloc(32, 'NEW_ADMIN_KEY');
          contract.privateState.injectSecretKey(newKey);
          const newAccountId = buildAccountIdHash(newKey);
          contract._grantRole(ROLE_ADMIN, newAccountId);

          expect(() =>
            contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID),
          ).not.toThrow();
          contract.privateState.injectSecretKey(OPERATOR_1_SK);
          expect(contract.canProveRole(ROLE_OP1)).toBe(true);
        });

        it('when multiple admins exist', () => {
          contract._grantRole(ROLE_ADMIN, OP1_ACCOUNT_ID);
          contract._grantRole(ROLE_ADMIN, OP2_ACCOUNT_ID);

          // Admin 1 can grant
          contract.privateState.injectSecretKey(OPERATOR_1_SK);
          expect(() =>
            contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID),
          ).not.toThrow();

          // Admin 2 can grant
          contract.privateState.injectSecretKey(OPERATOR_2_SK);
          expect(() =>
            contract.grantRole(ROLE_OP2, OP2_ACCOUNT_ID),
          ).not.toThrow();
        });

        it('when admin holds multiple roles', () => {
          contract._grantRole(ROLE_OP1, ADMIN_ACCOUNT_ID);
          contract._grantRole(ROLE_OP2, ADMIN_ACCOUNT_ID);

          expect(() =>
            contract.grantRole(ROLE_OP3, OP3_ACCOUNT_ID),
          ).not.toThrow();
          contract.privateState.injectSecretKey(OPERATOR_3_SK);
          expect(contract.canProveRole(ROLE_OP3)).toBe(true);
        });

        it('when re-granting an active role (duplicate)', () => {
          expect(() =>
            contract.grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID),
          ).not.toThrow();
          expect(contract.canProveRole(ROLE_ADMIN)).toBe(true);
        });
      });
    });

    describe('_grantRole', () => {
      it('should insert commitment into Merkle tree', () => {
        let root = contract
          .getPublicState()
          .ShieldedAccessControl__operatorRoles.root();
        expect(root.field).toBe(0n);

        contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

        root = contract
          .getPublicState()
          .ShieldedAccessControl__operatorRoles.root();
        expect(root.field).not.toBe(0n);

        const path = contract
          .getPublicState()
          .ShieldedAccessControl__operatorRoles.findPathForLeaf(
            ADMIN_ROLE_COMMITMENT,
          );
        expect(path).toBeDefined();
        expect(path?.leaf).toStrictEqual(ADMIN_ROLE_COMMITMENT);
      });

      it('should insert multiple commitments into Merkle tree', () => {
        const root = contract
          .getPublicState()
          .ShieldedAccessControl__operatorRoles.root();
        expect(root.field).toBe(0n);

        contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        const root1 = contract
          .getPublicState()
          .ShieldedAccessControl__operatorRoles.root();
        expect(root1.field).not.toBe(root.field);

        contract._grantRole(ROLE_ADMIN, OP1_ACCOUNT_ID);
        const root2 = contract
          .getPublicState()
          .ShieldedAccessControl__operatorRoles.root();
        expect(root2.field).not.toBe(root.field);
        expect(root2.field).not.toBe(root1.field);
      });

      it('should insert multiple leaves for the same (role, accountId)', () => {
        const rootBefore = contract
          .getPublicState()
          .ShieldedAccessControl__operatorRoles.root();

        contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
        const rootAfterFirst = contract
          .getPublicState()
          .ShieldedAccessControl__operatorRoles.root();

        contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
        const rootAfterSecond = contract
          .getPublicState()
          .ShieldedAccessControl__operatorRoles.root();

        // Each grant should change the root (new leaf inserted)
        expect(rootAfterFirst).not.toEqual(rootBefore);
        expect(rootAfterSecond).not.toEqual(rootAfterFirst);
      });

      it('should invalidate all duplicates with a single revocation', () => {
        contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
        contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
        contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);

        contract.privateState.injectSecretKey(OPERATOR_1_SK);
        expect(contract.canProveRole(ROLE_OP1)).toBe(true);

        contract._revokeRole(ROLE_OP1, OP1_ACCOUNT_ID);

        expect(contract.canProveRole(ROLE_OP1)).toBe(false);
      });

      it('should throw when granting to a revoked accountId', () => {
        contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

        expect(() => contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID)).toThrow(
          'ShieldedAccessControl: role is already revoked',
        );
      });

      it('should not update tree when granting to a revoked accountId', () => {
        contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

        const rootBefore = contract
          .getPublicState()
          .ShieldedAccessControl__operatorRoles.root();
        expect(() => contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID)).toThrow(
          'ShieldedAccessControl: role is already revoked',
        );
        const rootAfter = contract
          .getPublicState()
          .ShieldedAccessControl__operatorRoles.root();
        expect(rootBefore).toEqual(rootAfter);
      });

      it('should allow granting same role to new accountId after revoking different accountId', () => {
        contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
        contract._revokeRole(ROLE_OP1, OP1_ACCOUNT_ID);

        // Different accountId for the same role
        expect(() =>
          contract._grantRole(ROLE_OP1, OP2_ACCOUNT_ID),
        ).not.toThrow();
        contract.privateState.injectSecretKey(OPERATOR_2_SK);
        expect(contract.canProveRole(ROLE_OP1)).toBe(true);
      });
    });

    describe('revokeRole', () => {
      beforeEach(() => {
        contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
      });

      describe('should fail', () => {
        it('when caller does not have admin role', () => {
          contract.privateState.injectSecretKey(UNAUTHORIZED_SK);
          expect(() => contract.revokeRole(ROLE_OP1, OP1_ACCOUNT_ID)).toThrow(
            'ShieldedAccessControl: unauthorized account',
          );
        });

        it('when re-revoking an already revoked role', () => {
          contract.revokeRole(ROLE_OP1, OP1_ACCOUNT_ID);
          expect(() => contract.revokeRole(ROLE_OP1, OP1_ACCOUNT_ID)).toThrow(
            'ShieldedAccessControl: role is already revoked',
          );
        });

        it('when admin provides wrong secret key', () => {
          contract.privateState.injectSecretKey(BAD_SK);
          expect(() => contract.revokeRole(ROLE_OP1, OP1_ACCOUNT_ID)).toThrow(
            'ShieldedAccessControl: unauthorized account',
          );
        });

        it('when admin provides invalid witness path', () => {
          contract.overrideWitness(
            'wit_getRoleCommitmentPath',
            RETURN_BAD_PATH,
          );
          expect(() => contract.revokeRole(ROLE_OP1, OP1_ACCOUNT_ID)).toThrow(
            'ShieldedAccessControl: unauthorized account',
          );
        });

        it('when witness returns path for a different commitment', () => {
          contract.overrideWitness('wit_getRoleCommitmentPath', () => {
            const ps = contract.getPrivateState();
            const path = contract
              .getPublicState()
              .ShieldedAccessControl__operatorRoles.findPathForLeaf(
                OP1_ROLE_COMMITMENT,
              );
            if (path) return [ps, path];
            throw new Error('Path should be defined');
          });

          expect(() =>
            contract.revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID),
          ).toThrow(
            'ShieldedAccessControl: Path must contain leaf matching computed role commitment for the provided role, accountId pairing',
          );
        });
      });

      describe('should succeed', () => {
        it('when caller has admin role', () => {
          expect(() =>
            contract.revokeRole(ROLE_OP1, OP1_ACCOUNT_ID),
          ).not.toThrow();
          contract.privateState.injectSecretKey(OPERATOR_1_SK);
          expect(contract.canProveRole(ROLE_OP1)).toBe(false);
        });

        it('when caller has custom admin role', () => {
          contract._setRoleAdmin(ROLE_OP2, ROLE_OP1);
          contract._grantRole(ROLE_OP2, OP2_ACCOUNT_ID);

          contract.privateState.injectSecretKey(OPERATOR_1_SK);
          contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);

          expect(() =>
            contract.revokeRole(ROLE_OP2, OP2_ACCOUNT_ID),
          ).not.toThrow();
          contract.privateState.injectSecretKey(OPERATOR_2_SK);
          expect(contract.canProveRole(ROLE_OP2)).toBe(false);
        });

        it('when admin self-revokes then cannot further grant or revoke', () => {
          contract.revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

          expect(() => contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID)).toThrow(
            'ShieldedAccessControl: unauthorized account',
          );
          expect(() => contract.revokeRole(ROLE_OP1, OP1_ACCOUNT_ID)).toThrow(
            'ShieldedAccessControl: unauthorized account',
          );
        });

        it('when revoking a role that was never granted', () => {
          expect(() =>
            contract.revokeRole(ROLE_NONEXISTENT, ADMIN_ACCOUNT_ID),
          ).not.toThrow();
          expect(contract.canProveRole(ROLE_NONEXISTENT)).toBe(false);
        });

        it('when revoking a never-granted role should permanently block future grants', () => {
          contract.revokeRole(ROLE_NONEXISTENT, OP2_ACCOUNT_ID);

          expect(() =>
            contract._grantRole(ROLE_NONEXISTENT, OP2_ACCOUNT_ID),
          ).toThrow('ShieldedAccessControl: role is already revoked');
        });

        it('when admin role is revoked and re-issued then can revoke again', () => {
          contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

          const newKey = Buffer.alloc(32, 'NEW_ADMIN_KEY');
          contract.privateState.injectSecretKey(newKey);
          const newAccountId = buildAccountIdHash(newKey);
          contract._grantRole(ROLE_ADMIN, newAccountId);

          expect(() =>
            contract.revokeRole(ROLE_OP1, OP1_ACCOUNT_ID),
          ).not.toThrow();
          contract.privateState.injectSecretKey(OPERATOR_1_SK);
          expect(contract.canProveRole(ROLE_OP1)).toBe(false);
        });
      });
    });

    describe('_revokeRole', () => {
      beforeEach(() => {
        contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
      });

      it('should insert nullifier into set', () => {
        expect(
          contract
            .getPublicState()
            .ShieldedAccessControl__roleCommitmentNullifiers.size(),
        ).toBe(0n);

        contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

        expect(
          contract
            .getPublicState()
            .ShieldedAccessControl__roleCommitmentNullifiers.size(),
        ).toBe(1n);
        expect(
          contract
            .getPublicState()
            .ShieldedAccessControl__roleCommitmentNullifiers.member(
              ADMIN_ROLE_NULLIFIER,
            ),
        ).toBe(true);
      });

      it('should throw when re-revoking', () => {
        contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        expect(() =>
          contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID),
        ).toThrow('ShieldedAccessControl: role is already revoked');
      });

      it('should not update nullifier set when re-revoking', () => {
        contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        const sizeBefore = contract
          .getPublicState()
          .ShieldedAccessControl__roleCommitmentNullifiers.size();

        expect(() =>
          contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID),
        ).toThrow();
        const sizeAfter = contract
          .getPublicState()
          .ShieldedAccessControl__roleCommitmentNullifiers.size();
        expect(sizeBefore).toEqual(sizeAfter);
      });

      it('should allow revoking a role that was never granted', () => {
        expect(() =>
          contract._revokeRole(ROLE_NONEXISTENT, ADMIN_ACCOUNT_ID),
        ).not.toThrow();
      });
    });

    describe('renounceRole', () => {
      beforeEach(() => {
        contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
      });

      it('should allow caller to renounce their own role', () => {
        expect(() =>
          contract.renounceRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID),
        ).not.toThrow();
        expect(contract.canProveRole(ROLE_ADMIN)).toBe(false);
      });

      it('should update nullifier set', () => {
        expect(
          contract
            .getPublicState()
            .ShieldedAccessControl__roleCommitmentNullifiers.size(),
        ).toBe(0n);
        contract.renounceRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        expect(
          contract
            .getPublicState()
            .ShieldedAccessControl__roleCommitmentNullifiers.size(),
        ).toBe(1n);
        expect(
          contract
            .getPublicState()
            .ShieldedAccessControl__roleCommitmentNullifiers.member(
              ADMIN_ROLE_NULLIFIER,
            ),
        ).toBe(true);
      });

      it('should fail when caller provides wrong accountId', () => {
        expect(() => contract.renounceRole(ROLE_ADMIN, BAD_ACCOUNT_ID)).toThrow(
          'ShieldedAccessControl: bad confirmation',
        );
      });

      it('should fail when caller has wrong secret key', () => {
        contract.privateState.injectSecretKey(UNAUTHORIZED_SK);
        expect(() =>
          contract.renounceRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID),
        ).toThrow('ShieldedAccessControl: bad confirmation');
      });

      it('should throw when role is already revoked', () => {
        contract._revokeRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        expect(() =>
          contract.renounceRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID),
        ).toThrow('ShieldedAccessControl: role is already revoked');
      });

      it('should permanently block re-grant to same accountId', () => {
        contract.renounceRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        expect(() => contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID)).toThrow(
          'ShieldedAccessControl: role is already revoked',
        );
      });

      it('should allow re-grant with new accountId after renounce', () => {
        contract.renounceRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

        const newKey = Buffer.alloc(32, 'NEW_ADMIN_KEY');
        contract.privateState.injectSecretKey(newKey);
        const newAccountId = buildAccountIdHash(newKey);
        contract._grantRole(ROLE_ADMIN, newAccountId);

        expect(contract.canProveRole(ROLE_ADMIN)).toBe(true);
      });

      it('should not affect other roles held by same accountId', () => {
        contract._grantRole(ROLE_OP1, ADMIN_ACCOUNT_ID);
        contract._grantRole(ROLE_OP2, ADMIN_ACCOUNT_ID);

        contract.renounceRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

        expect(contract.canProveRole(ROLE_ADMIN)).toBe(false);
        expect(contract.canProveRole(ROLE_OP1)).toBe(true);
        expect(contract.canProveRole(ROLE_OP2)).toBe(true);
      });

      // Pre-burn scenario: a user can burn a nullifier for a (role, accountId) pairing
      // that was never granted. This permanently blocks future grants to that accountId
      // for the specified role, but does not affect other accountIds holding the same role
      it('should allow renouncing a role never granted to this accountId', () => {
        // OP1 has ROLE_OP1, but ADMIN does not
        contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);

        // ADMIN renounces ROLE_OP1 despite never holding it
        expect(() =>
          contract.renounceRole(ROLE_OP1, ADMIN_ACCOUNT_ID),
        ).not.toThrow();

        // OP1's grant is unaffected — different accountId, different nullifier
        contract.privateState.injectSecretKey(OPERATOR_1_SK);
        expect(contract.canProveRole(ROLE_OP1)).toBe(true);

        // ADMIN's accountId is now burned for ROLE_OP1
        expect(() => contract._grantRole(ROLE_OP1, ADMIN_ACCOUNT_ID)).toThrow(
          'ShieldedAccessControl: role is already revoked',
        );
      });
    });

    describe('getRoleAdmin', () => {
      it('should return DEFAULT_ADMIN_ROLE when no admin set', () => {
        expect(contract.getRoleAdmin(ROLE_OP1)).toStrictEqual(
          new Uint8Array(32),
        );
        expect(contract.getRoleAdmin(ROLE_OP1)).toStrictEqual(
          contract.DEFAULT_ADMIN_ROLE(),
        );
      });

      it('should restore DEFAULT_ADMIN_ROLE grant/revoke authority after reset to zero bytes', () => {
        contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);

        // Reassign OP1's admin to OP2
        contract._setRoleAdmin(ROLE_OP1, ROLE_OP2);

        // DEFAULT_ADMIN_ROLE holder cannot grant ROLE_OP1 anymore
        expect(() => contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID)).toThrow(
          'ShieldedAccessControl: unauthorized account',
        );

        // Reset OP1's admin back to DEFAULT_ADMIN_ROLE
        contract._setRoleAdmin(ROLE_OP1, new Uint8Array(32));

        // DEFAULT_ADMIN_ROLE holder can grant ROLE_OP1 again
        expect(() =>
          contract.grantRole(ROLE_OP1, OP1_ACCOUNT_ID),
        ).not.toThrow();
        contract.privateState.injectSecretKey(OPERATOR_1_SK);
        expect(contract.canProveRole(ROLE_OP1)).toBe(true);

        // And can revoke
        contract.privateState.injectSecretKey(ADMIN_SK);
        expect(() =>
          contract.revokeRole(ROLE_OP1, OP1_ACCOUNT_ID),
        ).not.toThrow();
        contract.privateState.injectSecretKey(OPERATOR_1_SK);
        expect(contract.canProveRole(ROLE_OP1)).toBe(false);
      });

      it('should return admin role after _setRoleAdmin', () => {
        contract._setRoleAdmin(ROLE_OP1, ROLE_ADMIN);
        expect(contract.getRoleAdmin(ROLE_OP1)).toEqual(
          new Uint8Array(ROLE_ADMIN),
        );
      });
    });

    describe('_setRoleAdmin', () => {
      it('should set admin role', () => {
        contract._setRoleAdmin(ROLE_OP1, ROLE_ADMIN);
        expect(contract.getRoleAdmin(ROLE_OP1)).toEqual(
          new Uint8Array(ROLE_ADMIN),
        );
      });

      it('should update _adminRoles map', () => {
        expect(
          contract.getPublicState().ShieldedAccessControl__adminRoles.isEmpty(),
        ).toBe(true);

        contract._setRoleAdmin(ROLE_OP1, ROLE_ADMIN);
        contract._setRoleAdmin(ROLE_OP2, ROLE_ADMIN);
        contract._setRoleAdmin(ROLE_OP3, ROLE_ADMIN);

        expect(
          contract.getPublicState().ShieldedAccessControl__adminRoles.size(),
        ).toBe(3n);
      });

      it('should override existing admin role', () => {
        contract._setRoleAdmin(ROLE_OP1, ROLE_ADMIN);
        contract._setRoleAdmin(ROLE_OP1, ROLE_OP2);
        expect(contract.getRoleAdmin(ROLE_OP1)).toEqual(
          new Uint8Array(ROLE_OP2),
        );
      });

      it('should return DEFAULT_ADMIN_ROLE when reset to zero bytes', () => {
        contract._setRoleAdmin(ROLE_OP1, ROLE_ADMIN);
        contract._setRoleAdmin(ROLE_OP1, new Uint8Array(32));
        expect(contract.getRoleAdmin(ROLE_OP1)).toStrictEqual(
          contract.DEFAULT_ADMIN_ROLE(),
        );
      });

      it('should allow a role to be its own admin', () => {
        contract._setRoleAdmin(ROLE_OP1, ROLE_OP1);
        expect(contract.getRoleAdmin(ROLE_OP1)).toEqual(
          new Uint8Array(ROLE_OP1),
        );
      });

      it('when new admin revokes after _setRoleAdmin reassignment', () => {
        contract._setRoleAdmin(ROLE_OP2, ROLE_OP1);
        contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);
        contract._grantRole(ROLE_OP2, OP2_ACCOUNT_ID);

        // Switch to operator 1 who is now admin of ROLE_OP2
        contract.privateState.injectSecretKey(OPERATOR_1_SK);
        expect(() =>
          contract.revokeRole(ROLE_OP2, OP2_ACCOUNT_ID),
        ).not.toThrow();
        contract.privateState.injectSecretKey(OPERATOR_2_SK);
        expect(contract.canProveRole(ROLE_OP2)).toBe(false);
      });

      it('admin authority should not be transitive across role hierarchies', () => {
        contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        contract._setRoleAdmin(ROLE_OP2, ROLE_OP1);
        contract._grantRole(ROLE_OP1, OP1_ACCOUNT_ID);

        // ADMIN can grant ROLE_OP1 (admin is DEFAULT_ADMIN_ROLE)
        expect(() =>
          contract.grantRole(ROLE_OP1, OP2_ACCOUNT_ID),
        ).not.toThrow();

        // But ADMIN cannot directly grant ROLE_OP2 (admin is ROLE_OP1, not DEFAULT_ADMIN_ROLE)
        expect(() => contract.grantRole(ROLE_OP2, OP3_ACCOUNT_ID)).toThrow(
          'ShieldedAccessControl: unauthorized account',
        );

        // OP1 holder can grant ROLE_OP2
        contract.privateState.injectSecretKey(OPERATOR_1_SK);
        expect(() =>
          contract.grantRole(ROLE_OP2, OP3_ACCOUNT_ID),
        ).not.toThrow();
      });
    });

    describe('single key across multiple roles', () => {
      beforeEach(() => {
        contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        contract._grantRole(ROLE_OP1, ADMIN_ACCOUNT_ID);
        contract._grantRole(ROLE_OP2, ADMIN_ACCOUNT_ID);
        contract._grantRole(ROLE_OP3, ADMIN_ACCOUNT_ID);
      });

      it('should prove all roles with same key', () => {
        expect(contract.canProveRole(ROLE_ADMIN)).toBe(true);
        expect(contract.canProveRole(ROLE_OP1)).toBe(true);
        expect(contract.canProveRole(ROLE_OP2)).toBe(true);
        expect(contract.canProveRole(ROLE_OP3)).toBe(true);
      });

      it('revoking one role should not affect others', () => {
        contract._revokeRole(ROLE_OP2, ADMIN_ACCOUNT_ID);

        expect(contract.canProveRole(ROLE_ADMIN)).toBe(true);
        expect(contract.canProveRole(ROLE_OP1)).toBe(true);
        expect(contract.canProveRole(ROLE_OP2)).toBe(false);
        expect(contract.canProveRole(ROLE_OP3)).toBe(true);
      });
    });

    describe('cross-contract isolation', () => {
      it('should not validate a role granted on a different contract instance', () => {
        contract._grantRole(ROLE_ADMIN, ADMIN_ACCOUNT_ID);
        expect(contract.canProveRole(ROLE_ADMIN)).toBe(true);

        // Deploy a different contract with a different salt
        const differentSalt = new Uint8Array(32).fill(99);
        const contractB = new ShieldedAccessControlSimulator(
          differentSalt,
          true,
          {
            privateState:
              ShieldedAccessControlPrivateState.withSecretKey(ADMIN_SK),
          },
        );

        // Same key on contract B produces a different accountId (different salt)
        // so canProveRole should return false — role was never granted on B
        expect(contractB.canProveRole(ROLE_ADMIN)).toBe(false);
      });

      it('should produce different commitments for same role and key across instances', () => {
        const differentSalt = new Uint8Array(32).fill(99);
        const contractB = new ShieldedAccessControlSimulator(
          differentSalt,
          true,
          {
            privateState:
              ShieldedAccessControlPrivateState.withSecretKey(ADMIN_SK),
          },
        );

        const commitmentA = contract.computeRoleCommitment(
          ROLE_ADMIN,
          ADMIN_ACCOUNT_ID,
        );
        const accountIdOnB = contractB.computeAccountId(
          ADMIN_SK,
          differentSalt,
        );
        const commitmentB = contractB.computeRoleCommitment(
          ROLE_ADMIN,
          accountIdOnB,
        );

        expect(commitmentA).not.toEqual(commitmentB);
      });
    });
  });
});
