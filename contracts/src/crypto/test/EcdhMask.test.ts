import { ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pureCircuits as ecdh } from '../../../artifacts/MockEcdh/contract/index.js';
import { pureCircuits } from '../../../artifacts/MockEcdhMask/contract/index.js';
import { pureCircuits as elgamal } from '../../../artifacts/MockElGamal/contract/index.js';

// The EcdhMask circuits are pure, so tests drive them directly via the compiled
// artifact's `pureCircuits` (no proof, no simulator needed).

// Jubjub prime-order subgroup order. Valid scalars are [1, L-1]; the runtime
// faults ecMul on scalars >= L (see crypto/ElGamal), so L-1 is the largest
// valid scalar.
const L =
  6554484396890773809930967563523245729705921265872317281365359162392183254199n;

// BLS12-381 scalar field modulus: the modulus of the Compact `Field` type.
const P = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

// Upper bound of a single degradeToTransient output, so the width of one
// fieldKdf half and of the whole kdf mask.
const TWO_248 = 1n << 248n;

// Field subtraction. Ciphertext arithmetic wraps, so a raw bigint `-` on two
// field elements is not the field difference.
const sub = (a: bigint, b: bigint): bigint => (a - b + P) % P;

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

// Two tags for the multi-field pattern: one key agreement, one fieldKdf per field.
const TAG_VALUE = domain('ecdh_mask_test:value');
const TAG_NONCE = domain('ecdh_mask_test:nonce');

// A fixed encrypt input/output pair, recorded before encrypt delegated to
// crypto/Ecdh, under its own tag so a change to the tests above cannot move it.
const GOLDEN_VALUE = (1n << 127n) + 12345n;
const GOLDEN_E = 424242n;
const GOLDEN_DOMAIN = domain('ecdh_mask_golden');
const GOLDEN_CIPHERTEXT = {
  ephemeralPk: {
    x: 29744007854499136538279777804045376227924513599493318762246204369493933045815n,
    y: 2604409624680019572520314011984821445135836579833696274586703556773097648664n,
  },
  ct: 92943607126214901997092911019500281461782473933829915198787051090573790098n,
};

