import { ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import { pureCircuits as audit } from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAudit/contract/index.js';
import { pureCircuits as composed } from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAudited/contract/index.js';
import { NOTE_SALT } from '../../presets/test/witnesses/CustodialConfidentialNoteFungibleTokenWitnesses.js';
import {
  ConfidentialNoteFungibleTokenAuditedSimulator,
  type Note,
} from './simulators/ConfidentialNoteFungibleTokenAuditedSimulator.js';
import {
  type AuditRecord,
  ConfidentialNoteFungibleTokenAuditSimulator,
  type Identifier,
  type RecoveredRecord,
} from './simulators/ConfidentialNoteFungibleTokenAuditSimulator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic 32 bytes from a label; also Compact's `pad(32, label)`. */
const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

const U128 = 1n << 128n;
const U248 = 1n << 248n;

// Jubjub prime-order subgroup order; the bindings accept scalars in [0, L-1].
const L =
  6554484396890773809930967563523245729705921265872317281365359162392183254199n;

const ZERO = new Uint8Array(32);

const AUDIT_SCALAR = 111222333444555n;
const OTHER_SCALAR = 999888777666555n;
const AUDIT_KEY = ecMulGenerator(AUDIT_SCALAR);
const OTHER_KEY = ecMulGenerator(OTHER_SCALAR);
const IDENTITY = ecMulGenerator(0n);

const keyArm = (bytes: Uint8Array): Identifier => ({
  is_left: true,
  left: bytes,
  right: { bytes: ZERO },
});

const contractArm = (bytes: Uint8Array): Identifier => ({
  is_left: false,
  left: ZERO,
  right: { bytes },
});

// 32 distinct non-zero bytes, so a swapped limb or a reversed byte order shows.
const OWNER = keyArm(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
const OWNER_LO = 0x100f0e0d0c0b0a090807060504030201n;
const OWNER_HI = 0x201f1e1d1c1b1a191817161514131211n;

const OTHER_OWNER = keyArm(bytes32('OTHER-OWNER'));

const SLOT = bytes32('spec:out');
const OTHER_SLOT = bytes32('spec:change');
const FIXED_SEED = bytes32('FIXED-AUDIT-SEED');

const NOTE = { value: 100n, nonce: 7n };

const ERR = {
  alreadyInitialized:
    'ConfidentialNoteFungibleTokenAudit: contract already initialized',
  notInitialized:
    'ConfidentialNoteFungibleTokenAudit: contract not initialized',
  identityKey: 'ConfidentialNoteFungibleTokenAudit: identity audit key',
  contractOwner: 'ConfidentialNoteFungibleTokenAudit: contract owner',
  nonCanonicalOwner: 'ConfidentialNoteFungibleTokenAudit: non-canonical owner',
  identityEphemeral: 'ConfidentialNoteFungibleTokenAudit: identity ephemeral',
  zeroSeed: 'RandPrfExpand: zero seed',
  castNonce: 'cast from Field or Uint value to smaller Uint value failed',
} as const;

/** The auditor's range filter: a record opened under the wrong scalar fails it. */
const passesFilter = (r: RecoveredRecord): boolean =>
  r.value < U128 && r.ownerLo < U128 && r.ownerHi < U128;

let token: ConfidentialNoteFungibleTokenAuditSimulator;

/** The trail, newest first. */
const records = async (): Promise<AuditRecord[]> => [
  ...(await token.getPublicState()).Audit__auditTrail,
];

const trailLength = async (): Promise<bigint> =>
  (await token.getPublicState()).Audit__auditTrail.length();

const deploy = (inits = 1n, auditSeed?: Uint8Array) =>
  ConfidentialNoteFungibleTokenAuditSimulator.create({
    auditKey: AUDIT_KEY,
    inits,
    wallet: { auditSeed },
  });

// ---------------------------------------------------------------------------
// initialize
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenAudit: initialize', () => {
  it('should store the key and set the flag', async () => {
    token = await deploy();
    const state = await token.getPublicState();

    expect(state.Audit__isInitialized).toBe(true);
    expect(state.Audit__auditKey).toStrictEqual(AUDIT_KEY);
    expect(state.Audit__auditTrail.length()).toBe(0n);
  });

  it('should leave the flag unset when the constructor skips it', async () => {
    token = await deploy(0n);

    expect((await token.getPublicState()).Audit__isInitialized).toBe(false);
  });

  it('should not run twice', async () => {
    await expectRejection(deploy(2n), ERR.alreadyInitialized);
  });

  it('should not accept the identity point as the key', async () => {
    await expectRejection(
      ConfidentialNoteFungibleTokenAuditSimulator.create({
        auditKey: IDENTITY,
      }),
      ERR.identityKey,
    );
  });
});

