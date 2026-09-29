/**
 * The preset's `@notice Privacy` header as executable assertions.
 *
 * The probe drives the mock artifact directly so every call keeps its
 * `proofData`: `publicTranscript` is what the transaction publishes,
 * `privateTranscriptOutputs` stays on the prover. Layers, weakest to strongest:
 *
 *   1. no secret's byte encoding appears in the public transcript,
 *   2. the transcript's shape does not vary with the secrets,
 *   3. two runs differing only in a secret differ only in hash digests.
 *
 * Which ledger field a call writes is derived from the transcript ops by
 * replaying the stack, not from a state diff: the unit spec already diffs.
 *
 * Layers 1-3 run dry. The live layer scans the serialized transaction the
 * indexer stored, the bytes a real observer receives.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  AlignedValue,
  CircuitResults,
  Op,
} from '@midnight-ntwrk/compact-runtime';
import {
  bigIntToValue,
  copyCircuitContext,
  dummyContractAddress,
  emptyZswapLocalState,
} from '@midnight-ntwrk/compact-runtime';
import {
  CircuitContextManager,
  isLiveBackend,
} from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { toHexPadded } from '#test-utils/fixtures/address.js';
import { shieldedTestKey } from '#test-utils/fixtures/shieldedKey.js';
import {
  awaitPublishedTxs,
  indexerHead,
  publishedContains,
} from '#test-utils/harness/publishedTx.js';
import {
  type Maybe,
  Contract as MockToken,
  type ShieldedCoinInfo,
  type ZswapCoinPublicKey,
} from '../../../../artifacts/MockZOwnableNativeShieldedToken/contract/index.js';
import {
  type ZOwnablePKPrivateState,
  ZOwnablePKWitnesses,
} from '../../../access/test/witnesses/ZOwnablePKWitnesses.js';
import {
  buildCommitmentFromId,
  createIdHash,
  ZOwnableNativeShieldedTokenSimulator,
} from './simulators/ZOwnableNativeShieldedTokenSimulator.js';

// ---------------------------------------------------------------------------
// Probe: the contract driven directly, so `proofData` survives the call
// ---------------------------------------------------------------------------

const OWNER = 'SIGNER1';
const UNAUTHORIZED = 'SIGNER3';
const Z_OWNER = shieldedTestKey(OWNER).left;

const b32 = (label: string): Uint8Array => {
  const u = new Uint8Array(32);
  u.set(new TextEncoder().encode(label).slice(0, 32));
  return u;
};

const INSTANCE_SALT = new Uint8Array(32).fill(0x5a);
const TOKEN_DOMAIN = b32('zownable-nst:token');
const NAME = 'Ownable Shielded Token';
const SYMBOL = 'OST';
const DECIMALS = 2n;
const INIT_COUNTER = 1n;
const SECRET_NONCE = Buffer.alloc(32, 0x77);

const RECIPIENT: ZswapCoinPublicKey = { bytes: b32('RECIPIENT') };
const REFUND_TO: ZswapCoinPublicKey = { bytes: b32('REFUND_TO') };
const MINT_NONCE = b32('mint-nonce');
const COIN_NONCE = b32('coin-nonce');
const AMOUNT = 1_000n;
const PARTIAL = 600n;
const MAX_U64 = (1n << 64n) - 1n;

// Generated-input tests run many circuits, so they get their own timeout.
const GENERATED_INPUT_TIMEOUT_MS = 120_000;

type Trace = {
  transcript: Op<AlignedValue>[];
  privateOutputs: AlignedValue[];
};

class Probe {
  private readonly contract = new MockToken<ZOwnablePKPrivateState>(
    ZOwnablePKWitnesses(),
  );
  private readonly manager: CircuitContextManager<ZOwnablePKPrivateState>;
  private caller = toHexPadded(OWNER);

  private constructor(secretNonce: Buffer, instanceSalt: Uint8Array) {
    this.manager = new CircuitContextManager<ZOwnablePKPrivateState>(
      this.contract,
      { secretNonce },
      this.caller,
      dummyContractAddress(),
      0,
      createIdHash(Z_OWNER, secretNonce),
      instanceSalt,
      TOKEN_DOMAIN,
      NAME,
      SYMBOL,
      DECIMALS,
      true,
    );
  }

  static async create(
    secretNonce: Buffer = SECRET_NONCE,
    instanceSalt: Uint8Array = INSTANCE_SALT,
  ): Promise<Probe> {
    const probe = new Probe(secretNonce, instanceSalt);
    await probe.manager.init();
    return probe;
  }

  /** `ownPublicKey()` for the next call, resolved the way the dry backend does. */
  as(alias: string): this {
    this.caller = toHexPadded(alias);
    return this;
  }

  private context() {
    const ctx = copyCircuitContext(this.manager.getContext());
    ctx.callContext.currentZswapLocalState = emptyZswapLocalState(this.caller);
    return ctx;
  }

  private async run<T>(
    call: () => Promise<CircuitResults<ZOwnablePKPrivateState, T>>,
  ): Promise<[T, Trace]> {
    const { result, context } = await call();
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

  mint(
    recipient: ZswapCoinPublicKey,
    amount: bigint,
    nonce: Uint8Array,
  ): Promise<[ShieldedCoinInfo, Trace]> {
    return this.run(() =>
      this.contract.impureCircuits.mint(
        this.context(),
        recipient,
        amount,
        nonce,
      ),
    );
  }

  burn(
    coin: ShieldedCoinInfo,
    amount: bigint,
    refundTo: ZswapCoinPublicKey,
  ): Promise<[Maybe<ShieldedCoinInfo>, Trace]> {
    return this.run(() =>
      this.contract.impureCircuits.burn(this.context(), coin, amount, refundTo),
    );
  }

  transferOwnership(newOwnerId: Uint8Array): Promise<[[], Trace]> {
    return this.run(() =>
      this.contract.impureCircuits.transferOwnership(
        this.context(),
        newOwnerId,
      ),
    );
  }

  renounceOwnership(): Promise<[[], Trace]> {
    return this.run(() =>
      this.contract.impureCircuits.renounceOwnership(this.context()),
    );
  }

  async tokenColor(): Promise<Uint8Array> {
    const [color] = await this.run(() =>
      this.contract.impureCircuits.tokenColor(this.context()),
    );
    return color;
  }

  coin(value: bigint, nonce = COIN_NONCE): Promise<ShieldedCoinInfo> {
    return this.tokenColor().then((color) => ({ nonce, color, value }));
  }
}

