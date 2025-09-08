import {
  CompactTypeBytes,
  CompactTypeVector,
  convert_bigint_to_Uint8Array,
  persistentHash,
  WitnessContext,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ZswapCoinPublicKey, Either, ContractAddress, Ledger } from '../../../artifacts/MockShieldedAccessControl/contract/index.cjs';
import { ShieldedAccessControlPrivateState } from '../witnesses/ShieldedAccessControlWitnesses.js';
import { ShieldedAccessControlSimulator } from './simulators/ShieldedAccessControlSimulator.js';
import * as utils from './utils/address.js';

// PKs
const [ADMIN, Z_ADMIN] = utils.generateEitherPubKeyPair('ADMIN');
const [CUSTOM_ADMIN, Z_CUSTOM_ADMIN] = utils.generateEitherPubKeyPair('CUSTOM_ADMIN');
const [OPERATOR_1, Z_OPERATOR_1] = utils.generateEitherPubKeyPair('OPERATOR_1');
const [OPERATOR_CONTRACT, Z_OPERATOR_CONTRACT] = utils.generateEitherPubKeyPair('OPERATOR_CONTRACT', false);

// Constants
const INSTANCE_SALT = new Uint8Array(32).fill(8675309);
const BAD_NONCE = Buffer.alloc(32, 'BAD_NONCE');
const DOMAIN = 'ShieldedAccessControl:shield:';
const INIT_COUNTER = 0n;
const EMPTY_ROOT = { field: 0n };

// Roles
const DEFAULT_ADMIN_ROLE = utils.zeroUint8Array();
const OPERATOR_ROLE_1 = convert_bigint_to_Uint8Array(32, 1n);
const OPERATOR_ROLE_2 = convert_bigint_to_Uint8Array(32, 2n);
const OPERATOR_ROLE_3 = convert_bigint_to_Uint8Array(32, 3n);
const CUSTOM_ADMIN_ROLE = convert_bigint_to_Uint8Array(32, 4n);
const UNINITIALIZED_ROLE = convert_bigint_to_Uint8Array(32, 5n);

const operatorTypes = [
  ['contract', Z_OPERATOR_CONTRACT],
  ['pubkey', Z_OPERATOR_1],
] as const;

// Role to string
const DEFAULT_ADMIN_ROLE_TO_STRING = Buffer.from(DEFAULT_ADMIN_ROLE).toString('hex');

const secretNonce = Buffer.alloc(32, "secretNonce");
let shieldedAccessControl: ShieldedAccessControlSimulator;

// Helpers
const buildCommitment = (
  roleId: Uint8Array,
  account: Either<ZswapCoinPublicKey, ContractAddress>,
  nonce: Uint8Array,
  index: bigint,
): Uint8Array => {
  const rt_type = new CompactTypeVector(5, new CompactTypeBytes(32));
  const bAccount = utils.eitherToBytes(account);
  const bIndex = convert_bigint_to_Uint8Array(32, index);
  const bDomain = new TextEncoder().encode(DOMAIN);

  const commitment = persistentHash(rt_type, [
    roleId,
    bAccount,
    nonce,
    bIndex,
    bDomain,
  ]);

  return commitment;
};

function RETURN_BAD_INDEX(context: WitnessContext<Ledger, ShieldedAccessControlPrivateState>, roleId: Uint8Array): [ShieldedAccessControlPrivateState, bigint] {
  console.log("WIT RETURN BAD INDEX");
  return [context.privateState, 1023n]
}

describe('ShieldedAccessControl', () => {
  beforeEach(() => {
    // Create private state object and generate nonce
    const PS = ShieldedAccessControlPrivateState.withRoleAndNonce(Z_ADMIN, Buffer.from(DEFAULT_ADMIN_ROLE), secretNonce);
    // Init contract for user with PS
    shieldedAccessControl = new ShieldedAccessControlSimulator(Z_ADMIN, {
      privateState: PS,
    });
  });

  describe.only('should fail when incorrect witness values provided', () => {
    beforeEach(() => {
      shieldedAccessControl._grantRole(DEFAULT_ADMIN_ROLE, Z_ADMIN);
    });

    type FailingCircuits = [method: keyof ShieldedAccessControlSimulator, args: unknown[]];
    const protectedCircuits: FailingCircuits[] = [
      ['assertOnlyRole', [DEFAULT_ADMIN_ROLE]],
      ['_checkRole', [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['grantRole', [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['revokeRole', [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
    ];

    it.each(protectedCircuits)('%s should fail with bad nonce', (circuitName, args) => {
      shieldedAccessControl.privateState.injectSecretNonce(Buffer.from(DEFAULT_ADMIN_ROLE), BAD_NONCE);

      expect(() => {
        (shieldedAccessControl[circuitName] as (...args: unknown[]) => unknown)(...args);
      }).toThrow('ShieldedAccessControl: unauthorized account');
    });

    it.each(protectedCircuits)('%s should fail with bad index', (circuitName, args) => {
      shieldedAccessControl.overrideWitness("wit_getRoleIndex", RETURN_BAD_INDEX);
      expect(() => {
        (shieldedAccessControl[circuitName] as (...args: unknown[]) => unknown)(...args);
      }).toThrow('ShieldedAccessControl: unauthorized account');
    });
  });

  describe('hasRole', () => {
    beforeEach(() => {
      shieldedAccessControl._grantRole(DEFAULT_ADMIN_ROLE, Z_ADMIN);
    });

    it('should throw if caller is contract address', () => {
      shieldedAccessControl.callerCtx.setCaller(OPERATOR_CONTRACT);
      expect(() => {
        shieldedAccessControl.hasRole(UNINITIALIZED_ROLE, Z_OPERATOR_CONTRACT)
      }).toThrow('ShieldedAccessControl: contract address roles are not yet supported');
    });

    it('should return correct role commitment', () => {
      const expCommitment = buildCommitment(
        DEFAULT_ADMIN_ROLE,
        Z_ADMIN,
        secretNonce,
        INIT_COUNTER,
      );

      const role = shieldedAccessControl.hasRole(DEFAULT_ADMIN_ROLE, Z_ADMIN);
      expect(role.roleCommitment).toEqual(expCommitment);
    });

    it('should return true when admin has role', () => {
      const role = shieldedAccessControl.hasRole(DEFAULT_ADMIN_ROLE, Z_ADMIN);
      expect(role.hasRole).toEqual(true);
    });


  })
});
