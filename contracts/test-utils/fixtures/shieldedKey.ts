// Compact's byte-encoded recipient representation (the one the compiled circuits
// accept) — distinct from the runtime `Recipient`, whose fields are
// `type`/`string`. `EncodedRecipient` is exactly
// `Either<ZswapCoinPublicKey, ContractAddress>`.
import {
  type EncodedRecipient,
  encodeCoinPublicKey,
} from '@midnight-ntwrk/compact-runtime';
import {
  createEitherTestUser,
  eitherUserFromCoinPublicKey,
  encodeToPK,
} from './address.js';

/**
 * Backend-aware shielded recipient/signer-key fixtures, so one spec runs
 * unchanged on both `MIDNIGHT_BACKEND=dry` and `=live`. The live keys are
 * threaded in WITHOUT importing the live harness (which pulls in testkit /
 * midnight-js): each key arrives through a `MIDNIGHT_*_COIN_PK` env var the
 * harness publishes once the wallet has synced. So a dry spec importing this
 * stays lean. See {@link nativeShieldedToken} for the matching coin fixtures.
 */

/**
 * The recipient for a shielded send in a spec that runs on both backends. On
 * live it must be a key whose encryption key the node can resolve, so it is the
 * deployer wallet's own coin public key — published by the live harness as
 * `MIDNIGHT_DEPLOYER_COIN_PK` once the wallet has synced. Call this AFTER
 * `Sim.create()` (e.g. in `beforeEach`), since that is what triggers the sync.
 * On dry a fabricated key works, so `label` is hashed into a synthetic recipient.
 *
 * @param label Distinguishes synthetic recipients on the dry backend.
 */
export const shieldedTestRecipient = (
  label = 'RECIPIENT',
): EncodedRecipient => {
  const deployerPk = process.env.MIDNIGHT_DEPLOYER_COIN_PK;
  return deployerPk
    ? eitherUserFromCoinPublicKey(deployerPk)
    : createEitherTestUser(label);
};

/**
 * A bare `ZswapCoinPublicKey` for a spec that targets a coin public key directly
 * (not an `Either`) — e.g. a private forwarder's drain parent. Like
 * {@link shieldedTestRecipient}, on live it is the deployer wallet's own key
 * (whose encryption key the node can resolve; a fabricated key has none) and on
 * dry a synthetic key. The deployer key is published by the live setup before
 * any spec loads, so this is safe to read at module scope.
 *
 * @param label Distinguishes synthetic keys on the dry backend.
 */
export const shieldedTestParentKey = (
  label = 'PARENT',
): { bytes: Uint8Array } => {
  const deployerPk = process.env.MIDNIGHT_DEPLOYER_COIN_PK;
  return deployerPk
    ? { bytes: encodeCoinPublicKey(deployerPk) }
    : encodeToPK(label);
};

/**
 * The `Either<ZswapCoinPublicKey, ContractAddress>` for a named signer alias, for
 * specs that register a multisig signer set. On live it resolves to the pooled
 * wallet's own coin public key — published by the harness as
 * `MIDNIGHT_<ALIAS>_COIN_PK` — so `.as(alias)` submits from that wallet and the
 * circuit's `ownPublicKey()` matches this key. On dry it is the deterministic
 * synthetic key `createEitherTestUser(alias)`, which is exactly what the dry
 * backend resolves `.as(alias)` to. Read at module scope: the keys are published
 * by the live setup before any spec loads.
 *
 * @param alias The signer alias (e.g. `SIGNER1`); must be a pooled wallet on live.
 */
export const shieldedTestSigner = (alias: string): EncodedRecipient => {
  const pk = process.env[`MIDNIGHT_${alias}_COIN_PK`];
  return pk ? eitherUserFromCoinPublicKey(pk) : createEitherTestUser(alias);
};