// ---------------------------------------------------------------------------
// Reading a transcript
// ---------------------------------------------------------------------------

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/**
 * The runtime publishes byte values with trailing zeros stripped, so a padded
 * secret appears under its trimmed form. Searching the padded form alone would
 * pass vacuously.
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

/** The forms a `Uint` secret can take in a transcript. */
const encodingsOfUint = (value: bigint): string[] =>
  bigIntToValue(value).map(hex);

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

/**
 * The digest-width values a transcript publishes. Not exactly 64 hex: a digest
 * whose tail is zero is published short, so the bound keeps a digest trimmed
 * by up to four bytes while still excluding indices and amounts.
 */
const DIGEST_MIN_HEX = 56;

const isDigest = (bytes: string): boolean => bytes.length >= DIGEST_MIN_HEX;

/** A published value's width, with every digest counted alike. */
const widthOf = (bytes: string): number =>
  isDigest(bytes) ? DIGEST_MIN_HEX : bytes.length;

/** The byte strings that move between two otherwise identical runs. */
const drift = (a: Trace, b: Trace): string[] => {
  const left = bytesIn(a.transcript);
  const right = bytesIn(b.transcript);
  expect(left).toHaveLength(right.length);
  return left.filter((value, i) => value !== right[i]);
};

/** Nothing that moved is anything but an opaque digest. */
const expectOpaque = (moved: string[], secrets: string[]): void => {
  for (const value of moved) {
    expect(isDigest(value)).toBe(true);
    expect(value.length).toBeLessThanOrEqual(64);
    expect(secrets).not.toContain(value);
  }
};

const expectAbsent = (published: string[], secrets: string[]): void => {
  for (const secret of secrets) {
    expect(published).not.toContain(secret);
    for (const value of published) {
      expect(value.includes(secret)).toBe(false);
    }
  }
};

// ---------------------------------------------------------------------------
// Replaying the stack: which ledger field an `ins` lands in
// ---------------------------------------------------------------------------

/** Ledger fields by state index, in the artifact's `Ledger` key order. */
const LEDGER_FIELDS = [
  '_ownableIsInitialized',
  '_ownerCommitment',
  '_counter',
  '_instanceSalt',
  '_domain',
  '_isInitialized',
  '_name',
  '_symbol',
  '_decimals',
  '_totalMinted',
  '_totalBurned',
] as const;

type Root = 'state' | 'effects' | 'context' | 'value';

/** A symbolic stack slot: which root it descends from and at which field. */
type Slot = { root: Root; field?: number; literal?: string };

type PathElement = { tag: 'value'; value: AlignedValue } | { tag: 'stack' };

