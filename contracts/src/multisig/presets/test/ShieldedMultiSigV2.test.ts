import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { id, TypedDataEncoder } from 'ethers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  highSTwin,
  type Signer,
  sign,
  signerFromLabel,
} from '#test-utils/fixtures/ecdsa.js';
import {
  GENESIS_NATIVE_SHIELDED_TOKEN_COLORS,
  encodeShieldedCoinInfo as makeCoin,
} from '#test-utils/fixtures/nativeShieldedToken.js';
import {
  bytesOf,
  executeMsgHash,
  hexOf,
  mintMsgHash,
} from '../../test/EcdsaTestUtils.js';
import { ShieldedMultiSigV2Simulator } from './simulators/ShieldedMultiSigV2Simulator.js';

const RecipientKind = { ShieldedUser: 0, UnshieldedUser: 1, Contract: 2 };

const INSTANCE_SALT = new Uint8Array(32).fill(0xaa);
// A shielded token type the deployer wallet holds on live (genesis-minted);
// `fill(1)` would be unfunded on live. On dry the color is arbitrary.
const COLOR = GENESIS_NATIVE_SHIELDED_TOKEN_COLORS.nativeShieldedToken1;
const AMOUNT = 1000n;

// Real secp256k1 signers, deterministic from labels. Authorization needs a
// genuine ECDSA signature over the operation digest, but it stays
// caller-agnostic (no `ownPublicKey` identity), so this spec runs unchanged on
// live.
const S1 = signerFromLabel('v2-signer-1');
const S2 = signerFromLabel('v2-signer-2');
const S3 = signerFromLabel('v2-signer-3');
const OUTSIDER = signerFromLabel('v2-outsider');

const COMMITMENT1 = ShieldedMultiSigV2Simulator.calculateSignerId(
  S1.publicKey,
  INSTANCE_SALT,
);
const COMMITMENT2 = ShieldedMultiSigV2Simulator.calculateSignerId(
  S2.publicKey,
  INSTANCE_SALT,
);
const COMMITMENT3 = ShieldedMultiSigV2Simulator.calculateSignerId(
  S3.publicKey,
  INSTANCE_SALT,
);
const SIGNER_COMMITMENTS = [COMMITMENT1, COMMITMENT2, COMMITMENT3];

function makeRecipient(address: Uint8Array): {
  kind: number;
  address: Uint8Array;
} {
  return { kind: RecipientKind.ShieldedUser, address };
}

function makeQualifiedCoin(
  color: Uint8Array,
  value: bigint,
  mtIndex: bigint,
  nonce?: Uint8Array,
): {
  nonce: Uint8Array;
  color: Uint8Array;
  value: bigint;
  mt_index: bigint;
} {
  return {
    nonce: nonce ?? new Uint8Array(32).fill(0),
    color,
    value,
    mt_index: mtIndex,
  };
}

const hexBytes = (hex: string): Uint8Array =>
  Uint8Array.from(Buffer.from(hex, 'hex'));

let multisig: ShieldedMultiSigV2Simulator;

/** The execute digest the contract computes for these params at its current nonce. */
async function executeDigest(
  m: ShieldedMultiSigV2Simulator,
  to: { kind: number; address: Uint8Array },
  coin: { color: Uint8Array },
  amount: bigint,
): Promise<Uint8Array> {
  return executeMsgHash({
    contractAddress: Uint8Array.from(Buffer.from(m.contractAddress, 'hex')),
    instanceSalt: INSTANCE_SALT,
    nonce: await m.getNonce(),
    to,
    coinColor: coin.color,
    amount,
  });
}

// A fresh 2-of-3 stateless multisig. Mutating groups build one per test
// (`beforeEach`); the read-only `view` group shares one deploy (`beforeAll`).
const freshMultisig = () =>
  ShieldedMultiSigV2Simulator.create(
    INSTANCE_SALT,
    SIGNER_COMMITMENTS,
    2n,
    true,
  );

