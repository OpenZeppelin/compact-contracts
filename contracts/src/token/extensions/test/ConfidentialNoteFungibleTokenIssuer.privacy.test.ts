/**
 * Privacy claims for the ConfidentialNoteFungibleTokenIssuer extension, as
 * executable assertions.
 *
 * The probes drive the mocks directly so every call keeps its `proofData`:
 *
 *   publicTranscript          the ledger operations the transaction publishes
 *   privateTranscriptOutputs  the witness answers, which stay on the prover
 *
 * The issuer key is public by design, and the gate's transcript carries it as
 * the expected value of its read. The claim is therefore an accounting one:
 * every published value is a cell index, a value the ledger already held, or
 * the new key a rotation chose to publish. Nothing else, and nothing derived
 * from the secret, reaches the transcript.
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
  Op,
} from '@midnight-ntwrk/compact-runtime';
import {
  bigIntToValue,
  dummyContractAddress,
} from '@midnight-ntwrk/compact-runtime';
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
  pureCircuits as composed,
  Contract as MockIssued,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenIssued/contract/index.js';
import {
  pureCircuits as issuer,
  type Ledger,
  ledger,
  Contract as MockIssuer,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenIssuer/contract/index.js';
import {
  ConfidentialNoteFungibleTokenWitnesses,
  createNoteWallet,
  INSTANCE_SALT,
  type NoteCommitmentLedger,
} from '../../test/witnesses/ConfidentialNoteFungibleTokenWitnesses.js';
import { ConfidentialNoteFungibleTokenIssuerSimulator } from './simulators/ConfidentialNoteFungibleTokenIssuerSimulator.js';
import {
  ConfidentialNoteFungibleTokenIssuerWitnesses,
  type IssuerWallet,
} from './witnesses/ConfidentialNoteFungibleTokenIssuerWitnesses.js';

// ---------------------------------------------------------------------------
// Probes: the mocks driven directly, so `proofData` survives
// ---------------------------------------------------------------------------

const secretKey = (label: string): Uint8Array => {
  const sk = new Uint8Array(32);
  sk.set(new TextEncoder().encode(label));
  return sk;
};

const ISSUER_SK = secretKey('ISSUER');
const SUCCESSOR_SK = secretKey('SUCCESSOR');
const SUCCESSOR = issuer.derivePk(SUCCESSOR_SK, INSTANCE_SALT);
const RECIPIENT = composed.derivePk(secretKey('RECIPIENT'), INSTANCE_SALT);

// Compact `Field` modulus (BLS12-381 scalar field).
const P =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;

/** Neither mock declares private state; the wallets carry the secrets. */
type PrivateState = Record<string, never>;

type Trace = {
  transcript: Op<AlignedValue>[];
  privateOutputs: AlignedValue[];
};

/** Block time the probes deploy at, pinned so two runs agree on every input. */
const PROBE_TIME = 0;

/** Runs one circuit on `manager`'s state and keeps the root call's proof data. */
const traced = async <T>(
  manager: CircuitContextManager<PrivateState>,
  call: (
    context: CircuitContext<PrivateState>,
  ) => Promise<CircuitResults<PrivateState, T>>,
): Promise<[T, Trace]> => {
  const { result, context } = await call(manager.getContext());
  manager.setContext(context);
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
};

/** The standalone mock, deployed for the issuer behind `secret`. */
class Probe {
  readonly wallet: IssuerWallet;
  private readonly contract: MockIssuer<PrivateState>;
  private readonly manager: CircuitContextManager<PrivateState>;

  private constructor(secret: Uint8Array, salt: Uint8Array) {
    this.wallet = { secretKey: secret };
    this.contract = new MockIssuer<PrivateState>(
      ConfidentialNoteFungibleTokenIssuerWitnesses<Ledger, PrivateState>(
        this.wallet,
      ),
    );
    this.manager = new CircuitContextManager<PrivateState>(
      this.contract,
      {},
      '0'.repeat(64),
      dummyContractAddress(),
      PROBE_TIME,
      issuer.derivePk(secret, salt),
      salt,
    );
  }

  static async create(
    secret: Uint8Array = ISSUER_SK,
    salt: Uint8Array = INSTANCE_SALT,
  ): Promise<Probe> {
    const probe = new Probe(secret, salt);
    await probe.manager.init();
    return probe;
  }

