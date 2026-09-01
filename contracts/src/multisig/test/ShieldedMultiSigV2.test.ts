import { encodeContractAddress } from '@midnight-ntwrk/compact-runtime';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GENESIS_NATIVE_SHIELDED_TOKEN_COLORS,
  encodeShieldedCoinInfo as makeCoin,
} from '#test-utils/fixtures/nativeShieldedToken.js';
import {
  domainSeparator,
  type ExecuteDigestParams,
  executeDigest,
  signerCommitmentPreimage,
  V2_DOMAIN_NAME,
  viemDomainSeparator,
  viemExecuteDigest,
} from './Eip712TestUtils.js';
import { ShieldedMultiSigV2Simulator } from './simulators/ShieldedMultiSigV2Simulator.js';

const RecipientKind = { ShieldedUser: 0, UnshieldedUser: 1, Contract: 2 };

const INSTANCE_SALT = new Uint8Array(32).fill(0xaa);
// A shielded token type the deployer wallet holds on live (genesis-minted);
// `fill(1)` would be unfunded on live. On dry the color is arbitrary.
const COLOR = GENESIS_NATIVE_SHIELDED_TOKEN_COLORS.nativeShieldedToken1;
const AMOUNT = 1000n;

const PK1 = new Uint8Array(64).fill(0x11);
const PK2 = new Uint8Array(64).fill(0x22);
const PK3 = new Uint8Array(64).fill(0x33);
const NON_SIGNER_PK = new Uint8Array(64).fill(0x99);

const COMMITMENT1 = ShieldedMultiSigV2Simulator.calculateSignerId(
  PK1,
  INSTANCE_SALT,
);
const COMMITMENT2 = ShieldedMultiSigV2Simulator.calculateSignerId(
  PK2,
  INSTANCE_SALT,
);
const COMMITMENT3 = ShieldedMultiSigV2Simulator.calculateSignerId(
  PK3,
  INSTANCE_SALT,
);
const SIGNER_COMMITMENTS = [COMMITMENT1, COMMITMENT2, COMMITMENT3];

// ECDSA verification is stubbed in the contract (`stubVerifySignature` returns
// true), so any 64-byte value passes. Authorization is enforced only by
// signer-commitment membership and duplicate detection — both caller-agnostic,
// so this spec runs unchanged on live (no `ownPublicKey`-based caller identity).
const DUMMY_SIG = new Uint8Array(64).fill(0xff);

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

let multisig: ShieldedMultiSigV2Simulator;

// A fresh 2-of-3 stateless multisig. Mutating groups build one per test
// (`beforeEach`); the read-only `view` group shares one deploy (`beforeAll`).
const freshMultisig = () =>
  ShieldedMultiSigV2Simulator.create(INSTANCE_SALT, SIGNER_COMMITMENTS, 2n);