/** Pop and push counts of the ops that carry no path or depth of their own. */
const FIXED_ARITY: Record<string, [pops: number, pushes: number]> = {
  noop: [0, 0],
  lt: [2, 1],
  eq: [2, 1],
  type: [1, 1],
  size: [1, 1],
  new: [0, 1],
  and: [2, 1],
  or: [2, 1],
  neg: [1, 1],
  log: [1, 0],
  root: [1, 1],
  pop: [1, 0],
  popeq: [1, 0],
  popeqc: [1, 0],
  addi: [1, 1],
  subi: [1, 1],
  push: [0, 1],
  pushs: [0, 1],
  branch: [1, 0],
  jmp: [0, 0],
  add: [2, 1],
  sub: [2, 1],
  concat: [2, 1],
  member: [2, 1],
  rem: [2, 1],
  ckpt: [0, 0],
};

const fieldOf = (value: AlignedValue): number => {
  const key = value.value[0];
  if (!(key instanceof Uint8Array) || key.length > 1) {
    throw new Error('replay: expected a one-byte field index');
  }
  return key.length === 0 ? 0 : key[0];
};

type Replay = {
  reads: { field: number; value: string }[];
  writes: { root: Root; field: number }[];
};

/**
 * Replays the transcript over a symbolic stack, initially `[state, effects,
 * context]` top first, tracking which root every slot descends from.
 *
 * `branch` arms are replayed linearly: an arm is stack-neutral, so the shape
 * the VM ends with is the same on either path.
 */
const replay = (transcript: Op<AlignedValue>[]): Replay => {
  const stack: Slot[] = [
    { root: 'context' },
    { root: 'effects' },
    { root: 'state' },
  ];
  const reads: Replay['reads'] = [];
  const writes: Replay['writes'] = [];
  const pop = (): Slot => {
    const slot = stack.pop();
    if (slot === undefined) throw new Error('replay: stack underflow');
    return slot;
  };
  const peek = (n: number): Slot => {
    const slot = stack[stack.length - 1 - n];
    if (slot === undefined) throw new Error('replay: stack underflow');
    return slot;
  };

  for (const op of transcript) {
    const kind = opKind(op);
    const arg = typeof op === 'string' ? {} : (op as Record<string, any>)[kind];
    switch (kind) {
      case 'dup': {
        stack.push(peek(arg.n));
        break;
      }
      case 'swap': {
        const top = stack.length - 1;
        const other = top - 1 - arg.n;
        [stack[top], stack[other]] = [stack[other] as Slot, stack[top] as Slot];
        break;
      }
      case 'idx': {
        const path = arg.path as PathElement[];
        const keys: Slot[] = path.map((element) =>
          element.tag === 'stack'
            ? pop()
            : { root: 'value', field: fieldOf(element.value) },
        );
        const container = pop();
        let child: Slot = container;
        if (arg.pushPath) stack.push(container);
        for (const key of keys) {
          child =
            child.root === 'value'
              ? { root: 'value' }
              : { root: child.root, field: child.field ?? key.field };
          if (arg.pushPath) stack.push(key);
        }
        stack.push(child);
        break;
      }
      case 'ins': {
        pop();
        let container: Slot = { root: 'value' };
        let key: Slot = { root: 'value' };
        for (let i = 0; i < arg.n; i++) {
          key = pop();
          container = pop();
        }
        if (container.root === 'state' || container.root === 'effects') {
          writes.push({
            root: container.root,
            field: container.field ?? key.field ?? Number.NaN,
          });
        }
        stack.push(container);
        break;
      }
      case 'popeq': {
        const slot = pop();
        if (slot.root === 'state' && slot.field !== undefined) {
          reads.push({
            field: slot.field,
            value: bytesIn(arg.result)[0] ?? '',
          });
        }
        break;
      }
      case 'push': {
        const content = arg.value?.content;
        stack.push(
          content === undefined
            ? { root: 'value' }
            : { root: 'value', field: fieldOfLiteral(content) },
        );
        break;
      }
      default: {
        const arity = FIXED_ARITY[kind];
        if (arity === undefined) throw new Error(`replay: unknown op ${kind}`);
        for (let i = 0; i < arity[0]; i++) pop();
        for (let i = 0; i < arity[1]; i++) stack.push({ root: 'value' });
      }
    }
  }
  return { reads, writes };
};

/** A pushed one-byte cell is a candidate field index; anything wider is not. */
const fieldOfLiteral = (content: AlignedValue): number | undefined => {
  const value = content.value[0];
  return value instanceof Uint8Array && value.length <= 1
    ? fieldOf(content)
    : undefined;
};

/** The ledger fields a call writes, sorted; a nested insert counts once. */
const ledgerWrites = (trace: Trace): string[] =>
  [
    ...new Set(
      replay(trace.transcript)
        .writes.filter((write) => write.root === 'state')
        .map((write) => LEDGER_FIELDS[write.field] ?? `#${write.field}`),
    ),
  ].sort();

const effectsWrites = (trace: Trace): number =>
  replay(trace.transcript).writes.filter((write) => write.root === 'effects')
    .length;

