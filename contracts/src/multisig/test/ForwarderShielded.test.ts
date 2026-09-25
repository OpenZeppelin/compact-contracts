import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import {
  encodeShieldedCoinInfo,
  GENESIS_NATIVE_SHIELDED_TOKEN_COLORS,
} from '#test-utils/fixtures/nativeShieldedToken.js';
import { shieldedTestKey } from '#test-utils/fixtures/shieldedKey.js';
import type {
  ShieldedCoinInfo,
  ShieldedSendResult,
} from '../../../artifacts/MockForwarderShielded/contract/index.js';
import { MockForwarderShieldedSimulator } from './simulators/MockForwarderShieldedSimulator.js';

// The constructor takes the narrow, supported arm only: a `ZswapCoinPublicKey`.
// A contract-address parent is intentionally not expressible today — an atomic
// forward to a non-participating contract is rejected on-chain (the output is
// never claimed). The `_parent` ledger field stays a generic `Either` so a
// future CMA circuit upgrade can add contract support without a state
// migration; `initialize` stores the supported arm (`left`), which is what
// `getParent` reads back.

// Alice (depositor) is the deployer, the default caller on live.
const ALICE = 'deployer';
const ALICE_KEY = shieldedTestKey(ALICE).left;
// Bob (parent) is a pooled wallet. Live: Alice encrypts the forwarded coin to
// Bob's encryption key, which the harness maps from Bob's coin key
// (`WalletPool.encryptionKeysByCoinKey`).
const BOB = 'SIGNER1';
const BOB_KEY = shieldedTestKey(BOB).left;
// Carol (parent) is outside the wallet pool, so Alice has no encryption key
// for Carol.
const CAROL_KEY = utils.encodeToPK('CAROL');
const SHIELDED_ZERO = utils.ZERO_KEY.left;

// Shielded colors: genesis-funded (`0x00…01`, `0x00…02`) so a live forward has
// funds to draw; `fill(1)` would be unfunded on live.
const SHIELDED_COLOR =
  GENESIS_NATIVE_SHIELDED_TOKEN_COLORS.nativeShieldedToken1;
// Only the round-trip test forwards this color to Bob.
const ROUND_TRIP_COLOR =
  GENESIS_NATIVE_SHIELDED_TOKEN_COLORS.nativeShieldedToken2;
const AMOUNT = 1000n;

// Live gets a fresh random nonce per run (the node persists nullifiers); dry
// uses zero for reproducibility.
function makeCoin(color: Uint8Array, value: bigint, nonce?: Uint8Array) {
  return encodeShieldedCoinInfo(color, value, nonce);
}

// The parent gets the whole coin under a new nonce, and no change is left.
function expectForwarded(result: ShieldedSendResult, coin: ShieldedCoinInfo) {
  expect(result).toStrictEqual({
    change: {
      is_some: false,
      value: {
        nonce: new Uint8Array(32),
        color: new Uint8Array(32),
        value: 0n,
      },
    },
    sent: {
      nonce: expect.any(Uint8Array),
      color: coin.color,
      value: coin.value,
    },
  });
  expect(result.sent.nonce).not.toEqual(coin.nonce);
}

