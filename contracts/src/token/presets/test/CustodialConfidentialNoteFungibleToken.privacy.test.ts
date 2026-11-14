/**
 * Privacy claims for the CustodialConfidentialNoteFungibleToken preset, as
 * executable assertions.
 *
 * The probes drive the mock directly so every call keeps its `proofData`:
 *
 *   publicTranscript          the ledger operations the transaction publishes
 *   privateTranscriptOutputs  the witness answers, which stay on the prover
 *
 * The issuer id is public by design, and the gate's transcript carries it as
 * the expected value of its read. The claims are that no secret reaches the
 * transcript, that the issuer's id never meets a holder's spend, and that the
 * issuer's note key, its account under the other salt, is never published
 * next to its id. What the core publishes per note is the core suite's claim.
 *
 * Everything above the published-transaction block runs dry. That block runs
 * live and scans the transaction as the indexer stored it.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  AlignedValue,
  CircuitContext,
  CircuitResults,
  MerkleTreePathEntry,
  Op,
} from '@midnight-ntwrk/compact-runtime';
import { dummyContractAddress } from '@midnight-ntwrk/compact-runtime';
import {
  CircuitContextManager,
  isLiveBackend,
} from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  awaitPublishedTxs,
  indexerHead,
} from '#test-utils/harness/publishedTx.js';
import {
  type Ledger,
  ledger,
  Contract as MockCustodial,
  pureCircuits as preset,
} from '../../../../artifacts/token/presets/test/mocks/MockCustodialConfidentialNoteFungibleToken/contract/index.js';
import {
  type Account,
  CustodialConfidentialNoteFungibleTokenSimulator,
  type Note,
} from './simulators/CustodialConfidentialNoteFungibleTokenSimulator.js';
import {
  CustodialConfidentialNoteFungibleTokenWitnesses,
  type CustodialWallet,
  ISSUER_SALT,
  NOTE_SALT,
} from './witnesses/CustodialConfidentialNoteFungibleTokenWitnesses.js';

// ---------------------------------------------------------------------------
// Probe: the mock driven directly, so `proofData` survives
// ---------------------------------------------------------------------------

const secretKey = (label: string): Uint8Array => {
  const sk = new Uint8Array(32);
  sk.set(new TextEncoder().encode(label));
  return sk;
};

const ISSUER_SK = secretKey('ISSUER');
const SUCCESSOR_SK = secretKey('SUCCESSOR');
const ALICE_SK = secretKey('ALICE');
const SUCCESSOR = preset.deriveAccount(SUCCESSOR_SK, ISSUER_SALT);
const ALICE = preset.deriveAccount(ALICE_SK, NOTE_SALT);
const BOB = preset.deriveAccount(secretKey('BOB'), NOTE_SALT);

// Planted so two probes derive byte-identical notes; the differential tests
// need every input equal except the one secret under study.
const SEED = secretKey('DIFFERENTIAL-SEED');

/** The mock declares no private state; the wallet carries the secrets. */
type PrivateState = Record<string, never>;

type Trace = {
  transcript: Op<AlignedValue>[];
  privateOutputs: AlignedValue[];
};

/** Block time the probes deploy at, pinned so two runs agree on every input. */
const PROBE_TIME = 0;

/** The mock, deployed with the issuer behind `issuerSk`. */
class Probe {
  readonly wallet: CustodialWallet;
  private readonly contract: MockCustodial<PrivateState>;
  private readonly manager: CircuitContextManager<PrivateState>;

  private constructor(issuerSk: Uint8Array) {
    this.wallet = { secretKey: issuerSk, nonceSeed: SEED };
    this.contract = new MockCustodial<PrivateState>(
      CustodialConfidentialNoteFungibleTokenWitnesses<Ledger, PrivateState>(
        this.wallet,
      ),
    );
    this.manager = new CircuitContextManager<PrivateState>(
      this.contract,
      {},
      '0'.repeat(64),
      dummyContractAddress(),
      PROBE_TIME,
      preset.deriveAccount(issuerSk, ISSUER_SALT),
      ISSUER_SALT,
      NOTE_SALT,
      1n,
    );
  }

