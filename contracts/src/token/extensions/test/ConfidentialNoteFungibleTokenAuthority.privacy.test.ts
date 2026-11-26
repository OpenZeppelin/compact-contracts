/**
 * Privacy claims for the ConfidentialNoteFungibleTokenAuthority extension, as
 * executable assertions.
 *
 * The probe drives the mock directly so every call keeps its `proofData`:
 *
 *   publicTranscript          the ledger operations the transaction publishes
 *   privateTranscriptOutputs  the witness answers, which stay on the prover
 *
 * The authority id is public by design, and a gated call's transcript carries
 * it as the expected value of its read. The claims are that the secret never
 * reaches the transcript, that a handover publishes the new id and nothing else
 * new, and that the shape does not depend on who holds the role.
 */

import { readFileSync } from 'node:fs';
import type {
  AlignedValue,
  CircuitContext,
  CircuitResults,
  Op,
} from '@midnight-ntwrk/compact-runtime';
import {
  CompactTypeBytes,
  CompactTypeVector,
  dummyContractAddress,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import {
  CircuitContextManager,
  isLiveBackend,
} from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type Ledger,
  ledger,
  Contract as MockAuthority,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAuthority/contract/index.js';
import type { Identifier } from './simulators/ConfidentialNoteFungibleTokenAuthoritySimulator.js';
import {
  type ConfidentialNoteFungibleTokenAuthorityPrivateState,
  ConfidentialNoteFungibleTokenAuthorityWitnesses,
} from './witnesses/ConfidentialNoteFungibleTokenAuthorityWitnesses.js';

// ---------------------------------------------------------------------------
// Probe: the mock driven directly, so `proofData` survives
// ---------------------------------------------------------------------------

type PrivateState = ConfidentialNoteFungibleTokenAuthorityPrivateState;

const secretKey = (label: string): Uint8Array => {
  const sk = new Uint8Array(32);
  sk.set(new TextEncoder().encode(label));
  return sk;
};

/** The mock's account id: `AuthPrfPseudonym` under the salt `MockAuthority`. */
const idOf = (sk: Uint8Array): Identifier => ({
  is_left: true,
  left: persistentHash(new CompactTypeVector(3, new CompactTypeBytes(32)), [
    secretKey('AuthPrfPseudonym:identifier'),
    secretKey('MockAuthority'),
    sk,
  ]),
  right: { bytes: new Uint8Array(32) },
});

const AUTHORITY_SK = secretKey('AUTHORITY');
const SUCCESSOR = idOf(secretKey('SUCCESSOR'));

type Trace = {
  transcript: Op<AlignedValue>[];
  privateOutputs: AlignedValue[];
};

/** Block time the probes deploy at, pinned so two runs agree on every input. */
const PROBE_TIME = 0;

/** The mock, deployed with the authority behind `authoritySk`. */
class Probe {
  private readonly contract = new MockAuthority<PrivateState>(
    ConfidentialNoteFungibleTokenAuthorityWitnesses<Ledger>(),
  );
  private readonly manager: CircuitContextManager<PrivateState>;

  private constructor(authoritySk: Uint8Array) {
    this.manager = new CircuitContextManager<PrivateState>(
      this.contract,
      { secretKey: authoritySk },
      '0'.repeat(64),
      dummyContractAddress(),
      PROBE_TIME,
      idOf(authoritySk),
      1n,
    );
  }

  static async create(authoritySk: Uint8Array = AUTHORITY_SK): Promise<Probe> {
    const probe = new Probe(authoritySk);
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

  authority(): Promise<[Identifier, Trace]> {
    return this.run((ctx) => this.contract.impureCircuits.authority(ctx));
  }

  assertOnlyAuthority(): Promise<[[], Trace]> {
    return this.run((ctx) =>
      this.contract.impureCircuits.assertOnlyAuthority(ctx),
    );
  }

  transferAuthority(newAuthority: Identifier): Promise<[[], Trace]> {
    return this.run((ctx) =>
      this.contract.impureCircuits.transferAuthority(ctx, newAuthority),
    );
  }

  _transferAuthority(newAuthority: Identifier): Promise<[[], Trace]> {
    return this.run((ctx) =>
      this.contract.impureCircuits._transferAuthority(ctx, newAuthority),
    );
  }

  get state(): Ledger {
    return ledger(
      this.manager.getContext().callContext.currentQueryContext.state.state,
    );
  }
}

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
const encodingsOfAccount = (account: Identifier): string[] => [
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

/** Cell indices of the mock's two slots, as published. */
const CELL_INDICES = ['', '01'];

/** What a call may publish on its own account: the ledger before it. */
const publicBefore = (state: Ledger): string[] => [
  ...CELL_INDICES,
  state.Authority__isInitialized ? '01' : '',
  ...encodingsOfAccount(state.Authority__authority),
];

/** Published values the allowed set does not account for. */
const unaccounted = (trace: Trace, allowed: string[]): string[] =>
  bytesIn(trace.transcript).filter((value) => !allowed.includes(value));

const expectSecretAbsent = (trace: Trace, secret: Uint8Array): void => {
  const published = bytesIn(trace.transcript);
  for (const form of encodingsOfBytes(secret)) {
    expect(published).not.toContain(form);
  }
};

/** The module's cells, in a form `toStrictEqual` compares. */
const cellsOf = (state: Ledger) => ({
  initialized: state.Authority__isInitialized,
  authority: state.Authority__authority,
});

/**
 * Digest-width values a transcript publishes. Not an exact 32 bytes: the
 * runtime zero-trims, so an id whose edge byte is zero arrives a byte short.
 */
const DIGEST_MIN_HEX = 56;

/** A published value's width, with every digest counted alike. */
const widthOf = (bytes: string): number =>
  Math.min(bytes.length, DIGEST_MIN_HEX);

/** The byte strings that move between two otherwise identical runs. */
const drift = (a: Trace, b: Trace): string[] => {
  const left = bytesIn(a.transcript);
  const right = bytesIn(b.transcript);
  expect(left).toHaveLength(right.length);
  return left.filter((value, i) => value !== right[i]);
};

const expectSameShape = (left: Trace, right: Trace): void => {
  expect(shapeOf(left.transcript)).toStrictEqual(shapeOf(right.transcript));
  expect(bytesIn(left.transcript).map(widthOf)).toStrictEqual(
    bytesIn(right.transcript).map(widthOf),
  );
};

const anySecret = () =>
  fc
    .uint8Array({ minLength: 32, maxLength: 32 })
    .filter((sk) => sk.some((byte) => byte !== 0));

const EXTENSION_SOURCE = readFileSync(
  new URL('../ConfidentialNoteFungibleTokenAuthority.compact', import.meta.url),
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

const CODE = codeLines(EXTENSION_SOURCE);

// ---------------------------------------------------------------------------
// What reaches the public transcript
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenAuthority privacy: the public transcript',
  () => {
    // The positive controls: the gate reads the id, so it must be findable,
    // and the secret exists on the side that never leaves the prover.
    it('should not carry the authority secret through assertOnlyAuthority', async () => {
      const probe = await Probe.create();
      const [, trace] = await probe.assertOnlyAuthority();

      expectSecretAbsent(trace, AUTHORITY_SK);
      expect(bytesIn(trace.transcript)).toContain(
        encoded(idOf(AUTHORITY_SK).left),
      );
      expect(bytesIn(trace.privateOutputs)).toContain(encoded(AUTHORITY_SK));
    });

    it('should publish nothing from the secret on a gated call, for any secret', async () => {
      await fc.assert(
        fc.asyncProperty(anySecret(), async (secret) => {
          const probe = await Probe.create(secret);
          const [, trace] = await probe.assertOnlyAuthority();

          expectSecretAbsent(trace, secret);
          expect(unaccounted(trace, publicBefore(probe.state))).toStrictEqual(
            [],
          );
        }),
        { numRuns: 10 },
      );
    });

    it('should publish only the new id beyond the prior ledger on a gated handover', async () => {
      await fc.assert(
        fc.asyncProperty(anySecret(), anySecret(), async (secret, next) => {
          const probe = await Probe.create(secret);
          const before = probe.state;
          const newAuthority = idOf(next);
          const [, trace] = await probe.transferAuthority(newAuthority);

          expect(storedOf(trace.transcript)).toStrictEqual(
            encodingsOfAccount(newAuthority),
          );
          expect(
            unaccounted(trace, [
              ...publicBefore(before),
              ...encodingsOfAccount(newAuthority),
            ]),
          ).toStrictEqual([]);
          expectSecretAbsent(trace, secret);
          expectSecretAbsent(trace, next);
        }),
        { numRuns: 10 },
      );
    });

    it('should publish only the new id beyond the prior ledger on an ungated handover', async () => {
      const probe = await Probe.create();
      const before = probe.state;
      const [, trace] = await probe._transferAuthority(SUCCESSOR);

      expect(storedOf(trace.transcript)).toStrictEqual(
        encodingsOfAccount(SUCCESSOR),
      );
      expect(
        unaccounted(trace, [
          ...publicBefore(before),
          ...encodingsOfAccount(SUCCESSOR),
        ]),
      ).toStrictEqual([]);
      expectSecretAbsent(trace, AUTHORITY_SK);
    });

    it('should publish only the prior ledger when reading the authority', async () => {
      const probe = await Probe.create();
      const before = probe.state;
      const [, trace] = await probe.authority();

      expect(unaccounted(trace, publicBefore(before))).toStrictEqual([]);
    });
  },
);

// ---------------------------------------------------------------------------
// What a call writes
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenAuthority privacy: what a call writes',
  () => {
    it.each([
      {
        circuit: 'transferAuthority',
        handover: (probe: Probe) => probe.transferAuthority(SUCCESSOR),
      },
      {
        circuit: '_transferAuthority',
        handover: (probe: Probe) => probe._transferAuthority(SUCCESSOR),
      },
    ])(
      'should write one cell, the authority, in $circuit',
      async ({ handover }) => {
        const probe = await Probe.create();
        const before = cellsOf(probe.state);
        const [, trace] = await handover(probe);

        expect(insertsIn(trace.transcript)).toBe(1);
        expect(cellsOf(probe.state)).toStrictEqual({
          ...before,
          authority: SUCCESSOR,
        });
      },
    );

    it.each([
      {
        circuit: 'assertOnlyAuthority',
        check: (probe: Probe) => probe.assertOnlyAuthority(),
      },
      {
        circuit: 'authority',
        check: (probe: Probe) => probe.authority(),
      },
    ])('should write nothing in $circuit', async ({ check }) => {
      const probe = await Probe.create();
      const before = cellsOf(probe.state);
      const [, trace] = await check(probe);

      expect(insertsIn(trace.transcript)).toBe(0);
      expect(storedOf(trace.transcript)).toStrictEqual([]);
      expect(cellsOf(probe.state)).toStrictEqual(before);
    });
  },
);

// ---------------------------------------------------------------------------
// Indistinguishability: the shape does not depend on the secrets
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenAuthority privacy: indistinguishability',
  () => {
    const checkTrace = async (authority: Uint8Array): Promise<Trace> =>
      (await (await Probe.create(authority)).assertOnlyAuthority())[1];

    const handoverTrace = async (
      authority: Uint8Array,
      next: Uint8Array,
    ): Promise<Trace> =>
      (await (await Probe.create(authority)).transferAuthority(idOf(next)))[1];

    it('should check with the same transcript shape and widths for any authority', async () => {
      await fc.assert(
        fc.asyncProperty(anySecret(), anySecret(), async (a, b) => {
          expectSameShape(await checkTrace(a), await checkTrace(b));
        }),
        { numRuns: 10 },
      );
    });

    it('should move only the authority read between two authorities', async () => {
      await fc.assert(
        fc.asyncProperty(anySecret(), anySecret(), async (a, b) => {
          fc.pre(hex(a) !== hex(b));

          const moved = drift(await checkTrace(a), await checkTrace(b));

          expect(moved).toStrictEqual([encoded(idOf(a).left)]);
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

    it('should move only the authority read and the new id between two handovers', async () => {
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

            expect(moved).toStrictEqual([
              encoded(idOf(a).left),
              encoded(idOf(nextA).left),
            ]);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('should publish byte-identical transcripts for identical inputs', async () => {
      const moved = drift(
        await handoverTrace(AUTHORITY_SK, secretKey('SUCCESSOR')),
        await handoverTrace(AUTHORITY_SK, secretKey('SUCCESSOR')),
      );

      expect(moved).toStrictEqual([]);
    });
  },
);

// ---------------------------------------------------------------------------
// The disclose surface
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenAuthority privacy: the disclose surface',
  () => {
    // Every crossing of the privacy boundary is one `disclose()`. Pinning the
    // exact set means a new one fails a test instead of relying on review.
    it('should disclose only the canonical new id', () => {
      const sites = CODE.filter((line) => line.includes('disclose('));

      expect(sites).toStrictEqual([
        '_authority = disclose(Utils_canonicalize<Bytes<32>, ContractAddress>(newAuthority));',
      ]);
    });

    it('should not disclose a witness value directly', () => {
      expect(EXTENSION_SOURCE).not.toMatch(/disclose\(\s*wit_/);
    });

    it('should write the authority at one site', () => {
      const writes = CODE.filter((line) => /^_authority\s*=/.test(line));

      expect(writes).toHaveLength(1);
    });

    it('should declare the flag and the authority only', () => {
      const ledgerFields = CODE.filter((line) =>
        /^export (sealed )?ledger /.test(line),
      );

      expect(ledgerFields).toStrictEqual([
        'export ledger _isInitialized: Boolean;',
        'export ledger _authority: Identifier;',
      ]);
    });

    // No renounce and no unchecked setter: the role can only move to a
    // checked key.
    it('should export exactly the five circuits of the design', () => {
      const circuits = CODE.flatMap(
        (line) => /^export circuit (\w+)\(/.exec(line)?.[1] ?? [],
      );

      expect(circuits).toStrictEqual([
        'initialize',
        'authority',
        'assertOnlyAuthority',
        'transferAuthority',
        '_transferAuthority',
      ]);
    });

    it('should assert only the reviewed reasons', () => {
      const reasons = new Set(
        [
          ...CODE.join('\n').matchAll(
            /"ConfidentialNoteFungibleTokenAuthority: ([^"]+)"/g,
          ),
        ].map((match) => match[1]),
      );

      expect(reasons).toStrictEqual(
        new Set([
          'contract already initialized',
          'contract not initialized',
          'caller is not the authority',
          'contract authority',
          'zero authority',
        ]),
      );
    });

    it('should keep the extension free of branches and loops', () => {
      const branching = CODE.filter(
        (line) => /\bif\s*\(/.test(line) || /\bfor\s*\(/.test(line),
      );

      expect(branching).toStrictEqual([]);
    });
  },
);