const ledgerReads = (trace: Trace): Record<string, string[]> => {
  const reads: Record<string, string[]> = {};
  for (const read of replay(trace.transcript).reads) {
    const name = LEDGER_FIELDS[read.field] ?? `#${read.field}`;
    reads[name] = [...(reads[name] ?? []), read.value];
  }
  return reads;
};

const PRESET_SOURCE = readFileSync(
  new URL('../ZOwnableNativeShieldedToken.compact', import.meta.url),
  'utf8',
);

// ---------------------------------------------------------------------------
// What reaches the public transcript
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ZOwnableNativeShieldedToken privacy: the public transcript',
  () => {
    it('reads the ledger at the indices the replay maps to', async () => {
      const probe = await Probe.create();
      const [, trace] = await probe.mint(RECIPIENT, AMOUNT, MINT_NONCE);
      const reads = ledgerReads(trace);
      const commitment = buildCommitmentFromId(
        createIdHash(Z_OWNER, SECRET_NONCE),
        INSTANCE_SALT,
        INIT_COUNTER,
      );

      expect(reads._ownerCommitment).toStrictEqual([hex(commitment)]);
      expect(reads._counter).toStrictEqual([
        hex(bigIntToValue(INIT_COUNTER)[0]),
      ]);
      expect(reads._instanceSalt).toStrictEqual([encoded(INSTANCE_SALT)]);
      expect(reads._domain).toStrictEqual([encoded(TOKEN_DOMAIN)]);
    });

    it('mint publishes the amount, twice', async () => {
      const probe = await Probe.create();
      const [, trace] = await probe.mint(RECIPIENT, AMOUNT, MINT_NONCE);
      const published = bytesIn(trace.transcript);

      // Once for the Zswap mint effect, once for `_totalMinted`.
      for (const encoding of encodingsOfUint(AMOUNT)) {
        expect(published.filter((value) => value === encoding)).toHaveLength(2);
      }
    });

    it('mint publishes neither the recipient nor the nonce', async () => {
      const probe = await Probe.create();
      const [, trace] = await probe.mint(RECIPIENT, AMOUNT, MINT_NONCE);

      expectAbsent(bytesIn(trace.transcript), [
        ...encodingsOfBytes(RECIPIENT.bytes),
        ...encodingsOfBytes(MINT_NONCE),
      ]);
    });

    it('mint writes only _totalMinted', async () => {
      const probe = await Probe.create();
      const [, trace] = await probe.mint(RECIPIENT, AMOUNT, MINT_NONCE);

      expect(ledgerWrites(trace)).toStrictEqual(['_totalMinted']);
      expect(effectsWrites(trace)).toBeGreaterThan(0);
    });

    it('burn publishes neither the amount, the coin nonce nor refundTo', async () => {
      const probe = await Probe.create();
      const coin = await probe.coin(AMOUNT);
      const [, trace] = await probe.burn(coin, PARTIAL, REFUND_TO);

      expectAbsent(bytesIn(trace.transcript), [
        ...encodingsOfUint(PARTIAL),
        ...encodingsOfUint(AMOUNT),
        ...encodingsOfBytes(COIN_NONCE),
        ...encodingsOfBytes(REFUND_TO.bytes),
      ]);
    });

    it('burn writes no ledger field, only Zswap effects', async () => {
      const probe = await Probe.create();
      const [, trace] = await probe.burn(
        await probe.coin(AMOUNT),
        PARTIAL,
        REFUND_TO,
      );

      expect(ledgerWrites(trace)).toStrictEqual([]);
      expect(effectsWrites(trace)).toBeGreaterThan(0);
    });

    it('transferOwnership writes only _ownerCommitment and _counter', async () => {
      const probe = await Probe.create();
      const newOwnerId = createIdHash({ bytes: b32('NEW') }, b32('new-nonce'));
      const [, trace] = await probe.transferOwnership(newOwnerId);

      expect(ledgerWrites(trace).sort()).toStrictEqual([
        '_counter',
        '_ownerCommitment',
      ]);
      expect(effectsWrites(trace)).toBe(0);
    });

    // The id is committed, never stored: only its hash reaches the transcript.
    it('transferOwnership publishes the new commitment, not the new id', async () => {
      const probe = await Probe.create();
      const newOwnerId = createIdHash({ bytes: b32('NEW') }, b32('new-nonce'));
      const [, trace] = await probe.transferOwnership(newOwnerId);
      const published = bytesIn(trace.transcript);

      expect(published).toContain(
        hex(
          buildCommitmentFromId(newOwnerId, INSTANCE_SALT, INIT_COUNTER + 1n),
        ),
      );
      expectAbsent(published, encodingsOfBytes(newOwnerId));
    });

    it('renounceOwnership writes only _ownerCommitment', async () => {
      const probe = await Probe.create();
      const [, trace] = await probe.renounceOwnership();

      expect(ledgerWrites(trace)).toStrictEqual(['_ownerCommitment']);
      expect(effectsWrites(trace)).toBe(0);
    });

    const ownerOps: [name: string, call: (probe: Probe) => Promise<Trace>][] = [
      ['mint', async (p) => (await p.mint(RECIPIENT, AMOUNT, MINT_NONCE))[1]],
      [
        'burn',
        async (p) =>
          (await p.burn(await p.coin(AMOUNT), PARTIAL, REFUND_TO))[1],
      ],
      [
        'transferOwnership',
        async (p) =>
          (await p.transferOwnership(createIdHash(RECIPIENT, MINT_NONCE)))[1],
      ],
      ['renounceOwnership', async (p) => (await p.renounceOwnership())[1]],
    ];

    it.each(ownerOps)(
      '%s keeps the owner key and secret nonce on the private side',
      async (_name, call) => {
        const trace = await call(await Probe.create());
        const secrets = [
          ...encodingsOfBytes(SECRET_NONCE),
          ...encodingsOfBytes(Z_OWNER.bytes),
        ];

        expectAbsent(bytesIn(trace.transcript), secrets);
        // The mirror image: the secrets exist, on the side that never leaves
        // the prover. Without this an empty read would pass every check above.
        const witnessed = bytesIn(trace.privateOutputs);
        expect(witnessed).toContain(hex(SECRET_NONCE));
        expect(witnessed).toContain(hex(Z_OWNER.bytes));
      },
    );

    it('a rejected caller leaves no transcript to publish', async () => {
      const probe = await Probe.create();
      await expect(
        probe.as(UNAUTHORIZED).mint(RECIPIENT, AMOUNT, MINT_NONCE),
      ).rejects.toThrow('ZOwnablePK: caller is not the owner');
    });

    // A known, accepted leak: the transcript alone tells the circuits apart.
    it('publishes which circuit ran', async () => {
      const shapes = await Promise.all(
        ownerOps.map(async ([, call]) =>
          shapeOf((await call(await Probe.create())).transcript).join(' '),
        ),
      );
      expect(new Set(shapes).size).toBe(ownerOps.length);
    });
  },
);

