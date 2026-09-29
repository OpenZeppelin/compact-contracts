/**
 * `ForwarderPrivate`'s privacy claims as executable assertions.
 *
 * The probe drives the compiled artifact directly so every call keeps its
 * `proofData`. `publicTranscript` is what the transaction publishes. `input`
 * and `output`, the circuit's arguments and return value, stay on the prover.
 * Layers, weakest to strongest:
 *
 *   1. no secret's byte encoding appears in the public transcript,
 *   2. the transcript's shape does not vary with the secrets,
 *   3. two runs differing only in a secret differ only in hash digests.
 *
 * Which ledger field a call reads or writes is derived from the transcript ops
 * by replaying the stack, not from a state diff.
 *
 * Layers 1-3 run dry. The live layer scans the serialized transaction the
 * indexer stored, the bytes a real observer receives.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  AlignedValue,
  CircuitContext,
  CircuitResults,
  EncodedRecipient,
  EncodedZswapLocalState,
  Op,
} from '@midnight-ntwrk/compact-runtime';
import {
  bigIntToValue,
  copyCircuitContext,
  emptyZswapLocalState,
} from '@midnight-ntwrk/compact-runtime';
import {
  CircuitContextManager,
  isLiveBackend,
} from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  eitherContractFromAddress,
  toHexPadded,
} from '#test-utils/fixtures/address.js';
import {
  encodeShieldedCoinInfo,
  GENESIS_NATIVE_SHIELDED_TOKEN_COLORS,
} from '#test-utils/fixtures/nativeShieldedToken.js';
import { shieldedTestKey } from '#test-utils/fixtures/shieldedKey.js';
import {
  contractOwner,
  getQualifiedShieldedCoinInfo,
} from '#test-utils/harness/NativeShieldedTokenTracker.js';
import {
  awaitPublishedTxs,
  indexerHead,
  type PublishedTx,
  publishedContains,
} from '#test-utils/harness/publishedTx.js';
import { Contract as ForwarderExample } from '../../../artifacts/ForwarderPrivateExample/contract/index.js';
import {
  Contract as MockForwarder,
  pureCircuits,
  type QualifiedShieldedCoinInfo,
  type ShieldedCoinInfo,
  type ShieldedSendResult,
  type ZswapCoinPublicKey,
} from '../../../artifacts/MockForwarderPrivate/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from './EmptyWitnesses.js';
import { MockForwarderPrivateSimulator } from './simulators/MockForwarderPrivateSimulator.js';

// ---------------------------------------------------------------------------
// Probe: the contract driven directly, so `proofData` survives the call
// ---------------------------------------------------------------------------

const b32 = (label: string): Uint8Array => {
  const u = new Uint8Array(32);
  u.set(new TextEncoder().encode(label).slice(0, 32));
  return u;
};

// Live: the drain sends the note to the parent, so its encryption key must
// resolve on-chain. The deployer's own key does.
const PARENT: ZswapCoinPublicKey = shieldedTestKey().left;
const OP_SECRET = new Uint8Array(32).fill(0xaa);
const WRONG_OP_SECRET = new Uint8Array(32).fill(0xbb);
const CALLER = toHexPadded('OPERATOR');

// Non-zero addresses, so either one is recognizable where it is published.
const FORWARDER_ADDRESS = '3e'.repeat(32);
const ROUTED_TO = 'c7'.repeat(32);

const COLOR = GENESIS_NATIVE_SHIELDED_TOKEN_COLORS.nativeShieldedToken1;
const COIN_NONCE = b32('coin-nonce');
const AMOUNT = 1_000n;
const PARTIAL = 400n;
// The dry runtime ignores the index, so any recognizable value serves.
const MT_INDEX = 0x0badc0den;

const commitmentOf = (
  parent: ZswapCoinPublicKey,
  opSecret: Uint8Array,
): Uint8Array => pureCircuits.calculateParentCommitment(parent.bytes, opSecret);

const coinOf = (
  nonce: Uint8Array = COIN_NONCE,
  value: bigint = AMOUNT,
): QualifiedShieldedCoinInfo => ({
  nonce,
  color: COLOR,
  value,
  mt_index: MT_INDEX,
});

/**
 * One call's proof data. The transaction publishes `transcript` and builds its
 * Zswap offer from `zswap`; `input`, `output` and `privateOutputs` stay on the
 * prover.
 */
