import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
  type WitnessContext,
} from '@midnight-ntwrk/compact-runtime';

/**
 * Caller identity for the witness-based access modules.
 *
 * Authorization is proved by the secret key a caller injects through its
 * `wit_*SK` witness, not by the wallet that submits the tx. So an "alias" here
 * is a private state, and every alias of one deployment can share the single
 * funded deployer wallet.
 */

/** The private state every module in the TestToken mock reads its identity from. */
export type TestTokenPrivateState = { secretKey: Uint8Array };

/** The three `wit_*SK` witnesses the composed modules declare. */
export interface TestTokenWitnesses<L> {
  wit_AccessControlSK(
    context: WitnessContext<L, TestTokenPrivateState>,
  ): [TestTokenPrivateState, Uint8Array];
  wit_OwnableSK(
    context: WitnessContext<L, TestTokenPrivateState>,
  ): [TestTokenPrivateState, Uint8Array];
  wit_FungibleTokenSK(
    context: WitnessContext<L, TestTokenPrivateState>,
  ): [TestTokenPrivateState, Uint8Array];
}

/**
 * All three witnesses answer with the same key, so one alias is one identity
 * across AccessControl, Ownable and FungibleToken.
 */
export const testTokenWitnesses = <L>(): TestTokenWitnesses<L> => {
  const sk = (context: WitnessContext<L, TestTokenPrivateState>) =>
    [context.privateState, Uint8Array.from(context.privateState.secretKey)] as [
      TestTokenPrivateState,
      Uint8Array,
    ];
  return {
    wit_AccessControlSK: sk,
    wit_OwnableSK: sk,
    wit_FungibleTokenSK: sk,
  };
};

/** The aliases the CMA specs call as. */
export const ALIASES = ['deployer', 'ADMIN', 'ALICE', 'BOB'] as const;
export type Alias = (typeof ALIASES)[number];

/** A deterministic 32-byte secret key for `alias`. Stable across runs. */
export function secretKeyFor(alias: string): Uint8Array {
  const sk = new Uint8Array(32);
  sk.set(new TextEncoder().encode(alias).slice(0, 32));
  return sk;
}

/**
 * The account identifier `alias` presents on chain, mirroring the modules'
 * `Utils_computeAccountId`. The one place the derivation is written down.
 */
export function accountIdFor(alias: string): Uint8Array {
  return persistentHash(new CompactTypeVector(1, new CompactTypeBytes(32)), [
    secretKeyFor(alias),
  ]);
}

const ZERO_BYTES = new Uint8Array(32);

/** `alias` as the account-id arm of the modules' `Either`. */
export function eitherFor(alias: string) {
  return {
    is_left: true,
    left: accountIdFor(alias),
    right: { bytes: ZERO_BYTES },
  };
}

/** A stable, unique `ContractAddress` arm derived from `label`. Nothing is deployed there. */
export function eitherContractAddress(label: string) {
  const bytes = new Uint8Array(32);
  const seed = new TextEncoder().encode(label);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = seed[i % seed.length] ?? 0;
  }
  return { is_left: false, left: ZERO_BYTES, right: { bytes } };
}

/** `AccessControl.DEFAULT_ADMIN_ROLE` — zero bytes. */
export const DEFAULT_ADMIN_ROLE = ZERO_BYTES;