  assertOnlyIssuer(): Promise<[[], Trace]> {
    return traced(this.manager, (ctx) =>
      this.contract.impureCircuits.assertOnlyIssuer(ctx),
    );
  }

  rotateIssuer(newIssuerPk: bigint): Promise<[[], Trace]> {
    return traced(this.manager, (ctx) =>
      this.contract.impureCircuits.rotateIssuer(ctx, newIssuerPk),
    );
  }

  _setIssuer(newIssuerPk: bigint): Promise<[[], Trace]> {
    return traced(this.manager, (ctx) =>
      this.contract.impureCircuits._setIssuer(ctx, newIssuerPk),
    );
  }

  get state(): Ledger {
    return ledger(
      this.manager.getContext().callContext.currentQueryContext.state.state,
    );
  }
}

/** The composed mock (core + issuer), for the gated mint. */
const mintTrace = async (secret: Uint8Array): Promise<Trace> => {
  const contract = new MockIssued<PrivateState>({
    ...ConfidentialNoteFungibleTokenWitnesses<NoteCommitmentLedger>(
      createNoteWallet(),
    ),
    ...ConfidentialNoteFungibleTokenIssuerWitnesses<
      NoteCommitmentLedger,
      PrivateState
    >({ secretKey: secret }),
  });
  const manager = new CircuitContextManager<PrivateState>(
    contract,
    {},
    '0'.repeat(64),
    dummyContractAddress(),
    PROBE_TIME,
    INSTANCE_SALT,
    composed.deriveIssuerPk(secret, INSTANCE_SALT),
  );
  await manager.init();
  const [, trace] = await traced(manager, (ctx) =>
    contract.impureCircuits.mint(ctx, RECIPIENT, 100n),
  );
  return trace;
};

// ---------------------------------------------------------------------------
// Reading a transcript
// ---------------------------------------------------------------------------

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/**
 * The runtime stores byte values with trailing zeros stripped, so a 32-byte
 * secret whose tail is padding appears in a transcript under its trimmed form.
 */
const encoded = (bytes: Uint8Array): string => {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return hex(bytes.subarray(0, end));
};

/** Both forms a 32-byte secret can take in a transcript. */
const encodingsOfBytes = (bytes: Uint8Array): string[] => [
  ...new Set([hex(bytes), encoded(bytes)]),
];

/** The form a `Field` takes in a transcript. */
const encodingsOf = (value: bigint): string[] => bigIntToValue(value).map(hex);

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

/** The values the transcript expects its ledger reads to return, in order. */
const readsOf = (transcript: Op<AlignedValue>[]): string[] =>
  transcript
    .filter((op) => opKind(op) === 'popeq')
    .flatMap((op) => bytesIn((op as { popeq: unknown }).popeq));

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

/** Cell indices of the standalone mock's three fields, as published. */
const CELL_INDICES = ['', '01', '02'];

/**
 * What a transcript may publish on its own account: the cell indices and the
 * values the ledger held before the call.
 */
const publicBefore = (state: Ledger): string[] => [
  ...CELL_INDICES,
  ...encodingsOf(state.Issuer__isInitialized ? 1n : 0n),
  encoded(state.Issuer__instanceSalt),
  ...encodingsOf(state.Issuer__issuerPk),
];

/** Published values the allowed set does not account for. */
const unaccounted = (trace: Trace, allowed: string[]): string[] =>
  bytesIn(trace.transcript).filter((value) => !allowed.includes(value));

/** Asserts no form of `secret`, and no core identity of it, was published. */
const expectSecretAbsent = (trace: Trace, secret: Uint8Array): void => {
  const published = bytesIn(trace.transcript);
  for (const form of [
    ...encodingsOfBytes(secret),
    ...encodingsOf(composed.derivePk(secret, INSTANCE_SALT)),
  ]) {
    expect(published).not.toContain(form);
  }
};

/** The standalone mock's three cells, in a form `toStrictEqual` compares. */
const cellsOf = (state: Ledger) => ({
  isInitialized: state.Issuer__isInitialized,
  instanceSalt: hex(state.Issuer__instanceSalt),
  issuerPk: state.Issuer__issuerPk,
});

