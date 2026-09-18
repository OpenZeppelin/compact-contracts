import { createHash } from 'node:crypto';
import { ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { pureCircuits as ecdh } from '../../../artifacts/MockEcdh/contract/index.js';
import { pureCircuits } from '../../../artifacts/MockEcdhMask/contract/index.js';
import { pureCircuits as elgamal } from '../../../artifacts/MockElGamal/contract/index.js';
import { Sha256Simulator } from '../hash/test/simulators/Sha256Simulator.js';

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
    let sha: Sha256Simulator;

    beforeAll(async () => {
      sha = await Sha256Simulator.create();
    });

    // persistentHash<JubjubPoint>: SHA-256 of x || y, each as 32 little-endian bytes.
    const pointDigest = (point: { x: bigint; y: bigint }): Uint8Array => {
      const le = (v: bigint): Uint8Array =>
        Uint8Array.from({ length: 32 }, (_, i) =>
          Number((v >> BigInt(8 * i)) & 0xffn),
        );
      return new Uint8Array(
        createHash('sha256').update(le(point.x)).update(le(point.y)).digest(),
      );
    };

    it('should be deterministic for the same shared point and domain', () => {
      expect(pureCircuits.fieldKdf(PK, DOMAIN)).toBe(
        pureCircuits.fieldKdf(PK, DOMAIN),
      );
    });

    it('should differ for distinct shared points', () => {
      expect(pureCircuits.fieldKdf(PK, DOMAIN)).not.toBe(
        pureCircuits.fieldKdf(ecMulGenerator(222n), DOMAIN),
      );
    });

    it('should differ for distinct domains', () => {
      expect(pureCircuits.fieldKdf(PK, domain('a'))).not.toBe(
        pureCircuits.fieldKdf(PK, domain('b')),
      );
    });

    it('should equal Sha256.hashToField(pointDigest(S), domain)', async () => {
      for (const point of points) {
        expect(pureCircuits.fieldKdf(point, DOMAIN)).toBe(
          await sha.hashToField(pointDigest(point), DOMAIN),
        );
      }
    });

    it('should match the reference for S = 5 * pk(3) under "OZ:test:dst"', () => {
      const S = {
        x: 34133914351292434048413503276202728289265490189576620060413629725504410538523n,
        y: 14331798736465991320125906355460685144102305233516748184833801044822620467723n,
      };
      expect(pureCircuits.fieldKdf(S, domain('OZ:test:dst'))).toBe(
        26610806138279577918068632042914450713404457242874797469315820532741471409604n,
      );
      expect(pureCircuits.kdf(S, domain('OZ:test:dst'))).toBe(
        69564922259646089911822298958338864030232716070909835277172563539860613021n,
      );
    });

    it('should match the reference for S = 1307 * pk(42) under "other"', () => {
      const S = {
        x: 21846731140111779498597767336707429224314113023599758281380925851664428732333n,
        y: 16756994231029989709753422113746052839188842806931617304566960550784499484096n,
      };
      expect(pureCircuits.fieldKdf(S, domain('other'))).toBe(
        14942334384528480047623944073446731732154425113458333513933056364075658344760n,
      );
      expect(pureCircuits.kdf(S, domain('other'))).toBe(
        332242018693607749271965174322648896667187613080348592700581236270042761364n,
      );
    });

    it('should not equal kdf under the same point and domain', () => {
      for (const point of points) {
        expect(pureCircuits.fieldKdf(point, DOMAIN)).not.toBe(
          pureCircuits.kdf(point, DOMAIN),
        );
      }
    });

    it('should exceed the 248-bit kdf range for most shared points', () => {
      const wide = Array.from({ length: 64 }, (_, i) =>
        pureCircuits.fieldKdf(ecMulGenerator(BigInt(i) + 1n), DOMAIN),
      ).filter((mask) => mask >= TWO_248);
      expect(wide.length).toBeGreaterThan(56);
    });
  });

  describe('encryptField reference vectors', () => {
    it('should match the reference for sk = 3, e = 5, m = 299973 under "OZ:test:dst"', () => {
      const pk = ecMulGenerator(3n);
      const ciphertext = pureCircuits.encryptField(
        pk,
        299973n,
        5n,
        domain('OZ:test:dst'),
      );
      expect(ciphertext).toStrictEqual({
        ephemeralPk: {
          x: 46037580203438066765405229507649644425780970512522822336637661968249826130047n,
          y: 26189429486186784039799689203850934078756791903368248146476421754146336352630n,
        },
        ct: 26610806138279577918068632042914450713404457242874797469315820532741471709577n,
      });
      expect(
        pureCircuits.decryptField(ciphertext, 3n, domain('OZ:test:dst')),
      ).toBe(299973n);
    });

    it('should match the reference for sk = 42, e = 1307, m = 4199622 under "other"', () => {
      const pk = ecMulGenerator(42n);
      const ciphertext = pureCircuits.encryptField(
        pk,
        4199622n,
        1307n,
        domain('other'),
      );
      expect(ciphertext).toStrictEqual({
        ephemeralPk: {
          x: 19484914689417196181240116237393434494914401980232007599737218164003740761381n,
          y: 6764962076417023830458027630302197924902637758905016901701807876639802414181n,
        },
        ct: 14942334384528480047623944073446731732154425113458333513933056364075662544382n,
      });
      expect(pureCircuits.decryptField(ciphertext, 42n, domain('other'))).toBe(
        4199622n,
      );
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

  describe('pad width attack', () => {
    // Attack vector, one fact per line.
    // - A ciphertext is ct = (value + pad) mod P.
    // - The kdf pad is LEOS2IP_248 of a digest, so 0 <= pad < 2^248.
    // - If value + 2^248 <= P, then value + pad < P and the sum does not wrap.
    // - Then ct - pad = value, so value lies in (ct - 2^248, ct].
    // - That window is 2^248 wide in a field of size P > 2^254, so the
    //   observer learns the top 7 bits of value.
    // - A Uint<128> value is below 2^128, so the window covers the whole type
    //   and the observer learns nothing.
    // - The fieldKdf pad is LEOS2IP_512 of two digests reduced mod P, uniform
    //   on [0, P) to within 2^-257.
    // - Then ct is uniform on [0, P) for every value, and no window exists.
    //
    // Every pad below comes from one of 256 fixed shared points,
    // s_i = (7919 i + 1) G, so every count is deterministic.

    const SHARED_POINTS = Array.from({ length: 256 }, (_, i) =>
      ecMulGenerator(BigInt(i) * 7919n + 1n),
    );

    /** Pads of `kdf` over the fixed shared points, under `DOMAIN`. */
    const padsOf = (kdf: typeof pureCircuits.kdf): bigint[] =>
      SHARED_POINTS.map((s) => kdf(s, DOMAIN));

    // The largest value of each plaintext width. The Field one leaves room for
    // a 2^248 pad below P, so the kdf sum cannot wrap.
    const VALUE_128 = (1n << 128n) - 1n;
    const VALUE_248 = TWO_248 - 1n;
    const VALUE_FIELD = 1n << 254n;

    /**
     * IND-CPA game under `kdf`. Half the pads encrypt 0 and half encrypt
     * `value`. The observer guesses `value` whenever ct >= value. Returns the
     * win rate: 1 means the ciphertext gives the plaintext away, 0.5 means it
     * hides it.
     */
    const distinguisherWinRate = (
      kdf: typeof pureCircuits.kdf,
      value: bigint,
    ): number => {
      const pads = padsOf(kdf);
      const wins = pads.filter((pad, i) => {
        const encryptsValue = i % 2 === 1;
        const ct = ((encryptsValue ? value : 0n) + pad) % P;
        return ct >= value === encryptsValue;
      }).length;
      return wins / pads.length;
    };

    /**
     * Bit recovery under `kdf`. Encrypts a fixed spread of Field values and
     * reports how often the value lies in the window (ct - 2^248, ct].
     * 1 means the observer learns every value to within 2^248.
     */
    const windowHitRate = (kdf: typeof pureCircuits.kdf): number => {
      const pads = padsOf(kdf);
      const hits = pads.filter((pad, i) => {
        // Spread over [0, P - 2^248) so the kdf sum never wraps.
        const value =
          (BigInt(i + 1) * 0x9e3779b97f4a7c15n * (1n << 192n)) % (P - TWO_248);
        const ct = (value + pad) % P;
        return sub(ct, value) < TWO_248;
      }).length;
      return hits / pads.length;
    };

    /** A rate a fair coin could produce over 256 trials. */
    const expectCoinFlip = (rate: number): void => {
      expect(rate).toBeGreaterThan(0.35);
      expect(rate).toBeLessThan(0.65);
    };

    it('should keep every kdf pad below 2^248', () => {
      expect(padsOf(pureCircuits.kdf).every((pad) => pad < TWO_248)).toBe(true);
    });

    it('should put most fieldKdf pads at or above 2^248', () => {
      const pads = padsOf(pureCircuits.fieldKdf);
      const above = pads.filter((pad) => pad >= TWO_248).length;
      expect(above).toBeGreaterThan(pads.length * 0.9);
    });

    it('should keep every fieldKdf pad below P', () => {
      expect(padsOf(pureCircuits.fieldKdf).every((pad) => pad < P)).toBe(true);
    });

    it('should spread fieldKdf pads over every eighth of the field', () => {
      // A pad that stopped at 2^254, or an unreduced 2^256 one, would leave
      // the top eighths empty.
      const eighths = new Set(
        padsOf(pureCircuits.fieldKdf).map((pad) => (pad * 8n) / P),
      );
      expect([...eighths].sort()).toStrictEqual([
        0n,
        1n,
        2n,
        3n,
        4n,
        5n,
        6n,
        7n,
      ]);
    });

    it('should let the observer read a 248-bit value off its kdf ciphertext', () => {
      expect(distinguisherWinRate(pureCircuits.kdf, VALUE_248)).toBe(1);
    });

    it('should let the observer read a Field value off its kdf ciphertext', () => {
      expect(distinguisherWinRate(pureCircuits.kdf, VALUE_FIELD)).toBe(1);
    });

    it('should not let the observer read a Uint<128> value off its kdf ciphertext', () => {
      expectCoinFlip(distinguisherWinRate(pureCircuits.kdf, VALUE_128));
    });

    it('should not let the observer read a 248-bit value off its fieldKdf ciphertext', () => {
      expectCoinFlip(distinguisherWinRate(pureCircuits.fieldKdf, VALUE_248));
    });

    it('should not let the observer read a Field value off its fieldKdf ciphertext', () => {
      expectCoinFlip(distinguisherWinRate(pureCircuits.fieldKdf, VALUE_FIELD));
    });

    it('should not let the observer read a Uint<128> value off its fieldKdf ciphertext', () => {
      expectCoinFlip(distinguisherWinRate(pureCircuits.fieldKdf, VALUE_128));
    });

    it('should leave every Field value within 2^248 of its kdf ciphertext', () => {
      expect(windowHitRate(pureCircuits.kdf)).toBe(1);
    });

    it('should not leave a Field value within 2^248 of its fieldKdf ciphertext', () => {
      expect(windowHitRate(pureCircuits.fieldKdf)).toBeLessThan(0.05);
    });
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