// ---------------------------------------------------------------------------
// Before initialize
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenAudit: before initialize', () => {
  beforeEach(async () => {
    token = await deploy(0n);
  });

  it.each([
    {
      circuit: '_setAuditKey',
      call: () => token._setAuditKey(OTHER_KEY),
    },
    {
      circuit: '_setAuditKey with the identity point',
      call: () => token._setAuditKey(IDENTITY),
    },
    {
      circuit: '_audit',
      call: () => token._audit(OWNER, NOTE.value, NOTE.nonce, SLOT),
    },
    {
      circuit: '_audit with a contract owner',
      call: () =>
        token._audit(
          contractArm(bytes32('CONTRACT')),
          NOTE.value,
          NOTE.nonce,
          SLOT,
        ),
    },
  ])('should fail $circuit', async ({ call }) => {
    await expectRejection(call(), ERR.notInitialized);

    const state = await token.getPublicState();
    expect(state.Audit__isInitialized).toBe(false);
    expect(state.Audit__auditTrail.length()).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// _setAuditKey
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenAudit: _setAuditKey', () => {
  beforeEach(async () => {
    token = await deploy();
  });

  it('should replace the key', async () => {
    await token._setAuditKey(OTHER_KEY);

    expect((await token.getPublicState()).Audit__auditKey).toStrictEqual(
      OTHER_KEY,
    );
  });

  it('should not accept the identity point and should keep the old key', async () => {
    await expectRejection(token._setAuditKey(IDENTITY), ERR.identityKey);

    expect((await token.getPublicState()).Audit__auditKey).toStrictEqual(
      AUDIT_KEY,
    );
  });

  it('should accept the current key', async () => {
    await token._setAuditKey(AUDIT_KEY);

    expect((await token.getPublicState()).Audit__auditKey).toStrictEqual(
      AUDIT_KEY,
    );
  });

  it('should leave the trail untouched', async () => {
    await token._audit(OWNER, NOTE.value, NOTE.nonce, SLOT);
    const before = await records();
    await token._setAuditKey(OTHER_KEY);

    expect(await records()).toStrictEqual(before);
  });
});