  static async create(issuerSk: Uint8Array = ISSUER_SK): Promise<Probe> {
    const probe = new Probe(issuerSk);
    await probe.manager.init();
    return probe;
  }

  /** Runs one circuit and keeps the root call's proof data. */
  private async run<T>(
    call: (
      context: CircuitContext<PrivateState>,
    ) => Promise<CircuitResults<PrivateState, T>>,
  ): Promise<[T, Trace]> {
    const { result, context } = await call(this.manager.getContext());
    this.manager.setContext(context);
    // One entry per call in the tree, depth-first, so the root circuit is last.
    const proofData = context.callProofDataTrace.at(-1);
    if (proofData === undefined) {
      throw new Error('probe: circuit produced no proof data');
    }
    return [
      result,
      {
        transcript: proofData.publicTranscript,
        privateOutputs: proofData.privateTranscriptOutputs,
      },
    ];
  }

  actAs(sk: Uint8Array): void {
    this.wallet.secretKey = sk;
  }

  mint(recipientPk: Account, value: bigint): Promise<[Note, Trace]> {
    return this.run((ctx) =>
      this.contract.impureCircuits.mint(ctx, recipientPk, value),
    );
  }

  transfer(
    recipientPk: Account,
    value: bigint,
    note: Note,
  ): Promise<[[Note, Note], Trace]> {
    return this.run((ctx) =>
      this.contract.impureCircuits.transfer(
        ctx,
        recipientPk,
        value,
        note,
        this.pathOf(note),
      ),
    );
  }

  burn(value: bigint, note: Note): Promise<[Note, Trace]> {
    return this.run((ctx) =>
      this.contract.impureCircuits.burn(ctx, value, note, this.pathOf(note)),
    );
  }

  transferOwnership(newOwner: Account): Promise<[[], Trace]> {
    return this.run((ctx) =>
      this.contract.impureCircuits.transferOwnership(ctx, newOwner),
    );
  }

  /** The path entries of `note` under the acting secret's note key. */
  private pathOf(note: Note): MerkleTreePathEntry[] {
    const owner = preset.deriveAccount(this.wallet.secretKey, NOTE_SALT);
    const path = this.state.Token_Core__commitments.findPathForLeaf(
      preset.commitOf(note, owner),
    );
    if (path === undefined) {
      throw new Error('probe: note not committed under the acting key');
    }
    return path.path;
  }

  get state(): Ledger {
    return ledger(
      this.manager.getContext().callContext.currentQueryContext.state.state,
    );
  }
}

/** A probe with a note of 100 minted to alice, acting as alice. */
const aliceHolding = async (): Promise<[Probe, Note]> => {
  const probe = await Probe.create();
  const [note] = await probe.mint(ALICE, 100n);
  probe.actAs(ALICE_SK);
  return [probe, note];
};

// ---------------------------------------------------------------------------
// Reading a transcript
// ---------------------------------------------------------------------------

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/**
 * The runtime stores byte values with trailing zeros stripped, so a 32-byte
 * value whose tail is padding appears in a transcript under its trimmed form.
 */
const encoded = (bytes: Uint8Array): string => {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return hex(bytes.subarray(0, end));
};

/** Both forms a 32-byte value can take in a transcript. */
const encodingsOfBytes = (bytes: Uint8Array): string[] => [
  ...new Set([hex(bytes), encoded(bytes)]),
];

/** The atoms an account is published as: the flag, then each arm. */
const encodingsOfAccount = (account: Account): string[] => [
  account.is_left ? '01' : '',
  encoded(account.left),
  encoded(account.right.bytes),
];

/** Every byte string appearing anywhere in a transcript or aligned value. */
const bytesIn = (node: unknown, found: string[] = []): string[] => {
  if (node instanceof Uint8Array) {
    found.push(hex(node));
  } else if (Array.isArray(node)) {
    for (const child of node) bytesIn(child, found);
  } else if (node !== null && typeof node === 'object') {
    for (const child of Object.values(node)) bytesIn(child, found);
  }
  return found;
};

const opKind = (op: Op<AlignedValue>): string =>
  typeof op === 'string' ? op : (Object.keys(op as object)[0] ?? '?');