// ---------------------------------------------------------------------------
// Indistinguishability: the shape does not depend on the secrets
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ZOwnableNativeShieldedToken privacy: indistinguishability',
  { timeout: GENERATED_INPUT_TIMEOUT_MS },
  () => {
    const mintTrace = async (
      recipient: ZswapCoinPublicKey,
      amount: bigint,
      nonce: Uint8Array,
    ): Promise<Trace> => {
      const probe = await Probe.create();
      return (await probe.mint(recipient, amount, nonce))[1];
    };

    const burnTrace = async (
      coinNonce: Uint8Array,
      amount: bigint,
      refundTo: ZswapCoinPublicKey,
    ): Promise<Trace> => {
      const probe = await Probe.create();
      const coin = await probe.coin(AMOUNT, coinNonce);
      return (await probe.burn(coin, amount, refundTo))[1];
    };

    // Run counts are small: each case drives two full circuit executions.
    const RUNS = { numRuns: 10 };

    const anyAmount = () => fc.bigInt({ min: 0n, max: MAX_U64 });
    /** A burn the 1000-value coin can pay without consuming it. */
    const partialAmount = () => fc.bigInt({ min: 0n, max: AMOUNT - 1n });
    const anyBytes = () => fc.uint8Array({ minLength: 32, maxLength: 32 });
    /** A key the circuits accept: never the zero key. */
    const anyKey = () =>
      anyBytes()
        .filter((bytes) => bytes.some((b) => b !== 0))
        .map((bytes): ZswapCoinPublicKey => ({ bytes }));

    it('mint has one shape for any amount', async () => {
      await fc.assert(
        fc.asyncProperty(anyAmount(), anyAmount(), async (a, b) => {
          expect(
            shapeOf((await mintTrace(RECIPIENT, a, MINT_NONCE)).transcript),
          ).toStrictEqual(
            shapeOf((await mintTrace(RECIPIENT, b, MINT_NONCE)).transcript),
          );
        }),
        RUNS,
      );
    });

    it('mint has one shape for any recipient', async () => {
      await fc.assert(
        fc.asyncProperty(anyKey(), anyKey(), async (first, second) => {
          expect(
            shapeOf((await mintTrace(first, AMOUNT, MINT_NONCE)).transcript),
          ).toStrictEqual(
            shapeOf((await mintTrace(second, AMOUNT, MINT_NONCE)).transcript),
          );
        }),
        RUNS,
      );
    });

    it('mint moves only the coin commitment when the recipient differs', async () => {
      await fc.assert(
        fc.asyncProperty(anyKey(), anyKey(), async (first, second) => {
          fc.pre(hex(first.bytes) !== hex(second.bytes));

          const moved = drift(
            await mintTrace(first, AMOUNT, MINT_NONCE),
            await mintTrace(second, AMOUNT, MINT_NONCE),
          );

          expect(moved).toHaveLength(1);
          expectOpaque(moved, [
            ...encodingsOfBytes(first.bytes),
            ...encodingsOfBytes(second.bytes),
          ]);
        }),
        RUNS,
      );
    });

    it('mint moves only the coin commitment when the nonce differs', async () => {
      await fc.assert(
        fc.asyncProperty(anyBytes(), anyBytes(), async (first, second) => {
          fc.pre(hex(first) !== hex(second));

          const moved = drift(
            await mintTrace(RECIPIENT, AMOUNT, first),
            await mintTrace(RECIPIENT, AMOUNT, second),
          );

          expect(moved).toHaveLength(1);
          expectOpaque(moved, [
            ...encodingsOfBytes(first),
            ...encodingsOfBytes(second),
          ]);
        }),
        RUNS,
      );
    });

    // The amount is public by design: it moves in the clear, plus the digest.
    it('mint moves the amount and the coin commitment when the amount differs', async () => {
      await fc.assert(
        fc.asyncProperty(anyAmount(), anyAmount(), async (a, b) => {
          fc.pre(a !== b);

          const moved = drift(
            await mintTrace(RECIPIENT, a, MINT_NONCE),
            await mintTrace(RECIPIENT, b, MINT_NONCE),
          );
          const amounts = [...encodingsOfUint(a), ...encodingsOfUint(b)];

          expect(moved.filter(isDigest)).toHaveLength(1);
          expect(moved.filter((value) => !isDigest(value))).toHaveLength(2);
          for (const value of moved.filter((value) => !isDigest(value))) {
            expect(amounts).toContain(value);
          }
        }),
        RUNS,
      );
    });

    it('burn has one shape and one width profile for any partial amount', async () => {
      await fc.assert(
        fc.asyncProperty(partialAmount(), partialAmount(), async (a, b) => {
          const left = await burnTrace(COIN_NONCE, a, REFUND_TO);
          const right = await burnTrace(COIN_NONCE, b, REFUND_TO);

          expect(shapeOf(left.transcript)).toStrictEqual(
            shapeOf(right.transcript),
          );
          expect(bytesIn(left.transcript).map(widthOf)).toStrictEqual(
            bytesIn(right.transcript).map(widthOf),
          );
        }),
        RUNS,
      );
    });

    it('burn has one shape for any refund target', async () => {
      await fc.assert(
        fc.asyncProperty(anyKey(), anyKey(), async (first, second) => {
          expect(
            shapeOf((await burnTrace(COIN_NONCE, PARTIAL, first)).transcript),
          ).toStrictEqual(
            shapeOf((await burnTrace(COIN_NONCE, PARTIAL, second)).transcript),
          );
        }),
        RUNS,
      );
    });

    it('burn moves only digests when the amount differs', async () => {
      await fc.assert(
        fc.asyncProperty(partialAmount(), partialAmount(), async (a, b) => {
          fc.pre(a !== b);

          const moved = drift(
            await burnTrace(COIN_NONCE, a, REFUND_TO),
            await burnTrace(COIN_NONCE, b, REFUND_TO),
          );

          expect(moved.length).toBeGreaterThan(0);
          expectOpaque(moved, [
            ...encodingsOfUint(a),
            ...encodingsOfUint(b),
            ...encodingsOfUint(AMOUNT - a),
            ...encodingsOfUint(AMOUNT - b),
          ]);
        }),
        RUNS,
      );
    });

    it('burn moves only the refund commitment when the refund target differs', async () => {
      await fc.assert(
        fc.asyncProperty(anyKey(), anyKey(), async (first, second) => {
          fc.pre(hex(first.bytes) !== hex(second.bytes));

          const moved = drift(
            await burnTrace(COIN_NONCE, PARTIAL, first),
            await burnTrace(COIN_NONCE, PARTIAL, second),
          );

          expect(moved).toHaveLength(1);
          expectOpaque(moved, [
            ...encodingsOfBytes(first.bytes),
            ...encodingsOfBytes(second.bytes),
          ]);
        }),
        RUNS,
      );
    });

    it('burn moves only digests when the coin nonce differs', async () => {
      await fc.assert(
        fc.asyncProperty(anyBytes(), anyBytes(), async (first, second) => {
          fc.pre(hex(first) !== hex(second));

          const moved = drift(
            await burnTrace(first, PARTIAL, REFUND_TO),
            await burnTrace(second, PARTIAL, REFUND_TO),
          );

          expect(moved.length).toBeGreaterThan(0);
          expectOpaque(moved, [
            ...encodingsOfBytes(first),
            ...encodingsOfBytes(second),
          ]);
        }),
        RUNS,
      );
    });

    // The header's stated leak: a change output reveals that a burn was partial.
    it('a full burn and a partial burn differ in shape', async () => {
      const full = await burnTrace(COIN_NONCE, AMOUNT, REFUND_TO);
      const partial = await burnTrace(COIN_NONCE, PARTIAL, REFUND_TO);

      expect(shapeOf(full.transcript)).not.toStrictEqual(
        shapeOf(partial.transcript),
      );
      expect(effectsWrites(partial)).toBeGreaterThan(effectsWrites(full));
    });

    it('transferOwnership moves only the commitment when the new id differs', async () => {
      await fc.assert(
        fc.asyncProperty(anyBytes(), anyBytes(), async (first, second) => {
          fc.pre(hex(first) !== hex(second));

          const probeA = await Probe.create();
          const [, traceA] = await probeA.transferOwnership(first);
          const probeB = await Probe.create();
          const [, traceB] = await probeB.transferOwnership(second);

          const moved = drift(traceA, traceB);
          expect(moved).toHaveLength(1);
          expectOpaque(moved, [
            ...encodingsOfBytes(first),
            ...encodingsOfBytes(second),
          ]);
        }),
        RUNS,
      );
    });

    it('every owner-gated call moves only digests when the owner secret differs', async () => {
      await fc.assert(
        fc.asyncProperty(anyBytes(), anyBytes(), async (first, second) => {
          fc.pre(hex(first) !== hex(second));
          const secrets = [
            ...encodingsOfBytes(first),
            ...encodingsOfBytes(second),
            ...encodingsOfBytes(Z_OWNER.bytes),
          ];
          const calls: ((p: Probe) => Promise<Trace>)[] = [
            async (p) => (await p.mint(RECIPIENT, AMOUNT, MINT_NONCE))[1],
            async (p) =>
              (await p.burn(await p.coin(AMOUNT), PARTIAL, REFUND_TO))[1],
            async (p) => (await p.transferOwnership(b32('next')))[1],
            async (p) => (await p.renounceOwnership())[1],
          ];

          for (const call of calls) {
            const moved = drift(
              await call(await Probe.create(Buffer.from(first))),
              await call(await Probe.create(Buffer.from(second))),
            );
            // Only the stored commitment the check reads back.
            expect(moved).toHaveLength(1);
            expectOpaque(moved, secrets);
          }
        }),
        { numRuns: 5 },
      );
    });
  },
);

