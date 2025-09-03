import {
  CompactTypeBytes,
  CompactTypeVector,
  convert_bigint_to_Uint8Array,
  persistentHash,
  transientHash,
  upgradeFromTransient,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ZswapCoinPublicKey, Either, ContractAddress } from '../../../artifacts/MockShieldedAccessControl/contract/index.cjs';
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
const BAD_NONCE = Buffer.from(Buffer.alloc(32, 'BAD_NONCE'));
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

let secretNonce: Uint8Array;
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

describe('ShieldedAccessControl', () => {
  beforeEach(() => {
    // Create private state object and generate nonce
    const PS = ShieldedAccessControlPrivateState.generate(Z_ADMIN);
    // Bind nonce for convenience
    secretNonce = PS.roles[DEFAULT_ADMIN_ROLE_TO_STRING];
    // Prepare owner ID with gen nonce
    // Deploy contract with derived owner commitment and PS
    shieldedAccessControl = new ShieldedAccessControlSimulator(Z_ADMIN, {
      privateState: PS,
    });
  });

  describe('initialization checks', () => {
    it('DEFAULT_ADMIN_ROLE should be 0', () => {
      expect(shieldedAccessControl.getPublicState().ShieldedAccessControl_DEFAULT_ADMIN_ROLE).toEqual(DEFAULT_ADMIN_ROLE);
    });

    it('Merkle tree root should be 0', () => {
      expect(shieldedAccessControl.getPublicState().ShieldedAccessControl__operatorRoles.root()).toEqual(EMPTY_ROOT);
    });
  });

  describe('hasRole', () => {
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
  })
});