/** The operation sequence with every operand stripped: the public shape. */
const shapeOf = (transcript: Op<AlignedValue>[]): string[] =>
  transcript.map(opKind);

/** The values pushed for storage, which is every value a write publishes. */
const storedOf = (transcript: Op<AlignedValue>[]): string[] =>
  transcript
    .filter(
      (op) =>
        opKind(op) === 'push' &&
        (op as { push: { storage: boolean } }).push.storage,
    )
    .flatMap((op) => bytesIn((op as { push: unknown }).push));

const insertsIn = (transcript: Op<AlignedValue>[]): number =>
  shapeOf(transcript).filter((kind) => kind === 'ins').length;

/** Cell indices of the mock's seven slots, as published. */
const CELL_INDICES = ['', '01', '02', '03', '04', '05', '06'];

/**
 * What a handover may publish on its own account: the cell indices and the
 * preset and `Ownable` values the ledger held before the call.
 */
const publicBefore = (state: Ledger): string[] => [
  ...CELL_INDICES,
  encoded(state.Token__issuerSalt),
  encoded(state.Token__noteSalt),
  state.Token_Ownable__isInitialized ? '01' : '',
  ...encodingsOfAccount(state.Token_Ownable__owner),
];

/** Published values the allowed set does not account for. */
const unaccounted = (trace: Trace, allowed: string[]): string[] =>
  bytesIn(trace.transcript).filter((value) => !allowed.includes(value));

/** Asserts neither `secret` nor its note key was published. */
const expectSecretAbsent = (trace: Trace, secret: Uint8Array): void => {
  const published = bytesIn(trace.transcript);
  for (const form of [
    ...encodingsOfBytes(secret),
    encoded(preset.deriveAccount(secret, NOTE_SALT).left),
  ]) {
    expect(published).not.toContain(form);
  }
};

/** The preset's and `Ownable`'s cells, in a form `toStrictEqual` compares. */
const cellsOf = (state: Ledger) => ({
  issuerSalt: hex(state.Token__issuerSalt),
  noteSalt: hex(state.Token__noteSalt),
  initialized: state.Token_Ownable__isInitialized,
  owner: state.Token_Ownable__owner,
});

/**
 * Digest-width values a transcript publishes. Not an exact 32 bytes: the
 * runtime zero-trims, so a key whose edge byte is zero arrives a byte short.
 */
const DIGEST_MIN_HEX = 56;

/** A published value's width, with every digest counted alike. */
const widthOf = (bytes: string): number =>
  bytes.length >= DIGEST_MIN_HEX ? DIGEST_MIN_HEX : bytes.length;

/** The byte strings that move between two otherwise identical runs. */
const drift = (a: Trace, b: Trace): string[] => {
  const left = bytesIn(a.transcript);
  const right = bytesIn(b.transcript);
  expect(left).toHaveLength(right.length);
  return left.filter((value, i) => value !== right[i]);
};

const anySecret = () =>
  fc
    .uint8Array({ minLength: 32, maxLength: 32 })
    .filter((sk) => sk.some((byte) => byte !== 0));

const PRESET_SOURCE = readFileSync(
  new URL('../CustodialConfidentialNoteFungibleToken.compact', import.meta.url),
  'utf8',
);

/** Source lines with doc and line comments dropped. */
const codeLines = (source: string): string[] =>
  source
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        !line.startsWith('*') &&
        !line.startsWith('/*') &&
        !line.startsWith('//'),
    );

