import {
  CompactTypeBytes,
  CompactTypeVector,
  convertFieldToBytes,
  type MerkleTreePath,
  persistentHash,
  type WitnessContext,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import type {
  Ledger,
  ZswapCoinPublicKey,
} from '../../../artifacts/MockShieldedAccessControl/contract/index.js';
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
const buildAccountIdHash = (
  pk: ZswapCoinPublicKey,
  nonce: Uint8Array,
): Uint8Array => {
  const rt_type = new CompactTypeVector(4, new CompactTypeBytes(32));

  const bPK = pk.bytes;
  const bDomain = new TextEncoder().encode(ACCOUNT_DOMAIN);
  return persistentHash(rt_type, [bPK, nonce, INSTANCE_SALT, bDomain]);
};

const buildRoleCommitmentHash = (
  role: Uint8Array,
  accountId: Uint8Array,
): Uint8Array => {
  const rt_type = new CompactTypeVector(4, new CompactTypeBytes(32));
  const bDomain = new TextEncoder().encode(COMMITMENT_DOMAIN);

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

class ShieldedAccessControlConstant {
  baseString: string;
  publicKey: string;
  zPublicKey: ZswapCoinPublicKey;
  role: Buffer;
  accountId: Uint8Array;
  roleNullifier: Uint8Array;
  roleCommitment: Uint8Array;
  secretNonce: Buffer;

  constructor(baseString: string, roleIdentifier: bigint) {
    this.baseString = baseString;
    [this.publicKey, this.zPublicKey] = utils.generatePubKeyPair(baseString);
    this.secretNonce = Buffer.alloc(32, `${baseString}_NONCE`);
    this.accountId = buildAccountIdHash(this.zPublicKey, this.secretNonce);
    this.role = Buffer.from(convertFieldToBytes(32, roleIdentifier, ''));
    this.roleCommitment = buildRoleCommitmentHash(this.role, this.accountId);
    this.roleNullifier = buildNullifierHash(this.roleCommitment);
  }
}

// PKs
const ADMIN = new ShieldedAccessControlConstant('ADMIN', 0n);
const OPERATOR_1 = new ShieldedAccessControlConstant('OPERATOR_1', 1n);
const OPERATOR_2 = new ShieldedAccessControlConstant('OPERATOR_2', 2n);
const OPERATOR_3 = new ShieldedAccessControlConstant('OPERATOR_3', 3n);
const UNAUTHORIZED = new ShieldedAccessControlConstant(
  'UNAUTHORIZED',
  99999999n,
);
const UNINITIALIZED = new ShieldedAccessControlConstant('UNINITIALIZED', 555n);
const BAD_INPUT = new ShieldedAccessControlConstant('BAD_INPUT', 666n);

let shieldedAccessControl: ShieldedAccessControlSimulator;

describe('ShieldedAccessControl', () => {
  describe('when not initialized correctly', () => {
    const isInit = false;

    beforeEach(() => {
      shieldedAccessControl = new ShieldedAccessControlSimulator(
        INSTANCE_SALT,
        isInit,
      );
    });
    type FailingCircuits = [
      method: keyof ShieldedAccessControlSimulator,
      args: unknown[],
    ];
    // Circuit calls should fail before the args are used
    const circuitsToFail: FailingCircuits[] = [
      ['proveCallerRole', [UNINITIALIZED.role]],
      ['assertOnlyRole', [UNINITIALIZED.role]],
      ['_validateRole', [UNINITIALIZED.role, UNINITIALIZED.accountId]],
      ['getRoleAdmin', [UNINITIALIZED.role]],
      ['grantRole', [UNINITIALIZED.role, UNINITIALIZED.accountId]],
      ['revokeRole', [UNINITIALIZED.role, UNINITIALIZED.accountId]],
      ['renounceRole', [UNINITIALIZED.role, UNINITIALIZED.accountId]],
      ['_setRoleAdmin', [UNINITIALIZED.role, UNINITIALIZED.role]],
      ['_grantRole', [UNINITIALIZED.role, UNINITIALIZED.accountId]],
      ['_revokeRole', [UNINITIALIZED.role, UNINITIALIZED.accountId]],
      [
        '_computeRoleCommitment',
        [UNINITIALIZED.role, UNINITIALIZED.accountId],
      ],
      [
        '_computeAccountId',
        [UNINITIALIZED.zPublicKey, UNINITIALIZED.accountId],
      ],
    ];
    it.each(circuitsToFail)('%s should fail', (circuitName, args) => {
      expect(() => {
        (shieldedAccessControl[circuitName] as (...args: unknown[]) => unknown)(
          ...args,
        );
      }).toThrow('Initializable: contract not initialized');
    });

    it('should allow pure _computeNullifier', () => {
      expect(() => {
        shieldedAccessControl._computeNullifier(ADMIN.roleCommitment);
      }).not.toThrow();
    });

    it('should fail with 0 instanceSalt', () => {
      const isInit = true;
      expect(() => {
        new ShieldedAccessControlSimulator(new Uint8Array(32), isInit);
      }).toThrow('ShieldedAccessControl: Instance salt must not be 0');
    });
  });

  describe('after initialization', () => {
    const isInit = true;

    beforeEach(() => {
      // Create private state object and generate nonce
      const PS = ShieldedAccessControlPrivateState.withRoleAndNonce(
        ADMIN.role,
        ADMIN.secretNonce,
      );
      // Create contract simulator with PS
      shieldedAccessControl = new ShieldedAccessControlSimulator(
        INSTANCE_SALT,
        isInit,
        {
          privateState: PS,
        },
      );
    });

    describe('_computeRoleCommitment', () => {
      it('should match computed commitment', () => {
        expect(
          shieldedAccessControl._computeRoleCommitment(
            ADMIN.role,
            ADMIN.accountId,
          ),
        ).toEqual(ADMIN.roleCommitment);
      });

      type ComputeCommitmentCases = [
        isValidRoleId: boolean,
        isValidAccountId: boolean,
        args: unknown[],
      ];

      const checkedCircuits: ComputeCommitmentCases[] = [
        [false, true, [BAD_INPUT.role, ADMIN.accountId]],
        [true, false, [ADMIN.role, BAD_INPUT.accountId]],
        [false, false, [BAD_INPUT.role, BAD_INPUT.accountId]],
      ];

      it.each(
        checkedCircuits,
      )('should not compute commitment with isValidRoleId=%s, isValidAccountId=%s', (_isValidRoleId, _isValidAccountId, args) => {
        // Test protected circuit
        expect(() => {
          (
            shieldedAccessControl._computeRoleCommitment as (
              ...args: unknown[]
            ) => Uint8Array
          )(...args);
        }).not.toEqual(ADMIN.roleCommitment);
      });
    });

    describe('_computeNullifier', () => {
      it('should match nullifier', () => {
        expect(
          shieldedAccessControl._computeNullifier(ADMIN.roleCommitment),
        ).toEqual(ADMIN.roleNullifier);
      });

      it('should not match bad commitment inputs', () => {
        expect(
          shieldedAccessControl._computeNullifier(BAD_INPUT.roleCommitment),
        ).not.toEqual(ADMIN.roleNullifier);
      });
    });

    describe('_computeAccountId', () => {
      it('should match account id', () => {
        expect(
          shieldedAccessControl._computeAccountId(
            ADMIN.zPublicKey,
            ADMIN.secretNonce,
          ),
        ).toEqual(ADMIN.accountId);
      });

      type ComputeAccountIdCases = [
        isValidAccount: boolean,
        isValidNonce: boolean,
        args: unknown[],
      ];

      const checkedCircuits: ComputeAccountIdCases[] = [
        [true, false, [ADMIN.zPublicKey, UNAUTHORIZED.secretNonce]],
        [false, true, [UNAUTHORIZED.zPublicKey, ADMIN.secretNonce]],
        [false, false, [UNAUTHORIZED.zPublicKey, UNAUTHORIZED.secretNonce]],
      ];

      it.each(
        checkedCircuits,
      )('should not match account id with isValidAccount=%s or isValidNonce=%s', (_isValidAccount, _isValidNonce, args) => {
        // Test circuit
        expect(() => {
          (
            shieldedAccessControl._computeAccountId as (
              ...args: unknown[]
            ) => Uint8Array
          )(...args);
        }).not.toEqual(ADMIN.accountId);
      });
    });

    describe('_validateRole', () => {
      beforeEach(() => {
        shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId);
        shieldedAccessControl.setPersistentCaller(ADMIN.publicKey);
      });

      it('should fail when wit_getRoleCommitmentPath returns a valid path for a different role, accountId pairing', () => {
        shieldedAccessControl._grantRole(
          OPERATOR_1.role,
          OPERATOR_1.accountId,
        );
        // Override witness to return valid path for OPERATOR_1 role commitment
        shieldedAccessControl.overrideWitness(
          'wit_getRoleCommitmentPath',
          () => {
            const privateState = shieldedAccessControl.getPrivateState();
            const operator1MtPath = shieldedAccessControl
              .getPublicState()
              .ShieldedAccessControl__operatorRoles.findPathForLeaf(
                OPERATOR_1.roleCommitment,
              );
            if (operator1MtPath) return [privateState, operator1MtPath];
            throw new Error('Merkle tree path should be defined');
          },
        );
        expect(() => {
          shieldedAccessControl._validateRole(ADMIN.role, ADMIN.accountId);
        }).toThrow(
          'ShieldedAccessControl: Path must contain leaf matching computed role commitment for the provided role, accountId pairing',
        );
      });

      describe('should return false', () => {
        type CheckRoleCases = [
          badRoleId: boolean,
          badAccountId: boolean,
          args: unknown[],
        ];
        const checkedCircuits: CheckRoleCases[] = [
          [false, true, [ADMIN.role, BAD_INPUT.accountId]],
          [true, false, [BAD_INPUT.role, ADMIN.accountId]],
          [false, false, [BAD_INPUT.role, BAD_INPUT.accountId]],
        ];

        it.each(
          checkedCircuits,
        )('when badRoleId=%s badAccountId=%s', (_badRoleId, _badAccountId, args) => {
          // Test protected circuit
          expect(
            (
              shieldedAccessControl._validateRole as (
                ...args: unknown[]
              ) => boolean
            )(...args),
          ).toBe(false);
        });

        it('when role does not exist', () => {
          expect(
            shieldedAccessControl._validateRole(
              UNINITIALIZED.role,
              ADMIN.accountId,
            ),
          ).toBe(false);
        });

        it('when revoked role is re-issued to the same accountId', () => {
          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);
          shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId);
          expect(
            shieldedAccessControl._validateRole(ADMIN.role, ADMIN.accountId),
          ).toBe(false);
        });

        it('when role is revoked, ', () => {
          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);
          const roleCheck = shieldedAccessControl._validateRole(
            ADMIN.role,
            ADMIN.accountId,
          );
          expect(roleCheck).toBe(false);
        });

        it('when invalid witness is provided for a legitimately credentialed user', () => {
          shieldedAccessControl.overrideWitness(
            'wit_getRoleCommitmentPath',
            RETURN_BAD_PATH,
          );
          expect(
            shieldedAccessControl._validateRole(ADMIN.role, ADMIN.accountId),
          ).toBe(false);
        });

        // an invalid witness should not violate the security invariant: revoked roles
        // are permanent
        it('when an invalid witness is provided for a revoked role', () => {
          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);
          shieldedAccessControl.overrideWitness(
            'wit_getRoleCommitmentPath',
            RETURN_BAD_PATH,
          );
          expect(
            shieldedAccessControl._validateRole(ADMIN.role, ADMIN.accountId),
          ).toBe(false);
        });
      });

      describe('should return true', () => {
        it('when role is granted', () => {
          expect(
            shieldedAccessControl._validateRole(ADMIN.role, ADMIN.accountId),
          ).toBe(true);
        });

        it('when accountId has multiple roles', () => {
          shieldedAccessControl._grantRole(OPERATOR_1.role, ADMIN.accountId);
          shieldedAccessControl._grantRole(OPERATOR_2.role, ADMIN.accountId);
          shieldedAccessControl._grantRole(OPERATOR_3.role, ADMIN.accountId);

          expect(
            shieldedAccessControl._validateRole(ADMIN.role, ADMIN.accountId),
          ).toBe(true);
          expect(
            shieldedAccessControl._validateRole(
              OPERATOR_1.role,
              ADMIN.accountId,
            ),
          ).toBe(true);
          expect(
            shieldedAccessControl._validateRole(
              OPERATOR_2.role,
              ADMIN.accountId,
            ),
          ).toBe(true);
          expect(
            shieldedAccessControl._validateRole(
              OPERATOR_3.role,
              ADMIN.accountId,
            ),
          ).toBe(true);
        });

        it('when role is revoked and re-issued with a different accountId', () => {
          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);

          shieldedAccessControl.privateState.injectSecretNonce(
            ADMIN.role,
            Buffer.alloc(32, 'NEW_ADMIN_NONCE'),
          );
          const newAdminAccountId = buildAccountIdHash(
            ADMIN.zPublicKey,
            shieldedAccessControl.privateState.getCurrentSecretNonce(
              ADMIN.role,
            ),
          );
          expect(newAdminAccountId).not.toEqual(ADMIN.accountId);

          shieldedAccessControl._grantRole(ADMIN.role, newAdminAccountId);
          expect(
            shieldedAccessControl._validateRole(
              ADMIN.role,
              newAdminAccountId,
            ),
          ).toBe(true);
        });

        it('when multiple users have the same role', () => {
          // All users will use OPERATOR_1.secretNonce as their nonce value
          // when generating their accountId for simplicity
          shieldedAccessControl.privateState.injectSecretNonce(
            OPERATOR_1.role,
            OPERATOR_1.secretNonce,
          );
          // A unique accountId must be constructed for each new role using its associated secretNonce
          const operator1AdminAccountId = buildAccountIdHash(
            ADMIN.zPublicKey,
            OPERATOR_1.secretNonce,
          );
          shieldedAccessControl._grantRole(
            OPERATOR_1.role,
            operator1AdminAccountId,
          );
          shieldedAccessControl.as(ADMIN.publicKey); // assert ADMIN has OP_1 role
          expect(
            shieldedAccessControl._validateRole(
              OPERATOR_1.role,
              operator1AdminAccountId,
            ),
          ).toBe(true);

          const operator1Op2AccountId = buildAccountIdHash(
            OPERATOR_2.zPublicKey,
            OPERATOR_1.secretNonce,
          );
          shieldedAccessControl._grantRole(
            OPERATOR_1.role,
            operator1Op2AccountId,
          );
          shieldedAccessControl.as(OPERATOR_2.publicKey); // assert OP_2 has OP_1 role
          expect(
            shieldedAccessControl._validateRole(
              OPERATOR_1.role,
              operator1Op2AccountId,
            ),
          ).toBe(true);

          const operator1Op3AccountId = buildAccountIdHash(
            OPERATOR_3.zPublicKey,
            OPERATOR_1.secretNonce,
          );
          shieldedAccessControl._grantRole(
            OPERATOR_1.role,
            operator1Op3AccountId,
          );
          shieldedAccessControl.as(OPERATOR_3.publicKey); // assert OP_3 has OP_1 role
          expect(
            shieldedAccessControl._validateRole(
              OPERATOR_1.role,
              operator1Op3AccountId,
            ),
          ).toBe(true);
        });
      });
    });

    describe('assertOnlyRole', () => {
      beforeEach(() => {
        shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId);
        shieldedAccessControl.setPersistentCaller(ADMIN.publicKey);
      });

      describe('should fail', () => {
        it('when wit_getRoleCommitmentPath returns a valid path for a different role, accountId pairing', () => {
          shieldedAccessControl._grantRole(
            OPERATOR_1.role,
            OPERATOR_1.accountId,
          );
          // Override witness to return valid path for OPERATOR_1 role commitment
          shieldedAccessControl.overrideWitness(
            'wit_getRoleCommitmentPath',
            () => {
              const privateState = shieldedAccessControl.getPrivateState();
              const operator1MtPath = shieldedAccessControl
                .getPublicState()
                .ShieldedAccessControl__operatorRoles.findPathForLeaf(
                  OPERATOR_1.roleCommitment,
                );
              if (operator1MtPath) return [privateState, operator1MtPath];
              throw new Error('Merkle tree path should be defined');
            },
          );
          expect(() => {
            shieldedAccessControl.assertOnlyRole(ADMIN.role);
          }).toThrow(
            'ShieldedAccessControl: Path must contain leaf matching computed role commitment for the provided role, accountId pairing',
          );
        });

        it('when caller was never granted the role', () => {
          shieldedAccessControl.as(UNAUTHORIZED.publicKey);
          expect(() =>
            shieldedAccessControl.assertOnlyRole(ADMIN.role),
          ).toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when authorized caller has incorrect path', () => {
          // Check caller is admin, has admin role
          expect(
            shieldedAccessControl.getCallerContext().currentZswapLocalState
              .coinPublicKey,
          ).toEqual(ADMIN.zPublicKey);
          expect(shieldedAccessControl.getRoleAdmin(ADMIN.role)).toEqual(
            new Uint8Array(ADMIN.role),
          );
          expect(
            shieldedAccessControl._validateRole(ADMIN.role, ADMIN.accountId),
          ).toBe(true);

          // Check nonce is correct
          expect(
            shieldedAccessControl.privateState.getCurrentSecretNonce(
              ADMIN.role,
            ),
          ).toBe(ADMIN.secretNonce);

          // Check path does not match
          const truePath =
            shieldedAccessControl.privateState.getCommitmentPathWithFindForLeaf(
              ADMIN.roleCommitment,
            );
          shieldedAccessControl.overrideWitness(
            'wit_getRoleCommitmentPath',
            RETURN_BAD_PATH,
          );
          const witnessCalculatedPath =
            shieldedAccessControl.privateState.getCommitmentPathWithWitnessImpl(
              ADMIN.roleCommitment,
            );
          expect(witnessCalculatedPath).not.toEqual(truePath);

          expect(() =>
            shieldedAccessControl.assertOnlyRole(ADMIN.role),
          ).toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when authorized caller has incorrect nonce', () => {
          // Check caller is admin, has admin role
          expect(
            shieldedAccessControl.getCallerContext().currentZswapLocalState
              .coinPublicKey,
          ).toEqual(ADMIN.zPublicKey);
          expect(shieldedAccessControl.getRoleAdmin(ADMIN.role)).toEqual(
            new Uint8Array(ADMIN.role),
          );
          expect(
            shieldedAccessControl._validateRole(ADMIN.role, ADMIN.accountId),
          ).toBe(true);

          shieldedAccessControl.privateState.injectSecretNonce(
            ADMIN.role,
            UNAUTHORIZED.secretNonce,
          );

          // Check nonce is incorrect
          expect(
            shieldedAccessControl.privateState.getCurrentSecretNonce(
              ADMIN.role,
            ),
          ).not.toBe(ADMIN.secretNonce);

          // Check path matches
          const truePath =
            shieldedAccessControl.privateState.getCommitmentPathWithFindForLeaf(
              ADMIN.roleCommitment,
            );
          const witnessCalculatedPath =
            shieldedAccessControl.privateState.getCommitmentPathWithWitnessImpl(
              ADMIN.roleCommitment,
            );
          expect(witnessCalculatedPath).toEqual(truePath);

          expect(() =>
            shieldedAccessControl.assertOnlyRole(ADMIN.role),
          ).toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when unauthorized caller has correct nonce, and path', () => {
          // Check UNAUTHORIZED user is not admin, doesnt have admin role
          expect(shieldedAccessControl.getRoleAdmin(ADMIN.role)).not.toEqual(
            new Uint8Array(UNAUTHORIZED.role),
          );
          expect(
            shieldedAccessControl._validateRole(
              ADMIN.role,
              UNAUTHORIZED.accountId,
            ),
          ).toBe(false);

          // Check nonce is correct
          expect(
            shieldedAccessControl.privateState.getCurrentSecretNonce(
              ADMIN.role,
            ),
          ).toBe(ADMIN.secretNonce);

          // Check path matches
          const truePath =
            shieldedAccessControl.privateState.getCommitmentPathWithFindForLeaf(
              ADMIN.roleCommitment,
            );
          const witnessCalculatedPath =
            shieldedAccessControl.privateState.getCommitmentPathWithWitnessImpl(
              ADMIN.roleCommitment,
            );
          expect(witnessCalculatedPath).toEqual(truePath);

          shieldedAccessControl.as(UNAUTHORIZED.publicKey);
          // Check caller is UNAUTHORIZED user
          expect(
            shieldedAccessControl.getCallerContext().currentZswapLocalState
              .coinPublicKey,
          ).toEqual(UNAUTHORIZED.zPublicKey);

          expect(() =>
            shieldedAccessControl.assertOnlyRole(ADMIN.role),
          ).toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when role is revoked', () => {
          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);
          expect(() =>
            shieldedAccessControl.assertOnlyRole(ADMIN.role),
          ).toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when role is revoked and re-issued to the same accountId', () => {
          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);
          shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId);
          expect(() =>
            shieldedAccessControl.assertOnlyRole(ADMIN.role),
          ).toThrow('ShieldedAccessControl: unauthorized account');
        });
      });

      describe('should not fail', () => {
        it('when accountId has multiple roles', () => {
          shieldedAccessControl.privateState.injectSecretNonce(
            OPERATOR_1.role,
            OPERATOR_1.secretNonce,
          );
          // A unique accountId must be constructed for each new role using its associated secretNonce
          const operator1AccountId = buildAccountIdHash(
            ADMIN.zPublicKey,
            OPERATOR_1.secretNonce,
          );

          shieldedAccessControl.privateState.injectSecretNonce(
            OPERATOR_2.role,
            OPERATOR_2.secretNonce,
          );
          const operator2AccountId = buildAccountIdHash(
            ADMIN.zPublicKey,
            OPERATOR_2.secretNonce,
          );

          shieldedAccessControl.privateState.injectSecretNonce(
            OPERATOR_3.role,
            OPERATOR_3.secretNonce,
          );
          const operator3AccountId = buildAccountIdHash(
            ADMIN.zPublicKey,
            OPERATOR_3.secretNonce,
          );

          shieldedAccessControl._grantRole(
            OPERATOR_1.role,
            operator1AccountId,
          );
          shieldedAccessControl._grantRole(
            OPERATOR_2.role,
            operator2AccountId,
          );
          shieldedAccessControl._grantRole(
            OPERATOR_3.role,
            operator3AccountId,
          );
          expect(() => {
            shieldedAccessControl.assertOnlyRole(ADMIN.role);
            shieldedAccessControl.assertOnlyRole(OPERATOR_1.role);
            shieldedAccessControl.assertOnlyRole(OPERATOR_2.role);
            shieldedAccessControl.assertOnlyRole(OPERATOR_3.role);
          }).not.toThrow();
        });

        it('when authorized caller has correct nonce, and path', () => {
          // Check nonce is correct
          expect(
            shieldedAccessControl.privateState.getCurrentSecretNonce(
              ADMIN.role,
            ),
          ).toBe(ADMIN.secretNonce);

          // Check path matches
          const truePath =
            shieldedAccessControl.privateState.getCommitmentPathWithFindForLeaf(
              ADMIN.roleCommitment,
            );
          const witnessCalculatedPath =
            shieldedAccessControl.privateState.getCommitmentPathWithWitnessImpl(
              ADMIN.roleCommitment,
            );
          expect(witnessCalculatedPath).toEqual(truePath);

          expect(() =>
            shieldedAccessControl.assertOnlyRole(ADMIN.role),
          ).not.toThrow();
        });

        it('when role is revoked and re-issued with a different accountId', () => {
          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);

          shieldedAccessControl.privateState.injectSecretNonce(
            ADMIN.role,
            Buffer.alloc(32, 'NEW_ADMIN_NONCE'),
          );
          const newAdminAccountId = buildAccountIdHash(
            ADMIN.zPublicKey,
            shieldedAccessControl.privateState.getCurrentSecretNonce(
              ADMIN.role,
            ),
          );
          expect(newAdminAccountId).not.toEqual(ADMIN.accountId);

          shieldedAccessControl._grantRole(ADMIN.role, newAdminAccountId);
          expect(() =>
            shieldedAccessControl.assertOnlyRole(
              ADMIN.role,
            )
          ).not.toThrow();
        });

        it('when multiple users have the same role', () => {
          // All users will use OPERATOR_1.secretNonce as their nonce value
          // when generating their accountId for simplicity
          shieldedAccessControl.privateState.injectSecretNonce(
            OPERATOR_1.role,
            OPERATOR_1.secretNonce,
          );
          // A unique accountId must be constructed for each new role using its associated secretNonce
          const operator1AdminAccountId = buildAccountIdHash(
            ADMIN.zPublicKey,
            OPERATOR_1.secretNonce,
          );
          shieldedAccessControl._grantRole(
            OPERATOR_1.role,
            operator1AdminAccountId,
          );
          shieldedAccessControl.as(ADMIN.publicKey); // assert ADMIN has OP_1 role
          expect(shieldedAccessControl.assertOnlyRole(OPERATOR_1.role));

          const operator1Op2AccountId = buildAccountIdHash(
            OPERATOR_2.zPublicKey,
            OPERATOR_1.secretNonce,
          );
          shieldedAccessControl._grantRole(
            OPERATOR_1.role,
            operator1Op2AccountId,
          );
          shieldedAccessControl.as(OPERATOR_2.publicKey); // assert OP_2 has OP_1 role
          expect(shieldedAccessControl.assertOnlyRole(OPERATOR_1.role));

          const operator1Op3AccountId = buildAccountIdHash(
            OPERATOR_3.zPublicKey,
            OPERATOR_1.secretNonce,
          );
          shieldedAccessControl._grantRole(
            OPERATOR_1.role,
            operator1Op3AccountId,
          );
          shieldedAccessControl.as(OPERATOR_3.publicKey); // assert OP_3 has OP_1 role
          expect(shieldedAccessControl.assertOnlyRole(OPERATOR_1.role));
        });
      });
    });

    describe('grantRole', () => {
      beforeEach(() => {
        shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId);
        shieldedAccessControl.setPersistentCaller(ADMIN.publicKey);
      });

      describe('should fail', () => {
        it('when caller does not have the admin role', () => {
          shieldedAccessControl.as(UNAUTHORIZED.publicKey);
          expect(() =>
            shieldedAccessControl.grantRole(
              OPERATOR_1.role,
              OPERATOR_1.accountId,
            ),
          ).toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when wit_getRoleCommitmentPath returns a valid path for a different role, accountId pairing', () => {
          shieldedAccessControl._grantRole(
            OPERATOR_1.role,
            OPERATOR_1.accountId,
          );
          // Override witness to return valid path for OPERATOR_1 role commitment
          shieldedAccessControl.overrideWitness(
            'wit_getRoleCommitmentPath',
            () => {
              const privateState = shieldedAccessControl.getPrivateState();
              const operator1MtPath = shieldedAccessControl
                .getPublicState()
                .ShieldedAccessControl__operatorRoles.findPathForLeaf(
                  OPERATOR_1.roleCommitment,
                );
              if (operator1MtPath) return [privateState, operator1MtPath];
              throw new Error('Merkle tree path should be defined');
            },
          );
          expect(() => {
            shieldedAccessControl.grantRole(ADMIN.role, ADMIN.accountId);
          }).toThrow(
            'ShieldedAccessControl: Path must contain leaf matching computed role commitment for the provided role, accountId pairing',
          );
        });

        it('when admin with duplicate roles is revoked', () => {
          // create duplicate roles
          shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId);
          shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId);

          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);
          expect(() =>
            shieldedAccessControl.grantRole(ADMIN.role, ADMIN.accountId),
          ).toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when admin role is revoked', () => {
          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);
          expect(() =>
            shieldedAccessControl.grantRole(ADMIN.role, ADMIN.accountId),
          ).toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when admin provides incorrect nonce', () => {
          shieldedAccessControl.privateState.injectSecretNonce(
            ADMIN.role,
            BAD_INPUT.secretNonce,
          );
          expect(
            shieldedAccessControl.privateState.getCurrentSecretNonce(
              ADMIN.role,
            ),
          ).not.toEqual(ADMIN.secretNonce);
          expect(() =>
            shieldedAccessControl.grantRole(ADMIN.role, ADMIN.accountId),
          ).toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when admin provides bad witness path', () => {
          shieldedAccessControl.overrideWitness(
            'wit_getRoleCommitmentPath',
            RETURN_BAD_PATH,
          );
          expect(() =>
            shieldedAccessControl.grantRole(ADMIN.role, ADMIN.accountId),
          ).toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when non-admin caller has role', () => {
          shieldedAccessControl._grantRole(
            OPERATOR_1.role,
            OPERATOR_1.accountId,
          );

          shieldedAccessControl.as(OPERATOR_1.publicKey);
          // OP_1 has role but is not authorized to grant roles to other users
          expect(() =>
            shieldedAccessControl.grantRole(
              OPERATOR_1.role,
              OPERATOR_2.accountId,
            ),
          ).toThrow('ShieldedAccessControl: unauthorized account');
        });
      });

      describe('should not update _operatorRoles Merkle tree', () => {
        it('when role is revoked', () => {
          // setup test
          shieldedAccessControl._grantRole(
            OPERATOR_1.role,
            OPERATOR_1.accountId,
          );
          shieldedAccessControl._revokeRole(
            OPERATOR_1.role,
            OPERATOR_1.accountId,
          );

          const initialRoot = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.root();
          shieldedAccessControl.grantRole(
            OPERATOR_1.role,
            OPERATOR_1.accountId,
          );

          const updatedRoot = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.root();
          expect(initialRoot).toEqual(updatedRoot);
        });
      });

      describe('should grant role', () => {
        it('when caller has the admin role', () => {
          expect(() =>
            shieldedAccessControl.grantRole(
              OPERATOR_1.role,
              OPERATOR_1.accountId,
            ),
          ).not.toThrow();
          expect(
            shieldedAccessControl._validateRole(
              OPERATOR_1.role,
              OPERATOR_1.accountId,
            ),
          ).toBe(true);
        });

        it('when caller has custom admin role', () => {
          // Make OPERATOR_1.role the admin of OPERATOR_2.role.
          shieldedAccessControl._setRoleAdmin(
            OPERATOR_2.role,
            OPERATOR_1.role,
          );
          // Grant OPERATOR_1.role to OPERATOR_1.accountId
          shieldedAccessControl.grantRole(
            OPERATOR_1.role,
            OPERATOR_1.accountId,
          );

          // Switch to OPERATOR_1 as caller and inject their nonce for their role.
          shieldedAccessControl.privateState.injectSecretNonce(
            OPERATOR_1.role,
            OPERATOR_1.secretNonce,
          );
          shieldedAccessControl.setPersistentCaller(OPERATOR_1.publicKey);

          // OPERATOR_1.accountId (who holds OPERATOR_1.role) can now grant OPERATOR_2.role.
          expect(() =>
            shieldedAccessControl.grantRole(
              OPERATOR_2.role,
              OPERATOR_2.accountId,
            ),
          ).not.toThrow();
          expect(
            shieldedAccessControl._validateRole(
              OPERATOR_2.role,
              OPERATOR_2.accountId,
            ),
          ).toBe(true);
        });

        it('when admin role is revoked and re-issued with a different accountId', () => {
          // setup test
          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);
          const newNonce = Buffer.alloc(32, 'NEW_ADMIN_NONCE');
          shieldedAccessControl.privateState.injectSecretNonce(
            ADMIN.role,
            newNonce,
          );
          const newAccountId = buildAccountIdHash(ADMIN.zPublicKey, newNonce);
          shieldedAccessControl._grantRole(ADMIN.role, newAccountId);

          expect(() => {
            shieldedAccessControl.grantRole(
              OPERATOR_1.role,
              OPERATOR_1.accountId,
            );
          }).not.toThrow();
          expect(
            shieldedAccessControl._validateRole(
              OPERATOR_1.role,
              OPERATOR_1.accountId,
            ),
          ).toBe(true);
          expect(
            shieldedAccessControl
              .getPublicState()
              .ShieldedAccessControl__operatorRoles.findPathForLeaf(
                OPERATOR_1.roleCommitment,
              ),
          ).toBeDefined();
        });

        it('when multiple admins of the same role exist', () => {
          // setup test
          const account1 = buildAccountIdHash(
            OPERATOR_1.zPublicKey,
            ADMIN.secretNonce,
          );
          const account2 = buildAccountIdHash(
            OPERATOR_2.zPublicKey,
            ADMIN.secretNonce,
          );
          const account3 = buildAccountIdHash(
            OPERATOR_3.zPublicKey,
            ADMIN.secretNonce,
          );
          shieldedAccessControl._grantRole(ADMIN.role, account1);
          shieldedAccessControl._grantRole(ADMIN.role, account2);
          shieldedAccessControl._grantRole(ADMIN.role, account3);

          // check grant role succeeds as OP and role is valid
          shieldedAccessControl.as(OPERATOR_1.publicKey);
          expect(() =>
            shieldedAccessControl.grantRole(ADMIN.role, account1),
          ).not.toThrow();
          expect(
            shieldedAccessControl._validateRole(ADMIN.role, account1),
          ).toBe(true);

          shieldedAccessControl.as(OPERATOR_2.publicKey);
          expect(() =>
            shieldedAccessControl.grantRole(ADMIN.role, ADMIN.accountId),
          ).not.toThrow();
          expect(
            shieldedAccessControl._validateRole(ADMIN.role, account2),
          ).toBe(true);

          shieldedAccessControl.as(OPERATOR_3.publicKey);
          expect(() =>
            shieldedAccessControl.grantRole(ADMIN.role, ADMIN.accountId),
          ).not.toThrow();
          expect(
            shieldedAccessControl._validateRole(ADMIN.role, account3),
          ).toBe(true);
        });

        it('when admin has multiple roles', () => {
          shieldedAccessControl._grantRole(OPERATOR_1.role, ADMIN.accountId);
          shieldedAccessControl._grantRole(OPERATOR_2.role, ADMIN.accountId);
          shieldedAccessControl._grantRole(OPERATOR_3.role, ADMIN.accountId);

          expect(() =>
            shieldedAccessControl.grantRole(
              OPERATOR_1.role,
              OPERATOR_1.accountId,
            ),
          ).not.toThrow();
          expect(
            shieldedAccessControl._validateRole(
              OPERATOR_1.role,
              OPERATOR_1.accountId,
            ),
          ).toBe(true);
        });

        it('when re-granting active role', () => {
          expect(() =>
            shieldedAccessControl.grantRole(ADMIN.role, ADMIN.accountId),
          ).not.toThrow();
          expect(
            shieldedAccessControl._validateRole(ADMIN.role, ADMIN.accountId),
          ).toBe(true);
        });

        it('when granting role that does not exist', () => {
          expect(() =>
            shieldedAccessControl.grantRole(
              UNINITIALIZED.role,
              UNINITIALIZED.accountId,
            ),
          ).not.toThrow();
          expect(
            shieldedAccessControl._validateRole(
              UNINITIALIZED.role,
              UNINITIALIZED.accountId,
            ),
          ).toBe(true);
        });

        it('when granting role with bad accountId', () => {
          expect(() =>
            shieldedAccessControl.grantRole(ADMIN.role, BAD_INPUT.accountId),
          ).not.toThrow();
          expect(
            shieldedAccessControl._validateRole(
              ADMIN.role,
              BAD_INPUT.accountId,
            ),
          ).toBe(true);
        });
      });
    });

    describe('_grantRole', () => {
      describe('should return true', () => {
        it('when authorized user grants a new role', () => {
          shieldedAccessControl.as(ADMIN.publicKey);
          expect(
            shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId),
          ).toBe(true);
        });

        it('when unauthorized user grants role', () => {
          shieldedAccessControl.as(UNAUTHORIZED.publicKey);
          expect(
            shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId),
          ).toBe(true);
        });

        it('when re-granting active role ', () => {
          shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId);

          expect(
            shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId),
          ).toBe(true);
        });

        it('when granting role that does not exist', () => {
          expect(
            shieldedAccessControl._grantRole(
              UNINITIALIZED.role,
              ADMIN.accountId,
            ),
          ).toBe(true);
        });

        it('when granting role with bad accountId', () => {
          expect(
            shieldedAccessControl._grantRole(ADMIN.role, BAD_INPUT.accountId),
          ).toBe(true);
        });
      });

      describe('should update _operatorRoles merkle tree', () => {
        it('when authorized user grants a new role', () => {
          shieldedAccessControl.setPersistentCaller(ADMIN.publicKey);
          // Check caller is admin, has admin role
          expect(
            shieldedAccessControl.getCallerContext().currentZswapLocalState
              .coinPublicKey,
          ).toEqual(ADMIN.zPublicKey);
          expect(shieldedAccessControl.getRoleAdmin(ADMIN.role)).toEqual(
            new Uint8Array(ADMIN.role),
          );

          // check merkle tree is empty
          let merkleRoot = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.root();
          expect(merkleRoot.field).toBe(0n);

          // check merkle tree is updated
          shieldedAccessControl.as(ADMIN.publicKey);
          shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId);
          merkleRoot = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.root();
          expect(merkleRoot).not.toBe(0n);

          // check path exists for new role
          const merkleTreePath = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.findPathForLeaf(
              ADMIN.roleCommitment,
            );
          expect(merkleTreePath).toBeDefined();
          expect(merkleTreePath?.leaf).toStrictEqual(ADMIN.roleCommitment);
        });

        it('when unauthorized user grants a new role', () => {
          // Check UNAUTHORIZED is not admin
          expect(shieldedAccessControl.getRoleAdmin(ADMIN.role)).not.toEqual(
            new Uint8Array(UNAUTHORIZED.role),
          );
          expect(
            shieldedAccessControl._validateRole(
              ADMIN.role,
              UNAUTHORIZED.accountId,
            ),
          ).toBe(false);

          // check merkle tree is empty
          let merkleRoot = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.root();
          expect(merkleRoot.field).toBe(0n);

          // check caller is UNAUTHORIZED user
          shieldedAccessControl.as(UNAUTHORIZED.publicKey);
          expect(
            shieldedAccessControl.getCallerContext().currentZswapLocalState
              .coinPublicKey,
          ).toEqual(UNAUTHORIZED.zPublicKey);

          // check merkle tree is updated
          shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId);
          merkleRoot = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.root();
          expect(merkleRoot).not.toBe(0n);

          // check path exists for new role
          const merkleTreePath = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.findPathForLeaf(
              ADMIN.roleCommitment,
            );
          expect(merkleTreePath).toBeDefined();
          expect(merkleTreePath?.leaf).toStrictEqual(ADMIN.roleCommitment);
        });

        it('when granting role that does not exist', () => {
          // check merkle tree is empty
          let merkleRoot = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.root();
          expect(merkleRoot.field).toBe(0n);

          // check merkle tree is updated
          shieldedAccessControl._grantRole(
            UNINITIALIZED.role,
            UNINITIALIZED.accountId,
          );
          merkleRoot = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.root();
          expect(merkleRoot).not.toBe(0n);

          // check path exists for new role
          const merkleTreePath = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.findPathForLeaf(
              UNINITIALIZED.roleCommitment,
            );
          expect(merkleTreePath).toBeDefined();
          expect(merkleTreePath?.leaf).toStrictEqual(
            UNINITIALIZED.roleCommitment,
          );
        });

        it('when granting role with bad accountId', () => {
          // check merkle tree is empty
          let merkleRoot = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.root();
          expect(merkleRoot.field).toBe(0n);

          // check merkle tree is updated
          shieldedAccessControl._grantRole(ADMIN.role, BAD_INPUT.accountId);
          merkleRoot = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.root();
          expect(merkleRoot).not.toBe(0n);

          // check path exists for new role
          const adminRoleBadAccountCommitment = buildRoleCommitmentHash(
            ADMIN.role,
            BAD_INPUT.accountId,
          );
          const merkleTreePath = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.findPathForLeaf(
              adminRoleBadAccountCommitment,
            );
          expect(merkleTreePath).toBeDefined();
          expect(merkleTreePath?.leaf).toStrictEqual(
            adminRoleBadAccountCommitment,
          );
        });
      });

      describe('should return false', () => {
        it('when re-granting revoked role', () => {
          shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId);
          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);
          expect(
            shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId),
          ).toBe(false);
        });
      });

      describe('should not update _operatorRoles merkle tree', () => {
        it('when re-granting revoked role', () => {
          shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId);
          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);
          const merkleRoot = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.root();

          shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId);
          const newMerkleRoot = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.root();
          expect(merkleRoot).toEqual(newMerkleRoot);
        });
      });
    });

    describe('revokeRole', () => {
      beforeEach(() => {
        shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId);
        shieldedAccessControl._grantRole(
          OPERATOR_1.role,
          OPERATOR_1.accountId,
        );
        shieldedAccessControl.setPersistentCaller(ADMIN.publicKey);
      });

      describe('should fail', () => {
        it('when caller does not have the admin role', () => {
          shieldedAccessControl.as(UNAUTHORIZED.publicKey);
          expect(() =>
            shieldedAccessControl.revokeRole(
              OPERATOR_1.role,
              OPERATOR_1.accountId,
            ),
          ).toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when wit_getRoleCommitmentPath returns a valid path for a different role, accountId pairing', () => {
          shieldedAccessControl._grantRole(
            OPERATOR_1.role,
            OPERATOR_1.accountId,
          );
          // Override witness to return valid path for OPERATOR_1 role commitment
          shieldedAccessControl.overrideWitness(
            'wit_getRoleCommitmentPath',
            () => {
              const privateState = shieldedAccessControl.getPrivateState();
              const operator1MtPath = shieldedAccessControl
                .getPublicState()
                .ShieldedAccessControl__operatorRoles.findPathForLeaf(
                  OPERATOR_1.roleCommitment,
                );
              if (operator1MtPath) return [privateState, operator1MtPath];
              throw new Error('Merkle tree path should be defined');
            },
          );
          expect(() => {
            shieldedAccessControl.revokeRole(ADMIN.role, ADMIN.accountId);
          }).toThrow(
            'ShieldedAccessControl: Path must contain leaf matching computed role commitment for the provided role, accountId pairing',
          );
        });

        it('when admin with duplicate roles is revoked', () => {
          // create duplicate roles
          shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId);
          shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId);

          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);
          expect(() =>
            shieldedAccessControl.revokeRole(ADMIN.role, ADMIN.accountId),
          ).toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when admin role is revoked', () => {
          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);
          expect(() =>
            shieldedAccessControl.grantRole(ADMIN.role, ADMIN.accountId),
          ).toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when admin provides bad witness path', () => {
          shieldedAccessControl.overrideWitness(
            'wit_getRoleCommitmentPath',
            RETURN_BAD_PATH,
          );
          expect(() =>
            shieldedAccessControl.revokeRole(ADMIN.role, ADMIN.accountId),
          ).toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when non-admin caller has role', () => {
          shieldedAccessControl._grantRole(
            OPERATOR_1.role,
            OPERATOR_1.accountId,
          );

          shieldedAccessControl.as(OPERATOR_1.publicKey);
          // OP_1 has role but is not authorized to grant roles to other users
          expect(() =>
            shieldedAccessControl.revokeRole(
              OPERATOR_1.role,
              OPERATOR_2.accountId,
            ),
          ).toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when caller is admin of a different role', () => {
          shieldedAccessControl._setRoleAdmin(
            OPERATOR_1.role,
            OPERATOR_1.accountId,
          );
          shieldedAccessControl.as(OPERATOR_1.publicKey);
          expect(() =>
            shieldedAccessControl.revokeRole(ADMIN.role, ADMIN.accountId),
          ).toThrow('ShieldedAccessControl: unauthorized account');
        });

        it('when admin provides bad nonce', () => {
          shieldedAccessControl.privateState.injectSecretNonce(
            ADMIN.role,
            BAD_INPUT.secretNonce,
          );
          expect(() =>
            shieldedAccessControl.revokeRole(ADMIN.role, ADMIN.accountId),
          ).toThrow('ShieldedAccessControl: unauthorized account');
        });
      });

      describe('should not update _roleCommitmentNullifiers set', () => {
        it('when role is re-revoked', () => {
          shieldedAccessControl.revokeRole(
            OPERATOR_1.role,
            OPERATOR_1.accountId,
          );
          const nullifierSetSize = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__roleCommitmentNullifiers.size();
          expect(() =>
            shieldedAccessControl.revokeRole(
              OPERATOR_1.role,
              OPERATOR_1.accountId,
            ),
          ).not.toThrow();
          expect(
            shieldedAccessControl
              .getPublicState()
              .ShieldedAccessControl__roleCommitmentNullifiers.size(),
          ).toEqual(nullifierSetSize);
        });
      });

      describe('should revoke role', () => {
        it('when caller has the admin role', () => {
          expect(() =>
            shieldedAccessControl.revokeRole(
              OPERATOR_1.role,
              OPERATOR_1.accountId,
            ),
          ).not.toThrow();
          expect(
            shieldedAccessControl._validateRole(
              OPERATOR_1.role,
              OPERATOR_1.accountId,
            ),
          ).toBe(false);
        });

        it('when caller has custom admin role', () => {
          // setup test
          shieldedAccessControl._grantRole(
            OPERATOR_2.role,
            OPERATOR_3.accountId,
          );
          shieldedAccessControl.privateState.injectSecretNonce(
            OPERATOR_1.role,
            OPERATOR_1.secretNonce,
          );
          // OP_1 is admin of OP_2 role
          shieldedAccessControl._setRoleAdmin(
            OPERATOR_2.role,
            OPERATOR_1.role,
          );
          shieldedAccessControl.as(OPERATOR_1.publicKey);

          expect(() =>
            shieldedAccessControl.revokeRole(
              OPERATOR_2.role,
              OPERATOR_3.accountId,
            ),
          ).not.toThrow();
          expect(
            shieldedAccessControl._validateRole(
              OPERATOR_2.role,
              OPERATOR_3.accountId,
            ),
          ).toBe(false);
        });

        it('when role does not exist', () => {
          // create role commitment that doesn't exist
          const commitment = buildRoleCommitmentHash(
            UNINITIALIZED.role,
            ADMIN.accountId,
          );

          // confirm role commitment not in Merkle tree
          const path = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.findPathForLeaf(commitment);
          expect(path).toBeUndefined();

          expect(() =>
            shieldedAccessControl.revokeRole(
              UNINITIALIZED.role,
              ADMIN.accountId,
            ),
          ).not.toThrow();

          expect(
            shieldedAccessControl._validateRole(
              UNINITIALIZED.role,
              ADMIN.accountId,
            ),
          ).toBe(false);
        });

        it('when revoking role with bad accountId', () => {
          expect(() =>
            shieldedAccessControl.revokeRole(ADMIN.role, BAD_INPUT.accountId),
          ).not.toThrow();

          expect(
            shieldedAccessControl._validateRole(
              ADMIN.role,
              BAD_INPUT.accountId,
            ),
          ).toBe(false);
        });

        it('when multiple admins of the same role exist', () => {
          // setup test
          const account1 = buildAccountIdHash(
            OPERATOR_1.zPublicKey,
            ADMIN.secretNonce,
          );
          const account2 = buildAccountIdHash(
            OPERATOR_2.zPublicKey,
            ADMIN.secretNonce,
          );
          const account3 = buildAccountIdHash(
            OPERATOR_3.zPublicKey,
            ADMIN.secretNonce,
          );
          shieldedAccessControl._grantRole(ADMIN.role, account1);
          shieldedAccessControl._grantRole(ADMIN.role, account2);
          shieldedAccessControl._grantRole(ADMIN.role, account3);

          // check revoke role succeeds as OP and role is valid
          shieldedAccessControl.as(OPERATOR_1.publicKey);
          expect(() =>
            shieldedAccessControl.revokeRole(ADMIN.role, account1),
          ).not.toThrow();
          expect(
            shieldedAccessControl._validateRole(ADMIN.role, account1),
          ).toBe(false);

          shieldedAccessControl.as(OPERATOR_2.publicKey);
          expect(() =>
            shieldedAccessControl.revokeRole(ADMIN.role, account2),
          ).not.toThrow();
          expect(
            shieldedAccessControl._validateRole(ADMIN.role, account2),
          ).toBe(false);

          shieldedAccessControl.as(OPERATOR_3.publicKey);
          expect(() =>
            shieldedAccessControl.revokeRole(ADMIN.role, account3),
          ).not.toThrow();
          expect(
            shieldedAccessControl._validateRole(ADMIN.role, account3),
          ).toBe(false);
        });

        it('when admin has multiple roles', () => {
          shieldedAccessControl._grantRole(OPERATOR_1.role, ADMIN.accountId);
          shieldedAccessControl._grantRole(OPERATOR_2.role, ADMIN.accountId);
          shieldedAccessControl._grantRole(OPERATOR_3.role, ADMIN.accountId);

          expect(() =>
            shieldedAccessControl.revokeRole(
              OPERATOR_1.role,
              OPERATOR_1.accountId,
            ),
          ).not.toThrow();
          expect(
            shieldedAccessControl._validateRole(
              OPERATOR_1.role,
              OPERATOR_1.accountId,
            ),
          ).toBe(false);
        });

        it('when revoking role that does not exist', () => {
          expect(() =>
            shieldedAccessControl.revokeRole(
              UNINITIALIZED.role,
              UNINITIALIZED.accountId,
            ),
          ).not.toThrow();
          expect(
            shieldedAccessControl._validateRole(
              UNINITIALIZED.role,
              UNINITIALIZED.accountId,
            ),
          ).toBe(false);
        });

        it('when admin role is revoked and re-issued with a different accountId', () => {
          // setup test
          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);
          const newNonce = Buffer.alloc(32, 'NEW_ADMIN_NONCE');
          shieldedAccessControl.privateState.injectSecretNonce(
            ADMIN.role,
            newNonce,
          );
          const newAccountId = buildAccountIdHash(ADMIN.zPublicKey, newNonce);
          shieldedAccessControl._grantRole(ADMIN.role, newAccountId);

          expect(() => {
            shieldedAccessControl.revokeRole(
              OPERATOR_1.role,
              OPERATOR_1.accountId,
            );
          }).not.toThrow();
          expect(
            shieldedAccessControl._validateRole(
              OPERATOR_1.role,
              OPERATOR_1.accountId,
            ),
          ).toBe(false);
        });
      });
    });

    describe('_revokeRole', () => {
      beforeEach(() => {
        shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId);
        shieldedAccessControl.setPersistentCaller(ADMIN.publicKey);
      });

      describe('should return true', () => {
        it('when active role is revoked', () => {
          // confirm role is active
          const isValidRole = shieldedAccessControl._validateRole(
            ADMIN.role,
            ADMIN.accountId,
          );
          expect(isValidRole).toBe(true);

          expect(
            shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId),
          ).toBe(true);
        });

        it('when an authorized user revokes role', () => {
          // Check caller is admin, has admin role
          expect(
            shieldedAccessControl.getCallerContext().currentZswapLocalState
              .coinPublicKey,
          ).toEqual(ADMIN.zPublicKey);
          expect(shieldedAccessControl.getRoleAdmin(ADMIN.role)).toEqual(
            new Uint8Array(ADMIN.role),
          );
          expect(
            shieldedAccessControl._validateRole(ADMIN.role, ADMIN.accountId),
          ).toBe(true);

          expect(
            shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId),
          ).toBe(true);
        });

        it('when unauthorized user revokes role', () => {
          // Check UNAUTHORIZED is not admin
          expect(shieldedAccessControl.getRoleAdmin(ADMIN.role)).not.toEqual(
            new Uint8Array(UNAUTHORIZED.role),
          );
          expect(
            shieldedAccessControl._validateRole(
              ADMIN.role,
              UNAUTHORIZED.accountId,
            ),
          ).toBe(false);

          // check caller is UNAUTHORIZED user
          shieldedAccessControl.as(UNAUTHORIZED.publicKey);
          expect(
            shieldedAccessControl.getCallerContext().currentZswapLocalState
              .coinPublicKey,
          ).toEqual(UNAUTHORIZED.zPublicKey);
          expect(
            shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId),
          ).toBe(true);
        });

        it('when revoking role that does not exist', () => {
          // create role commitment that doesn't exist
          const commitment = buildRoleCommitmentHash(
            UNINITIALIZED.role,
            ADMIN.accountId,
          );

          // confirm role commitment not in Merkle tree
          const path = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.findPathForLeaf(commitment);
          expect(path).toBeUndefined();

          expect(
            shieldedAccessControl._revokeRole(
              UNINITIALIZED.role,
              ADMIN.accountId,
            ),
          ).toBe(true);
        });

        it('when revoking role with bad accountId', () => {
          expect(
            shieldedAccessControl._revokeRole(
              ADMIN.role,
              BAD_INPUT.accountId,
            ),
          ).toBe(true);
        });
      });

      describe('should update nullifier set', () => {
        it('when active role is revoked', () => {
          // confirm role is active
          const isValidRole = shieldedAccessControl._validateRole(
            ADMIN.role,
            ADMIN.accountId,
          );
          expect(isValidRole).toBe(true);

          const initialSetSize = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__roleCommitmentNullifiers.size();
          expect(initialSetSize).toBe(0n);

          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);

          const updatedSetSize = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__roleCommitmentNullifiers.size();
          expect(updatedSetSize).toBe(1n);
          expect(
            shieldedAccessControl
              .getPublicState()
              .ShieldedAccessControl__roleCommitmentNullifiers.member(
                ADMIN.roleNullifier,
              ),
          ).toBe(true);
        });

        it('when an authorized user revokes role', () => {
          // Check caller is admin, has admin role
          expect(
            shieldedAccessControl.getCallerContext().currentZswapLocalState
              .coinPublicKey,
          ).toEqual(ADMIN.zPublicKey);
          expect(shieldedAccessControl.getRoleAdmin(ADMIN.role)).toEqual(
            new Uint8Array(ADMIN.role),
          );
          expect(
            shieldedAccessControl._validateRole(ADMIN.role, ADMIN.accountId),
          ).toBe(true);

          const initialSetSize = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__roleCommitmentNullifiers.size();
          expect(initialSetSize).toBe(0n);

          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);

          const updatedSetSize = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__roleCommitmentNullifiers.size();
          expect(updatedSetSize).toBe(1n);
          expect(
            shieldedAccessControl
              .getPublicState()
              .ShieldedAccessControl__roleCommitmentNullifiers.member(
                ADMIN.roleNullifier,
              ),
          ).toBe(true);
        });

        it('when unauthorized user revokes role', () => {
          // Check UNAUTHORIZED is not admin
          expect(shieldedAccessControl.getRoleAdmin(ADMIN.role)).not.toEqual(
            new Uint8Array(UNAUTHORIZED.role),
          );
          expect(
            shieldedAccessControl._validateRole(
              ADMIN.role,
              UNAUTHORIZED.accountId,
            ),
          ).toBe(false);

          const initialSetSize = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__roleCommitmentNullifiers.size();
          expect(initialSetSize).toBe(0n);

          // check caller is UNAUTHORIZED user
          shieldedAccessControl.as(UNAUTHORIZED.publicKey);
          expect(
            shieldedAccessControl.getCallerContext().currentZswapLocalState
              .coinPublicKey,
          ).toEqual(UNAUTHORIZED.zPublicKey);

          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);

          const updatedSetSize = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__roleCommitmentNullifiers.size();
          expect(updatedSetSize).toBe(1n);
          expect(
            shieldedAccessControl
              .getPublicState()
              .ShieldedAccessControl__roleCommitmentNullifiers.member(
                ADMIN.roleNullifier,
              ),
          ).toBe(true);
        });

        it('when revoking role that does not exist', () => {
          // create role commitment that doesn't exist
          const commitment = buildRoleCommitmentHash(
            UNINITIALIZED.role,
            ADMIN.accountId,
          );

          // confirm role commitment not in Merkle tree
          const path = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.findPathForLeaf(commitment);
          expect(path).toBeUndefined();

          const initialSetSize = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__roleCommitmentNullifiers.size();
          expect(initialSetSize).toBe(0n);

          shieldedAccessControl._revokeRole(
            UNINITIALIZED.role,
            ADMIN.accountId,
          );

          const updatedSetSize = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__roleCommitmentNullifiers.size();
          expect(updatedSetSize).toBe(1n);

          const nullifier = buildNullifierHash(commitment);

          expect(
            shieldedAccessControl
              .getPublicState()
              .ShieldedAccessControl__roleCommitmentNullifiers.member(
                nullifier,
              ),
          ).toBe(true);
        });

        it('when revoking role with bad accountId', () => {
          const initialSetSize = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__roleCommitmentNullifiers.size();
          expect(initialSetSize).toBe(0n);

          shieldedAccessControl._revokeRole(ADMIN.role, BAD_INPUT.accountId);

          const updatedSetSize = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__roleCommitmentNullifiers.size();
          expect(updatedSetSize).toBe(1n);

          const commitment = buildRoleCommitmentHash(
            ADMIN.role,
            BAD_INPUT.accountId,
          );
          const nullifier = buildNullifierHash(commitment);
          expect(
            shieldedAccessControl
              .getPublicState()
              .ShieldedAccessControl__roleCommitmentNullifiers.member(
                nullifier,
              ),
          ).toBe(true);
        });
      });

      describe('should return false', () => {
        it('when authorized user re-revokes role', () => {
          // Check caller is admin, has admin role
          expect(
            shieldedAccessControl.getCallerContext().currentZswapLocalState
              .coinPublicKey,
          ).toEqual(ADMIN.zPublicKey);
          expect(shieldedAccessControl.getRoleAdmin(ADMIN.role)).toEqual(
            new Uint8Array(ADMIN.role),
          );
          expect(
            shieldedAccessControl._validateRole(ADMIN.role, ADMIN.accountId),
          ).toBe(true);

          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);
          expect(
            shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId),
          ).toBe(false);
        });

        it('when unauthorized user re-revokes role', () => {
          // Check UNAUTHORIZED is not admin
          expect(shieldedAccessControl.getRoleAdmin(ADMIN.role)).not.toEqual(
            new Uint8Array(UNAUTHORIZED.role),
          );
          expect(
            shieldedAccessControl._validateRole(
              ADMIN.role,
              UNAUTHORIZED.accountId,
            ),
          ).toBe(false);

          // revoke as ADMIN
          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);

          // check caller is UNAUTHORIZED user
          shieldedAccessControl.as(UNAUTHORIZED.publicKey);
          expect(
            shieldedAccessControl.getCallerContext().currentZswapLocalState
              .coinPublicKey,
          ).toEqual(UNAUTHORIZED.zPublicKey);
          expect(
            shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId),
          ).toBe(false);
        });
      });

      describe('should not update nullifier set', () => {
        it('when authorized user re-revokes role', () => {
          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);
          const initialSetSize = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__roleCommitmentNullifiers.size();
          expect(initialSetSize).toBe(1n);

          // Check caller is admin, doesn't have admin role
          expect(
            shieldedAccessControl.getCallerContext().currentZswapLocalState
              .coinPublicKey,
          ).toEqual(ADMIN.zPublicKey);
          expect(
            shieldedAccessControl._validateRole(ADMIN.role, ADMIN.accountId),
          ).toBe(false);

          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);

          const updatedSetSize = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__roleCommitmentNullifiers.size();
          expect(updatedSetSize).toEqual(initialSetSize);
        });

        it('when unauthorized user re-revokes role', () => {
          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);
          const initialSetSize = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__roleCommitmentNullifiers.size();
          expect(initialSetSize).toBe(1n);

          // Check UNAUTHORIZED is not admin
          expect(shieldedAccessControl.getRoleAdmin(ADMIN.role)).not.toEqual(
            new Uint8Array(UNAUTHORIZED.role),
          );
          expect(
            shieldedAccessControl._validateRole(
              ADMIN.role,
              UNAUTHORIZED.accountId,
            ),
          ).toBe(false);

          // re-revoke as UNAUTHORIZED
          shieldedAccessControl.as(UNAUTHORIZED.publicKey);
          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);

          const updatedSetSize = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__roleCommitmentNullifiers.size();
          expect(updatedSetSize).toEqual(initialSetSize);
        });
      });
    });

    describe('proveCallerRole', () => {
      beforeEach(() => {
        shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId);
        shieldedAccessControl.setPersistentCaller(ADMIN.publicKey);
      });

      it('should fail when caller provides valid path for a different role, accountId pairing', () => {
        shieldedAccessControl._grantRole(
          OPERATOR_1.role,
          OPERATOR_1.accountId,
        );
        // Override witness to return valid path for OPERATOR_1 role commitment
        shieldedAccessControl.overrideWitness(
          'wit_getRoleCommitmentPath',
          () => {
            const privateState = shieldedAccessControl.getPrivateState();
            const operator1MtPath = shieldedAccessControl
              .getPublicState()
              .ShieldedAccessControl__operatorRoles.findPathForLeaf(
                OPERATOR_1.roleCommitment,
              );
            if (operator1MtPath) return [privateState, operator1MtPath];
            throw new Error('Merkle tree path should be defined');
          },
        );
        expect(() => {
          shieldedAccessControl.proveCallerRole(ADMIN.role);
        }).toThrow(
          'ShieldedAccessControl: Path must contain leaf matching computed role commitment for the provided role, accountId pairing',
        );
      });

      describe('should return true', () => {
        it('when caller has role', () => {
          // Check caller is admin, has admin role
          expect(
            shieldedAccessControl.getCallerContext().currentZswapLocalState
              .coinPublicKey,
          ).toEqual(ADMIN.zPublicKey);
          expect(
            shieldedAccessControl._validateRole(ADMIN.role, ADMIN.accountId),
          ).toBe(true);

          expect(shieldedAccessControl.proveCallerRole(ADMIN.role)).toBe(
            true,
          );
        });

        it('when caller has multiple roles', () => {
          // setup test
          shieldedAccessControl.privateState.injectSecretNonce(
            OPERATOR_1.role,
            OPERATOR_1.secretNonce,
          );
          shieldedAccessControl.privateState.injectSecretNonce(
            OPERATOR_2.role,
            OPERATOR_2.secretNonce,
          );
          shieldedAccessControl.privateState.injectSecretNonce(
            OPERATOR_3.role,
            OPERATOR_3.secretNonce,
          );
          const account1 = buildAccountIdHash(
            ADMIN.zPublicKey,
            OPERATOR_1.secretNonce,
          );
          const account2 = buildAccountIdHash(
            ADMIN.zPublicKey,
            OPERATOR_2.secretNonce,
          );
          const account3 = buildAccountIdHash(
            ADMIN.zPublicKey,
            OPERATOR_3.secretNonce,
          );
          shieldedAccessControl._grantRole(OPERATOR_1.role, account1);
          shieldedAccessControl._grantRole(OPERATOR_2.role, account2);
          shieldedAccessControl._grantRole(OPERATOR_3.role, account3);

          expect(shieldedAccessControl.proveCallerRole(ADMIN.role)).toBe(
            true,
          );
          expect(shieldedAccessControl.proveCallerRole(OPERATOR_1.role)).toBe(
            true,
          );
          expect(shieldedAccessControl.proveCallerRole(OPERATOR_2.role)).toBe(
            true,
          );
          expect(shieldedAccessControl.proveCallerRole(OPERATOR_3.role)).toBe(
            true,
          );
        });

        it('when role is revoked and re-issued with a different accountId', () => {
          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);

          shieldedAccessControl.privateState.injectSecretNonce(
            ADMIN.role,
            Buffer.alloc(32, 'NEW_ADMIN_NONCE'),
          );
          const newAdminAccountId = buildAccountIdHash(
            ADMIN.zPublicKey,
            shieldedAccessControl.privateState.getCurrentSecretNonce(
              ADMIN.role,
            ),
          );
          expect(newAdminAccountId).not.toEqual(ADMIN.accountId);

          shieldedAccessControl._grantRole(ADMIN.role, newAdminAccountId);
          expect(shieldedAccessControl.proveCallerRole(ADMIN.role)).toBe(
            true,
          );
        });

        it('when multiple users have the same role', () => {
          // All users will use OPERATOR_1.secretNonce as their nonce value
          // when generating their accountId for simplicity
          shieldedAccessControl.privateState.injectSecretNonce(
            OPERATOR_1.role,
            OPERATOR_1.secretNonce,
          );
          // A unique accountId must be constructed for each new role using its associated secretNonce
          const operator1AdminAccountId = buildAccountIdHash(
            ADMIN.zPublicKey,
            OPERATOR_1.secretNonce,
          );
          shieldedAccessControl._grantRole(
            OPERATOR_1.role,
            operator1AdminAccountId,
          );
          shieldedAccessControl.as(ADMIN.publicKey); // prove ADMIN has OP_1 role
          expect(shieldedAccessControl.proveCallerRole(OPERATOR_1.role)).toBe(
            true,
          );

          const operator1Op2AccountId = buildAccountIdHash(
            OPERATOR_2.zPublicKey,
            OPERATOR_1.secretNonce,
          );
          shieldedAccessControl._grantRole(
            OPERATOR_1.role,
            operator1Op2AccountId,
          );
          shieldedAccessControl.as(OPERATOR_2.publicKey); // prove OP_2 has OP_1 role
          expect(shieldedAccessControl.proveCallerRole(OPERATOR_1.role)).toBe(
            true,
          );

          const operator1Op3AccountId = buildAccountIdHash(
            OPERATOR_3.zPublicKey,
            OPERATOR_1.secretNonce,
          );
          shieldedAccessControl._grantRole(
            OPERATOR_1.role,
            operator1Op3AccountId,
          );
          shieldedAccessControl.as(OPERATOR_3.publicKey); // prove OP_3 has OP_1 role
          expect(shieldedAccessControl.proveCallerRole(OPERATOR_1.role)).toBe(
            true,
          );
        });
      });

      describe('should return false', () => {
        it('when caller does not have role', () => {
          // setup test
          shieldedAccessControl.privateState.injectSecretNonce(
            OPERATOR_1.role,
            OPERATOR_1.secretNonce,
          );
          const accountId = buildAccountIdHash(
            ADMIN.zPublicKey,
            OPERATOR_1.secretNonce,
          );

          // Check does not have OPERATOR role
          expect(
            shieldedAccessControl._validateRole(OPERATOR_1.role, accountId),
          ).toBe(false);

          expect(shieldedAccessControl.proveCallerRole(OPERATOR_1.role)).toBe(
            false,
          );
        });

        it('when caller has revoked role', () => {
          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);

          // check role revoked
          expect(
            shieldedAccessControl._validateRole(ADMIN.role, ADMIN.accountId),
          ).toBe(false);

          expect(shieldedAccessControl.proveCallerRole(ADMIN.role)).toBe(
            false,
          );
        });

        it('when revoked role is re-granted', () => {
          shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);
          // check role revoked
          expect(
            shieldedAccessControl._validateRole(ADMIN.role, ADMIN.accountId),
          ).toBe(false);

          shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId);
          expect(shieldedAccessControl.proveCallerRole(ADMIN.role)).toBe(
            false,
          );
        });

        it('when an unauthorized caller has valid nonce', () => {
          // UNAUTHORIZED uses the same private state (ADMIN.secretNonce for ADMIN.role),
          // so their derived accountId won't match the committed one.
          shieldedAccessControl.as(UNAUTHORIZED.publicKey);
          expect(shieldedAccessControl.proveCallerRole(ADMIN.role)).toBe(
            false,
          );
        });

        it('when an authorized caller provides invalid nonce', () => {
          // Check caller is admin, has admin role
          expect(
            shieldedAccessControl.getCallerContext().currentZswapLocalState
              .coinPublicKey,
          ).toEqual(ADMIN.zPublicKey);
          expect(
            shieldedAccessControl._validateRole(ADMIN.role, ADMIN.accountId),
          ).toBe(true);

          shieldedAccessControl.privateState.injectSecretNonce(
            ADMIN.role,
            BAD_INPUT.secretNonce,
          );
          // nonce should not match
          expect(ADMIN.secretNonce).not.toEqual(
            shieldedAccessControl.privateState.getCurrentSecretNonce(
              ADMIN.role,
            ),
          );

          expect(shieldedAccessControl.proveCallerRole(ADMIN.role)).toBe(
            false,
          );
        });

        it('when an authorized caller provides invalid witness path', () => {
          // Check caller is admin, has admin role
          expect(
            shieldedAccessControl.getCallerContext().currentZswapLocalState
              .coinPublicKey,
          ).toEqual(ADMIN.zPublicKey);
          expect(
            shieldedAccessControl._validateRole(ADMIN.role, ADMIN.accountId),
          ).toBe(true);

          shieldedAccessControl.overrideWitness(
            'wit_getRoleCommitmentPath',
            RETURN_BAD_PATH,
          );
          expect(shieldedAccessControl.proveCallerRole(ADMIN.role)).toBe(
            false,
          );
        });
      });
    });

    describe('getRoleAdmin', () => {
      it('should return zero bytes (DEFAULT_ADMIN_ROLE) for a role with no admin set', () => {
        expect(shieldedAccessControl.getRoleAdmin(OPERATOR_1.role)).toEqual(
          new Uint8Array(32),
        );
      });

      it('should return the admin role after _setRoleAdmin', () => {
        shieldedAccessControl._setRoleAdmin(OPERATOR_1.role, ADMIN.role);
        expect(shieldedAccessControl.getRoleAdmin(OPERATOR_1.role)).toEqual(
          new Uint8Array(ADMIN.role),
        );
      });
    });

    describe('_setRoleAdmin', () => {
      it('should set admin role', () => {
        shieldedAccessControl._setRoleAdmin(OPERATOR_1.role, ADMIN.role);
        expect(shieldedAccessControl.getRoleAdmin(OPERATOR_1.role)).toEqual(
          new Uint8Array(ADMIN.role),
        );
      });

      it('should update _adminRoles map', () => {
        expect(
          shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__adminRoles.isEmpty(),
        ).toBe(true);

        // setup test
        shieldedAccessControl._setRoleAdmin(OPERATOR_1.role, ADMIN.role);
        shieldedAccessControl._setRoleAdmin(OPERATOR_2.role, ADMIN.role);
        shieldedAccessControl._setRoleAdmin(OPERATOR_3.role, ADMIN.role);

        // check updated state
        expect(
          shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__adminRoles.isEmpty(),
        ).toBe(false);
        expect(
          shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__adminRoles.size(),
        ).toBe(3n);

        // check new values exist
        expect(
          shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__adminRoles.member(OPERATOR_1.role),
        ).toBe(true);
        expect(
          shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__adminRoles.lookup(OPERATOR_1.role),
        ).toEqual(new Uint8Array(ADMIN.role));

        expect(
          shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__adminRoles.member(OPERATOR_2.role),
        ).toBe(true);
        expect(
          shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__adminRoles.lookup(OPERATOR_2.role),
        ).toEqual(new Uint8Array(ADMIN.role));

        expect(
          shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__adminRoles.member(OPERATOR_3.role),
        ).toBe(true);
        expect(
          shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__adminRoles.lookup(OPERATOR_3.role),
        ).toEqual(new Uint8Array(ADMIN.role));
      });

      it('should override an existing admin role', () => {
        shieldedAccessControl._setRoleAdmin(OPERATOR_1.role, ADMIN.role);
        expect(shieldedAccessControl.getRoleAdmin(OPERATOR_1.role)).toEqual(
          new Uint8Array(ADMIN.role),
        );

        shieldedAccessControl._setRoleAdmin(
          OPERATOR_1.role,
          OPERATOR_2.role,
        );
        expect(shieldedAccessControl.getRoleAdmin(OPERATOR_1.role)).toEqual(
          new Uint8Array(OPERATOR_2.role),
        );
      });
    });

    describe('renounceRole', () => {
      beforeEach(() => {
        shieldedAccessControl._grantRole(ADMIN.role, ADMIN.accountId);
        shieldedAccessControl.setPersistentCaller(ADMIN.publicKey);
      });

      it('should allow caller to renounce their own role', () => {
        expect(() =>
          shieldedAccessControl.renounceRole(ADMIN.role, ADMIN.accountId),
        ).not.toThrow();
        expect(
          shieldedAccessControl._validateRole(ADMIN.role, ADMIN.accountId),
        ).toBe(false);
      });

      it('should allow caller to renounce role that does not exist', () => {
        // Set ADMIN.secretNonce for UNINITIALIZED role so circuit computes ADMIN.accountId
        shieldedAccessControl.privateState.injectSecretNonce(
          UNINITIALIZED.role,
          ADMIN.secretNonce,
        );
        expect(() =>
          shieldedAccessControl.renounceRole(
            UNINITIALIZED.role,
            ADMIN.accountId,
          ),
        ).not.toThrow();
        expect(
          shieldedAccessControl._validateRole(
            UNINITIALIZED.role,
            ADMIN.accountId,
          ),
        ).toBe(false);
      });

      it('should allow caller to renounce a role they do not have', () => {
        // Set ADMIN.secretNonce for OPERATOR_1 role so circuit computes ADMIN.accountId
        shieldedAccessControl.privateState.injectSecretNonce(
          OPERATOR_1.role,
          ADMIN.secretNonce,
        );
        expect(() =>
          shieldedAccessControl.renounceRole(
            OPERATOR_1.role,
            ADMIN.accountId,
          ),
        ).not.toThrow();
        expect(
          shieldedAccessControl._validateRole(
            OPERATOR_1.role,
            ADMIN.accountId,
          ),
        ).toBe(false);
      });

      it('should fail when caller provides bad nonce', () => {
        shieldedAccessControl.privateState.injectSecretNonce(
          ADMIN.role,
          BAD_INPUT.secretNonce,
        );

        expect(() =>
          shieldedAccessControl.renounceRole(ADMIN.role, ADMIN.accountId),
        ).toThrow('ShieldedAccessControl: bad confirmation');
      });

      it('should fail when caller provides bad accountId', () => {
        expect(() =>
          shieldedAccessControl.renounceRole(ADMIN.role, BAD_INPUT.accountId),
        ).toThrow('ShieldedAccessControl: bad confirmation');
      });

      it('should fail when unauthorized caller provides valid nonce, and accountId', () => {
        // check we have valid secret nonce in private state
        expect(
          shieldedAccessControl.privateState.getCurrentSecretNonce(
            ADMIN.role,
          ),
        ).toEqual(ADMIN.secretNonce);

        shieldedAccessControl.as(UNAUTHORIZED.publicKey);
        expect(() =>
          shieldedAccessControl.renounceRole(ADMIN.role, ADMIN.accountId),
        ).toThrow('ShieldedAccessControl: bad confirmation');
      });

      it('should be a no-op when role is already revoked', () => {
        shieldedAccessControl._revokeRole(ADMIN.role, ADMIN.accountId);
        // renounceRole calls _revokeRole internally which silently returns false
        // when the role is already revoked — no assertion, so no throw.
        expect(() =>
          shieldedAccessControl.renounceRole(ADMIN.role, ADMIN.accountId),
        ).not.toThrow();
        expect(
          shieldedAccessControl._validateRole(ADMIN.role, ADMIN.accountId),
        ).toBe(false);
      });

      it('should update nullifier root on successful renounce', () => {
        const nullifierSetSize = shieldedAccessControl
          .getPublicState()
          .ShieldedAccessControl__roleCommitmentNullifiers.size();
        expect(nullifierSetSize).toBe(0n);

        shieldedAccessControl.renounceRole(ADMIN.role, ADMIN.accountId);
        const updatedSetSize = shieldedAccessControl
          .getPublicState()
          .ShieldedAccessControl__roleCommitmentNullifiers.size();
        expect(updatedSetSize).toEqual(1n);
        expect(
          shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__roleCommitmentNullifiers.member(
              ADMIN.roleNullifier,
            ),
        );
      });
    });
  });
});
