import { createSimulator } from '@openzeppelin/compact-simulator';
import { TypedDataEncoder } from 'ethers';
import { beforeEach, describe, expect, it } from 'vitest';
import { sign, signerFromLabel } from '#test-utils/fixtures/ecdsa.js';
import { shieldedTestKey } from '#test-utils/fixtures/shieldedKey.js';
import {
  Contract as Ex,
  ledger,
} from '../../../../artifacts/NativeShieldedTokenIssuerExample/contract/index.js';
import { calculateSignerId } from '../../presets/test/simulators/NativeShieldedTokenIssuerSimulator.js';
import { bytesOf, hexOf, mintMsgHash } from '../../test/EcdsaTestUtils.js';
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
      {},
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

  it('mints with two valid signatures', async () => {
    const c = ex.circuits.impure;
    const recipient = shieldedTestKey();
    const addr = Uint8Array.from(Buffer.from(ex.contractAddress, 'hex'));
    const digest = mintMsgHash({
      contractAddress: addr,
      instanceSalt: INSTANCE_SALT,
      recipient,
      opNonce: await c.getNonce(),
      amount: 100n,
    });
    await c.mint(
      100n,
      recipient,
      [S1.publicKey, S2.publicKey],
      [sign(S1, digest), sign(S2, digest)],
    );
  });
});