// ---------------------------------------------------------------------------
// What reaches the public transcript
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'CustodialConfidentialNoteFungibleToken privacy: the public transcript',
  () => {
    // The positive control is the issuer id: the gate reads it, so it must be
    // findable where the secret was not.
    it('should not carry the issuer secret through a gated mint', async () => {
      const probe = await Probe.create();
      const [, trace] = await probe.mint(ALICE, 100n);

      expectSecretAbsent(trace, ISSUER_SK);
      expect(bytesIn(trace.transcript)).toContain(
        encoded(preset.deriveAccount(ISSUER_SK, ISSUER_SALT).left),
      );
      expect(bytesIn(trace.privateOutputs)).toContain(encoded(ISSUER_SK));
    });

    it('should publish nothing from the issuer secret on a mint, for any secret', async () => {
      await fc.assert(
        fc.asyncProperty(anySecret(), async (secret) => {
          const probe = await Probe.create(secret);
          const [, trace] = await probe.mint(ALICE, 100n);

          expectSecretAbsent(trace, secret);
        }),
        { numRuns: 10 },
      );
    });

    // The issuer's note key is its account under the note salt. A mint to it
    // publishes the issuer id and still leaves the note key off the wire.
    it('should not publish the issuer note key when the issuer mints to itself', async () => {
      const probe = await Probe.create();
      const [, trace] = await probe.mint(
        preset.deriveAccount(ISSUER_SK, NOTE_SALT),
        100n,
      );

      expectSecretAbsent(trace, ISSUER_SK);
    });

    it('should publish only the new owner beyond the prior ledger on handover', async () => {
      await fc.assert(
        fc.asyncProperty(anySecret(), anySecret(), async (secret, next) => {
          const probe = await Probe.create(secret);
          const before = probe.state;
          const newOwner = preset.deriveAccount(next, ISSUER_SALT);
          const [, trace] = await probe.transferOwnership(newOwner);

          expect(storedOf(trace.transcript)).toStrictEqual(
            encodingsOfAccount(newOwner),
          );
          expect(
            unaccounted(trace, [
              ...publicBefore(before),
              ...encodingsOfAccount(newOwner),
            ]),
          ).toStrictEqual([]);
          expectSecretAbsent(trace, secret);
          expectSecretAbsent(trace, next);
        }),
        { numRuns: 10 },
      );
    });

    it.each([
      {
        circuit: 'transfer',
        spend: (probe: Probe, note: Note) => probe.transfer(BOB, 30n, note),
      },
      {
        circuit: 'burn',
        spend: (probe: Probe, note: Note) => probe.burn(30n, note),
      },
    ])(
      'should not read the issuer id or the issuer salt in a $circuit',
      async ({ spend }) => {
        const [probe, note] = await aliceHolding();
        const [, trace] = await spend(probe, note);
        const published = bytesIn(trace.transcript);

        expect(published).toContain(encoded(NOTE_SALT));
        expect(published).not.toContain(encoded(ISSUER_SALT));
        expect(published).not.toContain(
          encoded(preset.deriveAccount(ISSUER_SK, ISSUER_SALT).left),
        );
      },
    );

    it.each([
      {
        circuit: 'transfer',
        spend: (probe: Probe, note: Note) => probe.transfer(BOB, 30n, note),
      },
      {
        circuit: 'burn',
        spend: (probe: Probe, note: Note) => probe.burn(30n, note),
      },
    ])(
      "should carry the holder's secret on the private side only in a $circuit",
      async ({ spend }) => {
        const [probe, note] = await aliceHolding();
        const [, trace] = await spend(probe, note);

        expectSecretAbsent(trace, ALICE_SK);
        expect(bytesIn(trace.transcript)).not.toContain(encoded(BOB.left));
        expect(bytesIn(trace.privateOutputs)).toContain(encoded(ALICE_SK));
      },
    );
  },
);

// ---------------------------------------------------------------------------
// What a call writes
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'CustodialConfidentialNoteFungibleToken privacy: what a call writes',
  () => {
    it('should write one cell, the owner, on handover', async () => {
      const probe = await Probe.create();
      const before = cellsOf(probe.state);
      const [, trace] = await probe.transferOwnership(SUCCESSOR);

      expect(insertsIn(trace.transcript)).toBe(1);
      expect(cellsOf(probe.state)).toStrictEqual({
        ...before,
        owner: SUCCESSOR,
      });
    });

    it('should leave the salts and the owner untouched on mint, transfer and burn', async () => {
      const [probe, note] = await aliceHolding();
      const before = cellsOf(probe.state);

      const [[out]] = await probe.transfer(BOB, 30n, note);
      probe.actAs(secretKey('BOB'));
      await probe.burn(10n, out);
      probe.actAs(ISSUER_SK);
      await probe.mint(BOB, 5n);

      expect(cellsOf(probe.state)).toStrictEqual(before);
    });
  },
);

