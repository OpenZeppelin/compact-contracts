import {
  CompactTypeBytes,
  CompactTypeVector,
  convert_bigint_to_Uint8Array,
  persistentHash,
  type WitnessContext,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ContractAddress,
  Either,
  Ledger,
  MerkleTreePath,
  ShieldedAccessControl_Role as Role,
  ZswapCoinPublicKey,
  Contract as MyContract
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
const [UNAUTHORIZED, Z_UNAUTHORIZED] = utils.generatePubKeyPair('UNAUTHORIZED');

// Roles
const DEFAULT_ADMIN_ROLE = utils.zeroUint8Array();
const BAD_ROLE = convert_bigint_to_Uint8Array(32, 99999999n);

// Nonces
const ADMIN_SECRET_NONCE = Buffer.alloc(32, 'ADMIN_SECRET_NONCE');
const BAD_NONCE = Buffer.alloc(32, 'BAD_NONCE');

// Constants
const COMMITMENT_DOMAIN = new Uint8Array(32);
new TextEncoder().encodeInto('ShieldedAccessControl:commitment', COMMITMENT_DOMAIN);
const NULLIFIER_DOMAIN = new Uint8Array(32);
new TextEncoder().encodeInto('ShieldedAccessControl:nullifier', NULLIFIER_DOMAIN);

const ADMIN_ID = createIdHash(Z_ADMIN, ADMIN_SECRET_NONCE);
const ADMIN_COMMITMENT = buildCommitment(ADMIN_ID, DEFAULT_ADMIN_ROLE, 0n);
const ADMIN_NULLIFIER = buildNullifier(ADMIN_COMMITMENT);

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


});