// ---------------------------------------------------------------------------
// _audit
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenAudit: _audit', () => {
  beforeEach(async () => {
    token = await deploy();
  });

  it('should start with an empty trail', async () => {
    const state = await token.getPublicState();

    expect(state.Audit__auditTrail.length()).toBe(0n);
    expect(state.Audit__auditTrail.head().is_some).toBe(false);
  });

  it('should add one record per call, newest first', async () => {
    await token._audit(OWNER, 1n, 11n, SLOT);
    await token._audit(OTHER_OWNER, 2n, 22n, SLOT);

    const [newest, oldest] = await records();
    expect(await trailLength()).toBe(2n);
    expect(audit.recoverRecord(newest, AUDIT_SCALAR)).toMatchObject({
      value: 2n,
      nonce: 22n,
    });
    expect(audit.recoverRecord(oldest, AUDIT_SCALAR)).toMatchObject({
      value: 1n,
      nonce: 11n,
    });
    expect(
      (await token.getPublicState()).Audit__auditTrail.head().value,
    ).toStrictEqual(newest);
  });

  it('should leave earlier records untouched', async () => {
    await token._audit(OWNER, NOTE.value, NOTE.nonce, SLOT);
    const [first] = await records();
    await token._audit(OTHER_OWNER, 5n, 55n, OTHER_SLOT);

    expect((await records())[1]).toStrictEqual(first);
  });

  it('should open to the value, the nonce and the two owner limbs under the audit scalar', async () => {
    await token._audit(OWNER, NOTE.value, NOTE.nonce, SLOT);
    const [record] = await records();

    expect(audit.recoverRecord(record, AUDIT_SCALAR)).toStrictEqual({
      value: NOTE.value,
      nonce: NOTE.nonce,
      ownerLo: OWNER_LO,
      ownerHi: OWNER_HI,
    });
  });

  it('should round-trip the owner through ownerOf', async () => {
    await token._audit(OWNER, NOTE.value, NOTE.nonce, SLOT);
    const [record] = await records();
    const { ownerLo, ownerHi } = audit.recoverRecord(record, AUDIT_SCALAR);

    expect(audit.ownerOf(ownerLo, ownerHi)).toStrictEqual(OWNER);
  });

  // The widest inputs force the wrap arm of every pad. `head()` is the accessor
  // a wider ciphertext atom breaks.
  it('should open the widest record through head() with every ciphertext below 2^248', async () => {
    const widest = keyArm(new Uint8Array(32).fill(0xff));
    await token._audit(widest, U128 - 1n, U248 - 1n, SLOT);
    const state = await token.getPublicState();
    const [record] = [...state.Audit__auditTrail];

    for (const ct of [
      record.valueCt,
      record.nonceCt,
      record.ownerLoCt,
      record.ownerHiCt,
    ]) {
      expect(ct).toBeLessThan(U248);
    }
    expect(record.ownerLoCt).not.toBe(record.ownerHiCt);
    expect(state.Audit__auditTrail.head().value).toStrictEqual(record);
    const opened = audit.recoverRecord(record, AUDIT_SCALAR);
    expect(opened).toStrictEqual({
      value: U128 - 1n,
      nonce: U248 - 1n,
      ownerLo: U128 - 1n,
      ownerHi: U128 - 1n,
    });
    expect(audit.ownerOf(opened.ownerLo, opened.ownerHi)).toStrictEqual(widest);
  });

  // Each field has its own pad tag: equal plaintexts must not give equal
  // ciphertexts.
  it('should give four fields with one plaintext four distinct ciphertexts', async () => {
    const bytes = new Uint8Array(32);
    bytes[0] = 5;
    bytes[16] = 5;
    await token._audit(keyArm(bytes), 5n, 5n, SLOT);
    const [record] = await records();

    expect(audit.recoverRecord(record, AUDIT_SCALAR)).toStrictEqual({
      value: 5n,
      nonce: 5n,
      ownerLo: 5n,
      ownerHi: 5n,
    });
    expect(
      new Set([
        record.valueCt,
        record.nonceCt,
        record.ownerLoCt,
        record.ownerHiCt,
      ]).size,
    ).toBe(4);
  });

  it('should open a zero-value record with a zero nonce', async () => {
    await token._audit(OWNER, 0n, 0n, SLOT);
    const [record] = await records();

    expect(audit.recoverRecord(record, AUDIT_SCALAR)).toMatchObject({
      value: 0n,
      nonce: 0n,
    });
  });

  it('should record a zero key owner', async () => {
    await token._audit(keyArm(ZERO), NOTE.value, NOTE.nonce, SLOT);
    const [record] = await records();
    const opened = audit.recoverRecord(record, AUDIT_SCALAR);

    expect(opened).toStrictEqual({ ...NOTE, ownerLo: 0n, ownerHi: 0n });
    expect(audit.ownerOf(0n, 0n)).toStrictEqual(keyArm(ZERO));
  });

  it('should not accept a nonce of 2^248', async () => {
    await expectRejection(token._audit(OWNER, 1n, U248, SLOT), ERR.castNonce);
    expect(await trailLength()).toBe(0n);
  });

  it('should not accept a zero seed', async () => {
    token.wallet.auditSeed = ZERO;

    await expectRejection(
      token._audit(OWNER, NOTE.value, NOTE.nonce, SLOT),
      ERR.zeroSeed,
    );
    expect(await trailLength()).toBe(0n);
  });

  it('should give two records of one note distinct ephemerals under fresh seeds', async () => {
    await token._audit(OWNER, NOTE.value, NOTE.nonce, SLOT);
    await token._audit(OWNER, NOTE.value, NOTE.nonce, SLOT);
    const [second, first] = await records();

    expect(second.ephemeralPk).not.toStrictEqual(first.ephemeralPk);
    expect(audit.recoverRecord(second, AUDIT_SCALAR)).toStrictEqual(
      audit.recoverRecord(first, AUDIT_SCALAR),
    );
  });
});

