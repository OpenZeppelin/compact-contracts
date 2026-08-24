import { randomBytes } from 'node:crypto';
// Compact's byte-encoded coin representation (the one the compiled circuits
// accept) — distinct from the runtime `ShieldedCoinInfo`, whose fields are
// `type`/`string`.
import type { EncodedShieldedCoinInfo } from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';

/**
 * Backend-aware native-shielded-token fixtures, so one spec runs unchanged on
 * both `MIDNIGHT_BACKEND=dry` and `=live`. The backend is read via the
 * simulator's `isLiveBackend()` (no live-harness import), so a dry spec importing
 * this stays lean. Terminology follows MIP-0011 (Native Shielded Token Standard):
 * a token's identifier is its `tokenColor` (`tokenType(domain, contractAddress)`).
 * Exports keep the `NativeShieldedToken` prefix so a future unshielded analog can
 * add parallel `NativeUnshieldedToken*` fixtures without name clashes.
 * See {@link shieldedKey} for the matching recipient-key fixtures.
 */

/**
 * A shielded token color the dev-preset genesis mints to every deployer wallet
 * (seeds `0x..0001`–`0x..0004`): colors `0x..01` and `0x..02` each carry ~5e13.
 * On the live backend `_deposit` / `_send` can only fund a color the wallet
 * actually holds, so specs must build coins with these — `new Uint8Array(32).fill(1)`
 * (`0x0101..01`) is a different, unfunded color. On dry the color is arbitrary, so
 * the same spec passes.
 *
 * @param lastByte The final byte of the 32-byte color (`1` → `0x..01`).
 */
export const genesisNativeShieldedTokenColor = (
  lastByte: number,
): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes[31] = lastByte;
  return bytes;
};

/**
 * The canonical set of shielded token colors the dev-preset genesis actually funds
 * on every deployer wallet (seeds `0x..0001`–`0x..0004`). These are the only
 * colors a live `_deposit` / `_send` can draw on — any other color is unfunded
 * and reverts — so specs pick from here instead of guessing a `lastByte`.
 */
export const GENESIS_NATIVE_SHIELDED_TOKEN_COLORS = {
  /** Funded shielded token color carrying ~5e13, `0x..01`. */
  nativeShieldedToken1: genesisNativeShieldedTokenColor(1),
  /** Funded shielded token color carrying ~5e13, `0x..02`. */
  nativeShieldedToken2: genesisNativeShieldedTokenColor(2),
} as const;

/**
 * Builds an `EncodedShieldedCoinInfo` for a spec that runs on both backends. On live,
 * every coin gets a unique random nonce per run: the local node persists
 * nullifiers across runs, so a fixed nonce would replay an already-spent coin
 * (`Custom error: 103`) and mask real failures. On dry the nonce is
 * deterministic (the passed `nonce`, else zero) so assertions stay reproducible.
 */
export const encodeShieldedCoinInfo = (
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