describe('ShieldedMultiSigV2', () => {
  describe('constructor', () => {
    it('should derive a domain separator matching ethers', async () => {
      multisig = await freshMultisig();

      expect(
        Buffer.from(
          (await multisig.getPublicState())._domainSeparator,
        ).toString('hex'),
      ).toEqual(
        TypedDataEncoder.hashDomain({
          name: 'ShieldedMultiSigV2',
          version: '1',
          salt: `0x${Buffer.from(INSTANCE_SALT).toString('hex')}`,
        }).slice(2),
      );
    });

    it('should initialize with 2-of-3 threshold', async () => {
      multisig = await ShieldedMultiSigV2Simulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        2n,
        true,
      );
      expect(await multisig.getSignerCount()).toEqual(3n);
      expect(await multisig.getThreshold()).toEqual(2n);
    });

    it('should initialize with 1-of-3 threshold', async () => {
      multisig = await ShieldedMultiSigV2Simulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        1n,
        true,
      );
      expect(await multisig.getThreshold()).toEqual(1n);
    });

    it('should fail with zero threshold', async () => {
      await expect(
        ShieldedMultiSigV2Simulator.create(
          INSTANCE_SALT,
          SIGNER_COMMITMENTS,
          0n,
          true,
        ),
      ).rejects.toThrow('Signer: threshold must not be zero');
    });

    it('should fail with threshold greater than 2', async () => {
      await expect(
        ShieldedMultiSigV2Simulator.create(
          INSTANCE_SALT,
          SIGNER_COMMITMENTS,
          3n,
          true,
        ),
      ).rejects.toThrow(
        'EcdsaSignerManager: threshold cannot exceed 2 (assertApprovals verifies 2 signatures)',
      );
    });

    it('should register all signer commitments', async () => {
      multisig = await ShieldedMultiSigV2Simulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        2n,
        true,
      );
      for (const commitment of SIGNER_COMMITMENTS) {
        expect(await multisig.isSigner(commitment)).toEqual(true);
      }
    });

    it('should reject a non-signer commitment', async () => {
      multisig = await ShieldedMultiSigV2Simulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        2n,
        true,
      );
      const unknown = ShieldedMultiSigV2Simulator.calculateSignerId(
        OUTSIDER.publicKey,
        INSTANCE_SALT,
      );
      expect(await multisig.isSigner(unknown)).toEqual(false);
    });
  });

  describe('when initialized', () => {
    describe('view', () => {
      beforeAll(async () => {
        multisig = await freshMultisig();
      });

      it('getNonce should start at 0', async () => {
        expect(await multisig.getNonce()).toEqual(0n);
      });

      it('getSignerCount should return 3', async () => {
        expect(await multisig.getSignerCount()).toEqual(3n);
      });

      it('getThreshold should match constructor arg', async () => {
        expect(await multisig.getThreshold()).toEqual(2n);
      });
    });

    describe('deposit', () => {
      beforeEach(async () => {
        multisig = await freshMultisig();
      });

      it('should accept deposits without reverting', async () => {
        await multisig.deposit(makeCoin(COLOR, AMOUNT));
      });
    });

    describe('execute', () => {
      beforeEach(async () => {
        multisig = await freshMultisig();
      });

      // A real send spends a deposited coin, which the live harness cannot yet
      // fund and track.
      describe.skipIf(isLiveBackend())('happy path (dry only)', () => {
        // Both output nonces derive from the deposited coin, so sending 100
        // of a 1000 deposit is fully determined.
        const EXPECTED_SEND_RESULT = {
          change: {
            is_some: true,
            value: {
              nonce: hexBytes(
                '1d62fa499a81ab6b63c7e8fb768dcb46729383838adec43fa70b2381e0765400',
              ),
              color: COLOR,
              value: 900n,
            },
          },
          sent: {
            nonce: hexBytes(
              'f0925e45d140674d1bbc00240a017b3d9635b803ee6e75a61569afd28440cf00',
            ),
            color: COLOR,
            value: 100n,
          },
        };

        async function execute(
          to: { kind: number; address: Uint8Array },
          amount: bigint,
          coin: {
            nonce: Uint8Array;
            color: Uint8Array;
            value: bigint;
            mt_index: bigint;
          },
          signers: Signer[],
        ) {
          const digest = await executeDigest(multisig, to, coin, amount);
          return multisig.execute(
            to,
            amount,
            coin,
            signers.map((s) => s.publicKey),
            signers.map((s) => sign(s, digest)),
          );
        }

        it('should execute a send with signers 0 and 1', async () => {
          await multisig.deposit(makeCoin(COLOR, AMOUNT));
          const to = makeRecipient(new Uint8Array(32).fill(7));
          const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
          expect(await execute(to, 100n, coin, [S1, S2])).toStrictEqual(
            EXPECTED_SEND_RESULT,
          );
          expect(await multisig.getNonce()).toEqual(1n);
        });

        it('should execute a send with signers 1 and 2', async () => {
          await multisig.deposit(makeCoin(COLOR, AMOUNT));
          const to = makeRecipient(new Uint8Array(32).fill(7));
          const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
          // Same expectation under different approvers: authorization
          // cannot influence the coins produced.
          expect(await execute(to, 100n, coin, [S2, S3])).toStrictEqual(
            EXPECTED_SEND_RESULT,
          );
          expect(await multisig.getNonce()).toEqual(1n);
        });

        it('should reject signatures replayed after the nonce moves', async () => {
          await multisig.deposit(makeCoin(COLOR, AMOUNT));
          const to = makeRecipient(new Uint8Array(32).fill(7));
          const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
          const digest = await executeDigest(multisig, to, coin, 100n);
          const pubkeys = [S1.publicKey, S2.publicKey];
          const sigs = [sign(S1, digest), sign(S2, digest)];

          await multisig.execute(to, 100n, coin, pubkeys, sigs);
          expect(await multisig.getNonce()).toEqual(1n);
          await expect(
            multisig.execute(to, 100n, coin, pubkeys, sigs),
          ).rejects.toThrow('Multisig: invalid signature');
        });
      });

      it('should reject duplicate signer', async () => {
        const to = makeRecipient(new Uint8Array(32).fill(7));
        const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
        const digest = await executeDigest(multisig, to, coin, 100n);
        await expect(
          multisig.execute(
            to,
            100n,
            coin,
            [S1.publicKey, S1.publicKey],
            [sign(S1, digest), sign(S1, digest)],
          ),
        ).rejects.toThrow('Multisig: duplicate signer');
      });

      it('should reject a non-signer pubkey', async () => {
        const to = makeRecipient(new Uint8Array(32).fill(7));
        const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
        const digest = await executeDigest(multisig, to, coin, 100n);
        await expect(
          multisig.execute(
            to,
            100n,
            coin,
            [S1.publicKey, OUTSIDER.publicKey],
            [sign(S1, digest), sign(OUTSIDER, digest)],
          ),
        ).rejects.toThrow('Signer: not a signer');
      });

      it('should reject a signature from the wrong key', async () => {
        const to = makeRecipient(new Uint8Array(32).fill(7));
        const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
        const digest = await executeDigest(multisig, to, coin, 100n);
        // S2's pubkey is registered, but S3 produced the signature.
        await expect(
          multisig.execute(
            to,
            100n,
            coin,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S3, digest)],
          ),
        ).rejects.toThrow('Multisig: invalid signature');
      });

      it('should reject a signature over a different digest', async () => {
        const to = makeRecipient(new Uint8Array(32).fill(7));
        const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
        const digest = await executeDigest(multisig, to, coin, 100n);
        const wrongDigest = await executeDigest(multisig, to, coin, 999n);
        await expect(
          multisig.execute(
            to,
            100n,
            coin,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S2, wrongDigest)],
          ),
        ).rejects.toThrow('Multisig: invalid signature');
      });

      describe('parameter binding', () => {
        it('should reject a signature bound to a different amount', async () => {
          const to = makeRecipient(new Uint8Array(32).fill(7));
          const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
          const digest = await executeDigest(multisig, to, coin, 999n);

          await expect(
            multisig.execute(
              to,
              100n,
              coin,
              [S1.publicKey, S2.publicKey],
              [sign(S1, digest), sign(S2, digest)],
            ),
          ).rejects.toThrow('Multisig: invalid signature');
        });

        it('should reject a signature bound to a different recipient address', async () => {
          const signedFor = makeRecipient(new Uint8Array(32).fill(7));
          const redirected = makeRecipient(new Uint8Array(32).fill(8));
          const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
          const digest = await executeDigest(multisig, signedFor, coin, 100n);

          await expect(
            multisig.execute(
              redirected,
              100n,
              coin,
              [S1.publicKey, S2.publicKey],
              [sign(S1, digest), sign(S2, digest)],
            ),
          ).rejects.toThrow('Multisig: invalid signature');
        });

        it('should reject a signature bound to a different coin color', async () => {
          const to = makeRecipient(new Uint8Array(32).fill(7));
          const otherColor =
            GENESIS_NATIVE_SHIELDED_TOKEN_COLORS.nativeShieldedToken2;
          const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
          const digest = await executeDigest(
            multisig,
            to,
            { color: otherColor },
            100n,
          );

          await expect(
            multisig.execute(
              to,
              100n,
              coin,
              [S1.publicKey, S2.publicKey],
              [sign(S1, digest), sign(S2, digest)],
            ),
          ).rejects.toThrow('Multisig: invalid signature');
        });
      });

      describe('encoding scheme', () => {
        const EXECUTE_TYPES = {
          Execute: [
            { name: 'contractAddress', type: 'bytes32' },
            { name: 'nonce', type: 'uint256' },
            { name: 'recipientKind', type: 'uint8' },
            { name: 'recipient', type: 'bytes32' },
            { name: 'coinColor', type: 'bytes32' },
            { name: 'amount', type: 'uint256' },
          ],
        };

        const ourDomain = {
          name: 'ShieldedMultiSigV2',
          version: '1',
          salt: hexOf(INSTANCE_SALT),
        };

        const executeValue = async (coinColor: Uint8Array) => ({
          contractAddress: hexOf(
            Uint8Array.from(Buffer.from(multisig.contractAddress, 'hex')),
          ),
          nonce: await multisig.getNonce(),
          recipientKind: RecipientKind.ShieldedUser,
          recipient: hexOf(new Uint8Array(32).fill(7)),
          coinColor: hexOf(coinColor),
          amount: 100n,
        });

        const executeWith = async (digest: Uint8Array) =>
          multisig.execute(
            makeRecipient(new Uint8Array(32).fill(7)),
            100n,
            makeQualifiedCoin(COLOR, AMOUNT, 0n),
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S2, digest)],
          );

        it('should use the type hash ethers derives', () => {
          expect(
            id(TypedDataEncoder.from(EXECUTE_TYPES).encodeType('Execute')),
          ).toEqual(
            '0x8e36c978f20015e81d7a53efc32e2b08f12497a5057c70207f8bc4b7c6cf5e15',
          );
        });

        it('should reject a signature over the bare struct hash', async () => {
          const structHash = bytesOf(
            TypedDataEncoder.hashStruct(
              'Execute',
              EXECUTE_TYPES,
              await executeValue(COLOR),
            ),
          );

          await expect(executeWith(structHash)).rejects.toThrow(
            'Multisig: invalid signature',
          );
        });

        // The property EIP-712 is here for: a signature obtained under any
        // other application's domain cannot be replayed against this one.
        it('should reject a digest built under a different domain', async () => {
          const digest = bytesOf(
            TypedDataEncoder.hash(
              { ...ourDomain, name: 'SomeOtherApp' },
              EXECUTE_TYPES,
              await executeValue(COLOR),
            ),
          );

          await expect(executeWith(digest)).rejects.toThrow(
            'Multisig: invalid signature',
          );
        });

        it('should reject a digest built under a different salt', async () => {
          const digest = bytesOf(
            TypedDataEncoder.hash(
              { ...ourDomain, salt: hexOf(new Uint8Array(32).fill(0xee)) },
              EXECUTE_TYPES,
              await executeValue(COLOR),
            ),
          );

          await expect(executeWith(digest)).rejects.toThrow(
            'Multisig: invalid signature',
          );
        });

        // Renaming a field leaves every value identical but changes the type
        // hash, which is the struct's first word.
        it('should reject a digest whose type hash differs', async () => {
          const renamed = {
            Execute: EXECUTE_TYPES.Execute.map((f) =>
              f.name === 'amount' ? { ...f, name: 'value' } : f,
            ),
          };
          const v = await executeValue(COLOR);
          const { amount, ...rest } = v;
          const digest = bytesOf(
            TypedDataEncoder.hash(ourDomain, renamed, {
              ...rest,
              value: amount,
            }),
          );

          await expect(executeWith(digest)).rejects.toThrow(
            'Multisig: invalid signature',
          );
        });

        it('should not let a signature redirect to a different recipient kind', async () => {
          const address = new Uint8Array(32).fill(7);
          const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
          const signedFor = { kind: RecipientKind.ShieldedUser, address };
          const redirected = { kind: RecipientKind.Contract, address };
          const digest = await executeDigest(multisig, signedFor, coin, 100n);

          await expect(
            multisig.execute(
              redirected,
              100n,
              coin,
              [S1.publicKey, S2.publicKey],
              [sign(S1, digest), sign(S2, digest)],
            ),
          ).rejects.toThrow('Multisig: invalid signature');
        });

        it.skipIf(isLiveBackend())(
          'should execute to a contract recipient',
          async () => {
            const to = {
              kind: RecipientKind.Contract,
              address: new Uint8Array(32).fill(7),
            };
            const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
            const digest = await executeDigest(multisig, to, coin, 100n);

            await multisig.execute(
              to,
              100n,
              coin,
              [S1.publicKey, S2.publicKey],
              [sign(S1, digest), sign(S2, digest)],
            );
            expect(await multisig.getNonce()).toEqual(1n);
          },
        );

        it('should carry an unshielded recipient kind into the digest', async () => {
          const to = {
            kind: RecipientKind.UnshieldedUser,
            address: new Uint8Array(32).fill(7),
          };
          const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
          const digest = await executeDigest(multisig, to, coin, 100n);

          await expect(
            multisig.execute(
              to,
              100n,
              coin,
              [S1.publicKey, S2.publicKey],
              [sign(S1, digest), sign(S2, digest)],
            ),
          ).rejects.toThrow('ProposalManager: invalid shielded recipient');
        });
      });

      it('should reject a high-s signature', async () => {
        const to = makeRecipient(new Uint8Array(32).fill(7));
        const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
        const digest = await executeDigest(multisig, to, coin, 100n);
        // The twin verifies under plain ECDSA, so only the low-s gate can
        // reject it.
        await expect(
          multisig.execute(
            to,
            100n,
            coin,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), highSTwin(sign(S2, digest))],
          ),
        ).rejects.toThrow('Multisig: invalid signature');
      });
    });

    describe('uninitialized', () => {
      it('cannot execute, and holds a zero domain separator', async () => {
        const uninit = await ShieldedMultiSigV2Simulator.create(
          INSTANCE_SALT,
          SIGNER_COMMITMENTS,
          2n,
          false,
        );

        expect(
          Buffer.from((await uninit.getPublicState())._domainSeparator).every(
            (b) => b === 0,
          ),
        ).toEqual(true);

        const to = makeRecipient(new Uint8Array(32).fill(7));
        const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
        const digest = await executeDigest(uninit, to, coin, 100n);

        await expect(
          uninit.execute(
            to,
            100n,
            coin,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S2, digest)],
          ),
        ).rejects.toThrow('Eip712: domain separator not set');
      });
    });

    // The mirror of the V3 spec's check
    describe('cross-preset replay', () => {
      it('should reject a ShieldedMultiSigV3 mint signature', async () => {
        const address = new Uint8Array(32).fill(7);
        const to = makeRecipient(address);
        const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
        const digest = mintMsgHash({
          contractAddress: Uint8Array.from(
            Buffer.from(multisig.contractAddress, 'hex'),
          ),
          instanceSalt: INSTANCE_SALT,
          recipient: address,
          opNonce: await multisig.getNonce(),
          amount: 100n,
        });

        await expect(
          multisig.execute(
            to,
            100n,
            coin,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S2, digest)],
          ),
        ).rejects.toThrow('Multisig: invalid signature');
      });
    });

    describe('cross-instance replay', () => {
      // A distinct deployed address for the second instance,
      // so its digest differs
      const OTHER_ADDRESS = '11'.repeat(32);

      it('should reject a signature bound to another instance', async () => {
        const instance1 = await freshMultisig();
        const instance2 = await ShieldedMultiSigV2Simulator.create(
          INSTANCE_SALT,
          SIGNER_COMMITMENTS,
          2n,
          true,
          isLiveBackend() ? {} : { contractAddress: OTHER_ADDRESS },
        );
        const to = makeRecipient(new Uint8Array(32).fill(7));
        const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
        const digest = await executeDigest(instance1, to, coin, 100n);
        await expect(
          instance2.execute(
            to,
            100n,
            coin,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S2, digest)],
          ),
        ).rejects.toThrow('Multisig: invalid signature');
      });
    });
  });
});
