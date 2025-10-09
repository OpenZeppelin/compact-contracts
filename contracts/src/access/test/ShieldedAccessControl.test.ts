import {
  CompactTypeBytes,
  CompactTypeVector,
  convert_bigint_to_Uint8Array,
  persistentHash,
  type WitnessContext,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ContractAddress,
  Either,
  Ledger,
  MerkleTreePath,
  ShieldedAccessControl_Role as Role,
  ZswapCoinPublicKey,
  Contract as MockShieldedAccessControl
} from '../../../artifacts/MockShieldedAccessControl/contract/index.cjs';
import { fmtHexString, ShieldedAccessControlPrivateState, ShieldedAccessControlWitnesses } from '../witnesses/ShieldedAccessControlWitnesses.js';
import { ShieldedAccessControlSimulator } from './simulators/ShieldedAccessControlSimulator.js';
import * as utils from './utils/address.js';

// Helpers
const buildCommitment = (
  accountId: Uint8Array,
  roleId: Uint8Array,
  index: bigint,
): Uint8Array => {
  const rt_type = new CompactTypeVector(4, new CompactTypeBytes(32));
  const bIndex = convert_bigint_to_Uint8Array(32, index);

  const commitment = persistentHash(rt_type, [
    accountId,
    roleId,
    bIndex,
    COMMITMENT_DOMAIN,
  ]);

  return commitment;
};

const buildNullifier = (
  roleCommitment: Uint8Array,
): Uint8Array => {
  const rt_type = new CompactTypeVector(2, new CompactTypeBytes(32));

  const nullifier = persistentHash(rt_type, [
    roleCommitment,
    NULLIFIER_DOMAIN,
  ]);

  return nullifier;
};

const createIdHash = (
  pk: ZswapCoinPublicKey,
  nonce: Uint8Array,
): Uint8Array => {
  const rt_type = new CompactTypeVector(2, new CompactTypeBytes(32));

  const bPK = pk.bytes;
  return persistentHash(rt_type, [bPK, nonce]);
};

// PKs
const [ADMIN, Z_ADMIN] = utils.generatePubKeyPair('ADMIN');
const [OPERATOR_1, Z_OPERATOR_1] = utils.generatePubKeyPair('OPERATOR_1');
const [OPERATOR_2, Z_OPERATOR_2] = utils.generatePubKeyPair('OPERATOR_2');
const [OPERATOR_3, Z_OPERATOR_3] = utils.generatePubKeyPair('OPERATOR_3');
const [UNAUTHORIZED, Z_UNAUTHORIZED] = utils.generatePubKeyPair('UNAUTHORIZED');

// Roles
const DEFAULT_ADMIN_ROLE = utils.zeroUint8Array();
const OPERATOR_1_ROLE = convert_bigint_to_Uint8Array(32, 1n);
const OPERATOR_2_ROLE = convert_bigint_to_Uint8Array(32, 2n);
const OPERATOR_3_ROLE = convert_bigint_to_Uint8Array(32, 3n);
const UNINITIALIZED_ROLE = convert_bigint_to_Uint8Array(32, 555n);
const BAD_ROLE = convert_bigint_to_Uint8Array(32, 99999999n);

// Nonces
const ADMIN_SECRET_NONCE = Buffer.alloc(32, 'ADMIN_SECRET_NONCE');
const OPERATOR_1_SECRET_NONCE = Buffer.alloc(32, 'OPERATOR_1_NONCE');
const OPERATOR_2_SECRET_NONCE = Buffer.alloc(32, 'OPERATOR_2_NONCE');
const OPERATOR_3_SECRET_NONCE = Buffer.alloc(32, 'OPERATOR_3_NONCE');
const BAD_NONCE = Buffer.alloc(32, 'BAD_NONCE');

// Constants
const COMMITMENT_DOMAIN = new Uint8Array(32);
new TextEncoder().encodeInto('ShieldedAccessControl:commitment', COMMITMENT_DOMAIN);
const NULLIFIER_DOMAIN = new Uint8Array(32);
new TextEncoder().encodeInto('ShieldedAccessControl:nullifier', NULLIFIER_DOMAIN);

const ADMIN_ID = createIdHash(Z_ADMIN, ADMIN_SECRET_NONCE);
const ADMIN_COMMITMENT = buildCommitment(ADMIN_ID, DEFAULT_ADMIN_ROLE, 0n);
const ADMIN_NULLIFIER = buildNullifier(ADMIN_COMMITMENT);

const OPERATOR_1_ID = createIdHash(Z_OPERATOR_1, OPERATOR_1_SECRET_NONCE);
const OPERATOR_2_ID = createIdHash(Z_OPERATOR_2, OPERATOR_2_SECRET_NONCE);
const OPERATOR_3_ID = createIdHash(Z_OPERATOR_3, OPERATOR_3_SECRET_NONCE);

