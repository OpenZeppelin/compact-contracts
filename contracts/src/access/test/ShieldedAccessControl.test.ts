import {
  CompactTypeBytes,
  CompactTypeVector,
  convert_bigint_to_Uint8Array,
  persistentHash,
  type WitnessContext,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ContractAddress,
  Either,
  Ledger,
  MerkleTreePath,
  ShieldedAccessControl_Role as Role,
  ZswapCoinPublicKey,
} from '../../../artifacts/MockShieldedAccessControl/contract/index.cjs';
import { ShieldedAccessControlPrivateState } from '../witnesses/ShieldedAccessControlWitnesses.js';
import { ShieldedAccessControlSimulator } from './simulators/ShieldedAccessControlSimulator.js';
import * as utils from './utils/address.js';

// PKs
const [ADMIN, Z_ADMIN] = utils.generateEitherPubKeyPair('ADMIN');
const [UNAUTHORIZED, Z_UNAUTHORIZED] =
  utils.generateEitherPubKeyPair('UNAUTHORIZED');
const [CUSTOM_ADMIN, Z_CUSTOM_ADMIN] =
  utils.generateEitherPubKeyPair('CUSTOM_ADMIN');
const [OPERATOR_1, Z_OPERATOR_1] = utils.generateEitherPubKeyPair('OPERATOR_1');
const [OPERATOR_2, Z_OPERATOR_2] = utils.generateEitherPubKeyPair('OPERATOR_2');
const [OPERATOR_3, Z_OPERATOR_3] = utils.generateEitherPubKeyPair('OPERATOR_3');
const [OPERATOR_CONTRACT, Z_OPERATOR_CONTRACT] = utils.generateEitherPubKeyPair(
  'OPERATOR_CONTRACT',
  false,
);
const Z_OPERATOR_LIST = [Z_OPERATOR_1, Z_OPERATOR_2, Z_OPERATOR_3];

// Constants
const BAD_NONCE = Buffer.alloc(32, 'BAD_NONCE');
const DOMAIN = new Uint8Array(32);
new TextEncoder().encodeInto('ShieldedAccessControl:shield:', DOMAIN);
const INIT_COUNTER = 0n;

const EMPTY_ROOT = { field: 0n };

// Roles
const DEFAULT_ADMIN_ROLE = utils.zeroUint8Array();
const OPERATOR_ROLE_1 = convert_bigint_to_Uint8Array(32, 1n);
const OPERATOR_ROLE_2 = convert_bigint_to_Uint8Array(32, 2n);
const OPERATOR_ROLE_3 = convert_bigint_to_Uint8Array(32, 3n);
const CUSTOM_ADMIN_ROLE = convert_bigint_to_Uint8Array(32, 4n);
const UNINITIALIZED_ROLE = convert_bigint_to_Uint8Array(32, 5n);
const OPERATOR_ROLE_LIST = [OPERATOR_ROLE_1, OPERATOR_ROLE_2, OPERATOR_ROLE_3];

// Role to string
const DEFAULT_ADMIN_ROLE_TO_STRING =
  Buffer.from(DEFAULT_ADMIN_ROLE).toString('hex');

const ADMIN_SECRET_NONCE = Buffer.alloc(32, 'ADMIN_SECRET_NONCE');
const OPERATOR_ROLE_1_SECRET_NONCE = Buffer.alloc(
  32,
  'OPERATOR_ROLE_1_SECRET_NONCE',
);
const OPERATOR_ROLE_2_SECRET_NONCE = Buffer.alloc(
  32,
  'OPERATOR_ROLE_2_SECRET_NONCE',
);
const OPERATOR_ROLE_3_SECRET_NONCE = Buffer.alloc(
  32,
  'OPERATOR_ROLE_3_SECRET_NONCE',
);
const OPERATOR_ROLE_SECRET_NONCES = [
  OPERATOR_ROLE_1_SECRET_NONCE,
  OPERATOR_ROLE_2_SECRET_NONCE,
  OPERATOR_ROLE_3_SECRET_NONCE,
];
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

  const commitment = persistentHash(rt_type, [
    roleId,
    bAccount,
    nonce,
    bIndex,
    DOMAIN,
  ]);

  return commitment;
};

const EXP_DEFAULT_ADMIN_COMMITMENT = buildCommitment(
  DEFAULT_ADMIN_ROLE,
  Z_ADMIN,
  ADMIN_SECRET_NONCE,
  INIT_COUNTER,
);

function RETURN_BAD_INDEX(
  context: WitnessContext<Ledger, ShieldedAccessControlPrivateState>,
  roleId: Uint8Array,
): [ShieldedAccessControlPrivateState, bigint] {
  return [context.privateState, 1023n];
}

function RETURN_BAD_PATH(
  context: WitnessContext<Ledger, ShieldedAccessControlPrivateState>,
  roleCommitment: Uint8Array,
): [ShieldedAccessControlPrivateState, MerkleTreePath<Uint8Array>] {
  const defaultPath: MerkleTreePath<Uint8Array> = {
    leaf: new Uint8Array(32),
    path: Array.from({ length: 10 }, () => ({
      sibling: { field: 0n },
      goes_left: false,
    })),
  };
  return [context.privateState, defaultPath];
}

