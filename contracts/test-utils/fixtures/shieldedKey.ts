// Compact's byte-encoded recipient representation (the one the compiled circuits
// accept) — distinct from the runtime `Recipient`, whose fields are
// `type`/`string`. `EncodedRecipient` is exactly
// `Either<ZswapCoinPublicKey, ContractAddress>`; its `.left` is the coin public
// key (`EncodedCoinPublicKey`) that callers needing a bare key read directly.
import type { EncodedRecipient } from '@midnight-ntwrk/compact-runtime';
import {
  createEitherTestUser,
  eitherUserFromCoinPublicKey,
} from './address.js';

/**
 * Backend-aware shielded coin-public-key fixture, so one spec runs unchanged on
 * both `MIDNIGHT_BACKEND=dry` and `=live`. The live keys are threaded in WITHOUT
 * importing the live harness (which pulls in testkit / midnight-js): each key
 * arrives through a `MIDNIGHT_*_COIN_PK` env var the harness publishes once the
 * wallet has synced. So a dry spec importing this stays lean. See
 * {@link nativeShieldedToken} for the matching coin fixtures.
 */

/**
 * The env var carrying a wallet alias's coin public key, mirroring the harness's
 * `coinPkEnv` (`deployer` → `MIDNIGHT_DEPLOYER_COIN_PK`). Inlined so this fixture
 * does not import the harness.
 */
const coinPkEnvVar = (alias: string): string =>
  `MIDNIGHT_${alias === 'deployer' ? 'DEPLOYER' : alias}_COIN_PK`;

/**
 * The `Either<ZswapCoinPublicKey, ContractAddress>` for a shielded identity — a
 * send recipient, a drain parent, or a named multisig signer — that runs on both
 * backends. On live it resolves to the named wallet's own coin public key
 * (published by the harness as `MIDNIGHT_<ALIAS>_COIN_PK`), so `.as(alias)`
 * submits from that wallet and the circuit's `ownPublicKey()` matches it; on dry
 * it is the deterministic synthetic key `createEitherTestUser(alias)`, exactly
 * what the dry backend resolves `.as(alias)` to. Callers needing a bare
 * `EncodedCoinPublicKey` (not an `Either`) read `.left`.
 *
 * The `deployer` default suits a send recipient / drain parent: on live that key
 * must be one whose encryption key the node can resolve, which only the deployer
 * wallet's own key is. With the default, call AFTER `Sim.create()` (which
 * triggers the wallet sync that publishes the deployer key); pooled signer
 * aliases are published before any spec loads, so those are safe at module scope.
 *
 * @param alias `'deployer'` (default) or a pooled signer alias like `'SIGNER1'`;
 *   must be a pooled wallet on live.
 */
export const shieldedTestKey = (alias = 'deployer'): EncodedRecipient => {
  const pk = process.env[coinPkEnvVar(alias)];
  return pk ? eitherUserFromCoinPublicKey(pk) : createEitherTestUser(alias);
};