// ---------------------------------------------------------------------------
// Owner checks
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenAudit: owner checks', () => {
  beforeEach(async () => {
    token = await deploy();
  });

  it.each([
    { label: 'a contract arm', owner: contractArm(bytes32('CONTRACT')) },
    { label: 'the zero contract arm', owner: contractArm(ZERO) },
    {
      label: 'a contract arm with a non-zero left arm',
      owner: {
        is_left: false,
        left: OWNER.left,
        right: { bytes: bytes32('CONTRACT') },
      },
    },
  ])('should not record $label', async ({ owner }) => {
    await expectRejection(
      token._audit(owner, NOTE.value, NOTE.nonce, SLOT),
      ERR.contractOwner,
    );
    expect(await trailLength()).toBe(0n);
  });

  it('should not record a key arm whose inactive arm is non-zero', async () => {
    const nonCanonical: Identifier = {
      is_left: true,
      left: OWNER.left,
      right: { bytes: bytes32('CONTRACT') },
    };

    await expectRejection(
      token._audit(nonCanonical, NOTE.value, NOTE.nonce, SLOT),
      ERR.nonCanonicalOwner,
    );
    expect(await trailLength()).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// recoverRecord
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenAudit: recoverRecord', () => {
  let record: AuditRecord;

  beforeEach(async () => {
    token = await deploy();
    await token._audit(OWNER, NOTE.value, NOTE.nonce, SLOT);
    [record] = await records();
  });

  it('should return a quadruple the filter drops under another scalar', () => {
    const wrong = audit.recoverRecord(record, OTHER_SCALAR);

    expect(passesFilter(wrong)).toBe(false);
    expect(wrong.nonce).not.toBe(NOTE.nonce);
  });

  // The shared point collapses to the identity; the circuit still returns.
  it('should return under the zero scalar', () => {
    const wrong = audit.recoverRecord(record, 0n);

    expect(passesFilter(wrong)).toBe(false);
    expect(wrong.nonce).not.toBe(NOTE.nonce);
  });

  it('should return for a record no circuit wrote', () => {
    const forged: AuditRecord = {
      ephemeralPk: ecMulGenerator(42n),
      valueCt: 1n,
      nonceCt: 2n,
      ownerLoCt: 3n,
      ownerHiCt: 4n,
    };

    expect(() => audit.recoverRecord(forged, AUDIT_SCALAR)).not.toThrow();
  });

  it('should reject a scalar of the group order at the API boundary', () => {
    expect(() => audit.recoverRecord(record, L)).toThrow(
      'expected value of type JubjubScalar',
    );
  });

  it('should not open a record whose ephemeral is the identity', () => {
    const placeholder = { ...record, ephemeralPk: IDENTITY };

    expect(() => audit.recoverRecord(placeholder, AUDIT_SCALAR)).toThrow(
      ERR.identityEphemeral,
    );
  });
});

// ---------------------------------------------------------------------------
// ownerOf
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenAudit: ownerOf', () => {
  it('should join bytes 0 to 15 from the low limb and 16 to 31 from the high limb, little-endian', () => {
    expect(audit.ownerOf(OWNER_LO, OWNER_HI)).toStrictEqual(OWNER);
  });

  it('should return a canonical key arm', () => {
    const owner = audit.ownerOf(OWNER_HI, OWNER_LO);

    expect(owner.is_left).toBe(true);
    expect(owner.right).toStrictEqual({ bytes: ZERO });
  });
});

// ---------------------------------------------------------------------------
// Pads under a reused seed
// ---------------------------------------------------------------------------

/**
 * The ephemeral is `RandPrfExpand.derive(tag, slot, [nonce, key, value,
 * owner])`, so with the seed pinned those five inputs are what separates two
 * records.
 */