type RoleAndNonce = {
  roleId: string;
  nonce: Buffer;
};

describe('ShieldedAccessControl', () => {
  beforeEach(() => {
    // Create private state object and generate nonce
    const PS = ShieldedAccessControlPrivateState.withRoleAndNonce(
      Z_ADMIN,
      Buffer.from(DEFAULT_ADMIN_ROLE),
      ADMIN_SECRET_NONCE,
    );
    // Init contract for user with PS
    shieldedAccessControl = new ShieldedAccessControlSimulator(Z_ADMIN, {
      privateState: PS,
    });
  });

  describe('checked circuits should fail for authorized caller with invalid witness values', () => {
    beforeEach(() => {
      shieldedAccessControl._grantRole(DEFAULT_ADMIN_ROLE, Z_ADMIN);
      shieldedAccessControl.callerCtx.setCaller(ADMIN);
    });

    type FailingCircuits = [
      method: keyof ShieldedAccessControlSimulator,
      isValidNonce: boolean,
      isValidIndex: boolean,
      isValidPath: boolean,
      args: unknown[],
    ];
    const checkedCircuits: FailingCircuits[] = [
      ['assertOnlyRole', false, true, true, [DEFAULT_ADMIN_ROLE]],
      ['assertOnlyRole', true, false, true, [DEFAULT_ADMIN_ROLE]],
      ['assertOnlyRole', true, true, false, [DEFAULT_ADMIN_ROLE]],
      ['assertOnlyRole', false, false, true, [DEFAULT_ADMIN_ROLE]],
      ['assertOnlyRole', true, false, false, [DEFAULT_ADMIN_ROLE]],
      ['assertOnlyRole', false, true, false, [DEFAULT_ADMIN_ROLE]],
      ['assertOnlyRole', false, false, false, [DEFAULT_ADMIN_ROLE]],
      ['grantRole', false, true, true, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['grantRole', true, false, true, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['grantRole', true, true, false, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['grantRole', false, false, true, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['grantRole', true, false, false, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['grantRole', false, true, false, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['grantRole', false, false, false, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['revokeRole', false, true, true, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['revokeRole', true, false, true, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['revokeRole', true, true, false, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['revokeRole', false, false, true, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['revokeRole', true, false, false, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['revokeRole', false, true, false, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['revokeRole', false, false, false, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
    ];

    it.each(checkedCircuits)(
      '%s should fail with isValidNonce(%s), isValidIndex(%s), isValidPath(%s)',
      (circuitName, isValidNonce, isValidIndex, isValidPath, args) => {
        if (isValidNonce) {
          // Check nonce matches
          expect(
            shieldedAccessControl.privateState.getCurrentSecretNonce(
              DEFAULT_ADMIN_ROLE,
            ),
          ).toEqual(ADMIN_SECRET_NONCE);
        } else {
          // Check nonce does not match
          shieldedAccessControl.privateState.injectSecretNonce(
            DEFAULT_ADMIN_ROLE,
            BAD_NONCE,
          );
          expect(
            shieldedAccessControl.privateState.getCurrentSecretNonce(
              DEFAULT_ADMIN_ROLE,
            ),
          ).not.toEqual(ADMIN_SECRET_NONCE);
        }

        if (isValidIndex) {
          // Check index matches
          const [, witnessCalculatedIndex] =
            shieldedAccessControl.witnesses.wit_getRoleIndex(
              shieldedAccessControl.getWitnessContext(),
              DEFAULT_ADMIN_ROLE,
              Z_ADMIN
            );
          expect(witnessCalculatedIndex).toBe(INIT_COUNTER);
        } else {
          // Check index does not match
          shieldedAccessControl.overrideWitness(
            'wit_getRoleIndex',
            RETURN_BAD_INDEX,
          );
          const [, witnessCalculatedIndex] =
            shieldedAccessControl.witnesses.wit_getRoleIndex(
              shieldedAccessControl.getWitnessContext(),
              DEFAULT_ADMIN_ROLE,
              Z_ADMIN
            );
          expect(witnessCalculatedIndex).not.toBe(INIT_COUNTER);
        }

        if (isValidPath) {
          // Check path matches
          const truePath = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.findPathForLeaf(
              EXP_DEFAULT_ADMIN_COMMITMENT,
            );
          const [, witnessCalculatedPath] =
            shieldedAccessControl.witnesses.wit_getRoleCommitmentPath(
              shieldedAccessControl.getWitnessContext(),
              EXP_DEFAULT_ADMIN_COMMITMENT,
            );
          expect(witnessCalculatedPath).toEqual(truePath);
        } else {
          // Check path does not match
          const truePath = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.findPathForLeaf(
              EXP_DEFAULT_ADMIN_COMMITMENT,
            );
          shieldedAccessControl.overrideWitness(
            'wit_getRoleCommitmentPath',
            RETURN_BAD_PATH,
          );
          const [, witnessCalculatedPath] =
            shieldedAccessControl.witnesses.wit_getRoleIndex(
              shieldedAccessControl.getWitnessContext(),
              DEFAULT_ADMIN_ROLE,
              Z_ADMIN
            );
          expect(witnessCalculatedPath).not.toEqual(truePath);
        }

        // Test protected circuit
        expect(() => {
          (
            shieldedAccessControl[circuitName] as (
              ...args: unknown[]
            ) => unknown
          )(...args);
        }).toThrow('ShieldedAccessControl: unauthorized account');
      },
    );
  });

  describe('checked circuits should fail for unauthorized caller with any witness value', () => {
    beforeEach(() => {
      shieldedAccessControl._grantRole(DEFAULT_ADMIN_ROLE, Z_ADMIN);
      shieldedAccessControl.callerCtx.setCaller(UNAUTHORIZED);
    });

    type FailingCircuits = [
      method: keyof ShieldedAccessControlSimulator,
      isValidNonce: boolean,
      isValidIndex: boolean,
      isValidPath: boolean,
      args: unknown[],
    ];
    const checkedCircuits: FailingCircuits[] = [
      ['assertOnlyRole', false, true, true, [DEFAULT_ADMIN_ROLE]],
      ['assertOnlyRole', true, false, true, [DEFAULT_ADMIN_ROLE]],
      ['assertOnlyRole', true, true, false, [DEFAULT_ADMIN_ROLE]],
      ['assertOnlyRole', false, false, true, [DEFAULT_ADMIN_ROLE]],
      ['assertOnlyRole', true, false, false, [DEFAULT_ADMIN_ROLE]],
      ['assertOnlyRole', false, true, false, [DEFAULT_ADMIN_ROLE]],
      ['assertOnlyRole', false, false, false, [DEFAULT_ADMIN_ROLE]],
      ['assertOnlyRole', true, true, true, [DEFAULT_ADMIN_ROLE]],
      ['grantRole', false, true, true, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['grantRole', true, false, true, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['grantRole', true, true, false, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['grantRole', false, false, true, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['grantRole', true, false, false, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['grantRole', false, true, false, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['grantRole', false, false, false, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['grantRole', true, true, true, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['revokeRole', false, true, true, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['revokeRole', true, false, true, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['revokeRole', true, true, false, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['revokeRole', false, false, true, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['revokeRole', true, false, false, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['revokeRole', false, true, false, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['revokeRole', false, false, false, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      ['revokeRole', true, true, true, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
    ];

    it.each(checkedCircuits)(
      '%s should fail with isValidNonce(%s), isValidIndex(%s), isValidPath(%s)',
      (circuitName, isValidNonce, isValidIndex, isValidPath, args) => {
        if (isValidNonce) {
          // Check nonce matches
          expect(
            shieldedAccessControl.privateState.getCurrentSecretNonce(
              DEFAULT_ADMIN_ROLE,
            ),
          ).toEqual(ADMIN_SECRET_NONCE);
        } else {
          // Check nonce does not match
          shieldedAccessControl.privateState.injectSecretNonce(
            DEFAULT_ADMIN_ROLE,
            BAD_NONCE,
          );
          expect(
            shieldedAccessControl.privateState.getCurrentSecretNonce(
              DEFAULT_ADMIN_ROLE,
            ),
          ).not.toEqual(ADMIN_SECRET_NONCE);
        }

        if (isValidIndex) {
          // Check index matches
          const [, witnessCalculatedIndex] =
            shieldedAccessControl.witnesses.wit_getRoleIndex(
              shieldedAccessControl.getWitnessContext(),
              DEFAULT_ADMIN_ROLE,
              Z_ADMIN
            );
          expect(witnessCalculatedIndex).toBe(INIT_COUNTER);
        } else {
          // Check index does not match
          shieldedAccessControl.overrideWitness(
            'wit_getRoleIndex',
            RETURN_BAD_INDEX,
          );
          const [, witnessCalculatedIndex] =
            shieldedAccessControl.witnesses.wit_getRoleIndex(
              shieldedAccessControl.getWitnessContext(),
              DEFAULT_ADMIN_ROLE,
              Z_ADMIN
            );
          expect(witnessCalculatedIndex).not.toBe(INIT_COUNTER);
        }

        if (isValidPath) {
          // Check path matches
          const truePath = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.findPathForLeaf(
              EXP_DEFAULT_ADMIN_COMMITMENT,
            );
          const [, witnessCalculatedPath] =
            shieldedAccessControl.witnesses.wit_getRoleCommitmentPath(
              shieldedAccessControl.getWitnessContext(),
              EXP_DEFAULT_ADMIN_COMMITMENT,
            );
          expect(witnessCalculatedPath).toEqual(truePath);
        } else {
          // Check path does not match
          const truePath = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.findPathForLeaf(
              EXP_DEFAULT_ADMIN_COMMITMENT,
            );
          shieldedAccessControl.overrideWitness(
            'wit_getRoleCommitmentPath',
            RETURN_BAD_PATH,
          );
          const [, witnessCalculatedPath] =
            shieldedAccessControl.witnesses.wit_getRoleIndex(
              shieldedAccessControl.getWitnessContext(),
              DEFAULT_ADMIN_ROLE,
              Z_ADMIN
            );
          expect(witnessCalculatedPath).not.toEqual(truePath);
        }

        // Test protected circuit
        expect(() => {
          (
            shieldedAccessControl[circuitName] as (
              ...args: unknown[]
            ) => unknown
          )(...args);
        }).toThrow('ShieldedAccessControl: unauthorized account');
      },
    );
  });

  describe('unsupported contract address failure cases', () => {
    beforeEach(() => {
      shieldedAccessControl._grantRole(DEFAULT_ADMIN_ROLE, Z_ADMIN);
      shieldedAccessControl.callerCtx.setCaller(ADMIN);
    });

    type FailingCircuits = [
      method: keyof ShieldedAccessControlSimulator,
      args: unknown[],
    ];
    const circuitsWithContractAddressCheck: FailingCircuits[] = [
      ['hasRole', [DEFAULT_ADMIN_ROLE, Z_OPERATOR_CONTRACT]],
      ['_checkRole', [DEFAULT_ADMIN_ROLE, Z_OPERATOR_CONTRACT]],
      ['grantRole', [DEFAULT_ADMIN_ROLE, Z_OPERATOR_CONTRACT]],
      ['revokeRole', [DEFAULT_ADMIN_ROLE, Z_OPERATOR_CONTRACT]],
      ['_grantRole', [DEFAULT_ADMIN_ROLE, Z_OPERATOR_CONTRACT]],
      ['_revokeRole', [DEFAULT_ADMIN_ROLE, Z_OPERATOR_CONTRACT]],
    ];

    it.each(circuitsWithContractAddressCheck)(
      '%s fails if contract address is queried',
      (circuitName, args) => {
        // Test protected circuit
        expect(() => {
          (
            shieldedAccessControl[circuitName] as (
              ...args: unknown[]
            ) => unknown
          )(...args);
        }).toThrow(
          'ShieldedAccessControl: contract address roles are not yet supported',
        );
      },
    );
  });

  describe('hasRole', () => {
    beforeEach(() => {
      shieldedAccessControl._grantRole(DEFAULT_ADMIN_ROLE, Z_ADMIN);
    });

    type HasRoleTest = [
      isValidNonce: boolean,
      isValidIndex: boolean,
      isValidPath: boolean,
      args: unknown[],
    ];
    const falseCases: HasRoleTest[] = [
      [false, true, true, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      [true, false, true, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      [true, true, false, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      [false, false, true, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      [true, false, false, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      [false, true, false, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      [false, false, false, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
    ];

    const commitmentDoesNotMatchCases: HasRoleTest[] = [
      [false, true, true, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      [true, false, true, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      [false, false, true, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      [true, false, false, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      [false, true, false, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
      [false, false, false, [DEFAULT_ADMIN_ROLE, Z_ADMIN]],
    ];

    it('should throw if caller is contract address', () => {
      shieldedAccessControl.callerCtx.setCaller(OPERATOR_CONTRACT);
      expect(() => {
        shieldedAccessControl.hasRole(UNINITIALIZED_ROLE, Z_OPERATOR_CONTRACT);
      }).toThrow(
        'ShieldedAccessControl: contract address roles are not yet supported',
      );
    });

    it('should return correct role commitment', () => {
      const expCommitment = buildCommitment(
        DEFAULT_ADMIN_ROLE,
        Z_ADMIN,
        ADMIN_SECRET_NONCE,
        INIT_COUNTER,
      );

      const role = shieldedAccessControl.hasRole(DEFAULT_ADMIN_ROLE, Z_ADMIN);
      expect(role.roleCommitment).toEqual(expCommitment);
    });

    it('should return true when admin has role', () => {
      const role = shieldedAccessControl.hasRole(DEFAULT_ADMIN_ROLE, Z_ADMIN);
      expect(role.isApproved).toEqual(true);
    });

    it('should return false when unauthorized does not have role', () => {
      const role = shieldedAccessControl.hasRole(
        DEFAULT_ADMIN_ROLE,
        Z_UNAUTHORIZED,
      );
      expect(role.isApproved).toEqual(false);
    });

    it('should return false when role does not exist', () => {
      shieldedAccessControl.privateState.injectSecretNonce(
        UNINITIALIZED_ROLE,
        Buffer.alloc(32),
      );
      const role = shieldedAccessControl.hasRole(
        UNINITIALIZED_ROLE,
        Z_UNAUTHORIZED,
      );
      expect(role.isApproved).toBe(false);
    });

    it.each(falseCases)(
      'should return false with any invalid witness value - isValidNonce(%s), isValidIndex(%s), isValidPath(%s)',
      (isValidNonce, isValidIndex, isValidPath, args) => {
        if (isValidNonce) {
          // Check nonce matches
          expect(
            shieldedAccessControl.privateState.getCurrentSecretNonce(
              DEFAULT_ADMIN_ROLE,
            ),
          ).toEqual(ADMIN_SECRET_NONCE);
        } else {
          // Check nonce does not match
          shieldedAccessControl.privateState.injectSecretNonce(
            DEFAULT_ADMIN_ROLE,
            BAD_NONCE,
          );
          expect(
            shieldedAccessControl.privateState.getCurrentSecretNonce(
              DEFAULT_ADMIN_ROLE,
            ),
          ).not.toEqual(ADMIN_SECRET_NONCE);
        }

        if (isValidIndex) {
          // Check index matches
          const [, witnessCalculatedIndex] =
            shieldedAccessControl.witnesses.wit_getRoleIndex(
              shieldedAccessControl.getWitnessContext(),
              DEFAULT_ADMIN_ROLE,
              Z_ADMIN
            );
          expect(witnessCalculatedIndex).toBe(INIT_COUNTER);
        } else {
          // Check index does not match
          shieldedAccessControl.overrideWitness(
            'wit_getRoleIndex',
            RETURN_BAD_INDEX,
          );
          const [, witnessCalculatedIndex] =
            shieldedAccessControl.witnesses.wit_getRoleIndex(
              shieldedAccessControl.getWitnessContext(),
              DEFAULT_ADMIN_ROLE,
              Z_ADMIN
            );
          expect(witnessCalculatedIndex).not.toBe(INIT_COUNTER);
        }

        if (isValidPath) {
          // Check path matches
          const truePath = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.findPathForLeaf(
              EXP_DEFAULT_ADMIN_COMMITMENT,
            );
          const [, witnessCalculatedPath] =
            shieldedAccessControl.witnesses.wit_getRoleCommitmentPath(
              shieldedAccessControl.getWitnessContext(),
              EXP_DEFAULT_ADMIN_COMMITMENT,
            );
          expect(witnessCalculatedPath).toEqual(truePath);
        } else {
          // Check path does not match
          const truePath = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.findPathForLeaf(
              EXP_DEFAULT_ADMIN_COMMITMENT,
            );
          shieldedAccessControl.overrideWitness(
            'wit_getRoleCommitmentPath',
            RETURN_BAD_PATH,
          );
          const [, witnessCalculatedPath] =
            shieldedAccessControl.witnesses.wit_getRoleIndex(
              shieldedAccessControl.getWitnessContext(),
              DEFAULT_ADMIN_ROLE,
              Z_ADMIN
            );
          expect(witnessCalculatedPath).not.toEqual(truePath);
        }

        // Test false case circuit
        const role = (
          shieldedAccessControl['hasRole'] as (...args: unknown[]) => Role
        )(...args);
        expect(role.isApproved).toBe(false);
      },
    );

    it.each(commitmentDoesNotMatchCases)(
      'commitment should not match with invalid nonce or index - isValidNonce(%s), isValidIndex(%s), isValidPath(%s)',
      (isValidNonce, isValidIndex, isValidPath, args) => {
        if (isValidNonce) {
          // Check nonce matches
          expect(
            shieldedAccessControl.privateState.getCurrentSecretNonce(
              DEFAULT_ADMIN_ROLE,
            ),
          ).toEqual(ADMIN_SECRET_NONCE);
        } else {
          // Check nonce does not match
          shieldedAccessControl.privateState.injectSecretNonce(
            DEFAULT_ADMIN_ROLE,
            BAD_NONCE,
          );
          expect(
            shieldedAccessControl.privateState.getCurrentSecretNonce(
              DEFAULT_ADMIN_ROLE,
            ),
          ).not.toEqual(ADMIN_SECRET_NONCE);
        }

        if (isValidIndex) {
          // Check index matches
          const [, witnessCalculatedIndex] =
            shieldedAccessControl.witnesses.wit_getRoleIndex(
              shieldedAccessControl.getWitnessContext(),
              DEFAULT_ADMIN_ROLE,
              Z_ADMIN
            );
          expect(witnessCalculatedIndex).toBe(INIT_COUNTER);
        } else {
          // Check index does not match
          shieldedAccessControl.overrideWitness(
            'wit_getRoleIndex',
            RETURN_BAD_INDEX,
          );
          const [, witnessCalculatedIndex] =
            shieldedAccessControl.witnesses.wit_getRoleIndex(
              shieldedAccessControl.getWitnessContext(),
              DEFAULT_ADMIN_ROLE,
              Z_ADMIN
            );
          expect(witnessCalculatedIndex).not.toBe(INIT_COUNTER);
        }

        if (isValidPath) {
          // Check path matches
          const truePath = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.findPathForLeaf(
              EXP_DEFAULT_ADMIN_COMMITMENT,
            );
          const [, witnessCalculatedPath] =
            shieldedAccessControl.witnesses.wit_getRoleCommitmentPath(
              shieldedAccessControl.getWitnessContext(),
              EXP_DEFAULT_ADMIN_COMMITMENT,
            );
          expect(witnessCalculatedPath).toEqual(truePath);
        } else {
          // Check path does not match
          const truePath = shieldedAccessControl
            .getPublicState()
            .ShieldedAccessControl__operatorRoles.findPathForLeaf(
              EXP_DEFAULT_ADMIN_COMMITMENT,
            );
          shieldedAccessControl.overrideWitness(
            'wit_getRoleCommitmentPath',
            RETURN_BAD_PATH,
          );
          const [, witnessCalculatedPath] =
            shieldedAccessControl.witnesses.wit_getRoleIndex(
              shieldedAccessControl.getWitnessContext(),
              DEFAULT_ADMIN_ROLE,
              Z_ADMIN
            );
          expect(witnessCalculatedPath).not.toEqual(truePath);
        }

        // Test false case circuit
        const role = (
          shieldedAccessControl['hasRole'] as (...args: unknown[]) => Role
        )(...args);
        expect(role.roleCommitment).not.toEqual(EXP_DEFAULT_ADMIN_COMMITMENT);
      },
    );
  });

  describe('assertOnlyRole', () => {
    beforeEach(() => {
      shieldedAccessControl._grantRole(DEFAULT_ADMIN_ROLE, Z_ADMIN);
      shieldedAccessControl.callerCtx.setCaller(ADMIN);
    });

    it('should not fail when authorized caller has correct nonce, index, and path', () => {
      // Check nonce is correct
      expect(
        shieldedAccessControl.privateState.getCurrentSecretNonce(
          DEFAULT_ADMIN_ROLE,
        ),
      ).toBe(ADMIN_SECRET_NONCE);

      // Check index matches
      const [, witnessCalculatedIndex] =
        shieldedAccessControl.witnesses.wit_getRoleIndex(
          shieldedAccessControl.getWitnessContext(),
          DEFAULT_ADMIN_ROLE,
          Z_ADMIN
        );
      expect(witnessCalculatedIndex).toBe(INIT_COUNTER);

      // Check path matches
      const truePath = shieldedAccessControl
        .getPublicState()
        .ShieldedAccessControl__operatorRoles.findPathForLeaf(
          EXP_DEFAULT_ADMIN_COMMITMENT,
        );
      const [, witnessCalculatedPath] =
        shieldedAccessControl.witnesses.wit_getRoleCommitmentPath(
          shieldedAccessControl.getWitnessContext(),
          EXP_DEFAULT_ADMIN_COMMITMENT,
        );
      expect(witnessCalculatedPath).toEqual(truePath);

      expect(() =>
        shieldedAccessControl.assertOnlyRole(DEFAULT_ADMIN_ROLE),
      ).not.toThrow();
    });

    it('should not fail for admin with multiple roles', () => {
      shieldedAccessControl.privateState.injectSecretNonce(
        OPERATOR_ROLE_1,
        OPERATOR_ROLE_1_SECRET_NONCE,
      );
      shieldedAccessControl.privateState.injectSecretNonce(
        OPERATOR_ROLE_2,
        OPERATOR_ROLE_2_SECRET_NONCE,
      );
      shieldedAccessControl.privateState.injectSecretNonce(
        OPERATOR_ROLE_3,
        OPERATOR_ROLE_3_SECRET_NONCE,
      );
      shieldedAccessControl._grantRole(OPERATOR_ROLE_1, Z_ADMIN);
      shieldedAccessControl._grantRole(OPERATOR_ROLE_2, Z_ADMIN);
      shieldedAccessControl._grantRole(OPERATOR_ROLE_3, Z_ADMIN);
      expect(() => {
        shieldedAccessControl.assertOnlyRole(DEFAULT_ADMIN_ROLE);
        shieldedAccessControl.assertOnlyRole(OPERATOR_ROLE_1);
        shieldedAccessControl.assertOnlyRole(OPERATOR_ROLE_2);
        shieldedAccessControl.assertOnlyRole(OPERATOR_ROLE_3);
      }).not.toThrow();
    });
  });

  describe('_checkRole', () => {
    beforeEach(() => {
      shieldedAccessControl._grantRole(DEFAULT_ADMIN_ROLE, Z_ADMIN);
      shieldedAccessControl.callerCtx.setCaller(ADMIN);
    });

    it('should not throw if admin has role', () => {
      expect(() =>
        shieldedAccessControl._checkRole(DEFAULT_ADMIN_ROLE, Z_ADMIN),
      ).not.toThrow();
    });

    it('should throw if unauthorized does not have role', () => {
      expect(() =>
        shieldedAccessControl._checkRole(DEFAULT_ADMIN_ROLE, Z_UNAUTHORIZED),
      ).toThrow('ShieldedAccessControl: unauthorized account');
    });
  });

  describe('getRoleAdmin', () => {
    it('should return default admin role if admin role not set', () => {
      expect(shieldedAccessControl.getRoleAdmin(OPERATOR_ROLE_1)).toEqual(
        DEFAULT_ADMIN_ROLE,
      );
    });

    it('should return custom admin role if set', () => {
      shieldedAccessControl._setRoleAdmin(OPERATOR_ROLE_1, CUSTOM_ADMIN_ROLE);
      expect(shieldedAccessControl.getRoleAdmin(OPERATOR_ROLE_1)).toEqual(
        CUSTOM_ADMIN_ROLE,
      );
    });
  });

  describe('grantRole', () => {
    beforeEach(() => {
      shieldedAccessControl._grantRole(DEFAULT_ADMIN_ROLE, Z_ADMIN);
      shieldedAccessControl.callerCtx.setCaller(ADMIN);
    });

    it('admin should grant role', () => {
      shieldedAccessControl.privateState.injectSecretNonce(
        OPERATOR_ROLE_1,
        OPERATOR_ROLE_1_SECRET_NONCE,
      );
      shieldedAccessControl.grantRole(OPERATOR_ROLE_1, Z_OPERATOR_1);
      const role: Role = shieldedAccessControl.hasRole(
        OPERATOR_ROLE_1,
        Z_OPERATOR_1,
      );
      expect(role.isApproved).toBe(true);
    });

    it('path for role should exist in Merkle tree', () => {
      expect(
        shieldedAccessControl
          .getPublicState()
          .ShieldedAccessControl__operatorRoles.findPathForLeaf(
            EXP_DEFAULT_ADMIN_COMMITMENT,
          ),
      ).toBeDefined();
    });

    it('should update Merkle tree root', () => {
      expect(
        shieldedAccessControl
          .getPublicState()
          .ShieldedAccessControl__operatorRoles.root().field,
      ).toBeGreaterThan(0n);
    });

    it('_currentMerkleTreeIndex should increment', () => {
      // Starts at 1 because we grant role to self in beforeEach
      expect(
        shieldedAccessControl.getPublicState()
          .ShieldedAccessControl__currentMerkleTreeIndex,
      ).toBe(1n);

      shieldedAccessControl.privateState.injectSecretNonce(
        OPERATOR_ROLE_1,
        OPERATOR_ROLE_1_SECRET_NONCE,
      );
      shieldedAccessControl.privateState.injectSecretNonce(
        OPERATOR_ROLE_2,
        OPERATOR_ROLE_2_SECRET_NONCE,
      );
      shieldedAccessControl.privateState.injectSecretNonce(
        OPERATOR_ROLE_3,
        OPERATOR_ROLE_3_SECRET_NONCE,
      );

      shieldedAccessControl.grantRole(OPERATOR_ROLE_1, Z_OPERATOR_1);
      expect(
        shieldedAccessControl.getPublicState()
          .ShieldedAccessControl__currentMerkleTreeIndex,
      ).toBe(2n);

      shieldedAccessControl.grantRole(OPERATOR_ROLE_2, Z_OPERATOR_2);
      expect(
        shieldedAccessControl.getPublicState()
          .ShieldedAccessControl__currentMerkleTreeIndex,
      ).toBe(3n);

      shieldedAccessControl.grantRole(OPERATOR_ROLE_3, Z_OPERATOR_3);
      expect(
        shieldedAccessControl.getPublicState()
          .ShieldedAccessControl__currentMerkleTreeIndex,
      ).toBe(4n);
    });

    it('admin should grant multiple roles', () => {
      for (let i = 0; i < OPERATOR_ROLE_LIST.length; i++) {
        shieldedAccessControl.privateState.injectSecretNonce(
          OPERATOR_ROLE_LIST[i],
          OPERATOR_ROLE_SECRET_NONCES[i],
        );
        for (let j = 0; j < Z_OPERATOR_LIST.length; j++) {
          shieldedAccessControl.grantRole(
            OPERATOR_ROLE_LIST[i],
            Z_OPERATOR_LIST[j],
          );
          const role: Role = shieldedAccessControl.hasRole(
            OPERATOR_ROLE_LIST[i],
            Z_OPERATOR_LIST[j],
          );
          expect(role.isApproved).toBe(true);


          expect(
            shieldedAccessControl
              .getPublicState()
              .ShieldedAccessControl__operatorRoles.findPathForLeaf(
                EXP_DEFAULT_ADMIN_COMMITMENT,
              ),
          ).toBeDefined();
        }
      }
    });

    it('should throw if non-admin operator grants role', () => {
      shieldedAccessControl.privateState.injectSecretNonce(
        OPERATOR_ROLE_1,
        OPERATOR_ROLE_1_SECRET_NONCE,
      );
      shieldedAccessControl._grantRole(OPERATOR_ROLE_1, Z_OPERATOR_1);

      shieldedAccessControl.callerCtx.setCaller(OPERATOR_1);
      expect(() => {
        shieldedAccessControl.grantRole(OPERATOR_ROLE_1, Z_UNAUTHORIZED);
      }).toThrow('ShieldedAccessControl: unauthorized account');
    });
  });

  describe.only('revokeRole', () => {
    beforeEach(() => {
      console.log("TEST - Current MT Index", shieldedAccessControl.getPublicState().ShieldedAccessControl__currentMerkleTreeIndex.toString());
      shieldedAccessControl._grantRole(DEFAULT_ADMIN_ROLE, Z_ADMIN);
      console.log("TEST - Current MT Index", shieldedAccessControl.getPublicState().ShieldedAccessControl__currentMerkleTreeIndex.toString());
      shieldedAccessControl.privateState.injectSecretNonce(
        OPERATOR_ROLE_1,
        OPERATOR_ROLE_1_SECRET_NONCE,
      );
      shieldedAccessControl._grantRole(OPERATOR_ROLE_1, Z_OPERATOR_1);
      console.log("TEST - Current MT Index", shieldedAccessControl.getPublicState().ShieldedAccessControl__currentMerkleTreeIndex.toString());
      shieldedAccessControl.callerCtx.setCaller(ADMIN);
    });

    it('admin should revoke role', () => {
      expect(shieldedAccessControl.hasRole(OPERATOR_ROLE_1, Z_OPERATOR_1).isApproved).toBe(true);
      shieldedAccessControl.revokeRole(OPERATOR_ROLE_1, Z_OPERATOR_1);
      expect(shieldedAccessControl.hasRole(OPERATOR_ROLE_1, Z_OPERATOR_1).isApproved).toBe(false);
    });

    it.only('commitment should be in nullifier set', () => {
      console.log("TEST - Current MT Index", shieldedAccessControl.getPublicState().ShieldedAccessControl__currentMerkleTreeIndex.toString());
      const [, opRoleIndex] = shieldedAccessControl.witnesses.wit_getRoleIndex(shieldedAccessControl.getWitnessContext(), OPERATOR_ROLE_1, Z_OPERATOR_1);
      const [, adminRoleIndex] = shieldedAccessControl.witnesses.wit_getRoleIndex(shieldedAccessControl.getWitnessContext(), DEFAULT_ADMIN_ROLE, Z_ADMIN);
      console.log("OPERATOR INDEX ", opRoleIndex.toString(10));
      console.log("ADMIN INDEX ", adminRoleIndex.toString(10));
      const expCommitmentOp = buildCommitment(OPERATOR_ROLE_1, Z_OPERATOR_1, OPERATOR_ROLE_1_SECRET_NONCE, opRoleIndex);
      const pathToOp = shieldedAccessControl.getPublicState().ShieldedAccessControl__operatorRoles.findPathForLeaf(expCommitmentOp);
      const pathToAdmin = shieldedAccessControl.getPublicState().ShieldedAccessControl__operatorRoles.findPathForLeaf(EXP_DEFAULT_ADMIN_COMMITMENT);
      //console.log("PATH TO OP ", pathToOp);
      //console.log("PATH TO ADMIN ", pathToAdmin);

      //console.log("EXPECTED COMMITMENT ", expCommitmentOp);
      const contractCommit = shieldedAccessControl.hasRole(OPERATOR_ROLE_1, Z_OPERATOR_1).roleCommitment;
      //console.log("CONTRACT COMMITMENT ", contractCommit);

      shieldedAccessControl.revokeRole(OPERATOR_ROLE_1, Z_OPERATOR_1);
      expect(shieldedAccessControl.getPublicState().ShieldedAccessControl__roleCommitmentNullifiers.isEmpty()).toBe(false);
      expect(shieldedAccessControl.getPublicState().ShieldedAccessControl__roleCommitmentNullifiers.member(expCommitmentOp)).toBe(true);
    });

    it('admin should revoke multiple roles', () => {
      const expCommitment = buildCommitment(OPERATOR_ROLE_1, Z_OPERATOR_1, OPERATOR_ROLE_1_SECRET_NONCE, 1n);
      shieldedAccessControl.revokeRole(OPERATOR_ROLE_1, Z_OPERATOR_1);
      expect(shieldedAccessControl.getPublicState().ShieldedAccessControl__roleCommitmentNullifiers.member(expCommitment)).toBe(true);

      for (let i = 1; i < OPERATOR_ROLE_LIST.length; i++) {
        shieldedAccessControl.privateState.injectSecretNonce(
          OPERATOR_ROLE_LIST[i],
          OPERATOR_ROLE_SECRET_NONCES[i],
        );
        for (let j = 1; j < Z_OPERATOR_LIST.length; j++) {
          shieldedAccessControl._grantRole(
            OPERATOR_ROLE_LIST[i],
            Z_OPERATOR_LIST[j],
          );
          const expCommitment = buildCommitment(OPERATOR_ROLE_LIST[i], Z_OPERATOR_LIST[j], OPERATOR_ROLE_SECRET_NONCES[i], BigInt(1 + i));
          shieldedAccessControl.revokeRole(OPERATOR_ROLE_LIST[i], Z_OPERATOR_LIST[j]);
          expect(shieldedAccessControl.getPublicState().ShieldedAccessControl__roleCommitmentNullifiers.member(expCommitment)).toBe(true);
        }
      }
    });

    it('should throw if non-admin operator revokes role', () => {
      shieldedAccessControl.privateState.injectSecretNonce(
        OPERATOR_ROLE_1,
        OPERATOR_ROLE_1_SECRET_NONCE,
      );
      shieldedAccessControl._grantRole(OPERATOR_ROLE_1, Z_OPERATOR_1);

      shieldedAccessControl.callerCtx.setCaller(OPERATOR_1);
      expect(() => {
        shieldedAccessControl.revokeRole(OPERATOR_ROLE_1, Z_UNAUTHORIZED);
      }).toThrow('ShieldedAccessControl: unauthorized account');
    });
  });
});