type Trace = {
  transcript: Op<AlignedValue>[];
  privateOutputs: AlignedValue[];
  input: AlignedValue;
  output: AlignedValue;
  zswap: EncodedZswapLocalState;
};

type Forwarder =
  | MockForwarder<EmptyPrivateState>
  | ForwarderExample<EmptyPrivateState>;

class Probe {
  private constructor(
    private readonly contract: Forwarder,
    private readonly manager: CircuitContextManager<EmptyPrivateState>,
  ) {}

  private static async over(
    contract: Forwarder,
    ...contractArgs: unknown[]
  ): Promise<Probe> {
    const manager = new CircuitContextManager<EmptyPrivateState>(
      contract,
      EmptyPrivateState,
      CALLER,
      FORWARDER_ADDRESS,
      0,
      ...contractArgs,
    );
    await manager.init();
    return new Probe(contract, manager);
  }

  static create(
    parent: ZswapCoinPublicKey = PARENT,
    opSecret: Uint8Array = OP_SECRET,
  ): Promise<Probe> {
    return Probe.over(
      new MockForwarder<EmptyPrivateState>(emptyWitnesses()),
      commitmentOf(parent, opSecret),
      true,
    );
  }

  static example(
    parent: ZswapCoinPublicKey = PARENT,
    opSecret: Uint8Array = OP_SECRET,
  ): Promise<Probe> {
    return Probe.over(
      new ForwarderExample<EmptyPrivateState>(emptyWitnesses()),
      commitmentOf(parent, opSecret),
    );
  }

  /** How many calls have left proof data behind. */
  get calls(): number {
    return this.manager.getContext().callProofDataTrace.length;
  }

  /** A fresh Zswap local state per call, so `zswap` holds that call's coins only. */
  private context(): CircuitContext<EmptyPrivateState> {
    const ctx = copyCircuitContext(this.manager.getContext());
    ctx.callContext.currentZswapLocalState = emptyZswapLocalState(CALLER);
    return ctx;
  }

