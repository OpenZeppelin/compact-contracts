import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type Signer,
  sign,
  signerFromLabel,
} from '#test-utils/fixtures/ecdsa.js';
import { shieldedTestKey } from '#test-utils/fixtures/shieldedKey.js';
import type {
  ShieldedCoinInfo,
  ZswapCoinPublicKey,
} from '../../../../artifacts/MockNativeShieldedTokenIssuer1To3/contract/index.js';
import { mintMsgHash } from '../../test/EcdsaTestUtils.js';
import {
  calculateSignerId,
  NativeShieldedTokenIssuer1To3Simulator,
} from './simulators/NativeShieldedTokenIssuer1To3Simulator.js';

const INSTANCE_SALT = new Uint8Array(32).fill(0xaa);
const TOKEN_DOMAIN = new Uint8Array(32);
Buffer.from('smt:token:').copy(TOKEN_DOMAIN);
const TOKEN_NAME = 'MultiSig Token';
const TOKEN_SYMBOL = 'MST';
const TOKEN_DECIMALS = 6n;

const S1 = signerFromLabel('v3-signer-1');
const S2 = signerFromLabel('v3-signer-2');
const S3 = signerFromLabel('v3-signer-3');
const OUTSIDER = signerFromLabel('v3-outsider');

const SIGNER_COMMITMENTS = [S1, S2, S3].map((s) =>
  calculateSignerId(s.publicKey, INSTANCE_SALT),
);

// Resolved after the first deploy: the deployer's own key on live, synthetic
// on dry.
let USER_RECIPIENT: ZswapCoinPublicKey;

let multisig: NativeShieldedTokenIssuer1To3Simulator;

/** Mints, signing the mint digest at the current nonce with each of `signers`. */
async function mint(
  m: NativeShieldedTokenIssuer1To3Simulator,
  amount: bigint,
  recipient: ZswapCoinPublicKey,
  signers: Signer[],
): Promise<ShieldedCoinInfo> {
  const digest = mintMsgHash({
    contractAddress: Uint8Array.from(Buffer.from(m.contractAddress, 'hex')),
    instanceSalt: INSTANCE_SALT,
    recipient: recipient.bytes,
    opNonce: await m.getNonce(),
    amount,
  });
  return m.mint(
    amount,
    recipient,
    signers.map((s) => s.publicKey),
    signers.map((s) => sign(s, digest)),
  );
}

/** Asserts `coin` is a well-formed coin of `m`'s token carrying `amount`. */
async function expectMintedCoin(
  m: NativeShieldedTokenIssuer1To3Simulator,
  coin: ShieldedCoinInfo,
  amount: bigint,
): Promise<void> {
  expect(coin.color).toStrictEqual(await m.tokenColor());
  expect(coin.value).toStrictEqual(amount);
  expect(coin.nonce).toBeInstanceOf(Uint8Array);
  expect(coin.nonce.length).toStrictEqual(32);
}

const freshMultisig = () =>
  NativeShieldedTokenIssuer1To3Simulator.create(
    INSTANCE_SALT,
    TOKEN_DOMAIN,
    TOKEN_NAME,
    TOKEN_SYMBOL,
    TOKEN_DECIMALS,
    SIGNER_COMMITMENTS,
  );

describe('NativeShieldedTokenIssuer 1-of-3', () => {
  beforeAll(async () => {
    multisig = await freshMultisig();
    USER_RECIPIENT = shieldedTestKey().left;
  });

  describe('view', () => {
    it('getThreshold returns 1', async () => {
      expect(await multisig.getThreshold()).toEqual(1n);
    });
  });

  describe('mint', () => {
    beforeEach(async () => {
      multisig = await freshMultisig();
    });

    it.each([
      { label: 'S1', signer: S1 },
      { label: 'S2', signer: S2 },
      { label: 'S3', signer: S3 },
    ])(
      'mints to a user recipient signed by $label alone',
      async ({ signer }) => {
        const coin = await mint(multisig, 100n, USER_RECIPIENT, [signer]);
        await expectMintedCoin(multisig, coin, 100n);
      },
    );

    it('rejects a lone signature from a non-signer', async () => {
      await expect(
        mint(multisig, 100n, USER_RECIPIENT, [OUTSIDER]),
      ).rejects.toThrow('Signer: not a signer');
    });
  });
});