describe('ConfidentialNoteFungibleTokenAudit: pads under a reused seed', () => {
  beforeEach(async () => {
    token = await deploy(1n, FIXED_SEED);
  });

  it('should repeat the record when every input repeats', async () => {
    await token._audit(OWNER, NOTE.value, NOTE.nonce, SLOT);
    await token._audit(OWNER, NOTE.value, NOTE.nonce, SLOT);
    const [second, first] = await records();

    expect(second).toStrictEqual(first);
  });

  it.each([
    {
      input: 'slot',
      second: () => token._audit(OWNER, NOTE.value, NOTE.nonce, OTHER_SLOT),
    },
    {
      input: 'nonce',
      second: () => token._audit(OWNER, NOTE.value, NOTE.nonce + 1n, SLOT),
    },
    {
      input: 'value',
      second: () => token._audit(OWNER, NOTE.value + 1n, NOTE.nonce, SLOT),
    },
    {
      input: 'owner',
      second: () => token._audit(OTHER_OWNER, NOTE.value, NOTE.nonce, SLOT),
    },
  ])(
    'should move the ephemeral when only the $input differs',
    async ({ second }) => {
      await token._audit(OWNER, NOTE.value, NOTE.nonce, SLOT);
      await second();
      const [later, first] = await records();

      expect(later.ephemeralPk).not.toStrictEqual(first.ephemeralPk);
      expect(passesFilter(audit.recoverRecord(later, AUDIT_SCALAR))).toBe(true);
    },
  );

  it('should move the ephemeral when only the key differs', async () => {
    await token._audit(OWNER, NOTE.value, NOTE.nonce, SLOT);
    await token._setAuditKey(OTHER_KEY);
    await token._audit(OWNER, NOTE.value, NOTE.nonce, SLOT);
    const [toOther, toAudit] = await records();

    expect(toOther.ephemeralPk).not.toStrictEqual(toAudit.ephemeralPk);
    expect(audit.recoverRecord(toOther, OTHER_SCALAR)).toStrictEqual(
      audit.recoverRecord(toAudit, AUDIT_SCALAR),
    );
  });
});