describe('ShieldedMultiSigV2', () => {
  describe('constructor', () => {
    it('should initialize with 2-of-3 threshold', async () => {
      multisig = await ShieldedMultiSigV2Simulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        2n,
      );
      expect(await multisig.getSignerCount()).toEqual(3n);
      expect(await multisig.getThreshold()).toEqual(2n);
    });

    it('should initialize with 1-of-3 threshold', async () => {
      multisig = await ShieldedMultiSigV2Simulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        1n,
      );
      expect(await multisig.getThreshold()).toEqual(1n);
    });

    it('should fail with zero threshold', async () => {
      await expect(
        ShieldedMultiSigV2Simulator.create(
          INSTANCE_SALT,
          SIGNER_COMMITMENTS,
          0n,
        ),
      ).rejects.toThrow('Signer: threshold must not be zero');
    });

    it('should fail with threshold greater than 2', async () => {
      await expect(
        ShieldedMultiSigV2Simulator.create(
          INSTANCE_SALT,
          SIGNER_COMMITMENTS,
          3n,
        ),
      ).rejects.toThrow(
        'ShieldedMultiSigV2: threshold cannot exceed 2 (execute verifies at most 2 signatures)',
      );
    });

    it('should register all signer commitments', async () => {
      multisig = await ShieldedMultiSigV2Simulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        2n,
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
      );
      const unknown = ShieldedMultiSigV2Simulator.calculateSignerId(
        NON_SIGNER_PK,
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

      it('should reject duplicate signer', async () => {
        const to = makeRecipient(new Uint8Array(32).fill(7));
        const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
        await expect(
          multisig.execute(to, 100n, coin, [PK1, PK1], [DUMMY_SIG, DUMMY_SIG]),
        ).rejects.toThrow('Multisig: duplicate signer');
      });

      it('should reject a non-signer pubkey', async () => {
        const to = makeRecipient(new Uint8Array(32).fill(7));
        const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
        await expect(
          multisig.execute(
            to,
            100n,
            coin,
            [PK1, NON_SIGNER_PK],
            [DUMMY_SIG, DUMMY_SIG],
          ),
        ).rejects.toThrow('Signer: not a signer');
      });
    });

    describe('_calculateSignerId', () => {
      // A deployer must be able to precompute commitments with a plain keccak
      // library, so the preimage is the flat `pk ‖ salt ‖ pad(32, domain)`.
      it('should equal keccak256 of pk, salt and the signer domain', () => {
        expect(
          ShieldedMultiSigV2Simulator.calculateSignerId(PK1, INSTANCE_SALT),
        ).toStrictEqual(
          keccak_256(signerCommitmentPreimage(PK1, INSTANCE_SALT)),
        );
      });
    });
  });

  describe('EIP-712 digests', () => {
    // The dry default address is all zeros, which a circuit that ignored the
    // salt would still satisfy. Pin a distinctive one instead; live ignores the
    // override, so the reference salt is always read back off the instance.
    const DIGEST_CONTRACT_ADDRESS = '22'.repeat(32);
    const DIGEST_NONCE = 5n;
    const DIGEST_AMOUNT = 987_654_321n;
    const DIGEST_RECIPIENT = new Uint8Array(32).fill(0x07);

    let salt: Uint8Array;

    const executeParams = (
      kind: number = RecipientKind.ShieldedUser,
    ): ExecuteDigestParams => ({
      contractAddress: salt,
      recipientKind: kind,
      recipient: DIGEST_RECIPIENT,
      color: COLOR,
      nonce: DIGEST_NONCE,
      amount: DIGEST_AMOUNT,
    });

    beforeAll(async () => {
      multisig = await ShieldedMultiSigV2Simulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        2n,
        { contractAddress: DIGEST_CONTRACT_ADDRESS },
      );
      salt = encodeContractAddress(multisig.contractAddress);
    });

    // The helpers rebuild the digest through compact-runtime; viem rebuilds it
    // from the EIP-712 spec with no shared code. These run without artifacts.
    describe('reference agreement', () => {
      it('domain separator matches viem hashDomain', () => {
        const params = { name: V2_DOMAIN_NAME, salt };
        expect(domainSeparator(params)).toStrictEqual(
          viemDomainSeparator(params),
        );
      });

      it('execute digest matches viem hashTypedData', () => {
        const params = executeParams();
        expect(executeDigest(params)).toStrictEqual(viemExecuteDigest(params));
      });

      it('execute digest covers the recipient kind', () => {
        expect(
          executeDigest(executeParams(RecipientKind.ShieldedUser)),
        ).not.toStrictEqual(
          executeDigest(executeParams(RecipientKind.Contract)),
        );
      });

      it('domain separator differs from the V3 preset', () => {
        expect(
          domainSeparator({ name: V2_DOMAIN_NAME, salt }),
        ).not.toStrictEqual(
          domainSeparator({ name: 'ShieldedMultiSigV3', salt }),
        );
      });
    });

    // Keccak in-circuit needs a ZKIR-v3 proof server; none is confirmed yet.
    describe.skipIf(isLiveBackend())('circuit agreement (dry only)', () => {
      it('getDomainSeparator matches viem hashDomain', async () => {
        expect(await multisig.getDomainSeparator()).toStrictEqual(
          viemDomainSeparator({ name: V2_DOMAIN_NAME, salt }),
        );
      });

      it('executeDigest matches viem', async () => {
        const params = executeParams();
        const circuit = await multisig.executeDigest(
          { kind: RecipientKind.ShieldedUser, address: DIGEST_RECIPIENT },
          COLOR,
          DIGEST_NONCE,
          DIGEST_AMOUNT,
        );
        expect(circuit).toStrictEqual(viemExecuteDigest(params));
        expect(circuit).toStrictEqual(executeDigest(params));
      });

      it('executeDigest binds the recipient kind', async () => {
        const shielded = await multisig.executeDigest(
          { kind: RecipientKind.ShieldedUser, address: DIGEST_RECIPIENT },
          COLOR,
          DIGEST_NONCE,
          DIGEST_AMOUNT,
        );
        const contract = await multisig.executeDigest(
          { kind: RecipientKind.Contract, address: DIGEST_RECIPIENT },
          COLOR,
          DIGEST_NONCE,
          DIGEST_AMOUNT,
        );
        expect(shielded).not.toStrictEqual(contract);
      });
    });
  });
});
