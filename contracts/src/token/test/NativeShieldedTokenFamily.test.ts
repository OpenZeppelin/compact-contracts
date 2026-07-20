import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import { encodeShieldedCoinInfo } from '#test-utils/fixtures/nativeShieldedToken.js';
import { shieldedTestRecipient } from '#test-utils/fixtures/shieldedKey.js';
import {
  NativeShieldedTokenFamilySimulator,
  type NativeShieldedTokenFamilySimulator as Sim,
} from './simulators/NativeShieldedTokenFamilySimulator.js';

const b32 = (label: string): Uint8Array => {
  const u = new Uint8Array(32);
  u.set(new TextEncoder().encode(label).slice(0, 32));
  return u;
};

const RECIPIENT = utils.createEitherTestUser('RECIPIENT');
const REFUND_TO = utils.createEitherTestUser('REFUND_TO');
const { ZERO_KEY, ZERO_ADDRESS } = utils;

const NAME = 'Family Token';
const SYMBOL = 'FAM';
const DECIMALS = 6n;
const DOMAIN_A = b32('domain-A');
const DOMAIN_B = b32('domain-B');
const INIT = true;
const BAD_INIT = false;
const AMOUNT = 1_000n;

const deploy = (init = INIT): Promise<NativeShieldedTokenFamilySimulator> =>
  NativeShieldedTokenFamilySimulator.create(NAME, SYMBOL, DECIMALS, init);

let token: NativeShieldedTokenFamilySimulator;

// Resolved once in `beforeAll` after the first `create()`: on live the harness
// then publishes MIDNIGHT_DEPLOYER_COIN_PK, so this is the deployer wallet's own
// coin public key (an encryption key the node can resolve as a mint recipient /
// refund target); on dry it is the synthetic `createEitherTestUser('RECIPIENT')`,
// identical to the un-gated tests' `RECIPIENT`.
let Z_RECIPIENT: ReturnType<typeof shieldedTestRecipient>;

// A backend-aware mint nonce, delegated to the shared coin builder: on live every
// coin gets a fresh random nonce (the local node persists nullifiers/commitments
// across runs, so a fixed nonce would replay a spent coin — Custom error 103); on
// dry it is the passed seed (else zero) so `coin.nonce` assertions stay reproducible.
const mintNonce = (seed?: Uint8Array): Uint8Array =>
  encodeShieldedCoinInfo(new Uint8Array(32), 0n, seed).nonce;

