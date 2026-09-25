import {
  createSimulator,
  isLiveBackend,
} from '@openzeppelin/compact-simulator';
import { TypedDataEncoder } from 'ethers';
import { beforeEach, describe, expect, it } from 'vitest';
import { sign, signerFromLabel } from '#test-utils/fixtures/ecdsa.js';
import { shieldedTestKey } from '#test-utils/fixtures/shieldedKey.js';
import {
  Contract as Ex,
  ledger,
} from '../../../../artifacts/NativeShieldedTokenIssuerExample/contract/index.js';
import { calculateSignerId } from '../../presets/test/simulators/NativeShieldedTokenIssuerSimulator.js';
import {
  burnFromSelfMsgHash,
  burnMsgHash,
  bytesOf,
  hexOf,
  mintMsgHash,
  mintToSelfMsgHash,
} from '../../test/EcdsaTestUtils.js';
import {
  EmptyPrivateState,
  emptyWitnesses,
} from '../../test/EmptyWitnesses.js';

const INSTANCE_SALT = new Uint8Array(32).fill(7);
const TOKEN_DOMAIN = new Uint8Array(32);
Buffer.from('smt:token:').copy(TOKEN_DOMAIN);
const TOKEN_NAME = 'MultiSig Token';
const TOKEN_SYMBOL = 'MST';
const TOKEN_DECIMALS = 6n;

const S1 = signerFromLabel('ex-signer-1');
const S2 = signerFromLabel('ex-signer-2');
const S3 = signerFromLabel('ex-signer-3');
const COMMITMENTS = [
  calculateSignerId(S1.publicKey, INSTANCE_SALT),
  calculateSignerId(S2.publicKey, INSTANCE_SALT),
  calculateSignerId(S3.publicKey, INSTANCE_SALT),
];

type ExampleArgs = readonly [
  Uint8Array,
  Uint8Array,
  string,
  string,
  bigint,
  Uint8Array[],
];

const ExampleSimulator = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  Ex<EmptyPrivateState>,
  ExampleArgs
>({
  contractFactory: (witnesses) => new Ex<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (
    instanceSalt,
    tokenDomain,
    name,
    symbol,
    decimals,
    signerCommitments,
  ) => [instanceSalt, tokenDomain, name, symbol, decimals, signerCommitments],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'NativeShieldedTokenIssuerExample',
});

describe('NativeShieldedTokenIssuerExample', () => {
  let ex: InstanceType<typeof ExampleSimulator>;

  beforeEach(async () => {
    ex = await ExampleSimulator.create(
      [
        INSTANCE_SALT,
        TOKEN_DOMAIN,
        TOKEN_NAME,
        TOKEN_SYMBOL,
        TOKEN_DECIMALS,
        COMMITMENTS,
      ],
      // The dry default address is zero, which `mintToSelf` rejects.
      isLiveBackend() ? {} : { contractAddress: '5e'.repeat(32) },
    );
  });

  it('reports the signer set the constructor registered', async () => {
    const c = ex.circuits.impure;
    expect(await c.getSignerCount()).toEqual(3n);
    expect(await c.getThreshold()).toEqual(2n);
  });

  it('surfaces the preset state in ledger()', async () => {
    const state = await ex.getPublicState();
    expect(state._counter).toStrictEqual(0n);
    expect(state._domainSeparator).toStrictEqual(
      bytesOf(
        TypedDataEncoder.hashDomain({
          name: 'NativeShieldedTokenIssuer',
          version: '1',
          salt: hexOf(INSTANCE_SALT),
        }),
      ),
    );
    expect(state._derivedNonceCounter).toStrictEqual(0n);
    expect(state._instanceSalt).toStrictEqual(INSTANCE_SALT);
    expect(state._signerCount).toStrictEqual(3n);
    expect(state._threshold).toStrictEqual(2n);
    for (const commitment of COMMITMENTS) {
      expect(state._signers.member(commitment)).toStrictEqual(true);
    }
    expect(state._domain).toStrictEqual(TOKEN_DOMAIN);
    expect(state._name).toStrictEqual(TOKEN_NAME);
    expect(state._symbol).toStrictEqual(TOKEN_SYMBOL);
    expect(state._decimals).toStrictEqual(TOKEN_DECIMALS);
    expect(state._isInitialized).toStrictEqual(true);
  });

  const addrBytes = () =>
    Uint8Array.from(Buffer.from(ex.contractAddress, 'hex'));

  /** Mints `amount` to `recipient` with signers 1 and 2. */
  async function mint(amount: bigint, recipient = shieldedTestKey().left) {
    const c = ex.circuits.impure;
    const digest = mintMsgHash({
      contractAddress: addrBytes(),
      instanceSalt: INSTANCE_SALT,
      recipient: recipient.bytes,
      opNonce: await c.getNonce(),
      amount,
    });
    return c.mint(
      amount,
      recipient,
      [S1.publicKey, S2.publicKey],
      [sign(S1, digest), sign(S2, digest)],
    );
  }

  it('mints with two valid signatures', async () => {
    await mint(100n);
  });

  it('mints to itself through the wrapper', async () => {
    const c = ex.circuits.impure;
    const digest = mintToSelfMsgHash({
      contractAddress: addrBytes(),
      instanceSalt: INSTANCE_SALT,
      opNonce: await c.getNonce(),
      amount: 100n,
    });
    const coin = await c.mintToSelf(
      100n,
      [S1.publicKey, S2.publicKey],
      [sign(S1, digest), sign(S2, digest)],
    );
    expect(coin.value).toStrictEqual(100n);
    expect(coin.color).toStrictEqual(await c.tokenColor());
  });

  it('burns a holder coin through the wrapper', async () => {
    const c = ex.circuits.impure;
    const holder = shieldedTestKey().left;
    // Burns the minted coin as-is: the linkable flow, on both backends.
    const coin = await mint(100n, holder);
    const digest = burnMsgHash({
      contractAddress: addrBytes(),
      instanceSalt: INSTANCE_SALT,
      refundTo: holder.bytes,
      opNonce: await c.getNonce(),
      amount: 100n,
    });
    const refund = await c.burn(
      coin,
      100n,
      holder,
      [S1.publicKey, S2.publicKey],
      [sign(S1, digest), sign(S2, digest)],
    );
    expect(refund.is_some).toStrictEqual(false);
  });

  // A held coin needs a real `mt_index` on live; dry accepts a fabricated one.
  it.skipIf(isLiveBackend())(
    'burns a held coin through the wrapper (dry only)',
    async () => {
      const c = ex.circuits.impure;
      const coin = {
        nonce: new Uint8Array(32),
        color: await c.tokenColor(),
        value: 100n,
        mt_index: 0n,
      };
      const digest = burnFromSelfMsgHash({
        contractAddress: addrBytes(),
        instanceSalt: INSTANCE_SALT,
        opNonce: await c.getNonce(),
        amount: 100n,
        coinNonce: coin.nonce,
        coinValue: coin.value,
      });
      const change = await c.burnFromSelf(
        coin,
        100n,
        [S1.publicKey, S2.publicKey],
        [sign(S1, digest), sign(S2, digest)],
      );
      expect(change.is_some).toStrictEqual(false);
    },
  );
});
