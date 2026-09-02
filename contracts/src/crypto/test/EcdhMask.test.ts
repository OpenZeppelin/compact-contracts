import { ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { EcdhMaskSimulator } from './simulators/EcdhMaskSimulator.js';
import { ElGamalSimulator } from './simulators/ElGamalSimulator.js';

// Jubjub prime-order subgroup order. Valid scalars are [1, L-1]; the runtime
// faults ecMul on scalars >= L (see crypto/ElGamal), so L-1 is the largest
// valid scalar.
const L =
  6554484396890773809930967563523245729705921265872317281365359162392183254199n;

// A recipient's secret scalar and their derived public key g^ek.
const EK = 111222333444555n;
const PK = ecMulGenerator(EK);

// A consumer-supplied domain-separation tag. Must match on encrypt/decrypt.
const domain = (label: string): Uint8Array => {
  const d = new Uint8Array(32);
  d.set(new TextEncoder().encode(label).slice(0, 32));
  return d;
};
const DOMAIN = domain('ecdh_mask_test');

// Every run is a transaction on the live backend, so the property shrinks to a
// handful of cases there and keeps its full sample space dry.
const PROPERTY_RUNS = isLiveBackend() ? 3 : 100;

let contract: EcdhMaskSimulator;

describe('EcdhMask', () => {
  beforeAll(async () => {
    contract = await EcdhMaskSimulator.create();
  });

  describe('encrypt / decrypt round-trip', () => {
    it('recovers the encrypted value', async () => {
      const ciphertext = await contract.encrypt(PK, 1000n, 42n, DOMAIN);
      expect(await contract.decrypt(ciphertext, EK, DOMAIN)).toBe(1000n);
    });

    it('round-trips zero', async () => {
      const ciphertext = await contract.encrypt(PK, 0n, 42n, DOMAIN);
      expect(await contract.decrypt(ciphertext, EK, DOMAIN)).toBe(0n);
    });

    it('round-trips a value far above 2^48 (no discrete-log bound)', async () => {
      // This is the whole point of the ECDH mask: values are delivered
      // directly, so there is no BSGS table and no 2^48 cap.
      const big = 1n << 120n;
      const ciphertext = await contract.encrypt(PK, big, 42n, DOMAIN);
      expect(await contract.decrypt(ciphertext, EK, DOMAIN)).toBe(big);
    });

    it('round-trips the maximum Uint<128> value', async () => {
      // Recovery is field subtraction (ct - mask), which is exact even if
      // value + mask wrapped the field modulus, so the max value round-trips
      // regardless of wrap.
      const max = (1n << 128n) - 1n;
      const ciphertext = await contract.encrypt(PK, max, 42n, DOMAIN);
      expect(await contract.decrypt(ciphertext, EK, DOMAIN)).toBe(max);
    });

    it('round-trips at the maximum valid scalar (L - 1) for key and ephemeral', async () => {
      // Exercise the top of the valid scalar range: both the recipient key's
      // secret and the ephemeral are L - 1, the largest scalar the runtime
      // accepts (L and above fault ecMul).
      const ek = L - 1n;
      const e = L - 1n;
      const max = (1n << 128n) - 1n;
      const pk = ecMulGenerator(ek);
      const ciphertext = await contract.encrypt(pk, max, e, DOMAIN);
      expect(await contract.decrypt(ciphertext, ek, DOMAIN)).toBe(max);
    });

    it('round-trips through the real crypto/ElGamal key derivation', async () => {
      // The CFT memo path derives the recipient pair from a Bytes<32> EK via
      // crypto/ElGamal: pk = derivePk(EK), ekScalar = secretToScalar(EK). Pin
      // that shared-key infrastructure end to end rather than using raw scalars.
      const elgamal = await ElGamalSimulator.create();
      const ekBytes = new Uint8Array(32).fill(0x11);
      const pk = await elgamal.derivePk(ekBytes);
      const ekScalar = await elgamal.secretToScalar(ekBytes);
      const ciphertext = await contract.encrypt(pk, 4242n, 99n, DOMAIN);
      expect(await contract.decrypt(ciphertext, ekScalar, DOMAIN)).toBe(4242n);
    });

    it('round-trips for arbitrary keys, ephemerals, and values (property)', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Keys and ephemerals stay well under the Jubjub subgroup order ℓ
          // (~2^252) so they are valid scalars; values span the full Uint<128>.
          fc.bigInt({ min: 1n, max: 1n << 200n }),
          fc.bigInt({ min: 1n, max: 1n << 200n }),
          fc.bigInt({ min: 0n, max: (1n << 128n) - 1n }),
          async (ek, e, value) => {
            const pk = ecMulGenerator(ek);
            const ciphertext = await contract.encrypt(pk, value, e, DOMAIN);
            expect(await contract.decrypt(ciphertext, ek, DOMAIN)).toBe(value);
          },
        ),
        { numRuns: PROPERTY_RUNS },
      );
    });
  });

  describe('freshness / pad reuse', () => {
    it('reusing the ephemeral to one recipient leaks the value difference', async () => {
      // The freshness footgun in executable form: a repeated `e` to the same
      // recipient reuses the one-time pad, so the ciphertext difference equals
      // the plaintext difference. This is exactly why `e` MUST be fresh; the
      // test also pins the pad semantics against a KDF regression.
      const e = 7n;
      const c1 = await contract.encrypt(PK, 1000n, e, DOMAIN);
      const c2 = await contract.encrypt(PK, 250n, e, DOMAIN);
      expect(c1.ct - c2.ct).toBe(1000n - 250n);
    });
  });

  describe('weak-input guards', () => {
    it('rejects encryption to the identity public key', async () => {
      const identity = ecMulGenerator(0n);
      await expect(
        contract.encrypt(identity, 1000n, 42n, DOMAIN),
      ).rejects.toThrow('identity pk');
    });

    it('rejects a zero ephemeral', async () => {
      await expect(contract.encrypt(PK, 1000n, 0n, DOMAIN)).rejects.toThrow(
        'zero ephemeral',
      );
    });
  });

  describe('confidentiality / correctness properties', () => {
    it('distinct ephemerals yield distinct ciphertexts for the same value', async () => {
      const c1 = await contract.encrypt(PK, 1000n, 1n, DOMAIN);
      const c2 = await contract.encrypt(PK, 1000n, 2n, DOMAIN);
      expect(c1.ct).not.toBe(c2.ct);
      expect(c1.ephemeralPk).not.toEqual(c2.ephemeralPk);
    });

    it('distinct values yield distinct ciphertexts under the same ephemeral', async () => {
      const c1 = await contract.encrypt(PK, 1000n, 5n, DOMAIN);
      const c2 = await contract.encrypt(PK, 2000n, 5n, DOMAIN);
      expect(c1.ct).not.toBe(c2.ct);
    });

    it('does not recover the value under the wrong secret key', async () => {
      const ciphertext = await contract.encrypt(PK, 1000n, 42n, DOMAIN);
      const WRONG_EK = 999999n;
      expect(await contract.decrypt(ciphertext, WRONG_EK, DOMAIN)).not.toBe(
        1000n,
      );
    });

    it('does not recover the value under the wrong domain', async () => {
      const ciphertext = await contract.encrypt(PK, 1000n, 42n, DOMAIN);
      expect(await contract.decrypt(ciphertext, EK, domain('other'))).not.toBe(
        1000n,
      );
    });
  });

  describe('kdf', () => {
    it('is deterministic for the same shared point and domain', async () => {
      expect(await contract.kdf(PK, DOMAIN)).toBe(
        await contract.kdf(PK, DOMAIN),
      );
    });

    it('differs for distinct shared points', async () => {
      const other = ecMulGenerator(222n);
      expect(await contract.kdf(PK, DOMAIN)).not.toBe(
        await contract.kdf(other, DOMAIN),
      );
    });

    it('differs for distinct domains (domain separation)', async () => {
      expect(await contract.kdf(PK, domain('a'))).not.toBe(
        await contract.kdf(PK, domain('b')),
      );
    });

    it('produces a mask below 2^248 (hiding-margin regression)', async () => {
      // The module's ~2^-120 hiding margin rests on the kdf output staying in
      // [0, 2^248) (the degradeToTransient range). Pin that stdlib behavior over
      // several points so a regression surfaces here rather than silently
      // shrinking the margin.
      const bound = 1n << 248n;
      for (const s of [2n, 5n, 222n, 999999n]) {
        expect(await contract.kdf(ecMulGenerator(s), DOMAIN)).toBeLessThan(
          bound,
        );
      }
    });
  });
});