const BAD_ID = createIdHash(Z_UNAUTHORIZED, new Uint8Array(32));
const BAD_INDEX = 99999999n;
const BAD_COMMITMENT = buildCommitment(BAD_ID, BAD_ROLE, BAD_INDEX);

let shieldedAccessControl: ShieldedAccessControlSimulator;


describe('ShieldedAccessControl', () => {
  beforeEach(() => {
    // Create private state object and generate nonce
    const PS = ShieldedAccessControlPrivateState.withRoleAndNonce(
      Buffer.from(DEFAULT_ADMIN_ROLE),
      ADMIN_SECRET_NONCE,
    );
    // Init contract for user with PS
    shieldedAccessControl = new ShieldedAccessControlSimulator({
      privateState: PS,
      coinPK: ADMIN
    });
  });

  describe('_computeRoleCommitment', () => {
    it('computed commitment should match', () => {
      expect(shieldedAccessControl._computeRoleCommitment(ADMIN_ID, DEFAULT_ADMIN_ROLE, 0n)).toEqual(ADMIN_COMMITMENT);
    });

    type ComputeRoleCommitmentCases = [
      method: keyof ShieldedAccessControlSimulator,
      isValidId: boolean,
      isValidRole: boolean,
      isValidIndex: boolean,
      args: unknown[],
    ];

    const checkedCircuits: ComputeRoleCommitmentCases[] = [
      ['_computeRoleCommitment', false, true, true, [BAD_ID, DEFAULT_ADMIN_ROLE, 0n]],
      ['_computeRoleCommitment', true, false, true, [ADMIN_ID, BAD_ROLE, 0n]],
      ['_computeRoleCommitment', true, true, false, [ADMIN_ID, DEFAULT_ADMIN_ROLE, BAD_INDEX]],
      ['_computeRoleCommitment', false, true, false, [BAD_ID, DEFAULT_ADMIN_ROLE, BAD_INDEX]],
      ['_computeRoleCommitment', false, false, false, [BAD_ID, BAD_ROLE, BAD_INDEX]],
      ['_computeRoleCommitment', true, false, false, [ADMIN_ID, BAD_ROLE, BAD_INDEX]],
      ['_computeRoleCommitment', false, false, true, [BAD_ID, BAD_ROLE, 0n]],
    ]

    it.each(checkedCircuits)(
      '%s should not match with isValidNonce(%s), isValidIndex(%s), isValidPath(%s)',
      (circuitName, isValidId, isValidRole, isValidIndex, args) => {
        // Test protected circuit
        expect(() => {
          (
            shieldedAccessControl[circuitName] as (
              ...args: unknown[]
            ) => unknown
          )(...args);
        }).not.toEqual(ADMIN);
      }
    )
  });

  describe('_computeNullifier', () => {
    it('should match nullifier', () => {
      expect(shieldedAccessControl._computeNullifier(ADMIN_COMMITMENT)).toEqual(ADMIN_NULLIFIER);
    });

    it('should not match with bad commitment', () => {
      expect(shieldedAccessControl._computeNullifier(BAD_COMMITMENT)).not.toEqual(ADMIN_NULLIFIER);
    });
  });

  describe('_computeRoleId', () => {
    const eitherAdmin = utils.createEitherTestUser('ADMIN');
    const eitherUnauthorized = utils.createEitherTestUser('UNAUTHORIZED');

    it('should match role id', () => {
      expect(shieldedAccessControl._computeRoleId(eitherAdmin, ADMIN_SECRET_NONCE)).toEqual(ADMIN_ID);
    });

    it('should fail for contract address', () => {
      const eitherContract = utils.createEitherTestContractAddress('CONTRACT')
      expect(() => {
        shieldedAccessControl._computeRoleId(eitherContract, ADMIN_SECRET_NONCE);
      }).toThrow('ShieldedAccessControl: contract address owners are not yet supported');
    });

    type ComputeRoleIdCases = [
      method: keyof ShieldedAccessControlSimulator,
      isValidAccount: boolean,
      isValidNonce: boolean,
      args: unknown[],
    ];

    const checkedCircuits: ComputeRoleIdCases[] = [
      ['_computeRoleId', true, false, [eitherAdmin, BAD_NONCE]],
      ['_computeRoleId', false, true, [eitherUnauthorized, ADMIN_SECRET_NONCE]],
      ['_computeRoleId', false, false, [eitherUnauthorized, BAD_NONCE]],
    ];

    it.each(checkedCircuits)(
      '%s should not match role id with invalidAccount=%s or invalidNonce=%s',
      (circuitName, isValidAccount, isValidNonce, args) => {
        // Test circuit
        expect(() => {
          (
            shieldedAccessControl[circuitName] as (
              ...args: unknown[]
            ) => unknown
          )(...args);
        }).not.toEqual(ADMIN_ID);
      }
    )
  });

  // Complete testing once issue with pathForLeaf is resolved
  describe.todo('wit_getRoleIndex', () => {
    it.todo('should return 0 if no roles granted', () => {
      const [_, index] = shieldedAccessControl.witnesses.wit_getRoleIndex(shieldedAccessControl.getWitnessContext(), UNINITIALIZED_ROLE, ADMIN_ID);
      expect(index).toBe(0n);
    });

    it.todo('should return correct index', () => {
      let granted = shieldedAccessControl._grantRole(DEFAULT_ADMIN_ROLE, ADMIN_ID);
      expect(granted).toBe(true);
      let [, adminIndex] = shieldedAccessControl.witnesses.wit_getRoleIndex(shieldedAccessControl.getWitnessContext(), DEFAULT_ADMIN_ROLE, ADMIN_ID);
      expect(adminIndex).toBe(0n);

      shieldedAccessControl.privateState.injectSecretNonce(OPERATOR_1_ROLE, OPERATOR_1_SECRET_NONCE);
      granted = shieldedAccessControl._grantRole(OPERATOR_1_ROLE, OPERATOR_1_ID);
      expect(granted).toBe(true);
      const [, operatorIndex] = shieldedAccessControl.witnesses.wit_getRoleIndex(shieldedAccessControl.getWitnessContext(), OPERATOR_1_ROLE, OPERATOR_1_ID);
      expect(operatorIndex).toBe(1n);

      shieldedAccessControl.privateState.injectSecretNonce(OPERATOR_2_ROLE, OPERATOR_2_SECRET_NONCE);
      granted = shieldedAccessControl._grantRole(OPERATOR_2_ROLE, OPERATOR_2_ID);
      expect(granted).toBe(true);
      shieldedAccessControl._grantRole(OPERATOR_2_ROLE, OPERATOR_2_ID);
      const [, operatorIndex2] = shieldedAccessControl.witnesses.wit_getRoleIndex(shieldedAccessControl.getWitnessContext(), OPERATOR_2_ROLE, OPERATOR_2_ID);
      expect(operatorIndex2).toBe(2n);

      shieldedAccessControl.privateState.injectSecretNonce(OPERATOR_3_ROLE, OPERATOR_3_SECRET_NONCE);
      shieldedAccessControl._grantRole(OPERATOR_3_ROLE, OPERATOR_3_ID);
      const [_, operatorIndex3] = shieldedAccessControl.witnesses.wit_getRoleIndex(shieldedAccessControl.getWitnessContext(), OPERATOR_3_ROLE, OPERATOR_3_ID);
      expect(operatorIndex3).toBe(3n);

      let [, adminIndex2] = shieldedAccessControl.witnesses.wit_getRoleIndex(shieldedAccessControl.getWitnessContext(), DEFAULT_ADMIN_ROLE, ADMIN_ID);
      expect(adminIndex2).toBe(0n);
    });

    it.todo('should return current Merkle tree index if role does not exist')
  });

  describe('wit_getRoleCommitmentPath', () => {
    it('should return a Merkle tree path if one exists', () => {

    });
  });

  describe('getRole', () => {
    it('should return unapproved if role does not exist', () => {
      expect(shieldedAccessControl.getRole(UNINITIALIZED_ROLE, ADMIN_ID).isApproved).toBe(false);
    });

    it('should return correct commitment', () => {
      expect(shieldedAccessControl.getRole(DEFAULT_ADMIN_ROLE, ADMIN_ID).roleCommitment).toEqual(ADMIN_COMMITMENT);
    });

    it('should return correct nullifier', () => {
      expect(shieldedAccessControl.getRole(DEFAULT_ADMIN_ROLE, ADMIN_ID).commitmentNullifier).toEqual(ADMIN_NULLIFIER);
    });

    it('should return approved role', () => {
      shieldedAccessControl._grantRole(DEFAULT_ADMIN_ROLE, ADMIN_ID);
      expect(shieldedAccessControl.getRole(DEFAULT_ADMIN_ROLE, ADMIN_ID).isApproved).toBe(true);
    });
  });

  describe('_grantRole', () => {
    it('should return true for new role', () => {
      expect(shieldedAccessControl._grantRole(DEFAULT_ADMIN_ROLE, ADMIN_ID)).toBe(true);
    });

    it('should return false if role already granted', () => {
      shieldedAccessControl._grantRole(DEFAULT_ADMIN_ROLE, ADMIN_ID);
      expect(shieldedAccessControl._grantRole(DEFAULT_ADMIN_ROLE, ADMIN_ID)).toBe(false);
    });
  });

  describe('')

});