/**
 * Digest-width values a transcript publishes. Not an exact 32 bytes: the
 * runtime zero-trims, so a key whose top byte is zero arrives a byte short.
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

const sourceOf = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const EXTENSION_SOURCE = sourceOf(
  '../ConfidentialNoteFungibleTokenIssuer.compact',
);
const PRF_SOURCES = [
  sourceOf('../../../crypto/prf/PrfCore.compact'),
  sourceOf('../../../crypto/prf/PrfAddr.compact'),
];

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
  'ConfidentialNoteFungibleTokenIssuer privacy: the public transcript',
  () => {
    it('should read the flag, the salt and the key when the gate passes, and store nothing', async () => {
      const probe = await Probe.create();
      const key = probe.state.Issuer__issuerPk;
      const [, trace] = await probe.assertOnlyIssuer();

      expect(readsOf(trace.transcript)).toStrictEqual([
        '01',
        encoded(INSTANCE_SALT),
        ...encodingsOf(key),
      ]);
      expect(shapeOf(trace.transcript)).not.toContain('push');
      expect(shapeOf(trace.transcript)).not.toContain('ins');
    });

    it('should publish nothing beyond the prior ledger when the gate passes, for any secret', async () => {
      await fc.assert(
        fc.asyncProperty(anySecret(), async (secret) => {
          const probe = await Probe.create(secret);
          const before = probe.state;
          const [, trace] = await probe.assertOnlyIssuer();

          expect(unaccounted(trace, publicBefore(before))).toStrictEqual([]);
          expectSecretAbsent(trace, secret);
        }),
        { numRuns: 10 },
      );
    });

    // The mirror image: the secret does exist, on the side that never leaves
    // the prover. Without this, a probe that read nothing would pass above.
    it('should carry the issuer secret on the private side only', async () => {
      const probe = await Probe.create();
      const [, trace] = await probe.assertOnlyIssuer();

      expect(bytesIn(trace.privateOutputs)).toContain(encoded(ISSUER_SK));
      expect(bytesIn(trace.transcript)).not.toContain(encoded(ISSUER_SK));
    });

    it('should publish only the new key beyond the prior ledger on rotation', async () => {
      await fc.assert(
        fc.asyncProperty(anySecret(), anySecret(), async (secret, next) => {
          const probe = await Probe.create(secret);
          const before = probe.state;
          const newKey = issuer.derivePk(next, INSTANCE_SALT);
          const [, trace] = await probe.rotateIssuer(newKey);

          expect(storedOf(trace.transcript)).toStrictEqual(encodingsOf(newKey));
          expect(
            unaccounted(trace, [
              ...publicBefore(before),
              ...encodingsOf(newKey),
            ]),
          ).toStrictEqual([]);
          expectSecretAbsent(trace, secret);
          expectSecretAbsent(trace, next);
        }),
        { numRuns: 10 },
      );
    });

    it('should read only the flag and publish only the new key on _setIssuer', async () => {
      const probe = await Probe.create();
      const before = probe.state;
      const [, trace] = await probe._setIssuer(SUCCESSOR);

      expect(readsOf(trace.transcript)).toStrictEqual(['01']);
      expect(storedOf(trace.transcript)).toStrictEqual(encodingsOf(SUCCESSOR));
      expect(
        unaccounted(trace, [
          ...publicBefore(before),
          ...encodingsOf(SUCCESSOR),
        ]),
      ).toStrictEqual([]);
    });

    // The positive control is the issuer key: the gate reads it, so it must be
    // findable where the secret was not.
    it('should not carry the issuer secret through a gated mint', async () => {
      const trace = await mintTrace(ISSUER_SK);
      const published = bytesIn(trace.transcript);

      expectSecretAbsent(trace, ISSUER_SK);
      expect(published).toContain(
        encodingsOf(composed.deriveIssuerPk(ISSUER_SK, INSTANCE_SALT))[0],
      );
      expect(bytesIn(trace.privateOutputs)).toContain(encoded(ISSUER_SK));
    });
  },
);

// ---------------------------------------------------------------------------
// What a call writes
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenIssuer privacy: what a call writes',
  () => {
    it('should write nothing when the gate passes', async () => {
      const probe = await Probe.create();
      const before = cellsOf(probe.state);
      const [, trace] = await probe.assertOnlyIssuer();

      expect(insertsIn(trace.transcript)).toBe(0);
      expect(cellsOf(probe.state)).toStrictEqual(before);
    });

    it('should write one cell, the issuer key, on rotation', async () => {
      const probe = await Probe.create();
      const before = cellsOf(probe.state);
      const [, trace] = await probe.rotateIssuer(SUCCESSOR);

      expect(insertsIn(trace.transcript)).toBe(1);
      expect(cellsOf(probe.state)).toStrictEqual({
        ...before,
        issuerPk: SUCCESSOR,
      });
    });

    it('should write one cell, the issuer key, on _setIssuer', async () => {
      const probe = await Probe.create();
      const before = cellsOf(probe.state);
      const [, trace] = await probe._setIssuer(SUCCESSOR);

      expect(insertsIn(trace.transcript)).toBe(1);
      expect(cellsOf(probe.state)).toStrictEqual({
        ...before,
        issuerPk: SUCCESSOR,
      });
    });
  },
);

// ---------------------------------------------------------------------------
// Indistinguishability: the shape does not depend on the secrets
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenIssuer privacy: indistinguishability',
  () => {
    const gateTrace = async (secret: Uint8Array): Promise<Trace> =>
      (await (await Probe.create(secret)).assertOnlyIssuer())[1];

    const rotationTrace = async (
      secret: Uint8Array,
      next: Uint8Array,
    ): Promise<Trace> =>
      (
        await (
          await Probe.create(secret)
        ).rotateIssuer(issuer.derivePk(next, INSTANCE_SALT))
      )[1];

    it('should run the gate with the same transcript shape and widths for any secret', async () => {
      await fc.assert(
        fc.asyncProperty(anySecret(), anySecret(), async (a, b) => {
          const left = await gateTrace(a);
          const right = await gateTrace(b);

          expect(shapeOf(left.transcript)).toStrictEqual(
            shapeOf(right.transcript),
          );
          expect(bytesIn(left.transcript).map(widthOf)).toStrictEqual(
            bytesIn(right.transcript).map(widthOf),
          );
        }),
        { numRuns: 10 },
      );
    });

    it('should move only the key read between two issuers', async () => {
      await fc.assert(
        fc.asyncProperty(anySecret(), anySecret(), async (a, b) => {
          fc.pre(hex(a) !== hex(b));

          const moved = drift(await gateTrace(a), await gateTrace(b));

          expect(moved).toStrictEqual(
            encodingsOf(issuer.derivePk(a, INSTANCE_SALT)),
          );
        }),
        { numRuns: 10 },
      );
    });

    it('should rotate with the same transcript shape and widths for any secrets', async () => {
      await fc.assert(
        fc.asyncProperty(
          anySecret(),
          anySecret(),
          anySecret(),
          anySecret(),
          async (a, nextA, b, nextB) => {
            const left = await rotationTrace(a, nextA);
            const right = await rotationTrace(b, nextB);

            expect(shapeOf(left.transcript)).toStrictEqual(
              shapeOf(right.transcript),
            );
            expect(bytesIn(left.transcript).map(widthOf)).toStrictEqual(
              bytesIn(right.transcript).map(widthOf),
            );
          },
        ),
        { numRuns: 10 },
      );
    });

    it('should move only the key read and the new key between two rotations', async () => {
      await fc.assert(
        fc.asyncProperty(
          anySecret(),
          anySecret(),
          anySecret(),
          anySecret(),
          async (a, nextA, b, nextB) => {
            fc.pre(hex(a) !== hex(b) && hex(nextA) !== hex(nextB));

            const moved = drift(
              await rotationTrace(a, nextA),
              await rotationTrace(b, nextB),
            );

            expect(moved).toStrictEqual([
              ...encodingsOf(issuer.derivePk(a, INSTANCE_SALT)),
              ...encodingsOf(issuer.derivePk(nextA, INSTANCE_SALT)),
            ]);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('should set the issuer with the same transcript shape for any key', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: 1n, max: P - 1n }),
          fc.bigInt({ min: 1n, max: P - 1n }),
          async (a, b) => {
            const [, left] = await (await Probe.create())._setIssuer(a);
            const [, right] = await (await Probe.create())._setIssuer(b);

            expect(shapeOf(left.transcript)).toStrictEqual(
              shapeOf(right.transcript),
            );
          },
        ),
        { numRuns: 10 },
      );
    });
  },
);

// ---------------------------------------------------------------------------
// The disclose surface
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenIssuer privacy: the disclose surface',
  () => {
    // Every crossing of the privacy boundary is one `disclose()`. Pinning the
    // exact set means a new one fails a test instead of relying on review.
    it('should disclose only at the two reviewed sites', () => {
      const sites = codeLines(EXTENSION_SOURCE).filter((line) =>
        line.includes('disclose('),
      );

      expect(sites).toStrictEqual([
        '_instanceSalt = disclose(instanceSalt);',
        '_issuerPk = disclose(newIssuerPk);',
      ]);
    });

    it('should not disclose a witness value directly', () => {
      expect(EXTENSION_SOURCE).not.toMatch(/disclose\(\s*wit_/);
    });

    it('should keep PrfCore and PrfAddr free of disclose', () => {
      for (const source of PRF_SOURCES) {
        expect(source).not.toContain('disclose(');
      }
    });

    // Three of the five span two lines, so the scan joins the code into one
    // string.
    it('should fail every assert with a fixed message under the module prefix', () => {
      const code = codeLines(EXTENSION_SOURCE).join('\n');
      const calls = code.match(/\bassert\(/g) ?? [];
      const messages = [
        ...code.matchAll(/\bassert\([^;]*?,\s*"([^"]*)"\s*\);/g),
      ].map(([, message]) => message);

      expect(calls).toHaveLength(5);
      expect(messages).toStrictEqual([
        'ConfidentialNoteFungibleTokenIssuer: instance salt must not be zero',
        'ConfidentialNoteFungibleTokenIssuer: contract not initialized',
        'ConfidentialNoteFungibleTokenIssuer: contract already initialized',
        'ConfidentialNoteFungibleTokenIssuer: caller is not the issuer',
        'ConfidentialNoteFungibleTokenIssuer: issuer key must not be zero',
      ]);
    });

    // A conditional write would make the presence of a write a private
    // predicate's shadow.
    it('should keep the module free of branches and loops', () => {
      const branching = codeLines(EXTENSION_SOURCE).filter(
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
  'ConfidentialNoteFungibleTokenIssuer privacy: the published transaction',
  () => {
    const liveSecret = (): Uint8Array => new Uint8Array(randomBytes(32));

    const wireOf = async (
      token: ConfidentialNoteFungibleTokenIssuerSimulator,
      from: number,
      entryPoint: string,
    ): Promise<string> => {
      const published = await awaitPublishedTxs(
        from,
        token._backend.contractAddress,
        { entryPoint },
      );
      expect(published.length).toBeGreaterThan(0);
      return published.map((tx) => tx.raw.toLowerCase()).join('');
    };

    const expectNotOnWire = (wire: string, secret: Uint8Array): void => {
      for (const form of [
        ...encodingsOfBytes(secret),
        ...encodingsOf(composed.derivePk(secret, INSTANCE_SALT)),
      ]) {
        expect(wire).not.toContain(form);
      }
    };

    it('should not publish the issuer secret when the gate passes', async () => {
      const secret = liveSecret();
      const token = await ConfidentialNoteFungibleTokenIssuerSimulator.create({
        wallet: { secretKey: secret },
      });

      const from = await indexerHead();
      await token.assertOnlyIssuer();
      const wire = await wireOf(token, from, 'assertOnlyIssuer');

      expectNotOnWire(wire, secret);
      // The positive control: the key is public by design.
      const key = issuer.derivePk(secret, INSTANCE_SALT);
      expect(encodingsOf(key).some((form) => wire.includes(form))).toBe(true);
    });

    it('should not publish either secret on rotation', async () => {
      const secret = liveSecret();
      const next = liveSecret();
      const token = await ConfidentialNoteFungibleTokenIssuerSimulator.create({
        wallet: { secretKey: secret },
      });

      const from = await indexerHead();
      await token.rotateIssuer(issuer.derivePk(next, INSTANCE_SALT));
      const wire = await wireOf(token, from, 'rotateIssuer');

      expectNotOnWire(wire, secret);
      expectNotOnWire(wire, next);
    });
  },
);
