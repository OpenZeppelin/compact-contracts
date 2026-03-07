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
  ShieldedAccessControl_RoleCheck as RoleCheck,
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
  roleId: Uint8Array,
  accountId: Uint8Array,
): Uint8Array => {
  const rt_type = new CompactTypeVector(4, new CompactTypeBytes(32));
  const bDomain = new TextEncoder().encode(COMMITMENT_DOMAIN);

  const commitment = persistentHash(rt_type, [
    roleId,
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
  roleId: Buffer;
  accountId: Uint8Array;
  roleNullifier: Uint8Array;
  roleCommitment: Uint8Array;
  secretNonce: Buffer;

  constructor(baseString: string, roleIdentifier: bigint) {
    this.baseString = baseString;
    [this.publicKey, this.zPublicKey] = utils.generatePubKeyPair(baseString);
    this.secretNonce = Buffer.alloc(32, `${baseString}_NONCE`);
    this.accountId = buildAccountIdHash(this.zPublicKey, this.secretNonce);
    this.roleId = Buffer.from(convertFieldToBytes(32, roleIdentifier, ''));
    this.roleCommitment = buildRoleCommitmentHash(this.roleId, this.accountId);
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
    const isNotInit = false;

    beforeEach(() => {
      shieldedAccessControl = new ShieldedAccessControlSimulator(
        INSTANCE_SALT,
        isNotInit,
      );
    });
    type FailingCircuits = [
      method: keyof ShieldedAccessControlSimulator,
      args: unknown[],
    ];
    // Circuit calls should fail before the args are used
    const circuitsToFail: FailingCircuits[] = [
      ['callerHasRole', [UNINITIALIZED.roleId]],
      ['assertOnlyRole', [UNINITIALIZED.roleId]],
      ['_checkRole', [UNINITIALIZED.roleId, UNINITIALIZED.accountId]],
      ['getRoleAdmin', [UNINITIALIZED.roleId]],
      ['grantRole', [UNINITIALIZED.roleId, UNINITIALIZED.accountId]],
      ['revokeRole', [UNINITIALIZED.roleId, UNINITIALIZED.accountId]],
      ['renounceRole', [UNINITIALIZED.roleId, UNINITIALIZED.accountId]],
      ['_setRoleAdmin', [UNINITIALIZED.roleId, UNINITIALIZED.roleId]],
      ['_grantRole', [UNINITIALIZED.roleId, UNINITIALIZED.accountId]],
      ['_revokeRole', [UNINITIALIZED.roleId, UNINITIALIZED.accountId]],
      [
        '_computeRoleCommitment',
        [UNINITIALIZED.roleId, UNINITIALIZED.accountId],
      ],
      [
        '_computeAccountId',
        [
          utils.createEitherTestUser(UNINITIALIZED.baseString),
          UNINITIALIZED.accountId,
        ],
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
  });

  describe('after initialization', () => {
    const isInit = true;

    beforeEach(() => {
      // Create private state object and generate nonce
      const PS = ShieldedAccessControlPrivateState.withRoleAndNonce(
        ADMIN.roleId,
        ADMIN.secretNonce,
      );
      // Deploy contract with derived owner commitment and PS
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
            ADMIN.roleId,
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
        [false, true, [BAD_INPUT.roleId, ADMIN.accountId]],
        [true, false, [ADMIN.roleId, BAD_INPUT.accountId]],
        [false, false, [BAD_INPUT.roleId, BAD_INPUT.accountId]],
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
      const eitherAdmin = utils.createEitherTestUser('ADMIN');
      const eitherUnauthorized = utils.createEitherTestUser('UNAUTHORIZED');

      it('should match account id', () => {
        expect(
          shieldedAccessControl._computeAccountId(
            eitherAdmin,
            ADMIN.secretNonce,
          ),
        ).toEqual(ADMIN.accountId);
      });

      it('should fail for contract address', () => {
        const eitherContract =
          utils.createEitherTestContractAddress('CONTRACT');
        expect(() => {
          shieldedAccessControl._computeAccountId(
            eitherContract,
            ADMIN.secretNonce,
          );
        }).toThrow(
          'ShieldedAccessControl: contract address roles are not yet supported',
        );
      });

      type ComputeAccountIdCases = [
        isValidAccount: boolean,
        isValidNonce: boolean,
        args: unknown[],
      ];

      const checkedCircuits: ComputeAccountIdCases[] = [
        [true, false, [eitherAdmin, UNAUTHORIZED.secretNonce]],
        [false, true, [eitherUnauthorized, ADMIN.secretNonce]],
        [false, false, [eitherUnauthorized, UNAUTHORIZED.secretNonce]],
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

    describe('_checkRole', () => {
      beforeEach(() => {
        shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId);
        shieldedAccessControl.setPersistentCaller(ADMIN.publicKey);
      });

      type CheckRoleCases = [
        isValidRoleId: boolean,
        isValidAccountId: boolean,
        args: unknown[],
      ];
      const checkedCircuits: CheckRoleCases[] = [
        [false, true, [ADMIN.roleId, BAD_INPUT.accountId]],
        [true, false, [BAD_INPUT.roleId, ADMIN.accountId]],
        [false, false, [BAD_INPUT.roleId, BAD_INPUT.accountId]],
      ];

      it.each(
        checkedCircuits,
      )('hasRole should be false with isValidRoleId=%s isValidAccountId=%s', (_isValidRoleId, _isValidAccountId, args) => {
        // Test protected circuit
        expect(
          (
            shieldedAccessControl._checkRole as (
              ...args: unknown[]
            ) => RoleCheck
          )(...args).hasRole,
        ).toBe(false);
      });

      it('hasRole should return false if role does not exist', () => {
        expect(
          shieldedAccessControl._checkRole(
            UNINITIALIZED.roleId,
            ADMIN.accountId,
          ).hasRole,
        ).toBe(false);
      });

      it('hasRole should return true for granted role', () => {
        expect(
          shieldedAccessControl._checkRole(ADMIN.roleId, ADMIN.accountId)
            .hasRole,
        ).toBe(true);
      });

      it('hasRole should return true for accountId with multiple roles', () => {
        shieldedAccessControl._grantRole(OPERATOR_1.roleId, ADMIN.accountId);
        shieldedAccessControl._grantRole(OPERATOR_2.roleId, ADMIN.accountId);
        shieldedAccessControl._grantRole(OPERATOR_3.roleId, ADMIN.accountId);
        shieldedAccessControl.getContractState()

        expect(
          shieldedAccessControl._checkRole(ADMIN.roleId, ADMIN.accountId)
            .hasRole,
        ).toBe(true);
        expect(
          shieldedAccessControl._checkRole(OPERATOR_1.roleId, ADMIN.accountId)
            .hasRole,
        ).toBe(true);
        expect(
          shieldedAccessControl._checkRole(OPERATOR_2.roleId, ADMIN.accountId)
            .hasRole,
        ).toBe(true);
        expect(
          shieldedAccessControl._checkRole(OPERATOR_3.roleId, ADMIN.accountId)
            .hasRole,
        ).toBe(true);
      });

      it('hasRole should return false for revoked role', () => {
        shieldedAccessControl._revokeRole(ADMIN.roleId, ADMIN.accountId);
        expect(
          shieldedAccessControl._checkRole(ADMIN.roleId, ADMIN.accountId)
            .hasRole,
        ).toBe(false);
      });

      it('hasRole should return false when revoked role is re-granted', () => {
        shieldedAccessControl._revokeRole(ADMIN.roleId, ADMIN.accountId);
        shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId);
        expect(
          shieldedAccessControl._checkRole(ADMIN.roleId, ADMIN.accountId)
            .hasRole,
        ).toBe(false);
      });

      it('hasRole should return false for bad path', () => {
        shieldedAccessControl.overrideWitness(
          'wit_getRoleCommitmentPath',
          RETURN_BAD_PATH,
        );
        expect(
          shieldedAccessControl._checkRole(ADMIN.roleId, ADMIN.accountId)
            .hasRole,
        ).toBe(false);
      });
    });

    describe('assertOnlyRole', () => {
      beforeEach(() => {
        shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId);
        shieldedAccessControl.setPersistentCaller(ADMIN.publicKey);
      });

      it('should not fail when authorized caller has correct nonce, and path', () => {
        // Check nonce is correct
        expect(
          shieldedAccessControl.privateState.getCurrentSecretNonce(
            ADMIN.roleId,
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
          shieldedAccessControl.assertOnlyRole(ADMIN.roleId),
        ).not.toThrow();
      });

      it('should fail for revoked role', () => {
        shieldedAccessControl._revokeRole(ADMIN.roleId, ADMIN.accountId);
        expect(() =>
          shieldedAccessControl.assertOnlyRole(ADMIN.roleId),
        ).toThrow('ShieldedAccessControl: unauthorized account');
      });

      it('should fail for revoked role with re-approval', () => {
        shieldedAccessControl._revokeRole(ADMIN.roleId, ADMIN.accountId);
        shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId);
        expect(() =>
          shieldedAccessControl.assertOnlyRole(ADMIN.roleId),
        ).toThrow('ShieldedAccessControl: unauthorized account');
      });

      it('should not fail for admin with multiple roles', () => {
        shieldedAccessControl.privateState.injectSecretNonce(
          OPERATOR_1.roleId,
          OPERATOR_1.secretNonce,
        );
        // A unique accountId must be constructed for each new role using its associated secretNonce
        const operator1AccountId = buildAccountIdHash(
          ADMIN.zPublicKey,
          OPERATOR_1.secretNonce,
        );

        shieldedAccessControl.privateState.injectSecretNonce(
          OPERATOR_2.roleId,
          OPERATOR_2.secretNonce,
        );
        const operator2AccountId = buildAccountIdHash(
          ADMIN.zPublicKey,
          OPERATOR_2.secretNonce,
        );

        shieldedAccessControl.privateState.injectSecretNonce(
          OPERATOR_3.roleId,
          OPERATOR_3.secretNonce,
        );
        const operator3AccountId = buildAccountIdHash(
          ADMIN.zPublicKey,
          OPERATOR_3.secretNonce,
        );

        shieldedAccessControl._grantRole(OPERATOR_1.roleId, operator1AccountId);
        shieldedAccessControl._grantRole(OPERATOR_2.roleId, operator2AccountId);
        shieldedAccessControl._grantRole(OPERATOR_3.roleId, operator3AccountId);
        expect(() => {
          shieldedAccessControl.assertOnlyRole(ADMIN.roleId);
          shieldedAccessControl.assertOnlyRole(OPERATOR_1.roleId);
          shieldedAccessControl.assertOnlyRole(OPERATOR_2.roleId);
          shieldedAccessControl.assertOnlyRole(OPERATOR_3.roleId);
        }).not.toThrow();
      });
    });

    describe('_grantRole', () => {
      it('should grant role', () => {
        expect(
          shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId),
        ).toBe(true);
      });

      it('should not re-grant role', () => {
        shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId);
        const merkleRoot = shieldedAccessControl
          .getPublicState()
          .ShieldedAccessControl__operatorRoles.root();
        expect(
          shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId),
        ).toBe(false);
        expect(
          shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.root(),
        ).toEqual(merkleRoot);
      });

      it('should not re-grant revoked role', () => {
        shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId);
        shieldedAccessControl._revokeRole(ADMIN.roleId, ADMIN.accountId);
        expect(
          shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId),
        ).toBe(false);
        const merkleRoot = shieldedAccessControl
          .getPublicState()
          .ShieldedAccessControl__operatorRoles.root();
        expect(
          shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.root(),
        ).toEqual(merkleRoot);
      });

      it('should update Merkle tree root', () => {
        const initialMtRoot = shieldedAccessControl
          .getPublicState()
          .ShieldedAccessControl__operatorRoles.root();
        shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId);
        const updatedMtRoot = shieldedAccessControl
          .getPublicState()
          .ShieldedAccessControl__operatorRoles.root();
        expect(initialMtRoot).not.toEqual(updatedMtRoot);
      });

      it('path for role commitment should exist', () => {
        shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId);
        const path =
          shieldedAccessControl.privateState.getCommitmentPathWithFindForLeaf(
            ADMIN.roleCommitment,
          );
        expect(path).not.toBe(undefined);
      });
    });

    describe('_revokeRole', () => {
      it('should not revoke role that does not exist', () => {
        expect(
          shieldedAccessControl._revokeRole(
            UNINITIALIZED.roleId,
            ADMIN.accountId,
          ),
        ).toBe(false);
      });

      it('should not re-revoke role', () => {
        shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId);
        shieldedAccessControl._revokeRole(ADMIN.roleId, ADMIN.accountId);
        expect(
          shieldedAccessControl._revokeRole(ADMIN.roleId, ADMIN.accountId),
        ).toBe(false);
      });

      it('should revoke role', () => {
        shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId);
        expect(
          shieldedAccessControl._revokeRole(ADMIN.roleId, ADMIN.accountId),
        ).toBe(true);
      });

      it('should update nullifier root on revoke', () => {
        const initialNullifierRoot = shieldedAccessControl
          .getPublicState()
          .ShieldedAccessControl__roleCommitmentNullifiers.root();
        shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId);
        const isRevoked = shieldedAccessControl._revokeRole(
          ADMIN.roleId,
          ADMIN.accountId,
        );
        expect(isRevoked).toBe(true);
        const updatedNullifierRoot = shieldedAccessControl
          .getPublicState()
          .ShieldedAccessControl__roleCommitmentNullifiers.root();
        expect(initialNullifierRoot).not.toEqual(updatedNullifierRoot);
      });

      it('should not update nullifier root on failed revoke', () => {
        const initialNullifierRoot = shieldedAccessControl
          .getPublicState()
          .ShieldedAccessControl__roleCommitmentNullifiers.root();
        const isRevoked = shieldedAccessControl._revokeRole(
          ADMIN.roleId,
          ADMIN.accountId,
        );
        expect(isRevoked).toBe(false);
        const updatedNullifierRoot = shieldedAccessControl
          .getPublicState()
          .ShieldedAccessControl__roleCommitmentNullifiers.root();
        expect(initialNullifierRoot).toEqual(updatedNullifierRoot);
      });

      it('path for role nullifier should exist after revoke', () => {
        shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId);
        shieldedAccessControl._revokeRole(ADMIN.roleId, ADMIN.accountId);
        const path =
          shieldedAccessControl.privateState.getNullifierPathWithFindForLeaf(
            ADMIN.roleNullifier,
          );
        expect(path).not.toBe(undefined);
      });
    });

    describe('callerHasRole', () => {
      beforeEach(() => {
        shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId);
        shieldedAccessControl.setPersistentCaller(ADMIN.publicKey);
      });

      it('should return true for caller with granted role', () => {
        expect(shieldedAccessControl.callerHasRole(ADMIN.roleId)).toBe(true);
      });

      it('should return false for caller without role', () => {
        // The witness requires a nonce entry for the queried roleId to exist in
        // private state (the runtime cannot call the circuit without it).
        // Inject a nonce that was never used to grant a role, so the derived
        // accountId will not match any commitment in the tree.
        shieldedAccessControl.privateState.injectSecretNonce(
          OPERATOR_1.roleId,
          OPERATOR_1.secretNonce,
        );
        expect(shieldedAccessControl.callerHasRole(OPERATOR_1.roleId)).toBe(
          false,
        );
      });

      it('should return false for caller with revoked role', () => {
        shieldedAccessControl._revokeRole(ADMIN.roleId, ADMIN.accountId);
        expect(shieldedAccessControl.callerHasRole(ADMIN.roleId)).toBe(false);
      });

      it('should return false for revoked role after re-grant attempt', () => {
        shieldedAccessControl._revokeRole(ADMIN.roleId, ADMIN.accountId);
        shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId);
        expect(shieldedAccessControl.callerHasRole(ADMIN.roleId)).toBe(false);
      });

      it('should return false for a different caller sharing the same private state', () => {
        // UNAUTHORIZED uses the same private state (ADMIN.secretNonce for ADMIN.roleId),
        // so their derived accountId won't match the committed one.
        shieldedAccessControl.setPersistentCaller(UNAUTHORIZED.publicKey);
        expect(shieldedAccessControl.callerHasRole(ADMIN.roleId)).toBe(false);
      });
    });

    describe('assertOnlyRole — unauthorized caller', () => {
      beforeEach(() => {
        shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId);
      });

      it('should fail for caller who was never granted the role', () => {
        shieldedAccessControl.setPersistentCaller(UNAUTHORIZED.publicKey);
        expect(() =>
          shieldedAccessControl.assertOnlyRole(ADMIN.roleId),
        ).toThrow('ShieldedAccessControl: unauthorized account');
      });
    });

    describe('_checkRole — isRevoked field', () => {
      beforeEach(() => {
        shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId);
        shieldedAccessControl.setPersistentCaller(ADMIN.publicKey);
      });

      it('isRevoked should be false when role is active', () => {
        expect(
          shieldedAccessControl._checkRole(ADMIN.roleId, ADMIN.accountId)
            .isRevoked,
        ).toBe(false);
      });

      it('isRevoked should be true when role is revoked', () => {
        shieldedAccessControl._revokeRole(ADMIN.roleId, ADMIN.accountId);
        expect(
          shieldedAccessControl._checkRole(ADMIN.roleId, ADMIN.accountId)
            .isRevoked,
        ).toBe(true);
      });

      it('isRevoked should be false when role has never been granted', () => {
        expect(
          shieldedAccessControl._checkRole(
            UNINITIALIZED.roleId,
            ADMIN.accountId,
          ).isRevoked,
        ).toBe(false);
      });

      it('should appear active (hasRole=true, isRevoked=false) when nullifier path witness returns a bad path', () => {
        // SIMULATOR LIMITATION: in the simulator, a bad nullifier path causes
        // _roleCommitmentNullifiers.checkRoot() to return false, so isRevoked=false
        // and the role appears active even though it was revoked.
        // In production ZK this cannot happen: an incorrect path produces an
        // invalid proof that the verifier rejects.
        shieldedAccessControl._revokeRole(ADMIN.roleId, ADMIN.accountId);
        shieldedAccessControl.overrideWitness(
          'wit_getCommitmentNullifierPath',
          RETURN_BAD_PATH,
        );
        const roleCheck = shieldedAccessControl._checkRole(
          ADMIN.roleId,
          ADMIN.accountId,
        );
        expect(roleCheck.isRevoked).toBe(false);
        expect(roleCheck.hasRole).toBe(true);
      });
    });

    describe('getRoleAdmin', () => {
      it('should return zero bytes (DEFAULT_ADMIN_ROLE) for a role with no admin set', () => {
        expect(
          shieldedAccessControl.getRoleAdmin(OPERATOR_1.roleId),
        ).toEqual(new Uint8Array(32));
      });

      it('should return the admin role after _setRoleAdmin', () => {
        shieldedAccessControl._setRoleAdmin(OPERATOR_1.roleId, ADMIN.roleId);
        expect(
          shieldedAccessControl.getRoleAdmin(OPERATOR_1.roleId),
        ).toEqual(new Uint8Array(ADMIN.roleId));
      });
    });

    describe('_setRoleAdmin', () => {
      it('should set admin role retrievable by getRoleAdmin', () => {
        shieldedAccessControl._setRoleAdmin(OPERATOR_1.roleId, ADMIN.roleId);
        expect(
          shieldedAccessControl.getRoleAdmin(OPERATOR_1.roleId),
        ).toEqual(new Uint8Array(ADMIN.roleId));
      });

      it('should override an existing admin role', () => {
        shieldedAccessControl._setRoleAdmin(OPERATOR_1.roleId, ADMIN.roleId);
        shieldedAccessControl._setRoleAdmin(
          OPERATOR_1.roleId,
          OPERATOR_2.roleId,
        );
        expect(
          shieldedAccessControl.getRoleAdmin(OPERATOR_1.roleId),
        ).toEqual(new Uint8Array(OPERATOR_2.roleId));
      });
    });

    describe('grantRole', () => {
      beforeEach(() => {
        // Give ADMIN the DEFAULT_ADMIN_ROLE (ADMIN.roleId === all-zero bytes === DEFAULT_ADMIN_ROLE).
        shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId);
        shieldedAccessControl.setPersistentCaller(ADMIN.publicKey);
      });

      it('should grant role when caller has the admin role', () => {
        // DEFAULT_ADMIN_ROLE is admin of every role by default.
        expect(() =>
          shieldedAccessControl.grantRole(
            OPERATOR_1.roleId,
            OPERATOR_1.accountId,
          ),
        ).not.toThrow();
        expect(
          shieldedAccessControl._checkRole(
            OPERATOR_1.roleId,
            OPERATOR_1.accountId,
          ).hasRole,
        ).toBe(true);
      });

      it('should fail when caller does not have the admin role', () => {
        shieldedAccessControl.setPersistentCaller(UNAUTHORIZED.publicKey);
        expect(() =>
          shieldedAccessControl.grantRole(
            OPERATOR_1.roleId,
            OPERATOR_1.accountId,
          ),
        ).toThrow('ShieldedAccessControl: unauthorized account');
      });

      it('should not re-grant role', () => {
        shieldedAccessControl.grantRole(OPERATOR_1.roleId, OPERATOR_1.accountId);
        const treeRoot = shieldedAccessControl
          .getPublicState()
          .ShieldedAccessControl__operatorRoles.root();
        expect(() =>
          shieldedAccessControl.grantRole(
            OPERATOR_1.roleId,
            OPERATOR_1.accountId,
          ),
        ).not.toThrow();
        expect(
          shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.root(),
        ).toEqual(treeRoot);
      });

      it('should grant role using a custom admin role', () => {
        // Make OPERATOR_1.roleId the admin of OPERATOR_2.roleId.
        shieldedAccessControl._setRoleAdmin(
          OPERATOR_2.roleId,
          OPERATOR_1.roleId,
        );
        // Grant OPERATOR_1.roleId to OPERATOR_1 (ADMIN has DEFAULT_ADMIN_ROLE
        // which is the admin of OPERATOR_1.roleId by default).
        shieldedAccessControl.grantRole(OPERATOR_1.roleId, OPERATOR_1.accountId);

        // Switch to OPERATOR_1 as caller and inject their nonce for their role.
        shieldedAccessControl.privateState.injectSecretNonce(
          OPERATOR_1.roleId,
          OPERATOR_1.secretNonce,
        );
        shieldedAccessControl.setPersistentCaller(OPERATOR_1.publicKey);

        // OPERATOR_1 (who holds OPERATOR_1.roleId) can now grant OPERATOR_2.roleId.
        expect(() =>
          shieldedAccessControl.grantRole(
            OPERATOR_2.roleId,
            OPERATOR_2.accountId,
          ),
        ).not.toThrow();
        expect(
          shieldedAccessControl._checkRole(
            OPERATOR_2.roleId,
            OPERATOR_2.accountId,
          ).hasRole,
        ).toBe(true);
      });
    });

    describe('revokeRole', () => {
      beforeEach(() => {
        shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId);
        shieldedAccessControl._grantRole(
          OPERATOR_1.roleId,
          OPERATOR_1.accountId,
        );
        shieldedAccessControl.setPersistentCaller(ADMIN.publicKey);
      });

      it('should revoke role when caller has the admin role', () => {
        expect(() =>
          shieldedAccessControl.revokeRole(
            OPERATOR_1.roleId,
            OPERATOR_1.accountId,
          ),
        ).not.toThrow();
        expect(
          shieldedAccessControl._checkRole(
            OPERATOR_1.roleId,
            OPERATOR_1.accountId,
          ).hasRole,
        ).toBe(false);
      });

      it('should fail when caller does not have the admin role', () => {
        shieldedAccessControl.setPersistentCaller(UNAUTHORIZED.publicKey);
        expect(() =>
          shieldedAccessControl.revokeRole(
            OPERATOR_1.roleId,
            OPERATOR_1.accountId,
          ),
        ).toThrow('ShieldedAccessControl: unauthorized account');
      });

      it('should not re-revoke role', () => {
        shieldedAccessControl.revokeRole(OPERATOR_1.roleId, OPERATOR_1.accountId);
        const nullifierRoot = shieldedAccessControl
          .getPublicState()
          .ShieldedAccessControl__roleCommitmentNullifiers.root();
        expect(() =>
          shieldedAccessControl.revokeRole(
            OPERATOR_1.roleId,
            OPERATOR_1.accountId,
          ),
        ).not.toThrow();
        expect(
          shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__roleCommitmentNullifiers.root(),
        ).toEqual(nullifierRoot);
      });
    });

    describe('renounceRole', () => {
      beforeEach(() => {
        shieldedAccessControl._grantRole(ADMIN.roleId, ADMIN.accountId);
        shieldedAccessControl.setPersistentCaller(ADMIN.publicKey);
      });

      it('should allow caller to renounce their own role', () => {
        expect(() =>
          shieldedAccessControl.renounceRole(ADMIN.roleId, ADMIN.accountId),
        ).not.toThrow();
        expect(
          shieldedAccessControl._checkRole(ADMIN.roleId, ADMIN.accountId)
            .hasRole,
        ).toBe(false);
      });

      it('should fail with wrong accountId confirmation', () => {
        expect(() =>
          shieldedAccessControl.renounceRole(
            ADMIN.roleId,
            OPERATOR_1.accountId,
          ),
        ).toThrow('ShieldedAccessControl: bad confirmation');
      });

      it('should be a no-op when role is already revoked', () => {
        shieldedAccessControl._revokeRole(ADMIN.roleId, ADMIN.accountId);
        // renounceRole calls _revokeRole internally which silently returns false
        // when the role is already revoked — no assertion, so no throw.
        expect(() =>
          shieldedAccessControl.renounceRole(ADMIN.roleId, ADMIN.accountId),
        ).not.toThrow();
        expect(
          shieldedAccessControl._checkRole(ADMIN.roleId, ADMIN.accountId)
            .hasRole,
        ).toBe(false);
      });

      it('should update nullifier root on successful renounce', () => {
        const initialNullifierRoot = shieldedAccessControl
          .getPublicState()
          .ShieldedAccessControl__roleCommitmentNullifiers.root();
        shieldedAccessControl.renounceRole(ADMIN.roleId, ADMIN.accountId);
        const updatedNullifierRoot = shieldedAccessControl
          .getPublicState()
          .ShieldedAccessControl__roleCommitmentNullifiers.root();
        expect(initialNullifierRoot).not.toEqual(updatedNullifierRoot);
      });
    });
  });
});
