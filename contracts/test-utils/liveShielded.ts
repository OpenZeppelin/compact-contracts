import { randomBytes } from 'node:crypto';
// Compact's byte-encoded coin/recipient representations (the ones the compiled
// circuits accept) — distinct from the runtime `ShieldedCoinInfo`/`Recipient`,
// whose fields are `type`/`string`. `EncodedRecipient` is exactly
// `Either<ZswapCoinPublicKey, ContractAddress>`.
import {
  type EncodedRecipient,
  type EncodedShieldedCoinInfo,
  encodeCoinPublicKey,
} from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import {
  createEitherTestUser,
  eitherUserFromCoinPublicKey,
  encodeToPK,
} from './address.js';

/**
 * Shared, backend-aware fixtures for shielded-coin specs, so one test file runs
 * unchanged on both `MIDNIGHT_BACKEND=dry` and `=live`.
 *
 * The live-only pieces are threaded in WITHOUT importing the live harness (which
 * pulls in testkit / midnight-js): the deployer key arrives through the
 * `MIDNIGHT_DEPLOYER_COIN_PK` env var the harness publishes, and the backend is
 * read via the simulator's `isLiveBackend()`. So importing this from a dry spec
 * stays lean.
 */

/**
 * A shielded token type the dev-preset genesis mints to every deployer wallet
 * (seeds `0x..0001`–`0x..0004`): colors `0x..01` and `0x..02` carry ~5e13 each,
 * and `0x..00` is the native shielded token. On the live backend `_deposit` /
 * `_send` can only fund a color the wallet actually holds, so specs must build
 * coins with these — `new Uint8Array(32).fill(1)` (`0x0101..01`) is a different,
 * unfunded type. On dry the color value is arbitrary, so the same spec passes.
 *
 * @param lastByte The final byte of the 32-byte type (`1` → `0x..01`).
 */
export const genesisShieldedColor = (lastByte: number): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes[31] = lastByte;
  return bytes;
};

/**
 * The canonical set of shielded token types the dev-preset genesis actually funds
 * on every deployer wallet (seeds `0x..0001`–`0x..0004`). These are the only
 * colors a live `_deposit` / `_send` can draw on — any other color is unfunded
 * and reverts — so specs pick from here instead of guessing a `lastByte`. Prefer
 * a `shieldedCoin*` type for value transfers; `tNight` is the native token.
 */
export const GENESIS_SHIELDED_COLORS = {
  /** Native shielded token (tNight), `0x..00`. */
  tNight: genesisShieldedColor(0),
  /** Funded shielded token carrying ~5e13, `0x..01`. */
  shieldedCoin1: genesisShieldedColor(1),
  /** Funded shielded token carrying ~5e13, `0x..02`. */
  shieldedCoin2: genesisShieldedColor(2),
} as const;

/**
 * Builds a `ShieldedCoinInfo` for a spec that runs on both backends. On live,
 * every coin gets a unique random nonce per run: the local node persists
 * nullifiers across runs, so a fixed nonce would replay an already-spent coin
 * (`Custom error: 103`) and mask real failures. On dry the nonce is
 * deterministic (the passed `nonce`, else zero) so assertions stay reproducible.
 */
export const makeShieldedCoin = (
  color: Uint8Array,
  value: bigint,
  nonce?: Uint8Array,
): EncodedShieldedCoinInfo => ({
  nonce: isLiveBackend()
    ? Uint8Array.from(randomBytes(32))
    : (nonce ?? new Uint8Array(32).fill(0)),
  color,
  value,
});

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