describe('EcdhMask', () => {
  describe('encrypt golden vector', () => {
    it('reproduces the pinned ciphertext bit for bit', () => {
      // encrypt's output is part of its API, so an importer that recompiles
      // still decrypts what it wrote before the split.
      expect(
        pureCircuits.encrypt(PK, GOLDEN_VALUE, GOLDEN_E, GOLDEN_DOMAIN),
      ).toStrictEqual(GOLDEN_CIPHERTEXT);
    });
  });

  describe('composition with crypto/Ecdh', () => {
    it('encrypt equals deriveShared then kdf then add', () => {
      const shared = ecdh.deriveShared(PK, 42n);
      const mask = pureCircuits.kdf(shared.sShared, DOMAIN);
      expect(pureCircuits.encrypt(PK, 1000n, 42n, DOMAIN)).toStrictEqual({
        ephemeralPk: shared.ephemeralPk,
        ct: (1000n + mask) % P,
      });
    });
  });

  describe('encrypt / decrypt round-trip', () => {
    it('recovers the encrypted value', () => {
      const ciphertext = pureCircuits.encrypt(PK, 1000n, 42n, DOMAIN);
      expect(pureCircuits.decrypt(ciphertext, EK, DOMAIN)).toBe(1000n);
    });

    it('round-trips zero', () => {
      const ciphertext = pureCircuits.encrypt(PK, 0n, 42n, DOMAIN);
      expect(pureCircuits.decrypt(ciphertext, EK, DOMAIN)).toBe(0n);
    });

    it('round-trips a value far above 2^48 (no discrete-log bound)', () => {
      // This is the whole point of the ECDH mask: values are delivered
      // directly, so there is no BSGS table and no 2^48 cap.
      const big = 1n << 120n;
      const ciphertext = pureCircuits.encrypt(PK, big, 42n, DOMAIN);
      expect(pureCircuits.decrypt(ciphertext, EK, DOMAIN)).toBe(big);
    });

    it('round-trips the maximum Uint<128> value', () => {
      // Recovery is field subtraction (ct - mask), which is exact even if
      // value + mask wrapped the field modulus, so the max value round-trips
      // regardless of wrap.
      const max = (1n << 128n) - 1n;
      const ciphertext = pureCircuits.encrypt(PK, max, 42n, DOMAIN);
      expect(pureCircuits.decrypt(ciphertext, EK, DOMAIN)).toBe(max);
    });

    it('round-trips at the maximum valid scalar (L - 1) for key and ephemeral', () => {
      // Exercise the top of the valid scalar range: both the recipient key's
      // secret and the ephemeral are L - 1, the largest scalar the runtime
      // accepts (L and above fault ecMul).
      const ek = L - 1n;
      const e = L - 1n;
      const max = (1n << 128n) - 1n;
      const pk = ecMulGenerator(ek);
      const ciphertext = pureCircuits.encrypt(pk, max, e, DOMAIN);
      expect(pureCircuits.decrypt(ciphertext, ek, DOMAIN)).toBe(max);
    });

    it('round-trips through the real crypto/ElGamal key derivation', () => {
      // The CFT memo path derives the recipient pair from a Bytes<32> EK via
      // crypto/ElGamal: pk = derivePk(EK), ekScalar = secretToScalar(EK). Pin
      // that shared-key infrastructure end to end rather than using raw scalars.
      const ekBytes = new Uint8Array(32).fill(0x11);
      const pk = elgamal.derivePk(ekBytes);
      const ekScalar = elgamal.secretToScalar(ekBytes);
      const ciphertext = pureCircuits.encrypt(pk, 4242n, 99n, DOMAIN);
      expect(pureCircuits.decrypt(ciphertext, ekScalar, DOMAIN)).toBe(4242n);
    });

    it('round-trips for arbitrary keys, ephemerals, and values (property)', () => {
      fc.assert(
        fc.property(
          // Keys and ephemerals stay well under the Jubjub subgroup order ℓ
          // (~2^252) so they are valid scalars; values span the full Uint<128>.
          fc.bigInt({ min: 1n, max: 1n << 200n }),
          fc.bigInt({ min: 1n, max: 1n << 200n }),
          fc.bigInt({ min: 0n, max: (1n << 128n) - 1n }),
          (ek, e, value) => {
            const pk = ecMulGenerator(ek);
            const ciphertext = pureCircuits.encrypt(pk, value, e, DOMAIN);
            expect(pureCircuits.decrypt(ciphertext, ek, DOMAIN)).toBe(value);
          },
        ),
      );
    });
  });

  describe('freshness / pad reuse', () => {
    it('reusing the ephemeral to one recipient leaks the value difference', () => {
      // The freshness footgun in executable form: a repeated `e` to the same
      // recipient reuses the one-time pad, so the ciphertext difference equals
      // the plaintext difference. This is exactly why `e` MUST be fresh; the
      // test also pins the pad semantics against a KDF regression.
      const e = 7n;
      const c1 = pureCircuits.encrypt(PK, 1000n, e, DOMAIN);
      const c2 = pureCircuits.encrypt(PK, 250n, e, DOMAIN);
      expect(c1.ct - c2.ct).toBe(1000n - 250n);
    });

    it('reusing the ephemeral leaks the difference through encryptField too', () => {
      // Uniformity buys nothing once the pad repeats.
      const e = 7n;
      const m1 = P - 1n;
      const m2 = 1n << 200n;
      const c1 = pureCircuits.encryptField(PK, m1, e, DOMAIN);
      const c2 = pureCircuits.encryptField(PK, m2, e, DOMAIN);
      expect(sub(c1.ct, c2.ct)).toBe(sub(m1, m2));
    });
  });

  describe('weak-input guards', () => {
    // Both guards now live in crypto/Ecdh, so encrypt raises that module's
    // messages. The guards themselves are covered in Ecdh.test.ts.
    it('rejects encryption to the identity public key', () => {
      const identity = ecMulGenerator(0n);
      expect(() => pureCircuits.encrypt(identity, 1000n, 42n, DOMAIN)).toThrow(
        'Ecdh: identity pk',
      );
    });

    it('rejects a zero ephemeral', () => {
      expect(() => pureCircuits.encrypt(PK, 1000n, 0n, DOMAIN)).toThrow(
        'Ecdh: zero ephemeral',
      );
    });
  });

  describe('confidentiality / correctness properties', () => {
    it('distinct ephemerals yield distinct ciphertexts for the same value', () => {
      const c1 = pureCircuits.encrypt(PK, 1000n, 1n, DOMAIN);
      const c2 = pureCircuits.encrypt(PK, 1000n, 2n, DOMAIN);
      expect(c1.ct).not.toBe(c2.ct);
      expect(c1.ephemeralPk).not.toEqual(c2.ephemeralPk);
    });

    it('distinct values yield distinct ciphertexts under the same ephemeral', () => {
      const c1 = pureCircuits.encrypt(PK, 1000n, 5n, DOMAIN);
      const c2 = pureCircuits.encrypt(PK, 2000n, 5n, DOMAIN);
      expect(c1.ct).not.toBe(c2.ct);
    });

    it('does not recover the value under the wrong secret key', () => {
      const ciphertext = pureCircuits.encrypt(PK, 1000n, 42n, DOMAIN);
      const WRONG_EK = 999999n;
      expect(pureCircuits.decrypt(ciphertext, WRONG_EK, DOMAIN)).not.toBe(
        1000n,
      );
    });

    it('does not recover the value under the wrong domain', () => {
      const ciphertext = pureCircuits.encrypt(PK, 1000n, 42n, DOMAIN);
      expect(pureCircuits.decrypt(ciphertext, EK, domain('other'))).not.toBe(
        1000n,
      );
    });
  });

  describe('kdf', () => {
    it('is deterministic for the same shared point and domain', () => {
      expect(pureCircuits.kdf(PK, DOMAIN)).toBe(pureCircuits.kdf(PK, DOMAIN));
    });

    it('differs for distinct shared points', () => {
      const other = ecMulGenerator(222n);
      expect(pureCircuits.kdf(PK, DOMAIN)).not.toBe(
        pureCircuits.kdf(other, DOMAIN),
      );
    });

    it('differs for distinct domains (domain separation)', () => {
      expect(pureCircuits.kdf(PK, domain('a'))).not.toBe(
        pureCircuits.kdf(PK, domain('b')),
      );
    });

    it('produces a mask below 2^248 (hiding-margin regression)', () => {
      // The module's ~2^-120 hiding margin rests on the kdf output staying in
      // [0, 2^248) (the degradeToTransient range). Pin that stdlib behavior over
      // several points so a regression surfaces here rather than silently
      // shrinking the margin.
      for (const s of [2n, 5n, 222n, 999999n]) {
        expect(pureCircuits.kdf(ecMulGenerator(s), DOMAIN)).toBeLessThan(
          TWO_248,
        );
      }
    });
  });

  describe('fieldKdf', () => {
    const points = [2n, 5n, 222n, 999999n].map((s) => ecMulGenerator(s));

    it('is deterministic for the same shared point and domain', () => {
      expect(pureCircuits.fieldKdf(PK, DOMAIN)).toBe(
        pureCircuits.fieldKdf(PK, DOMAIN),
      );
    });

    it('differs for distinct shared points', () => {
      expect(pureCircuits.fieldKdf(PK, DOMAIN)).not.toBe(
        pureCircuits.fieldKdf(ecMulGenerator(222n), DOMAIN),
      );
    });

    it('differs for distinct domains (domain separation)', () => {
      expect(pureCircuits.fieldKdf(PK, domain('a'))).not.toBe(
        pureCircuits.fieldKdf(PK, domain('b')),
      );
    });

    it('equals k1 + k2 * 2^248 over the two hashed halves', () => {
      // The mock recomputes both halves straight from the stdlib hashes, so the
      // pad's arithmetic is pinned against an independent path.
      for (const point of points) {
        const [low, high] = pureCircuits.fieldKdfHalves(point, DOMAIN);
        expect(pureCircuits.fieldKdf(point, DOMAIN)).toBe(
          (low + high * TWO_248) % P,
        );
      }
    });

    it('draws each half from the 248-bit degradeToTransient range', () => {
      for (const point of points) {
        const [low, high] = pureCircuits.fieldKdfHalves(point, DOMAIN);
        expect(low).toBeLessThan(TWO_248);
        expect(high).toBeLessThan(TWO_248);
      }
    });

    it('draws the two halves as independent hash queries', () => {
      // Index 0 and index 1 are separate random-oracle queries.
      for (const point of points) {
        const [low, high] = pureCircuits.fieldKdfHalves(point, DOMAIN);
        expect(low).not.toBe(high);
      }
    });

    it('differs from kdf under the same point and domain', () => {
      // The three-element preimage separates the pad from the kdf, so a
      // consumer may use both under one (S, domain).
      for (const point of points) {
        expect(pureCircuits.fieldKdf(point, DOMAIN)).not.toBe(
          pureCircuits.kdf(point, DOMAIN),
        );
      }
    });

    it('exceeds the 248-bit kdf range for most shared points', () => {
      // The regression that catches a dropped high half: a 248-bit pad can
      // never land above 2^248, a field-wide one almost always does.
      const wide = Array.from({ length: 64 }, (_, i) =>
        pureCircuits.fieldKdf(ecMulGenerator(BigInt(i) + 1n), DOMAIN),
      ).filter((mask) => mask >= TWO_248);
      expect(wide.length).toBeGreaterThan(0);
    });
  });

  describe('encryptField / decryptField round-trip', () => {
    // Recovery is exact for every Field, not only the Uint<128> range encrypt
    // covers.
    const cases: [string, bigint][] = [
      ['zero', 0n],
      ['one', 1n],
      ['the largest field element', P - 1n],
      ['2^248, the top of the kdf range', TWO_248],
      ['2^253, above every 248-bit mask', 1n << 253n],
    ];

    for (const [name, m] of cases) {
      it(`round-trips ${name}`, () => {
        const ciphertext = pureCircuits.encryptField(PK, m, 42n, DOMAIN);
        expect(pureCircuits.decryptField(ciphertext, EK, DOMAIN)).toBe(m);
      });
    }

    it('round-trips at the maximum valid scalar (L - 1) for key and ephemeral', () => {
      const ek = L - 1n;
      const pk = ecMulGenerator(ek);
      const m = P - 1n;
      const ciphertext = pureCircuits.encryptField(pk, m, L - 1n, DOMAIN);
      expect(pureCircuits.decryptField(ciphertext, ek, DOMAIN)).toBe(m);
    });

    it('round-trips through the real crypto/ElGamal key derivation', () => {
      const ekBytes = new Uint8Array(32).fill(0x11);
      const pk = elgamal.derivePk(ekBytes);
      const ekScalar = elgamal.secretToScalar(ekBytes);
      const m = P - 4242n;
      const ciphertext = pureCircuits.encryptField(pk, m, 99n, DOMAIN);
      expect(pureCircuits.decryptField(ciphertext, ekScalar, DOMAIN)).toBe(m);
    });

    it('round-trips for arbitrary keys, ephemerals, and field plaintexts (property)', () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: 1n, max: 1n << 200n }),
          fc.bigInt({ min: 1n, max: 1n << 200n }),
          fc.bigInt({ min: 0n, max: P - 1n }),
          (ek, e, m) => {
            const pk = ecMulGenerator(ek);
            const ciphertext = pureCircuits.encryptField(pk, m, e, DOMAIN);
            expect(pureCircuits.decryptField(ciphertext, ek, DOMAIN)).toBe(m);
          },
        ),
      );
    });

    it('masks the plaintext with exactly fieldKdf(pk^e, domain)', () => {
      // The ciphertext is a function of (sShared, domain) and m alone.
      const m = 1n << 253n;
      const shared = pureCircuits.deriveShared(PK, 42n);
      const ciphertext = pureCircuits.encryptField(PK, m, 42n, DOMAIN);
      expect(ciphertext.ct).toBe(
        (m + pureCircuits.fieldKdf(shared.sShared, DOMAIN)) % P,
      );
    });
  });

  describe('encryptField uniformity', () => {
    // With a 248-bit pad the ciphertext of a large plaintext stays in a narrow
    // band around it, so plaintexts of different magnitudes are distinguishable
    // by their ciphertext's range. A field-wide pad scatters every plaintext
    // across the whole field, so each of these must land on both sides of the
    // midpoint over a fixed set of ephemerals.
    const HALF_P = P / 2n;
    const plaintexts: [string, bigint][] = [
      ['zero', 0n],
      ['2^128', 1n << 128n],
      ['2^253', 1n << 253n],
      ['the largest field element', P - 1n],
    ];

    for (const [name, m] of plaintexts) {
      it(`spreads the ciphertext of ${name} across the whole field`, () => {
        const cts = Array.from({ length: 64 }, (_, i) =>
          pureCircuits.encryptField(PK, m, BigInt(i) + 1n, DOMAIN),
        ).map((ciphertext) => ciphertext.ct);
        expect(cts.some((ct) => ct < HALF_P)).toBe(true);
        expect(cts.some((ct) => ct >= HALF_P)).toBe(true);
      });
    }
  });

  describe('multi-field pad discipline', () => {
    // `deriveShared` and `recoverShared` come from crypto/Ecdh, imported
    // alongside EcdhMask in the mock exactly as a consumer imports both.
    it('carries two fields under one key agreement with one tag each', () => {
      // The multi-field pattern a consumer builds on.
      const value = 1n << 200n;
      const nonce = P - 5n;
      const shared = pureCircuits.deriveShared(PK, 31337n);
      const valueCt =
        (value + pureCircuits.fieldKdf(shared.sShared, TAG_VALUE)) % P;
      const nonceCt =
        (nonce + pureCircuits.fieldKdf(shared.sShared, TAG_NONCE)) % P;

      const recovered = pureCircuits.recoverShared(shared.ephemeralPk, EK);
      expect(sub(valueCt, pureCircuits.fieldKdf(recovered, TAG_VALUE))).toBe(
        value,
      );
      expect(sub(nonceCt, pureCircuits.fieldKdf(recovered, TAG_NONCE))).toBe(
        nonce,
      );
    });

    it('leaks the plaintext difference when one tag pads two fields', () => {
      // The tag-reuse footgun in executable form: one shared point, one tag,
      // two fields is pad reuse.
      const m1 = 1n << 200n;
      const m2 = 4242n;
      const shared = pureCircuits.deriveShared(PK, 31337n);
      const mask = pureCircuits.fieldKdf(shared.sShared, TAG_VALUE);
      expect(sub((m1 + mask) % P, (m2 + mask) % P)).toBe(sub(m1, m2));
    });

    it('does not leak the plaintext difference across distinct tags', () => {
      const m1 = 1n << 200n;
      const m2 = 4242n;
      const shared = pureCircuits.deriveShared(PK, 31337n);
      const ct1 = (m1 + pureCircuits.fieldKdf(shared.sShared, TAG_VALUE)) % P;
      const ct2 = (m2 + pureCircuits.fieldKdf(shared.sShared, TAG_NONCE)) % P;
      expect(sub(ct1, ct2)).not.toBe(sub(m1, m2));
    });
  });

  describe('total recipient-side circuits', () => {
    // Nothing on the recipient side asserts, so a scanner cannot tell an
    // addressed ciphertext from an unaddressed one by an abort.
    const identity = ecMulGenerator(0n);
    const WRONG_EK = 999999n;
    const ciphertext = pureCircuits.encryptField(PK, 1n << 200n, 42n, DOMAIN);

    it('fieldKdf accepts the identity shared point', () => {
      expect(() => pureCircuits.fieldKdf(identity, DOMAIN)).not.toThrow();
    });

    it('decryptField returns a wrong plaintext under a wrong secret key', () => {
      expect(pureCircuits.decryptField(ciphertext, WRONG_EK, DOMAIN)).not.toBe(
        1n << 200n,
      );
    });

    it('decryptField returns a wrong plaintext under a wrong domain', () => {
      expect(
        pureCircuits.decryptField(ciphertext, EK, domain('other')),
      ).not.toBe(1n << 200n);
    });

    it('decryptField resolves an identity ephemeral without aborting', () => {
      const forged = { ephemeralPk: identity, ct: ciphertext.ct };
      expect(() => pureCircuits.decryptField(forged, EK, DOMAIN)).not.toThrow();
    });
  });
});