describe('NativeShieldedTokenFamily (Family profile)', () => {
  // Resolve the shared recipient once: on live it needs a prior `create()` (which
  // triggers the wallet sync that publishes the deployer key); on dry it is
  // synthetic. Mutating groups still deploy a fresh token per test in `beforeEach`.
  beforeAll(async () => {
    token = await deploy(INIT);
    Z_RECIPIENT = shieldedTestRecipient();
  });

  describe('initialization', () => {
    beforeEach(async () => {
      token = await deploy(INIT);
    });

    it('should expose the family metadata', async () => {
      expect(await token.name()).toEqual(NAME);
      expect(await token.symbol()).toEqual(SYMBOL);
      expect(await token.decimals()).toEqual(DECIMALS);
      expect(await token.isInitialized()).toBe(true);
    });
  });

  describe('before initialization', () => {
    beforeEach(async () => {
      token = await deploy(BAD_INIT);
    });

    it('should report not initialized', async () => {
      expect(await token.isInitialized()).toBe(false);
    });

    type FailingCircuit = [method: keyof Sim, args: unknown[]];
    const circuitsToFail: FailingCircuit[] = [
      ['name', []],
      ['symbol', []],
      ['decimals', []],
      ['tokenColor', [DOMAIN_A]],
      ['_mint', [DOMAIN_A, RECIPIENT, AMOUNT, b32('n')]],
      [
        '_burn',
        [
          DOMAIN_A,
          { nonce: b32('cn'), color: b32('c'), value: AMOUNT },
          AMOUNT,
          REFUND_TO,
        ],
      ],
      [
        '_burnFromSelf',
        [
          DOMAIN_A,
          { nonce: b32('cn'), color: b32('c'), value: AMOUNT, mt_index: 0n },
          AMOUNT,
        ],
      ],
    ];

    it.each(circuitsToFail)(
      'should revert %s before initialize',
      async (method, args) => {
        await expect(
          (token[method] as (...a: unknown[]) => Promise<unknown>)(...args),
        ).rejects.toThrow('NativeShieldedToken: contract not initialized');
      },
    );
  });

  describe('_mint (per domain)', () => {
    beforeEach(async () => {
      token = await deploy(INIT);
    });

    // `_mint` creates a NEW coin (`mintShieldedToken`, no input coin to receive),
    // so it runs on both backends: recipient → the node-resolvable `Z_RECIPIENT`,
    // nonce → a backend-aware value captured locally (a fixed nonce would replay a
    // prior run's commitment on live). The mint echoes the nonce back, so assert
    // against the one we passed, never a hardcoded value.
    it('should return a coin with color = tokenColor(domain), value, nonce', async () => {
      const nonce = mintNonce(b32('m-a'));
      const coin = await token._mint(DOMAIN_A, Z_RECIPIENT, AMOUNT, nonce);
      expect(coin.value).toBe(AMOUNT);
      expect(coin.nonce).toEqual(nonce);
      expect(coin.color).toEqual(await token.tokenColor(DOMAIN_A));
    });

    it('should revert on a zero recipient', async () => {
      await expect(
        token._mint(DOMAIN_A, ZERO_KEY, AMOUNT, b32('z')),
      ).rejects.toThrow('NativeShieldedToken: invalid recipient');
      await expect(
        token._mint(DOMAIN_A, ZERO_ADDRESS, AMOUNT, b32('z')),
      ).rejects.toThrow('NativeShieldedToken: invalid recipient');
    });
  });

  describe('multi-domain isolation', () => {
    beforeEach(async () => {
      token = await deploy(INIT);
    });

    it('should give distinct colors to distinct domains', async () => {
      expect(await token.tokenColor(DOMAIN_A)).not.toEqual(
        await token.tokenColor(DOMAIN_B),
      );
    });

    it('should reject burning a domain-A coin under domain B (wrong color)', async () => {
      const colorA = await token.tokenColor(DOMAIN_A);
      await expect(
        token._burn(
          DOMAIN_B,
          { nonce: b32('c'), color: colorA, value: AMOUNT },
          AMOUNT,
          REFUND_TO,
        ),
      ).rejects.toThrow('NativeShieldedToken: wrong token');
    });
  });

  describe('_burn (per domain)', () => {
    let colorA: Uint8Array;
    beforeEach(async () => {
      token = await deploy(INIT);
      colorA = await token.tokenColor(DOMAIN_A);
    });

    const coinOf = (value: bigint, c: Uint8Array = colorA) => ({
      nonce: b32('coin'),
      color: c,
      value,
    });

    // Reverts assert-and-throw on the guards BEFORE the coin is received/spent, so
    // the fabricated coin never reaches Zswap — valid on both backends, un-gated.
    it('should revert when amount > coin.value', async () => {
      await expect(
        token._burn(DOMAIN_A, coinOf(AMOUNT), AMOUNT + 1n, REFUND_TO),
      ).rejects.toThrow('NativeShieldedToken: insufficient coin value');
    });

    it('should revert on a zero refundTo', async () => {
      await expect(
        token._burn(DOMAIN_A, coinOf(AMOUNT), 1n, ZERO_KEY),
      ).rejects.toThrow('NativeShieldedToken: invalid refund target');
    });

    // The happy path actually receives and spends the coin. A fabricated coin has
    // no on-chain existence on live (`receiveShielded`/`sendImmediateShielded`
    // reverts), so split like ShieldedTreasury: keep the fabricated-coin assertions
    // as dry coverage, and mint→burn a real coin on live.
    describe.skipIf(isLiveBackend())('happy path (dry only)', () => {
      it('should return none on a full burn and some(refund) on a partial burn', async () => {
        expect(
          (await token._burn(DOMAIN_A, coinOf(AMOUNT), AMOUNT, REFUND_TO))
            .is_some,
        ).toBe(false);
        const partial = await token._burn(
          DOMAIN_A,
          coinOf(AMOUNT),
          600n,
          REFUND_TO,
        );
        expect(partial.is_some).toBe(true);
        expect(partial.value.value).toBe(AMOUNT - 600n);
      });
    });

    describe.runIf(isLiveBackend())('happy path on live', () => {
      it('should return none on a full burn and some(refund) on a partial burn', async () => {
        // LIVE: `_burn` receives a same-tx coin and spends it via
        // `sendImmediateShielded`. The coin's color is this contract's
        // `tokenColor(DOMAIN_A)` (contract-derived, NOT a genesis color), so it
        // must come from a prior `_mint` this run — a fabricated coin can't be
        // received. `refundTo` receives the partial-burn change, so it must be
        // node-resolvable (`Z_RECIPIENT`). Confirm against a node that the minted
        // coin is spendable in the burn tx (the wallet paying it into the contract).
        const fullCoin = await token._mint(
          DOMAIN_A,
          Z_RECIPIENT,
          AMOUNT,
          mintNonce(),
        );
        expect(
          (await token._burn(DOMAIN_A, fullCoin, AMOUNT, Z_RECIPIENT)).is_some,
        ).toBe(false);

        const partialCoin = await token._mint(
          DOMAIN_A,
          Z_RECIPIENT,
          AMOUNT,
          mintNonce(),
        );
        const partial = await token._burn(
          DOMAIN_A,
          partialCoin,
          600n,
          Z_RECIPIENT,
        );
        expect(partial.is_some).toBe(true);
        expect(partial.value.value).toBe(AMOUNT - 600n);
      });
    });
  });

  describe('_burnFromSelf (per domain)', () => {
    let colorA: Uint8Array;
    beforeEach(async () => {
      token = await deploy(INIT);
      colorA = await token.tokenColor(DOMAIN_A);
    });

    const qCoinOf = (value: bigint, c: Uint8Array = colorA) => ({
      nonce: b32('qcoin'),
      color: c,
      value,
      mt_index: 0n,
    });

    // Wrong-color revert asserts BEFORE the `sendShielded` spend, so the fabricated
    // coin never reaches Zswap — valid on both backends, un-gated.
    it('should reject a wrong-color coin', async () => {
      await expect(
        token._burnFromSelf(DOMAIN_A, qCoinOf(AMOUNT, b32('wrong')), AMOUNT),
      ).rejects.toThrow('NativeShieldedToken: wrong token');
    });

    // The happy path spends a coin the contract already holds. On live that means
    // a real Merkle-tree entry with a valid `mt_index`; a fabricated one reverts.
    // Split like ShieldedTreasury: keep the fabricated-coin assertions as dry
    // coverage, and mint→capture→burn on live.
    describe.skipIf(isLiveBackend())('happy path (dry only)', () => {
      it('should return change on a partial burn and none on a full burn', async () => {
        expect(
          (await token._burnFromSelf(DOMAIN_A, qCoinOf(AMOUNT), 600n)).is_some,
        ).toBe(true);
        expect(
          (await token._burnFromSelf(DOMAIN_A, qCoinOf(AMOUNT), AMOUNT))
            .is_some,
        ).toBe(false);
      });
    });

    describe.runIf(isLiveBackend())('happy path on live', () => {
      it('should return change on a partial burn and none on a full burn', async () => {
        // LIVE: `_burnFromSelf` spends a coin the CONTRACT already holds (a
        // Merkle-tree entry with a valid `mt_index`). Such a coin must be minted to
        // this contract and its `mt_index` recovered from the global zswap
        // ledger-events stream (ShieldedCoinTracker) once the mint finalizes — it
        // cannot be known from the spec alone. The `mt_index: 0n` below is a
        // placeholder; wire the real index in when running against a node.
        const partialCoin = await token._mint(
          DOMAIN_A,
          Z_RECIPIENT,
          AMOUNT,
          mintNonce(),
        );
        expect(
          (
            await token._burnFromSelf(
              DOMAIN_A,
              { ...partialCoin, mt_index: 0n },
              600n,
            )
          ).is_some,
        ).toBe(true);

        const fullCoin = await token._mint(
          DOMAIN_A,
          Z_RECIPIENT,
          AMOUNT,
          mintNonce(),
        );
        expect(
          (
            await token._burnFromSelf(
              DOMAIN_A,
              { ...fullCoin, mt_index: 0n },
              AMOUNT,
            )
          ).is_some,
        ).toBe(false);
      });
    });
  });
});
