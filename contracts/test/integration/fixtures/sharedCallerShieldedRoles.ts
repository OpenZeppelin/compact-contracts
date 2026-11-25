import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import { padTag } from '#test-utils/fixtures/elgamal.js';
import {
  type ContractAddress,
  type Either,
  type Ledger,
  ledger,
  Contract as SharedCallerShieldedRoles,
} from '../../../artifacts/integration/SharedCallerShieldedRoles/contract/index.js';
import {
  ShieldedAccessControlPrivateState,
  ShieldedAccessControlWitnesses,
} from '../../../src/access/test/witnesses/ShieldedAccessControlWitnesses.js';

/**
 * Integration fixture for `test/integration/_mocks/SharedCallerShieldedRoles`:
 * FungibleToken and ShieldedAccessControl driven by one caller, each holder
 * with a secret blinding factor.
 *
 * The spec helpers (test users, salts, `actAs`) and the observer scan
 * `findRoleHolders` live at the bottom of this file.
 */
type SharedCallerShieldedRolesArgs = readonly [
  name: string,
  symbol: string,
  decimals: bigint,
  callerSalt: Uint8Array,
  instanceSalt: Uint8Array,
  admin: Uint8Array,
];

type Identifier = Either<Uint8Array, ContractAddress>;

const Base = createSimulator<
  ShieldedAccessControlPrivateState,
  Ledger,
  ReturnType<typeof ShieldedAccessControlWitnesses>,
  SharedCallerShieldedRoles<ShieldedAccessControlPrivateState>,
  SharedCallerShieldedRolesArgs
>({
  contractFactory: (witnesses) =>
    new SharedCallerShieldedRoles<ShieldedAccessControlPrivateState>(witnesses),
  defaultPrivateState: () => ShieldedAccessControlPrivateState.generate(),
  contractArgs: (name, symbol, decimals, callerSalt, instanceSalt, admin) => [
    name,
    symbol,
    decimals,
    callerSalt,
    instanceSalt,
    admin,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ShieldedAccessControlWitnesses<Ledger>(),
  artifactName: 'SharedCallerShieldedRoles',
});

export class SharedCallerShieldedRolesSimulator extends Base {
  static async create(
    name: string,
    symbol: string,
    decimals: bigint,
    callerSalt: Uint8Array,
    instanceSalt: Uint8Array,
    admin: Uint8Array,
    options: SimulatorOptions<
      ShieldedAccessControlPrivateState,
      ReturnType<typeof ShieldedAccessControlWitnesses>
    > = {},
  ): Promise<SharedCallerShieldedRolesSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [name, symbol, decimals, callerSalt, instanceSalt, admin],
      options,
    ) as Promise<SharedCallerShieldedRolesSimulator>;
  }

  public grantRole(
    role: Uint8Array,
    accountCommitment: Uint8Array,
  ): Promise<[]> {
    return this.circuits.impure.grantRole(role, accountCommitment);
  }

  public mint(to: Identifier, value: bigint): Promise<[]> {
    return this.circuits.impure.mint(to, value);
  }

  public transfer(to: Identifier, value: bigint): Promise<boolean> {
    return this.circuits.impure.transfer(to, value);
  }
}

// ---------------------------------------------------------------------------
// Observer scan
// ---------------------------------------------------------------------------

const ACCOUNT_DOMAIN = padTag('ShieldedAccessControl:account');
const COMMITMENT_DOMAIN = padTag('ShieldedAccessControl:commitment');
const NULLIFIER_DOMAIN = padTag('ShieldedAccessControl:nullifier');

/** The public ledger fields the observer scan reads. */
export type RoleHolderLedger = Pick<
  Ledger,
  | 'FungibleToken__balances'
  | 'ShieldedAccessControl__instanceSalt'
  | 'ShieldedAccessControl__grantedRoleNullifiers'
  | 'MINTER_ROLE'
>;

/** Mirrors `computeAccountCommitment(account, blinding)`. */
export const accountCommitment = (
  account: Uint8Array,
  blinding: Uint8Array,
): Uint8Array =>
  persistentHash(new CompactTypeVector(3, new CompactTypeBytes(32)), [
    blinding,
    ACCOUNT_DOMAIN,
    account,
  ]);