// ---------------------------------------------------------------------------
// Key rotation
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenAudit: key rotation', () => {
  beforeEach(async () => {
    token = await deploy();
  });

  it('should open each record under the key current when it was written, and under no other', async () => {
    await token._audit(OWNER, 1n, 11n, SLOT);
    await token._setAuditKey(OTHER_KEY);
    await token._audit(OWNER, 2n, 22n, SLOT);
    const [after, before] = await records();

    expect(audit.recoverRecord(before, AUDIT_SCALAR)).toStrictEqual({
      value: 1n,
      nonce: 11n,
      ownerLo: OWNER_LO,
      ownerHi: OWNER_HI,
    });
    expect(audit.recoverRecord(after, OTHER_SCALAR)).toStrictEqual({
      value: 2n,
      nonce: 22n,
      ownerLo: OWNER_LO,
      ownerHi: OWNER_HI,
    });
    expect(passesFilter(audit.recoverRecord(before, OTHER_SCALAR))).toBe(false);
    expect(passesFilter(audit.recoverRecord(after, AUDIT_SCALAR))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Composed with the core
// ---------------------------------------------------------------------------

/**
 * The auditor's view: every record opened under the audit scalar, filtered on
 * range, with its owner rebuilt and its leaf looked up in the core's tree.
 */
describe('ConfidentialNoteFungibleTokenAudit: composed with the core', () => {
  const ALICE_SK = bytes32('ALICE');
  const BOB_SK = bytes32('BOB');
  const RECOVERY_SK = bytes32('RECOVERY');
  const ALICE = composed.deriveIdentifier(ALICE_SK, NOTE_SALT);
  const BOB = composed.deriveIdentifier(BOB_SK, NOTE_SALT);
  const RECOVERY = composed.deriveIdentifier(RECOVERY_SK, NOTE_SALT);

  type Found = Note & { owner: Identifier; committed: boolean; spent: boolean };

  let audited: ConfidentialNoteFungibleTokenAuditedSimulator;

  /** Every record, newest first, as the auditor reads it. */
  const scan = async (): Promise<Found[]> => {
    const state = await audited.getPublicState();
    return [...state.Audit__auditTrail].map((record) => {
      const r = composed.recoverRecord(record, AUDIT_SCALAR);
      expect(passesFilter(r)).toBe(true);
      const owner = composed.ownerOf(r.ownerLo, r.ownerHi);
      const note = { value: r.value, nonce: r.nonce };
      return {
        ...note,
        owner,
        committed:
          state.Core__commitments.findPathForLeaf(
            composed.commitOf(note, owner),
          ) !== undefined,
        spent: state.Core__nullifiers.member(composed.nullifierOf(note)),
      };
    });
  };

  const cells = async () => {
    const state = await audited.getPublicState();
    return {
      leaves: state.Core__commitments.firstFree(),
      nullifiers: state.Core__nullifiers.size(),
      issuedNonces: state.Core__issuedNonces.size(),
      records: state.Audit__auditTrail.length(),
    };
  };

  const transferAs = async (
    sk: Uint8Array,
    owner: Identifier,
    recipient: Identifier,
    value: bigint,
    note: Note,
  ): Promise<[Note, Note]> => {
    audited.wallet.secretKey = sk;
    return audited.transfer(
      recipient,
      value,
      note,
      await audited.pathOf(note, owner),
    );
  };

  const burnAs = async (
    sk: Uint8Array,
    owner: Identifier,
    value: bigint,
    note: Note,
  ): Promise<Note> => {
    audited.wallet.secretKey = sk;
    return audited.burn(value, note, await audited.pathOf(note, owner));
  };

  const seize = async (target: Identifier, note: Note): Promise<Note> =>
    audited.seize(target, RECOVERY, note, await audited.pathOf(note, target));

  beforeEach(async () => {
    audited = await ConfidentialNoteFungibleTokenAuditedSimulator.create({
      auditKey: AUDIT_KEY,
    });
  });

  it('should record every leaf of a mint, a transfer, a full burn and a seize', async () => {
    const minted = await audited.mint(ALICE, 100n);
    const [out, change] = await transferAs(ALICE_SK, ALICE, BOB, 30n, minted);
    const burnChange = await burnAs(BOB_SK, BOB, 30n, out);
    const seized = await seize(ALICE, change);

    const found = await scan();
    const leaves = found.map(({ value, nonce, owner }) =>
      Buffer.from(composed.commitOf({ value, nonce }, owner)).toString('hex'),
    );
    expect((await cells()).leaves).toBe(5n);
    expect(found).toHaveLength(5);
    expect(found.every(({ committed }) => committed)).toBe(true);
    expect(new Set(leaves).size).toBe(5);
    expect(
      found.map(({ value, nonce, owner }) => [value, nonce, owner]),
    ).toStrictEqual([
      [seized.value, seized.nonce, RECOVERY],
      [0n, burnChange.nonce, BOB],
      [change.value, change.nonce, ALICE],
      [out.value, out.nonce, BOB],
      [minted.value, minted.nonce, ALICE],
    ]);
  });

  it.each([
    { circuit: 'mint', added: 1n, count: 'one record' },
    { circuit: 'transfer', added: 2n, count: 'two records' },
    { circuit: 'transfer of the whole note', added: 2n, count: 'two records' },
    { circuit: 'burn', added: 1n, count: 'one record' },
    { circuit: 'burn of the whole note', added: 1n, count: 'one record' },
    { circuit: 'seize', added: 1n, count: 'one record' },
  ])('should add $count per $circuit', async ({ circuit, added }) => {
    const note = await audited.mint(ALICE, 100n);
    const before = (await cells()).records;

    switch (circuit) {
      case 'mint':
        await audited.mint(BOB, 5n);
        break;
      case 'transfer':
        await transferAs(ALICE_SK, ALICE, BOB, 30n, note);
        break;
      case 'transfer of the whole note':
        await transferAs(ALICE_SK, ALICE, BOB, 100n, note);
        break;
      case 'burn':
        await burnAs(ALICE_SK, ALICE, 30n, note);
        break;
      case 'burn of the whole note':
        await burnAs(ALICE_SK, ALICE, 100n, note);
        break;
      case 'seize':
        await seize(ALICE, note);
        break;
    }

    expect((await cells()).records - before).toBe(added);
  });

  it('should record the recipient, then the spender for the change, of a transfer', async () => {
    const note = await audited.mint(ALICE, 100n);
    const [out, change] = await transferAs(ALICE_SK, ALICE, BOB, 100n, note);
    const [changeRecord, outRecord] = await scan();

    expect(changeRecord).toMatchObject({ ...change, owner: ALICE, value: 0n });
    expect(outRecord).toMatchObject({ ...out, owner: BOB });
  });

  it('should move the seized value to the recovery key and let its holder spend it', async () => {
    const note = await audited.mint(ALICE, 100n);
    const seized = await seize(ALICE, note);
    const state = await audited.getPublicState();

    expect(seized.value).toBe(note.value);
    expect(state.Core__nullifiers.member(composed.nullifierOf(note))).toBe(
      true,
    );
    const [record] = await scan();
    expect(record).toMatchObject({ ...seized, owner: RECOVERY });

    const change = await burnAs(RECOVERY_SK, RECOVERY, 40n, seized);
    expect(change.value).toBe(60n);
  });

  it('should not let the target spend a seized note', async () => {
    const note = await audited.mint(ALICE, 100n);
    const path = await audited.pathOf(note, ALICE);
    await seize(ALICE, note);
    audited.wallet.secretKey = ALICE_SK;

    await expectRejection(
      audited.burn(10n, note, path),
      'ConfidentialNoteFungibleToken: note already spent',
    );
  });

  // The auditor holds no wallet: the note, its owner and its path all come
  // from the trail and the public tree.
  it('should let the key holder find spent status and seize a note from the records alone', async () => {
    const note = await audited.mint(ALICE, 100n);
    await transferAs(ALICE_SK, ALICE, BOB, 30n, note);

    const found = await scan();
    expect(found.map(({ value, spent }) => [value, spent])).toStrictEqual([
      [70n, false],
      [30n, false],
      [100n, true],
    ]);

    const [, toBob] = found;
    const target = { value: toBob.value, nonce: toBob.nonce };
    const leaf = (
      await audited.getPublicState()
    ).Core__commitments.findPathForLeaf(composed.commitOf(target, toBob.owner));
    if (leaf === undefined) throw new Error('test setup: leaf not found');
    const seized = await audited.seize(
      toBob.owner,
      RECOVERY,
      target,
      leaf.path,
    );

    expect(seized.value).toBe(30n);
    expect((await scan())[2].spent).toBe(true);
  });

  // A note the hook cannot record must not exist: the core's writes revert
  // with the failed `_audit`.
  it.each([
    {
      recipient: 'a contract arm',
      pk: contractArm(bytes32('CONTRACT')),
      reason: ERR.contractOwner,
    },
    {
      recipient: 'a non-canonical key arm',
      pk: {
        is_left: true,
        left: bytes32('BOB-KEY'),
        right: { bytes: bytes32('CONTRACT') },
      },
      reason: ERR.nonCanonicalOwner,
    },
  ])(
    'should create nothing when a mint names $recipient',
    async ({ pk, reason }) => {
      const before = await cells();

      await expectRejection(audited.mint(pk, 10n), reason);
      expect(await cells()).toStrictEqual(before);
    },
  );

  it.each([
    {
      recipient: 'a contract arm',
      pk: contractArm(bytes32('CONTRACT')),
      reason: ERR.contractOwner,
    },
    {
      recipient: 'a non-canonical key arm',
      pk: {
        is_left: true,
        left: bytes32('BOB-KEY'),
        right: { bytes: bytes32('CONTRACT') },
      },
      reason: ERR.nonCanonicalOwner,
    },
  ])(
    'should spend nothing when a transfer names $recipient',
    async ({ pk, reason }) => {
      const note = await audited.mint(ALICE, 100n);
      const before = await cells();

      await expectRejection(transferAs(ALICE_SK, ALICE, pk, 30n, note), reason);
      expect(await cells()).toStrictEqual(before);
    },
  );

  it('should consume nothing when a seize names a contract-arm recovery key', async () => {
    const note = await audited.mint(ALICE, 100n);
    const before = await cells();

    await expectRejection(
      audited.seize(
        ALICE,
        contractArm(bytes32('CONTRACT')),
        note,
        await audited.pathOf(note, ALICE),
      ),
      ERR.contractOwner,
    );
    expect(await cells()).toStrictEqual(before);
  });

  it('should mint and record a note to the zero key', async () => {
    const zero = keyArm(ZERO);
    const note = await audited.mint(zero, 10n);
    const [record] = await scan();

    expect(record).toMatchObject({ ...note, owner: zero, committed: true });
  });

  it('should record a mint after a rotation to the new key only', async () => {
    await audited._setAuditKey(OTHER_KEY);
    await audited.mint(ALICE, 10n);
    const [record] = [...(await audited.getPublicState()).Audit__auditTrail];

    expect(passesFilter(composed.recoverRecord(record, AUDIT_SCALAR))).toBe(
      false,
    );
    expect(composed.recoverRecord(record, OTHER_SCALAR)).toMatchObject({
      value: 10n,
    });
  });

  it('should find no commitment path for a note never minted', async () => {
    await expect(
      audited.pathOf({ value: 1n, nonce: 1n }, ALICE),
    ).rejects.toThrow('pathOf: commitment not found in tree');
  });

  // The pads are malleable: a shifted ciphertext opens to a shifted plaintext
  // that passes the range filter. The commitment lookup drops it.
  it('should drop a tampered record at the commitment check', async () => {
    const note = await audited.mint(ALICE, 100n);
    const state = await audited.getPublicState();
    const [record] = [...state.Audit__auditTrail];
    const isLeaf = (r: RecoveredRecord): boolean =>
      state.Core__commitments.findPathForLeaf(
        composed.commitOf(
          { value: r.value, nonce: r.nonce },
          composed.ownerOf(r.ownerLo, r.ownerHi),
        ),
      ) !== undefined;
    const shifted = (ct: bigint): bigint => (ct + 1n) % U248;
    const genuine = composed.recoverRecord(record, AUDIT_SCALAR);

    expect(isLeaf(genuine)).toBe(true);

    const value = composed.recoverRecord(
      { ...record, valueCt: shifted(record.valueCt) },
      AUDIT_SCALAR,
    );
    expect(passesFilter(value)).toBe(true);
    expect(value.value).toBe(note.value + 1n);
    expect(isLeaf(value)).toBe(false);

    const owner = composed.recoverRecord(
      { ...record, ownerLoCt: shifted(record.ownerLoCt) },
      AUDIT_SCALAR,
    );
    expect(passesFilter(owner)).toBe(true);
    expect(owner.ownerLo).toBe(genuine.ownerLo + 1n);
    expect(isLeaf(owner)).toBe(false);

    const ephemeral = composed.recoverRecord(
      { ...record, ephemeralPk: ecMulGenerator(42n) },
      AUDIT_SCALAR,
    );
    expect(passesFilter(ephemeral)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fallback witnesses
// ---------------------------------------------------------------------------

// `_create` skips `create`'s wiring, so the factory's fallback wallet answers
// the seed witness with a fresh random seed.
describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenAudit: fallback witnesses',
  () => {
    it('should audit through the fallback witnesses in the standalone mock', async () => {
      const bare = await ConfidentialNoteFungibleTokenAuditSimulator._create([
        AUDIT_KEY,
        1n,
      ]);
      await bare.circuits.impure._audit(OWNER, NOTE.value, NOTE.nonce, SLOT);
      const [record] = [...(await bare.getPublicState()).Audit__auditTrail];

      expect(audit.recoverRecord(record, AUDIT_SCALAR)).toStrictEqual({
        ...NOTE,
        ownerLo: OWNER_LO,
        ownerHi: OWNER_HI,
      });
    });

    it('should audit through the fallback witnesses in the composed mock', async () => {
      const bare = await ConfidentialNoteFungibleTokenAuditedSimulator._create([
        NOTE_SALT,
        AUDIT_KEY,
      ]);
      const note = await bare.circuits.impure.mint(OWNER, 10n);
      const [record] = [...(await bare.getPublicState()).Audit__auditTrail];

      expect(composed.recoverRecord(record, AUDIT_SCALAR)).toStrictEqual({
        ...note,
        ownerLo: OWNER_LO,
        ownerHi: OWNER_HI,
      });
    });
  },
);
