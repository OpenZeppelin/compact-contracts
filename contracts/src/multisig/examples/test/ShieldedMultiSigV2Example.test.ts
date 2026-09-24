import { createSimulator } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type Signer,
  sign,
  signerFromLabel,
} from '#test-utils/fixtures/ecdsa.js';
import {
  GENESIS_NATIVE_SHIELDED_TOKEN_COLORS,
  encodeShieldedCoinInfo as makeCoin,
} from '#test-utils/fixtures/nativeShieldedToken.js';
import { shieldedTestKey } from '#test-utils/fixtures/shieldedKey.js';
import {
  contractOwner,
  getQualifiedShieldedCoinInfo,
} from '#test-utils/harness/NativeShieldedTokenTracker.js';
import {
  Contract as Example,
  ledger,
} from '../../../../artifacts/ShieldedMultiSigV2Example/contract/index.js';
import { ShieldedMultiSigV2Simulator } from '../../presets/test/simulators/ShieldedMultiSigV2Simulator.js';
import { executeMsgHash } from '../../test/EcdsaTestUtils.js';
import {
  EmptyPrivateState,
  emptyWitnesses,
} from '../../test/EmptyWitnesses.js';

const RecipientKind = { ShieldedUser: 0, UnshieldedUser: 1, Contract: 2 };
const INSTANCE_SALT = new Uint8Array(32).fill(0xaa);
const COLOR = GENESIS_NATIVE_SHIELDED_TOKEN_COLORS.nativeShieldedToken1;
const AMOUNT = 1000n;
const THRESHOLD = 2n;

const S1 = signerFromLabel('v2-example-signer-1');
const S2 = signerFromLabel('v2-example-signer-2');
const S3 = signerFromLabel('v2-example-signer-3');

const commitmentOf = (s: Signer) =>
  ShieldedMultiSigV2Simulator.calculateSignerId(s.publicKey, INSTANCE_SALT);
const SIGNER_COMMITMENTS = [
  commitmentOf(S1),
  commitmentOf(S2),
  commitmentOf(S3),
];

const makeRecipient = (address: Uint8Array) => ({
  kind: RecipientKind.ShieldedUser,
  address,
});

type ExampleArgs = readonly [Uint8Array, Uint8Array[], bigint];

const ExampleSimulator = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  Example<EmptyPrivateState>,
  ExampleArgs
>({
  contractFactory: (witnesses) => new Example<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (instanceSalt, signerCommitments, thresh) => [
    instanceSalt,
    signerCommitments,
    thresh,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'ShieldedMultiSigV2Example',
});

describe('ShieldedMultiSigV2Example', () => {
  let example: InstanceType<typeof ExampleSimulator>;

  beforeEach(async () => {
    example = await ExampleSimulator.create(
      [INSTANCE_SALT, SIGNER_COMMITMENTS, THRESHOLD],
      {},
    );
  });

  describe('the registry execute reads', () => {
    it('is the one the constructor configured', async () => {
      expect(await example.circuits.impure.getSignerCount()).toEqual(3n);
      expect(await example.circuits.impure.getThreshold()).toEqual(THRESHOLD);
    });

    it('recognizes every registered signer', async () => {
      for (const commitment of SIGNER_COMMITMENTS) {
        expect(await example.circuits.impure.isSigner(commitment)).toBe(true);
      }
    });
  });

  describe('execute', () => {
    it('spends a deposited coin with two registered signers', async () => {
      const c = example.circuits.impure;
      const deposited = makeCoin(COLOR, AMOUNT);
      await c.deposit(deposited);

      // `.left` is the bare coin public key; `Recipient` wants its 32 bytes.
      const to = makeRecipient(shieldedTestKey().left.bytes);
      const coin = await getQualifiedShieldedCoinInfo(
        contractOwner(example),
        deposited,
      );
      const digest = executeMsgHash({
        contractAddress: Uint8Array.from(
          Buffer.from(example.contractAddress, 'hex'),
        ),
        instanceSalt: INSTANCE_SALT,
        nonce: await c.getNonce(),
        to,
        coinColor: coin.color,
        amount: 100n,
      });

      await c.execute(
        to,
        100n,
        coin,
        [S1.publicKey, S2.publicKey],
        [sign(S1, digest), sign(S2, digest)],
      );

      expect(await c.getNonce()).toEqual(1n);
    });
  });
});