describe('ForwarderShielded module', () => {
  describe('initialization', () => {
    it('initializes with Bob (parent) when isInit is true', async () => {
      await MockForwarderShieldedSimulator.create(BOB_KEY, true);
    });

    it('fails initialization with a zero parent', async () => {
      await expect(
        MockForwarderShieldedSimulator.create(SHIELDED_ZERO, true),
      ).rejects.toThrow('ForwarderShielded: zero parent');
    });

    it('stores Bob (parent) in the left arm', async () => {
      const bobForwarderShielded = await MockForwarderShieldedSimulator.create(
        BOB_KEY,
        true,
      );
      const parent = await bobForwarderShielded.getParent();
      expect(parent.is_left).toBe(true);
      expect(parent.left).toEqual(BOB_KEY);
    });
  });

  describe('init guard', () => {
    it('rejects a deposit by Alice (depositor) before initialization', async () => {
      const bobForwarderShielded = await MockForwarderShieldedSimulator.create(
        BOB_KEY,
        false,
      );
      await expect(
        bobForwarderShielded
          .as(ALICE)
          .deposit(makeCoin(SHIELDED_COLOR, AMOUNT)),
      ).rejects.toThrow('ForwarderShielded: contract not initialized');
    });

    it('rejects a second initialization naming Alice, keeping Bob (parent)', async () => {
      const bobForwarderShielded = await MockForwarderShieldedSimulator.create(
        BOB_KEY,
        true,
      );
      await expect(
        bobForwarderShielded.as(ALICE).initialize(ALICE_KEY),
      ).rejects.toThrow('ForwarderShielded: contract already initialized');
      const parent = await bobForwarderShielded.getParent();
      expect(parent.left).toEqual(BOB_KEY);
    });
  });

  describe('deposit', () => {
    it('forwards a whole deposit by Alice (depositor) to Alice (parent)', async () => {
      const aliceForwarderShielded =
        await MockForwarderShieldedSimulator.create(ALICE_KEY, true);
      const coin = makeCoin(SHIELDED_COLOR, AMOUNT);
      expectForwarded(
        await aliceForwarderShielded.as(ALICE).deposit(coin),
        coin,
      );
    });

    it('forwards a whole deposit by Alice (depositor) to Bob (parent)', async () => {
      const bobForwarderShielded = await MockForwarderShieldedSimulator.create(
        BOB_KEY,
        true,
      );
      const coin = makeCoin(SHIELDED_COLOR, AMOUNT);
      expectForwarded(await bobForwarderShielded.as(ALICE).deposit(coin), coin);
    });

    it('forwards a zero-value deposit by Alice (depositor) to Bob (parent)', async () => {
      const bobForwarderShielded = await MockForwarderShieldedSimulator.create(
        BOB_KEY,
        true,
      );
      const coin = makeCoin(SHIELDED_COLOR, 0n);
      expectForwarded(await bobForwarderShielded.as(ALICE).deposit(coin), coin);
    });

    it('forwards two deposits by Alice (depositor) to Bob (parent) through one forwarder', async () => {
      const bobForwarderShielded = await MockForwarderShieldedSimulator.create(
        BOB_KEY,
        true,
      );
      const first = makeCoin(SHIELDED_COLOR, AMOUNT);
      // A distinct dry nonce, so dry does not deposit the same coin twice.
      const second = makeCoin(
        SHIELDED_COLOR,
        AMOUNT,
        new Uint8Array(32).fill(1),
      );
      expectForwarded(
        await bobForwarderShielded.as(ALICE).deposit(first),
        first,
      );
      expectForwarded(
        await bobForwarderShielded.as(ALICE).deposit(second),
        second,
      );
    });

    it('lets Bob (parent) spend all of a coin Alice (depositor) forwarded', async () => {
      const bobForwarderShielded = await MockForwarderShieldedSimulator.create(
        BOB_KEY,
        true,
      );
      await bobForwarderShielded
        .as(ALICE)
        .deposit(makeCoin(ROUND_TRIP_COLOR, AMOUNT));

      // Bob (depositor) deposits into a forwarder for Alice (parent). On live
      // Bob's only coin of this color is the forwarded one, so spending AMOUNT
      // of it proves all of it arrived.
      const aliceForwarderShielded =
        await MockForwarderShieldedSimulator.create(ALICE_KEY, true);
      await aliceForwarderShielded
        .as(BOB)
        .deposit(makeCoin(ROUND_TRIP_COLOR, AMOUNT));
    });

    // Live only: the dry backend encrypts nothing.
    it.runIf(isLiveBackend())(
      'refuses a deposit by Alice (depositor) to Carol (parent) with no encryption key for Carol',
      async () => {
        const carolForwarderShielded =
          await MockForwarderShieldedSimulator.create(CAROL_KEY, true);
        await expect(
          carolForwarderShielded
            .as(ALICE)
            .deposit(makeCoin(SHIELDED_COLOR, AMOUNT)),
        ).rejects.toThrow('Unable to resolve encryption public key');
      },
    );
  });
});
