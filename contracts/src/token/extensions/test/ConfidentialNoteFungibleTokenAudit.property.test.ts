/**
 * Stateless properties of the audit extension.
 *
 * The unit suite states each claim at hand-picked points. This states the same
 * claims over generated inputs, so they hold where nobody chose, and a failure
 * shrinks to the smallest counterexample.
 *
 * Each run reads back only the records it just wrote. Sequence claims live in
 * `ConfidentialNoteFungibleTokenAudit.invariant.test.ts`.
 *
 * Runs on either backend. `recoverRecord` and `ownerOf` are pure and evaluate
 * locally even on live, so their properties run 100 times anywhere. The
 * `_audit` properties deploy the standalone mock, and every record is a
 * transaction on live, so they run twice there.
 */

import { ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { pureCircuits as audit } from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAudit/contract/index.js';
import {
  type AuditRecord,
  ConfidentialNoteFungibleTokenAuditSimulator,
  type Identifier,
  type RecoveredRecord,
} from './simulators/ConfidentialNoteFungibleTokenAuditSimulator.js';

// ---------------------------------------------------------------------------
// Generators, each pinned to the circuit's own type
// ---------------------------------------------------------------------------

const U128 = 1n << 128n;
const U248 = 1n << 248n;

// Jubjub prime-order subgroup order; valid secret scalars are [1, L-1].
const L =
  6554484396890773809930967563523245729705921265872317281365359162392183254199n;

const ZERO = new Uint8Array(32);

/** `Uint<128>`, the declared width of a note's value and of each limb. */
const value = () => fc.bigInt({ min: 0n, max: U128 - 1n });

/** A `Field` nonce in `[0, 2^248)`, the range `_audit` accepts. */
const nonce = () => fc.bigInt({ min: 0n, max: U248 - 1n });

/** `Uint<248>`, the declared width of every pad. */
const pad = () => fc.bigInt({ min: 0n, max: U248 - 1n });

/** A `JubjubScalar` in `[1, L-1]`, so `g^scalar` is never the identity. */
const scalar = () => fc.bigInt({ min: 1n, max: L - 1n });

/** Any `JubjubScalar`, zero included: the auditor side returns for every key. */
const anyScalar = () => fc.bigInt({ min: 0n, max: L - 1n });

/** `Bytes<32>`, the declared width of a slot and of an owner key. */
const bytes32 = () => fc.uint8Array({ minLength: 32, maxLength: 32 });

/** A seed `RandPrfExpand` accepts: any 32 bytes but zero. */
const seed = () => bytes32().filter((bytes) => bytes.some((b) => b !== 0));

/** Any record `_audit` could write, and more: any non-identity `E`, any pads. */
const anyRecord = (): fc.Arbitrary<AuditRecord> =>
  fc.record({
    ephemeralPk: scalar().map((e) => ecMulGenerator(e)),
    valueCt: pad(),
    nonceCt: pad(),
    ownerLoCt: pad(),
    ownerHiCt: pad(),
  });

const keyArm = (bytes: Uint8Array): Identifier => ({
  is_left: true,
  left: bytes,
  right: { bytes: ZERO },
});

/** `bytes` read as a little-endian integer. */
const littleEndian = (bytes: Uint8Array): bigint =>
  bytes.reduceRight((acc, byte) => (acc << 8n) | BigInt(byte), 0n);

/** The limbs the module splits a key into: bytes 0 to 15, then 16 to 31. */
const limbsOf = (bytes: Uint8Array): { ownerLo: bigint; ownerHi: bigint } => ({
  ownerLo: littleEndian(bytes.subarray(0, 16)),
  ownerHi: littleEndian(bytes.subarray(16, 32)),
});

const passesFilter = (r: RecoveredRecord): boolean =>
  r.value < U128 && r.ownerLo < U128 && r.ownerHi < U128;

const hex = (bytes: Uint8Array): string =>
  `0x${Buffer.from(bytes).toString('hex')}`;

const PROPERTY_RUNS = isLiveBackend() ? 2 : 25;

// Each case drives several circuit calls; the default 5 s is too short under load.
const TIMEOUT = 120_000;

let token: ConfidentialNoteFungibleTokenAuditSimulator;

/** The trail, newest first. */
const records = async (): Promise<AuditRecord[]> => [
  ...(await token.getPublicState()).Audit__auditTrail,
];

// ---------------------------------------------------------------------------
// recoverRecord and ownerOf
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenAudit property: pure circuits', () => {
  it(
    'should return a quadruple below 2^248 for any record and scalar, without asserting',
    () => {
      fc.assert(
        fc.property(anyRecord(), anyScalar(), (record, s) => {
          const r = audit.recoverRecord(record, s);

          for (const field of [r.value, r.nonce, r.ownerLo, r.ownerHi]) {
            expect(field).toBeLessThan(U248);
          }
        }),
      );
    },
    TIMEOUT,
  );

  it(
    'should not open an identity ephemeral under any scalar, whatever the pads',
    () => {
      fc.assert(
        fc.property(anyRecord(), anyScalar(), (record, s) => {
          const placeholder = { ...record, ephemeralPk: ecMulGenerator(0n) };

          expect(() => audit.recoverRecord(placeholder, s)).toThrow(
            'ConfidentialNoteFungibleTokenAudit: identity ephemeral',
          );
        }),
      );
    },
    TIMEOUT,
  );

  it(
    'should rebuild any key from its two little-endian limbs',
    () => {
      fc.assert(
        fc.property(bytes32(), (bytes) => {
          const { ownerLo, ownerHi } = limbsOf(bytes);

          expect(audit.ownerOf(ownerLo, ownerHi)).toStrictEqual(keyArm(bytes));
        }),
      );
    },
    TIMEOUT,
  );
});