// ---------------------------------------------------------------------------
// Full-transcript sweep over generated secrets
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ZOwnableNativeShieldedToken privacy: no secret reaches the transcript',
  { timeout: GENERATED_INPUT_TIMEOUT_MS },
  () => {
    /** A non-zero tail keeps the trimmed encoding at full width. */
    const anyBytes = () =>
      fc
        .uint8Array({ minLength: 32, maxLength: 32 })
        .filter((bytes) => bytes[31] !== 0);
    const anyKey = () =>
      anyBytes().map((bytes): ZswapCoinPublicKey => ({ bytes }));

    it('mint: recipient, nonce, owner key and owner secret', async () => {
      await fc.assert(
        fc.asyncProperty(
          anyKey(),
          fc.bigInt({ min: 0n, max: MAX_U64 }),
          anyBytes(),
          anyBytes(),
          async (recipient, amount, nonce, secret) => {
            const probe = await Probe.create(Buffer.from(secret));
            const [, trace] = await probe.mint(recipient, amount, nonce);

            expectAbsent(bytesIn(trace.transcript), [
              ...encodingsOfBytes(recipient.bytes),
              ...encodingsOfBytes(nonce),
              ...encodingsOfBytes(secret),
              ...encodingsOfBytes(Z_OWNER.bytes),
            ]);
          },
        ),
        { numRuns: 10 },
      );
    });

    it('burn: amount, coin, refundTo, owner key and owner secret', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: 1n, max: MAX_U64 }),
          fc.bigInt({ min: 0n, max: MAX_U64 }),
          anyBytes(),
          anyKey(),
          anyBytes(),
          async (value, rawAmount, coinNonce, refundTo, secret) => {
            const amount = rawAmount % (value + 1n);
            const probe = await Probe.create(Buffer.from(secret));
            const coin = await probe.coin(value, coinNonce);
            const [, trace] = await probe.burn(coin, amount, refundTo);

            expectAbsent(bytesIn(trace.transcript), [
              ...encodingsOfBytes(coinNonce),
              ...encodingsOfBytes(refundTo.bytes),
              ...encodingsOfBytes(secret),
              ...encodingsOfBytes(Z_OWNER.bytes),
            ]);
            // Amounts are short, so only an exact match counts, and one under
            // three bytes would collide with the field indices every
            // transcript carries.
            const published = bytesIn(trace.transcript);
            for (const encoding of [
              ...encodingsOfUint(amount),
              ...encodingsOfUint(value),
              ...encodingsOfUint(value - amount),
            ].filter((encoding) => encoding.length >= 6)) {
              expect(published).not.toContain(encoding);
            }
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
  'ZOwnableNativeShieldedToken privacy: the disclose surface',
  () => {
    const sourceLines = PRESET_SOURCE.split('\n')
      .map((line) => line.trim())
      .filter((line) => !line.startsWith('*') && !line.startsWith('//'));

    // Every crossing of the privacy boundary belongs to a composed module;
    // the preset itself adds none.
    it('discloses nothing of its own', () => {
      expect(
        sourceLines.filter((line) => line.includes('disclose(')),
      ).toStrictEqual([]);
    });

    it('reads no witness of its own', () => {
      expect(sourceLines.filter((line) => line.includes('wit_'))).toStrictEqual(
        [],
      );
    });

    it('declares no ledger field of its own', () => {
      expect(
        sourceLines.filter((line) => line.startsWith('export ledger')),
      ).toStrictEqual([]);
    });
  },
);