// ---------------------------------------------------------------------------
// Indistinguishability: the shape does not depend on the secrets
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'CustodialConfidentialNoteFungibleToken privacy: indistinguishability',
  () => {
    const mintTrace = async (issuer: Uint8Array): Promise<Trace> =>
      (await (await Probe.create(issuer)).mint(ALICE, 100n))[1];

    const handoverTrace = async (
      issuer: Uint8Array,
      next: Uint8Array,
    ): Promise<Trace> =>
      (
        await (
          await Probe.create(issuer)
        ).transferOwnership(preset.deriveAccount(next, ISSUER_SALT))
      )[1];

    const transferTrace = async (holder: Uint8Array): Promise<Trace> => {
      const probe = await Probe.create();
      const [note] = await probe.mint(
        preset.deriveAccount(holder, NOTE_SALT),
        100n,
      );
      probe.actAs(holder);
      return (await probe.transfer(BOB, 30n, note))[1];
    };

    const expectSameShape = (left: Trace, right: Trace): void => {
      expect(shapeOf(left.transcript)).toStrictEqual(shapeOf(right.transcript));
      expect(bytesIn(left.transcript).map(widthOf)).toStrictEqual(
        bytesIn(right.transcript).map(widthOf),
      );
    };

    it('should mint with the same transcript shape and widths for any issuer', async () => {
      await fc.assert(
        fc.asyncProperty(anySecret(), anySecret(), async (a, b) => {
          expectSameShape(await mintTrace(a), await mintTrace(b));
        }),
        { numRuns: 10 },
      );
    }, 60_000);

    // Same seed, recipient and value, so the note is byte-identical: what moves
    // is the gate's two reads of the owner.
    it('should move only the owner reads between two issuers', async () => {
      await fc.assert(
        fc.asyncProperty(anySecret(), anySecret(), async (a, b) => {
          fc.pre(hex(a) !== hex(b));

          const moved = drift(await mintTrace(a), await mintTrace(b));
          const owner = encoded(preset.deriveAccount(a, ISSUER_SALT).left);

          expect(moved).toStrictEqual([owner, owner]);
        }),
        { numRuns: 10 },
      );
    });

    it('should hand over with the same transcript shape and widths for any secrets', async () => {
      await fc.assert(
        fc.asyncProperty(
          anySecret(),
          anySecret(),
          anySecret(),
          anySecret(),
          async (a, nextA, b, nextB) => {
            expectSameShape(
              await handoverTrace(a, nextA),
              await handoverTrace(b, nextB),
            );
          },
        ),
        { numRuns: 10 },
      );
    });

    it('should move only the owner reads and the new owner between two handovers', async () => {
      await fc.assert(
        fc.asyncProperty(
          anySecret(),
          anySecret(),
          anySecret(),
          anySecret(),
          async (a, nextA, b, nextB) => {
            fc.pre(hex(a) !== hex(b) && hex(nextA) !== hex(nextB));

            const moved = drift(
              await handoverTrace(a, nextA),
              await handoverTrace(b, nextB),
            );
            const owner = encoded(preset.deriveAccount(a, ISSUER_SALT).left);

            expect(moved).toStrictEqual([
              owner,
              owner,
              encoded(preset.deriveAccount(nextA, ISSUER_SALT).left),
            ]);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('should transfer with the same transcript shape and widths for any holder', async () => {
      await fc.assert(
        fc.asyncProperty(anySecret(), anySecret(), async (a, b) => {
          expectSameShape(await transferTrace(a), await transferTrace(b));
        }),
        { numRuns: 10 },
      );
    }, 60_000);
  },
);

// ---------------------------------------------------------------------------
// The disclose surface
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'CustodialConfidentialNoteFungibleToken privacy: the disclose surface',
  () => {
    // Every crossing of the privacy boundary is one `disclose()`. Pinning the
    // exact set means a new one fails a test instead of relying on review.
    it('should disclose only at the two reviewed sites', () => {
      const sites = codeLines(PRESET_SOURCE).filter((line) =>
        line.includes('disclose('),
      );

      expect(sites).toStrictEqual([
        '_issuerSalt = disclose(issuerSalt);',
        '_noteSalt = disclose(noteSalt);',
      ]);
    });

    it('should not disclose a witness value directly', () => {
      expect(PRESET_SOURCE).not.toMatch(/disclose\(\s*wit_/);
    });

    // Every assert spans two lines, so the scan joins the code into one string.
    it('should fail every assert with a fixed message under the module prefix', () => {
      const code = codeLines(PRESET_SOURCE).join('\n');
      const calls = code.match(/\bassert\(/g) ?? [];
      const messages = [
        ...code.matchAll(/\bassert\([^;]*?,\s*"([^"]*)"\s*\);/g),
      ].map(([, message]) => message);

      expect(calls).toHaveLength(7);
      expect(messages).toStrictEqual([
        'CustodialConfidentialNoteFungibleToken: issuer salt must not be zero',
        'CustodialConfidentialNoteFungibleToken: note salt must not be zero',
        'CustodialConfidentialNoteFungibleToken: salts must differ',
        'CustodialConfidentialNoteFungibleToken: contract recipient',
        'CustodialConfidentialNoteFungibleToken: contract recipient',
        'CustodialConfidentialNoteFungibleToken: contract not initialized',
        'CustodialConfidentialNoteFungibleToken: contract not initialized',
      ]);
    });

    // A conditional write would make the presence of a write a private
    // predicate's shadow.
    it('should keep the module free of branches and loops', () => {
      const branching = codeLines(PRESET_SOURCE).filter(
        (line) =>
          /\bif\s*\(/.test(line) ||
          /\bfor\s*\(/.test(line) ||
          /\?[^?]*:/.test(line),
      );

      expect(branching).toStrictEqual([]);
    });
  },
);

// ---------------------------------------------------------------------------
// Ground truth: the transaction as the chain stored it
// ---------------------------------------------------------------------------

/**
 * Secrets are high-entropy so a short encoding cannot match proof bytes by
 * chance, and there is no differential layer: two real transactions differ in
 * proofs, fees and wallet nonces whatever the circuit does. Run single-worker
 * (`MIDNIGHT_LIVE_WORKERS=1`).
 */
describe.runIf(isLiveBackend())(
  'CustodialConfidentialNoteFungibleToken privacy: the published transaction',
  () => {
    const liveSecret = (): Uint8Array => new Uint8Array(randomBytes(32));

    const wireOf = async (
      token: CustodialConfidentialNoteFungibleTokenSimulator,
      from: number,
      entryPoint: string,
    ): Promise<string> => {
      const published = await awaitPublishedTxs(from, token.contractAddress, {
        entryPoint,
      });
      expect(published.length).toBeGreaterThan(0);
      return published.map((tx) => tx.raw.toLowerCase()).join('');
    };

    const expectNotOnWire = (wire: string, secret: Uint8Array): void => {
      for (const form of [
        ...encodingsOfBytes(secret),
        encoded(preset.deriveAccount(secret, NOTE_SALT).left),
      ]) {
        expect(wire).not.toContain(form);
      }
    };

    it('should not publish the issuer secret or its note key on a mint', async () => {
      const secret = liveSecret();
      const token =
        await CustodialConfidentialNoteFungibleTokenSimulator.create({
          wallet: { secretKey: secret },
        });

      const from = await indexerHead();
      await token.mint(ALICE, 100n);
      const wire = await wireOf(token, from, 'mint');

      expectNotOnWire(wire, secret);
      // The positive control: the issuer id is public by design.
      const id = preset.deriveAccount(secret, ISSUER_SALT).left;
      expect(wire).toContain(encoded(id));
    });

    it('should not publish either secret on handover', async () => {
      const secret = liveSecret();
      const next = liveSecret();
      const token =
        await CustodialConfidentialNoteFungibleTokenSimulator.create({
          wallet: { secretKey: secret },
        });

      const from = await indexerHead();
      await token.transferOwnership(preset.deriveAccount(next, ISSUER_SALT));
      const wire = await wireOf(token, from, 'transferOwnership');

      expectNotOnWire(wire, secret);
      expectNotOnWire(wire, next);
    });
  },
);