// ---------------------------------------------------------------------------
// _audit
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenAudit property: _audit', () => {
  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenAuditSimulator.create({
      auditKey: ecMulGenerator(1n),
    });
  });

  it(
    'should open any record in range under the audit scalar, for any owner, slot, seed and key',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          scalar(),
          bytes32(),
          value(),
          nonce(),
          bytes32(),
          seed(),
          async (s, owner, v, n, slot, auditSeed) => {
            await token._setAuditKey(ecMulGenerator(s));
            token.wallet.auditSeed = auditSeed;
            await token._audit(keyArm(owner), v, n, slot);
            const [newest] = await records();
            const r = audit.recoverRecord(newest, s);

            expect(r).toStrictEqual({ value: v, nonce: n, ...limbsOf(owner) });
            expect(audit.ownerOf(r.ownerLo, r.ownerHi)).toStrictEqual(
              keyArm(owner),
            );
          },
        ),
        { numRuns: PROPERTY_RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    'should return a quadruple the filter drops under any other scalar',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          scalar(),
          anyScalar(),
          bytes32(),
          value(),
          nonce(),
          bytes32(),
          async (s, other, owner, v, n, slot) => {
            fc.pre(s !== other);
            await token._setAuditKey(ecMulGenerator(s));
            await token._audit(keyArm(owner), v, n, slot);
            const [newest] = await records();

            expect(passesFilter(audit.recoverRecord(newest, other))).toBe(
              false,
            );
          },
        ),
        { numRuns: PROPERTY_RUNS },
      );
    },
    TIMEOUT,
  );
});

// ---------------------------------------------------------------------------
// Pads under a reused seed
// ---------------------------------------------------------------------------

/**
 * The ephemeral is `RandPrfExpand.derive(tag, slot, [nonce, key, value,
 * owner])`, so with the seed planted those five inputs are what separates two
 * records. Each run repeats its first record to show the seed held.
 */
describe('ConfidentialNoteFungibleTokenAudit property: pads under a reused seed', () => {
  type Inputs = {
    key: bigint;
    owner: Uint8Array;
    value: bigint;
    nonce: bigint;
    slot: Uint8Array;
  };

  const inputs = (): fc.Arbitrary<Inputs> =>
    fc.record({
      key: scalar(),
      owner: bytes32(),
      value: value(),
      nonce: nonce(),
      slot: bytes32(),
    });

  const write = async ({ key, owner, value: v, nonce: n, slot }: Inputs) => {
    await token._setAuditKey(ecMulGenerator(key));
    await token._audit(keyArm(owner), v, n, slot);
  };

  /** Writes `base`, then `varied`, then `base` again, under one seed. */
  const expectMoved = async (
    auditSeed: Uint8Array,
    base: Inputs,
    varied: Inputs,
  ): Promise<void> => {
    token.wallet.auditSeed = auditSeed;
    await write(base);
    await write(varied);
    await write(base);
    const [repeat, second, first] = await records();

    expect(repeat).toStrictEqual(first);
    expect(second.ephemeralPk).not.toStrictEqual(first.ephemeralPk);
  };

  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenAuditSimulator.create({
      auditKey: ecMulGenerator(1n),
    });
  });

  it(
    'should move the ephemeral for any two distinct nonces',
    async () => {
      await fc.assert(
        fc.asyncProperty(seed(), inputs(), nonce(), async (s, base, n) => {
          fc.pre(n !== base.nonce);
          await expectMoved(s, base, { ...base, nonce: n });
        }),
        { numRuns: PROPERTY_RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    'should move the ephemeral for any two distinct slots',
    async () => {
      await fc.assert(
        fc.asyncProperty(seed(), inputs(), bytes32(), async (s, base, slot) => {
          fc.pre(hex(slot) !== hex(base.slot));
          await expectMoved(s, base, { ...base, slot });
        }),
        { numRuns: PROPERTY_RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    'should move the ephemeral for any two distinct keys',
    async () => {
      await fc.assert(
        fc.asyncProperty(seed(), inputs(), scalar(), async (s, base, key) => {
          fc.pre(key !== base.key);
          await expectMoved(s, base, { ...base, key });
        }),
        { numRuns: PROPERTY_RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    'should move the ephemeral for any two distinct values',
    async () => {
      await fc.assert(
        fc.asyncProperty(seed(), inputs(), value(), async (s, base, v) => {
          fc.pre(v !== base.value);
          await expectMoved(s, base, { ...base, value: v });
        }),
        { numRuns: PROPERTY_RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    'should move the ephemeral for any two distinct owners',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          seed(),
          inputs(),
          bytes32(),
          async (s, base, owner) => {
            fc.pre(hex(owner) !== hex(base.owner));
            await expectMoved(s, base, { ...base, owner });
          },
        ),
        { numRuns: PROPERTY_RUNS },
      );
    },
    TIMEOUT,
  );
});