/** Mirrors `computeNullifier(computeRoleCommitment(role, accountCommitment))`. */
export const roleNullifier = (
  role: Uint8Array,
  commitment: Uint8Array,
  instanceSalt: Uint8Array,
): Uint8Array => {
  const roleCommitment = persistentHash(
    new CompactTypeVector(4, new CompactTypeBytes(32)),
    [role, commitment, instanceSalt, COMMITMENT_DOMAIN],
  );
  return persistentHash(new CompactTypeVector(2, new CompactTypeBytes(32)), [
    roleCommitment,
    NULLIFIER_DOMAIN,
  ]);
};

/**
 * @description The accounts among the token holders that were granted
 * `MINTER_ROLE` under one of `blindings`. Reads nothing but the public ledger
 * it is given and the candidate blindings.
 */
export const findRoleHolders = (
  {
    FungibleToken__balances: balances,
    ShieldedAccessControl__instanceSalt: instanceSalt,
    ShieldedAccessControl__grantedRoleNullifiers: grantedNullifiers,
    MINTER_ROLE: role,
  }: RoleHolderLedger,
  blindings: readonly Uint8Array[],
): Uint8Array[] =>
  [...balances]
    .filter(([account]) => account.is_left)
    .map(([account]) => account.left)
    .filter((account) =>
      blindings.some((blinding) =>
        grantedNullifiers.member(
          roleNullifier(
            role,
            accountCommitment(account, blinding),
            instanceSalt,
          ),
        ),
      ),
    );

// ---------------------------------------------------------------------------
// Spec helpers (specs/shieldedRoleHolderPrivacy)
// ---------------------------------------------------------------------------

export const CALLER_SALT = padTag('CALLER_SALT');
export const INSTANCE_SALT = padTag('INSTANCE_SALT');

/** Mirrors `AuthPrfPseudonym.deriveIdentifier(secretKey, CALLER_SALT).left`. */
const buildAccountId = (secretKey: Uint8Array): Uint8Array =>
  persistentHash(new CompactTypeVector(3, new CompactTypeBytes(32)), [
    padTag('AuthPrfPseudonym:identifier'),
    CALLER_SALT,
    secretKey,
  ]);

export const makeUser = (label: string) => {
  const secretKey = padTag(`${label}_SK`);
  const blinding = padTag(`${label}_BLINDING`);
  const accountId = buildAccountId(secretKey);
  const account: Identifier = {
    is_left: true,
    left: accountId,
    right: { bytes: new Uint8Array(32) },
  };
  return {
    secretKey,
    blinding,
    accountId,
    account,
    accountCommitment: accountCommitment(accountId, blinding),
  };
};

export type TestUser = ReturnType<typeof makeUser>;

// Users
export const ADMIN = makeUser('ADMIN');
export const ALICE = makeUser('ALICE');
export const BOB = makeUser('BOB');

// Token metadata
export const TOKEN_NAME = 'Token';
export const TOKEN_SYMBOL = 'TKN';
export const TOKEN_DECIMALS = 18n;

/** Deploys a fresh contract with ADMIN as the default admin and active user. */
export function deploy(): Promise<SharedCallerShieldedRolesSimulator> {
  return SharedCallerShieldedRolesSimulator.create(
    TOKEN_NAME,
    TOKEN_SYMBOL,
    TOKEN_DECIMALS,
    CALLER_SALT,
    INSTANCE_SALT,
    ADMIN.accountCommitment,
    {
      privateState: ShieldedAccessControlPrivateState.withSecretKey(
        ADMIN.secretKey,
        ADMIN.blinding,
      ),
    },
  );
}

/** Switches the active user's secret key and blinding together. */
export async function actAs(
  sim: SharedCallerShieldedRolesSimulator,
  user: TestUser,
): Promise<void> {
  await sim.updatePrivateState({
    secretKey: user.secretKey,
    blinding: user.blinding,
  });
}