  private async run<T>(
    call: (
      context: CircuitContext<EmptyPrivateState>,
    ) => Promise<CircuitResults<EmptyPrivateState, T>>,
  ): Promise<[T, Trace]> {
    const { result, context } = await call(this.context());
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
        input: proofData.input,
        output: proofData.output,
        zswap: proofData.zswapLocalState,
      },
    ];
  }

  deposit(coin: ShieldedCoinInfo): Promise<[[], Trace]> {
    return this.run((context) =>
      this.contract.impureCircuits.deposit(context, coin),
    );
  }

  drain(
    coin: QualifiedShieldedCoinInfo,
    parent: ZswapCoinPublicKey,
    opSecret: Uint8Array,
    value: bigint,
  ): Promise<[ShieldedSendResult, Trace]> {
    return this.run((context) =>
      this.contract.impureCircuits.drain(
        context,
        coin,
        parent,
        opSecret,
        value,
      ),
    );
  }

  drainAndRouteChange(
    coin: QualifiedShieldedCoinInfo,
    parent: ZswapCoinPublicKey,
    opSecret: Uint8Array,
    value: bigint,
    changeRecipient: EncodedRecipient,
  ): Promise<[ShieldedSendResult, Trace]> {
    const circuits = this.contract.impureCircuits;
    if (!('drainAndRouteChange' in circuits)) {
      throw new Error('probe: only the mock routes change onward');
    }
    return this.run((context) =>
      circuits.drainAndRouteChange(
        context,
        coin,
        parent,
        opSecret,
        value,
        changeRecipient,
      ),
    );
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

/** A coin as the runtime aligns it: nonce, color, value. */
const encodingOfCoin = (coin: ShieldedCoinInfo): string[] => [
  encoded(coin.nonce),
  encoded(coin.color),
  ...encodingsOfUint(coin.value),
];

/** A `ShieldedSendResult` as the runtime aligns it: change first, then sent. */
const encodingOfResult = (result: ShieldedSendResult): string[] => [
  result.change.is_some ? '01' : '',
  ...encodingOfCoin(result.change.value),
  ...encodingOfCoin(result.sent),
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

/**
 * Amounts and indices are a few bytes wide, so a substring match would collide
 * inside a digest. Only a whole published value counts.
 */
const expectNoWholeValue = (published: string[], secrets: string[]): void => {
  for (const secret of secrets) {
    expect(secret).not.toBe('');
    expect(published).not.toContain(secret);
  }
};

/**
 * A Zswap output to a contract carries that address in cleartext. One to a
 * coin public key carries a ciphertext instead.
 */
const contractRecipients = (trace: Trace): string[] =>
  trace.zswap.outputs
    .filter((output) => !output.recipient.is_left)
    .map((output) => hex(output.recipient.right.bytes));

// ---------------------------------------------------------------------------
// Replaying the stack: which field a read or an `ins` lands in
// ---------------------------------------------------------------------------

/** Ledger fields by state index, in the module's declaration order. */
const LEDGER_FIELDS = ['_parentCommitment', '_isInitialized'] as const;

/** Effects fields by index, in the runtime's `Effects` order. */
const EFFECTS_FIELDS = [
  'claimedNullifiers',
  'claimedShieldedReceives',
  'claimedShieldedSpends',
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
  reads: { root: Root; field: number; value: string }[];
  /** `member` is the key inserted, a set member for the Zswap effects. */
  writes: { root: Root; field: number; member?: string }[];
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
        let member: string | undefined;
        for (let i = 0; i < arg.n; i++) {
          key = pop();
          if (i === 0) member = key.literal;
          container = pop();
        }
        if (container.root === 'state' || container.root === 'effects') {
          writes.push({
            root: container.root,
            field: container.field ?? key.field ?? Number.NaN,
            member,
          });
        }
        stack.push(container);
        break;
      }
      case 'popeq': {
        const slot = pop();
        if (slot.root !== 'value' && slot.field !== undefined) {
          reads.push({
            root: slot.root,
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
            : {
                root: 'value',
                field: fieldOfLiteral(content),
                literal: bytesIn(content)[0],
              },
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

/** The Zswap effects a call claims, in order: which set, which member. */
const effectsWrites = (trace: Trace): { field: string; member: string }[] =>
  replay(trace.transcript)
    .writes.filter((write) => write.root === 'effects')
    .map((write) => ({
      field: EFFECTS_FIELDS[write.field] ?? `#${write.field}`,
      member: write.member ?? '',
    }));

const ledgerReads = (trace: Trace): Record<string, string[]> => {
  const reads: Record<string, string[]> = {};
  for (const read of replay(trace.transcript).reads) {
    if (read.root !== 'state') continue;
    const name = LEDGER_FIELDS[read.field] ?? `#${read.field}`;
    reads[name] = [...(reads[name] ?? []), read.value];
  }
  return reads;
};

/** What a call reads from the call context, `kernel.self()` included. */
const contextReads = (trace: Trace): string[] =>
  replay(trace.transcript)
    .reads.filter((read) => read.root === 'context')
    .map((read) => read.value);

const EXAMPLE_SOURCE = readFileSync(
  new URL('../examples/ForwarderPrivateExample.compact', import.meta.url),
  'utf8',
);

// ---------------------------------------------------------------------------
// What reaches the public transcript
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ForwarderPrivate privacy: the public transcript',
  () => {
    const drains: [kind: string, value: bigint][] = [
      ['partial', PARTIAL],
      ['full', AMOUNT],
    ];

    // The dry runtime keeps no coin set, so a drain needs no prior deposit.
    const drain = async (
      value: bigint,
    ): Promise<[ShieldedSendResult, Trace]> => {
      const probe = await Probe.create();
      return probe.drain(coinOf(), PARENT, OP_SECRET, value);
    };

    const deposit = async (): Promise<Trace> => {
      const probe = await Probe.create();
      const [, trace] = await probe.deposit({
        nonce: COIN_NONCE,
        color: COLOR,
        value: AMOUNT,
      });
      return trace;
    };

    it('reads the ledger at the indices the replay maps to', async () => {
      const [, trace] = await drain(PARTIAL);

      expect(ledgerReads(trace)).toStrictEqual({
        _isInitialized: ['01'],
        _parentCommitment: [hex(commitmentOf(PARENT, OP_SECRET))],
      });
    });

    it.each(drains)(
      'a %s drain publishes none of its arguments',
      async (_kind, value) => {
        const [, trace] = await drain(value);
        const published = bytesIn(trace.transcript);

        expectAbsent(published, [
          ...encodingsOfBytes(OP_SECRET),
          ...encodingsOfBytes(PARENT.bytes),
          ...encodingsOfBytes(COIN_NONCE),
          ...encodingsOfBytes(COLOR),
        ]);
        expectNoWholeValue(published, [
          ...encodingsOfUint(AMOUNT),
          ...encodingsOfUint(MT_INDEX),
          ...encodingsOfUint(value),
        ]);
        // The mirror image: the arguments exist, on the side that never leaves
        // the prover. Without this an empty read would pass every check above.
        expect(bytesIn(trace.input)).toStrictEqual([
          ...encodingOfCoin(coinOf()),
          ...encodingsOfUint(MT_INDEX),
          encoded(PARENT.bytes),
          encoded(OP_SECRET),
          ...encodingsOfUint(value),
        ]);
        expect(bytesIn(trace.privateOutputs)).toStrictEqual([]);
      },
    );

    it('a partial drain returns the sent coin and the change', async () => {
      const [result] = await drain(PARTIAL);

      expect(result.sent.value).toBe(PARTIAL);
      expect(result.sent.color).toStrictEqual(COLOR);
      expect(result.change.is_some).toBe(true);
      expect(result.change.value.value).toBe(AMOUNT - PARTIAL);
      expect(result.change.value.color).toStrictEqual(COLOR);
    });

    it('a full drain returns the sent coin and no change', async () => {
      const [result] = await drain(AMOUNT);

      expect(result.sent.value).toBe(AMOUNT);
      expect(result.sent.color).toStrictEqual(COLOR);
      expect(result.change.is_some).toBe(false);
    });

    it.each(drains)(
      'a %s drain keeps the coins it returns on the private side',
      async (_kind, value) => {
        const [result, trace] = await drain(value);
        const published = bytesIn(trace.transcript);
        const returned = [
          result.sent,
          ...(result.change.is_some ? [result.change.value] : []),
        ];

        // The return value is the circuit output, whole.
        expect(bytesIn(trace.output)).toStrictEqual(encodingOfResult(result));
        for (const coin of returned) {
          expectAbsent(published, [
            ...encodingsOfBytes(coin.nonce),
            ...encodingsOfBytes(coin.color),
          ]);
          expectNoWholeValue(published, encodingsOfUint(coin.value));
        }
      },
    );

    it.each(drains)(
      'a %s drain reads only the init flag and the parent commitment',
      async (_kind, value) => {
        const [, trace] = await drain(value);

        expect(Object.keys(ledgerReads(trace)).sort()).toStrictEqual([
          '_isInitialized',
          '_parentCommitment',
        ]);
      },
    );

    it('a partial drain writes no ledger field, only Zswap effects', async () => {
      const [, trace] = await drain(PARTIAL);

      expect(ledgerWrites(trace)).toStrictEqual([]);
      // The change is both spent to and received by the forwarder.
      expect(effectsWrites(trace).map((write) => write.field)).toStrictEqual([
        'claimedNullifiers',
        'claimedShieldedSpends',
        'claimedShieldedSpends',
        'claimedShieldedReceives',
      ]);
    });

    it('a full drain writes no ledger field, only Zswap effects', async () => {
      const [, trace] = await drain(AMOUNT);

      expect(ledgerWrites(trace)).toStrictEqual([]);
      expect(effectsWrites(trace).map((write) => write.field)).toStrictEqual([
        'claimedNullifiers',
        'claimedShieldedSpends',
      ]);
    });

    it('deposit publishes neither the coin nonce, its value nor its color', async () => {
      const trace = await deposit();
      const published = bytesIn(trace.transcript);

      expectAbsent(published, [
        ...encodingsOfBytes(COIN_NONCE),
        ...encodingsOfBytes(COLOR),
      ]);
      expectNoWholeValue(published, encodingsOfUint(AMOUNT));
      expect(bytesIn(trace.input)).toStrictEqual(
        encodingOfCoin({ nonce: COIN_NONCE, color: COLOR, value: AMOUNT }),
      );
    });

    it('deposit writes no ledger field, only a Zswap receive', async () => {
      const trace = await deposit();

      expect(ledgerWrites(trace)).toStrictEqual([]);
      expect(effectsWrites(trace).map((write) => write.field)).toStrictEqual([
        'claimedShieldedReceives',
      ]);
    });

    it('a rejected drain leaves no transcript to publish', async () => {
      const probe = await Probe.create();

      await expect(
        probe.drain(coinOf(), PARENT, WRONG_OP_SECRET, PARTIAL),
      ).rejects.toThrow('ForwarderPrivate: invalid parent');
      expect(probe.calls).toBe(0);
    });

    // Positive controls: what the scanner must find, or every absence above is
    // vacuous.

    it.each(drains)(
      'a %s drain publishes the parent commitment, once',
      async (_kind, value) => {
        const [, trace] = await drain(value);
        const commitment = hex(commitmentOf(PARENT, OP_SECRET));

        expect(
          bytesIn(trace.transcript).filter(
            (published) => published === commitment,
          ),
        ).toHaveLength(1);
      },
    );

    it('every call publishes the forwarder address, read from the context', async () => {
      const [, drained] = await drain(PARTIAL);

      expect(contextReads(drained)).toStrictEqual([FORWARDER_ADDRESS]);
      expect(contextReads(await deposit())).toStrictEqual([FORWARDER_ADDRESS]);
    });

    it.each(drains)(
      'a %s drain publishes ledger reads, its own address and Zswap digests, nothing else',
      async (_kind, value) => {
        const [, trace] = await drain(value);
        const published = bytesIn(trace.transcript);
        const members = effectsWrites(trace).map((write) => write.member);

        expect(published.filter((bytes) => bytes.length > 2)).toStrictEqual([
          hex(commitmentOf(PARENT, OP_SECRET)),
          FORWARDER_ADDRESS,
          ...members,
        ]);
        for (const member of members) expect(isDigest(member)).toBe(true);
        // Field indices and the init flag.
        expect(
          [...new Set(published.filter((bytes) => bytes.length <= 2))].sort(),
        ).toStrictEqual(['', '01', '02']);
      },
    );

    it('a partial drain addresses its change to the forwarder', async () => {
      const [result, trace] = await drain(PARTIAL);
      const toSelf = trace.zswap.outputs.filter(
        (output) => !output.recipient.is_left,
      );

      expect(contractRecipients(trace)).toStrictEqual([FORWARDER_ADDRESS]);
      expect(toSelf.map((output) => output.coinInfo)).toStrictEqual([
        result.change.value,
      ]);
    });

    it('a full drain addresses no output to a contract', async () => {
      const [, trace] = await drain(AMOUNT);

      expect(contractRecipients(trace)).toStrictEqual([]);
    });

    // The address is published by the Zswap output, not by the transcript.
    it('a contract change recipient is published', async () => {
      const probe = await Probe.create();
      const [, trace] = await probe.drainAndRouteChange(
        coinOf(),
        PARENT,
        OP_SECRET,
        PARTIAL,
        eitherContractFromAddress(ROUTED_TO),
      );

      expect(contractRecipients(trace)).toStrictEqual([
        FORWARDER_ADDRESS,
        ROUTED_TO,
      ]);
      expect(bytesIn(trace.input)).toContain(ROUTED_TO);
      expectAbsent(bytesIn(trace.transcript), [ROUTED_TO]);
    });
  },
);

// ---------------------------------------------------------------------------
// Indistinguishability: the shape does not depend on the secrets
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ForwarderPrivate privacy: indistinguishability',
  () => {
    type Secrets = {
      value?: bigint;
      nonce?: Uint8Array;
      parent?: ZswapCoinPublicKey;
      opSecret?: Uint8Array;
    };

    /** Each run deploys its own forwarder, committed to its own pair. */
    const drainTrace = async ({
      value = PARTIAL,
      nonce = COIN_NONCE,
      parent = PARENT,
      opSecret = OP_SECRET,
    }: Secrets = {}): Promise<Trace> => {
      const probe = await Probe.create(parent, opSecret);
      return (await probe.drain(coinOf(nonce), parent, opSecret, value))[1];
    };

    // Run counts are small: each case drives two full circuit executions.
    const RUNS = { numRuns: 10 };

    /** A drain the 1000-value coin can pay without consuming it. */
    const partialValue = () => fc.bigInt({ min: 0n, max: AMOUNT - 1n });
    /** A non-zero tail keeps the trimmed encoding at full width. */
    const anyBytes = () =>
      fc
        .uint8Array({ minLength: 32, maxLength: 32 })
        .filter((bytes) => bytes[31] !== 0);
    const anyKey = () =>
      anyBytes().map((bytes): ZswapCoinPublicKey => ({ bytes }));

    const expectOneShape = (left: Trace, right: Trace): void => {
      expect(shapeOf(left.transcript)).toStrictEqual(shapeOf(right.transcript));
      expect(bytesIn(left.transcript).map(widthOf)).toStrictEqual(
        bytesIn(right.transcript).map(widthOf),
      );
    };

    it('drain has one shape for any partial value', async () => {
      await fc.assert(
        fc.asyncProperty(partialValue(), partialValue(), async (a, b) => {
          expectOneShape(
            await drainTrace({ value: a }),
            await drainTrace({ value: b }),
          );
        }),
        RUNS,
      );
    });

    it('drain has one shape for any coin nonce', async () => {
      await fc.assert(
        fc.asyncProperty(anyBytes(), anyBytes(), async (first, second) => {
          expectOneShape(
            await drainTrace({ nonce: first }),
            await drainTrace({ nonce: second }),
          );
        }),
        RUNS,
      );
    });

    it('drain has one shape for any parent and opSecret', async () => {
      await fc.assert(
        fc.asyncProperty(
          anyKey(),
          anyBytes(),
          anyKey(),
          anyBytes(),
          async (parentA, secretA, parentB, secretB) => {
            expectOneShape(
              await drainTrace({ parent: parentA, opSecret: secretA }),
              await drainTrace({ parent: parentB, opSecret: secretB }),
            );
          },
        ),
        RUNS,
      );
    });

    it('drain moves only the coin commitments when the value differs', async () => {
      await fc.assert(
        fc.asyncProperty(partialValue(), partialValue(), async (a, b) => {
          fc.pre(a !== b);

          const moved = drift(
            await drainTrace({ value: a }),
            await drainTrace({ value: b }),
          );

          // The sent coin, then the change as a spend and as a receive.
          expect(moved).toHaveLength(3);
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

    it('drain moves only the nullifier and the coin commitments when the coin nonce differs', async () => {
      await fc.assert(
        fc.asyncProperty(anyBytes(), anyBytes(), async (first, second) => {
          fc.pre(hex(first) !== hex(second));

          const moved = drift(
            await drainTrace({ nonce: first }),
            await drainTrace({ nonce: second }),
          );

          expect(moved).toHaveLength(4);
          expectOpaque(moved, [
            ...encodingsOfBytes(first),
            ...encodingsOfBytes(second),
          ]);
        }),
        RUNS,
      );
    });

    it('drain moves only the parent commitment when the opSecret differs', async () => {
      await fc.assert(
        fc.asyncProperty(anyBytes(), anyBytes(), async (first, second) => {
          fc.pre(hex(first) !== hex(second));

          const moved = drift(
            await drainTrace({ opSecret: first }),
            await drainTrace({ opSecret: second }),
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

    it('drain moves only the parent commitment and the sent coin commitment when the parent differs', async () => {
      await fc.assert(
        fc.asyncProperty(anyKey(), anyKey(), async (first, second) => {
          fc.pre(hex(first.bytes) !== hex(second.bytes));

          const moved = drift(
            await drainTrace({ parent: first }),
            await drainTrace({ parent: second }),
          );

          expect(moved).toHaveLength(2);
          expectOpaque(moved, [
            ...encodingsOfBytes(first.bytes),
            ...encodingsOfBytes(second.bytes),
          ]);
        }),
        RUNS,
      );
    });

    // An accepted leak: the change output reveals that a drain was partial.
    it('a full drain and a partial drain differ in shape', async () => {
      const full = await drainTrace({ value: AMOUNT });
      const partial = await drainTrace({ value: PARTIAL });

      expect(shapeOf(full.transcript)).not.toStrictEqual(
        shapeOf(partial.transcript),
      );
      expect(effectsWrites(full)).toHaveLength(2);
      expect(effectsWrites(partial)).toHaveLength(4);
    });
  },
);

// ---------------------------------------------------------------------------
// The example's surface
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ForwarderPrivate privacy: the example surface',
  () => {
    const sourceLines = EXAMPLE_SOURCE.split('\n')
      .map((line) => line.trim())
      .filter(
        (line) =>
          !line.startsWith('/**') &&
          !line.startsWith('*') &&
          !line.startsWith('//'),
      );

    // Every crossing of the privacy boundary belongs to the module; the
    // example itself adds none.
    it('discloses nothing of its own', () => {
      expect(
        sourceLines.filter((line) => line.includes('disclose(')),
      ).toStrictEqual([]);
    });

    it('reads no witness of its own', () => {
      expect(
        sourceLines.filter(
          (line) => line.includes('witness') || line.includes('wit_'),
        ),
      ).toStrictEqual([]);
    });

    it('declares no ledger field of its own', () => {
      expect(
        sourceLines.filter((line) =>
          /^(export\s+)?(sealed\s+)?ledger\b/.test(line),
        ),
      ).toStrictEqual([]);
    });

    it.each([
      ['partial', PARTIAL],
      ['full', AMOUNT],
    ])(
      'a %s drain on the example publishes what the mock publishes',
      async (_kind, value) => {
        const mock = await Probe.create();
        const example = await Probe.example();
        const [mockResult, mockTrace] = await mock.drain(
          coinOf(),
          PARENT,
          OP_SECRET,
          value,
        );
        const [exampleResult, exampleTrace] = await example.drain(
          coinOf(),
          PARENT,
          OP_SECRET,
          value,
        );

        expect(exampleResult).toStrictEqual(mockResult);
        expect(exampleTrace.transcript).toStrictEqual(mockTrace.transcript);
        expect(bytesIn(exampleTrace.output)).toStrictEqual(
          encodingOfResult(exampleResult),
        );
      },
    );
  },
);

// ---------------------------------------------------------------------------
// Ground truth: the transaction as the chain stored it
// ---------------------------------------------------------------------------

/**
 * Presence scanning only. Two real transactions differ in proofs, fees and
 * wallet nonces whatever the circuit does, so the differential layer stays
 * dry.
 *
 * Only 32-byte values are scanned, and the matcher also covers the form the
 * ledger trims them to. An amount or an index is a few bytes wide and
 * collides inside a proof blob, so none is scanned here.
 */
describe.runIf(isLiveBackend())(
  'ForwarderPrivate privacy: the published transaction',
  () => {
    /** 32 random bytes, redrawn when a zero tail trims them under the matcher's floor. */
    const liveSecret = (): Uint8Array => {
      const secret = Uint8Array.from(randomBytes(32));
      try {
        publishedContains([], secret, { as: 'bytes' });
        return secret;
      } catch (error) {
        if (error instanceof RangeError) return liveSecret();
        throw error;
      }
    };

    const published = (txs: readonly PublishedTx[], needle: Uint8Array) =>
      publishedContains(txs, needle, { as: 'bytes' });

    /** A deployed forwarder holding one deposited coin, qualified to spend. */
    const funded = async (opSecret: Uint8Array) => {
      const forwarder = await MockForwarderPrivateSimulator.create(
        commitmentOf(PARENT, opSecret),
        true,
      );
      const deposited = encodeShieldedCoinInfo(COLOR, AMOUNT);

      const from = await indexerHead();
      await forwarder.deposit(deposited);
      const depositTxs = await awaitPublishedTxs(
        from,
        forwarder.contractAddress,
        { entryPoint: 'deposit' },
      );
      const coin = await getQualifiedShieldedCoinInfo(
        contractOwner(forwarder),
        deposited,
      );
      return { forwarder, deposited, depositTxs, coin };
    };

    /** A partial drain and the one transaction that carried it. */
    const drained = async (opSecret: Uint8Array) => {
      const { forwarder, coin } = await funded(opSecret);

      const from = await indexerHead();
      const result = await forwarder.drain(coin, PARENT, opSecret, PARTIAL);
      const drainTxs = await awaitPublishedTxs(
        from,
        forwarder.contractAddress,
        { entryPoint: 'drain' },
      );
      return { forwarder, coin, result, drainTxs };
    };

    it('deposit publishes no coin nonce', async () => {
      const { deposited, depositTxs } = await funded(liveSecret());

      expect(depositTxs).toHaveLength(1);
      expect(published(depositTxs, deposited.nonce)).toBe(false);
    });

    it('drain publishes neither the opSecret, the parent key nor a coin nonce', async () => {
      const opSecret = liveSecret();
      const { coin, result, drainTxs } = await drained(opSecret);

      expect(drainTxs).toHaveLength(1);
      expect(result.change.is_some).toBe(true);
      expect(published(drainTxs, opSecret)).toBe(false);
      expect(published(drainTxs, PARENT.bytes)).toBe(false);
      expect(published(drainTxs, coin.nonce)).toBe(false);
      expect(published(drainTxs, result.sent.nonce)).toBe(false);
      expect(published(drainTxs, result.change.value.nonce)).toBe(false);
    });

    // The scanner's control: a transcript value it must find on the wire.
    it('drain publishes the parent commitment', async () => {
      const opSecret = liveSecret();
      const { drainTxs } = await drained(opSecret);

      expect(published(drainTxs, commitmentOf(PARENT, opSecret))).toBe(true);
    });

    // A known, accepted leak: the entry point names the circuit.
    it('publishes the entry point of the one call it carries', async () => {
      const { forwarder, drainTxs } = await drained(liveSecret());

      const bare = (address: string): string => address.replace(/^0x/, '');
      const calls = drainTxs.map((tx) =>
        tx.calls.map((call) => [bare(call.address), call.entryPoint]),
      );
      expect(calls).toStrictEqual([
        [[bare(forwarder.contractAddress), 'drain']],
      ]);
    });
  },
);