// ---------------------------------------------------------------------------
// Ground truth: the transaction as the chain stored it
// ---------------------------------------------------------------------------

/**
 * Presence scanning only. Two real transactions differ in proofs, fees and
 * wallet nonces whatever the circuit does, so the differential layer stays
 * dry. Every secret is 32 random bytes, and the matcher also covers the form
 * the ledger trims it to.
 */
describe.runIf(isLiveBackend())(
  'ZOwnableNativeShieldedToken privacy: the published transaction',
  () => {
    /** 32 random bytes, redrawn when a zero tail trims them under the matcher's floor. */
    const liveSecret = (): Buffer => {
      const secret = Buffer.from(randomBytes(32));
      try {
        publishedContains([], secret, { as: 'bytes' });
        return secret;
      } catch (error) {
        if (error instanceof RangeError) return liveSecret();
        throw error;
      }
    };

    const deploy = async (secretNonce: Buffer) =>
      ZOwnableNativeShieldedTokenSimulator.create(
        createIdHash(Z_OWNER, secretNonce),
        INSTANCE_SALT,
        TOKEN_DOMAIN,
        NAME,
        SYMBOL,
        DECIMALS,
        true,
        { privateState: { secretNonce } },
      );

    it('mint publishes neither the mint nonce nor the owner secret', async () => {
      const secretNonce = liveSecret();
      const nonce = liveSecret();
      const token = await deploy(secretNonce);

      const from = await indexerHead();
      await token.as(OWNER).mint(Z_OWNER, AMOUNT, nonce);
      const published = await awaitPublishedTxs(from, token.contractAddress, {
        entryPoint: 'mint',
      });

      expect(published).toHaveLength(1);
      expect(publishedContains(published, nonce, { as: 'bytes' })).toBe(false);
      expect(publishedContains(published, secretNonce, { as: 'bytes' })).toBe(
        false,
      );
    });

    it('burn publishes neither the coin nonce nor the owner secret', async () => {
      const secretNonce = liveSecret();
      const token = await deploy(secretNonce);
      const coin = await token.as(OWNER).mint(Z_OWNER, AMOUNT, liveSecret());

      const from = await indexerHead();
      await token.as(OWNER).burn(coin, PARTIAL, Z_OWNER);
      const published = await awaitPublishedTxs(from, token.contractAddress, {
        entryPoint: 'burn',
      });

      expect(published).toHaveLength(1);
      expect(publishedContains(published, coin.nonce, { as: 'bytes' })).toBe(
        false,
      );
      expect(publishedContains(published, secretNonce, { as: 'bytes' })).toBe(
        false,
      );
    });

    // A known, accepted leak: the entry point names the circuit.
    it('publishes the entry point of the one call it carries', async () => {
      const token = await deploy(liveSecret());

      const from = await indexerHead();
      await token.as(OWNER).mint(Z_OWNER, AMOUNT, liveSecret());
      const published = await awaitPublishedTxs(from, token.contractAddress, {
        entryPoint: 'mint',
      });

      const bare = (address: string): string => address.replace(/^0x/, '');
      const calls = published.map((tx) =>
        tx.calls.map((call) => [bare(call.address), call.entryPoint]),
      );
      expect(calls).toStrictEqual([[[bare(token.contractAddress), 'mint']]]);
    });
  },
);
