/**
 * Concurrency claims for the ZOwnableNativeShieldedToken preset.
 *
 * Every case builds two calls against one snapshot, lands the first, then
 * applies the second. See `#test-utils/concurrency/types.ts` for why that
 * reproduces a real block conflict deterministically.
 *
 * Exhaustive: ten callable circuits give 100 ordered pairs, each asserted
 * against {@link predict} rather than a memorised answer.
 *
 * What each circuit pins (a `popeq` read) and writes:
 *
 *   owner cell   `_ownerCommitment` + `_counter`. Read by every owner-gated
 *                circuit and `owner()`. Written by `transferOwnership` and
 *                `renounceOwnership`.
 *   minted cell  `_totalMinted[default]`. Read by `mint` and `totalMinted`.
 *                Written by `mint`.
 *   metadata     `_name`, `_symbol`, `_decimals`, `_domain`, init flags.
 *                Read only; nothing writes them after deploy.
 *
 * The second call is rejected iff the first wrote a cell the second read.
 */

import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import { createConcurrencyHarness } from '#test-utils/concurrency/backend.js';
import {
  createParties,
  labelledSecret,
} from '#test-utils/concurrency/parties.js';
import { race } from '#test-utils/concurrency/race.js';
import type {
  Call,
  ConcurrencyHarness,
  Outcome,
} from '#test-utils/concurrency/types.js';
import * as utils from '#test-utils/fixtures/address.js';
import { shieldedTestKey } from '#test-utils/fixtures/shieldedKey.js';
import {
  Contract as MockToken,
  type ShieldedCoinInfo,
  type Witnesses,
} from '../../../../artifacts/MockZOwnableNativeShieldedToken/contract/index.js';
import { createIdHash } from './simulators/ZOwnableNativeShieldedTokenSimulator.js';

// ---------------------------------------------------------------------------
// One wallet, two owner identities, one ledger
// ---------------------------------------------------------------------------

type PrivateState = Record<string, never>;

/** The secret behind an owner id; the witness answers from it. */
interface OwnerWallet {
  secretNonce: Uint8Array;
}

// The harness runs every call with one coin public key, so the two identities
// differ by nonce only, as in an owner rotating its nonce on one wallet.
const WALLET = 'SIGNER1';
const OWNER = 'owner';
const SUCCESSOR = 'successor';

const Z_WALLET = shieldedTestKey(WALLET).left;
const OWNER_ID = createIdHash(Z_WALLET, labelledSecret(OWNER));
const SUCCESSOR_ID = createIdHash(Z_WALLET, labelledSecret(SUCCESSOR));

const b32 = (label: string): Uint8Array => labelledSecret(label);

const INSTANCE_SALT = new Uint8Array(32).fill(0x5a);
const TOKEN_DOMAIN = b32('zownable-nst:token');
const NAME = 'Ownable Shielded Token';
const SYMBOL = 'OST';
const DECIMALS = 2n;

const AMOUNT = 1_000n;
const PARTIAL = 600n;
const RECIPIENT = utils.encodeToPK('RECIPIENT');
const REFUND_TO = utils.encodeToPK('REFUND_TO');

const witnessesFor = (wallet: OwnerWallet): Witnesses<PrivateState> => ({
  wit_secretNonce: (context) => [context.privateState, wallet.secretNonce],
});

const ownerParties = () =>
  createParties<OwnerWallet, MockToken<PrivateState>>([OWNER, SUCCESSOR], {
    wallet: (label) => ({ secretNonce: labelledSecret(label) }),
    contract: (wallet) => new MockToken(witnessesFor(wallet)),
  });

const createHarness = async (): Promise<ConcurrencyHarness> => {
  const { contracts } = ownerParties();
  return createConcurrencyHarness<PrivateState>({
    contracts,
    privateState: {},
    coinPublicKey: utils.toHexPadded(WALLET),
    constructorArgs: [
      OWNER_ID,
      INSTANCE_SALT,
      TOKEN_DOMAIN,
      NAME,
      SYMBOL,
      DECIMALS,
      true,
    ],
  });
};

// ---------------------------------------------------------------------------
// The operation space, and the conflict model it is measured against
// ---------------------------------------------------------------------------

/** Every circuit the mock exposes as a transaction. */
const OPERATIONS = [
  'mint',
  'burn',
  'transferOwnership',
  'renounceOwnership',
  'owner',
  'totalMinted',
  'name',
  'symbol',
  'decimals',
  'tokenColor',
] as const;

type Operation = (typeof OPERATIONS)[number];

/** A ledger cell that some circuit writes after deploy. */
type Cell = 'owner' | 'minted';

interface Footprint {
  readonly reads: readonly Cell[];
  readonly writes: readonly Cell[];
}

const FOOTPRINT: Readonly<Record<Operation, Footprint>> = {
  mint: { reads: ['owner', 'minted'], writes: ['minted'] },
  burn: { reads: ['owner'], writes: [] },
  transferOwnership: { reads: ['owner'], writes: ['owner'] },
  renounceOwnership: { reads: ['owner'], writes: ['owner'] },
  owner: { reads: ['owner'], writes: [] },
  totalMinted: { reads: ['minted'], writes: [] },
  name: { reads: [], writes: [] },
  symbol: { reads: [], writes: [] },
  decimals: { reads: [], writes: [] },
  tokenColor: { reads: [], writes: [] },
};

/**
 * The conflict model in one line: a pinned read of a cell the landed call
 * wrote is the only way a replay diverges.
 *
 * @param first - The operation that lands.
 * @param second - The operation applied against the moved state.
 */
const predict = (first: Operation, second: Operation): Outcome =>
  FOOTPRINT[first].writes.some((cell) => FOOTPRINT[second].reads.includes(cell))
    ? 'second-rejected'
    : 'both-landed';

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

interface MatrixCase {
  readonly first: Operation;
  readonly second: Operation;
  readonly expected: Outcome;
  readonly name: string;
}

const describeCase = (
  first: Operation,
  second: Operation,
  expected: Outcome,
): string =>
  expected === 'both-landed'
    ? `${first} then ${second} both land`
    : `${first} then ${second} rejects the second`;

/** Every ordered pair. */
const MATRIX: readonly MatrixCase[] = OPERATIONS.flatMap((first) =>
  OPERATIONS.map((second) => ({
    first,
    second,
    expected: predict(first, second),
    name: describeCase(first, second, predict(first, second)),
  })),
);

/** The call `actor` makes for `operation` in `slot`, so two mints never share a nonce. */
const callFor = (
  actor: string,
  operation: Operation,
  slot: 'first' | 'second',
  color: Uint8Array,
): Call => {
  switch (operation) {
    case 'mint':
      return {
        actor,
        circuitId: 'mint',
        args: [RECIPIENT, AMOUNT, b32(`mint-${slot}`)],
      };
    case 'burn':
      return {
        actor,
        circuitId: 'burn',
        args: [
          { nonce: b32(`coin-${slot}`), color, value: AMOUNT },
          PARTIAL,
          REFUND_TO,
        ],
      };
    case 'transferOwnership':
      return { actor, circuitId: 'transferOwnership', args: [SUCCESSOR_ID] };
    default:
      return { actor, circuitId: operation, args: [] };
  }
};

const tokenColor = (harness: ConcurrencyHarness): Promise<Uint8Array> =>
  harness.apply<Uint8Array>({
    actor: OWNER,
    circuitId: 'tokenColor',
    args: [],
  });

// The dry harness is the only backend; see test-utils/concurrency/backend.ts.
describe.skipIf(isLiveBackend())(
  'ZOwnableNativeShieldedToken: concurrency',
  () => {
    let harness: ConcurrencyHarness;
    let color: Uint8Array;

    beforeEach(async () => {
      harness = await createHarness();
      color = await tokenColor(harness);
    });

    it.each(MATRIX)('$name', async ({ first, second, expected }) => {
      const verdict = await race(
        harness,
        callFor(OWNER, first, 'first', color),
        callFor(OWNER, second, 'second', color),
      );

      expect(verdict.outcome).toBe(expected);
      if (verdict.outcome === 'second-rejected') {
        expect(verdict.reason).not.toBe('');
      }
    });
  },
);

// ---------------------------------------------------------------------------
// Re-proving a lost race against the new state
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ZOwnableNativeShieldedToken: re-proving after a lost race',
  () => {
    let harness: ConcurrencyHarness;
    let color: Uint8Array;

    beforeEach(async () => {
      harness = await createHarness();
      color = await tokenColor(harness);
    });

    const totalMinted = (): Promise<bigint> =>
      harness.apply<bigint>({
        actor: OWNER,
        circuitId: 'totalMinted',
        args: [],
      });

    it('lands the losing mint once rebuilt on the new state', async () => {
      const lost = callFor(OWNER, 'mint', 'second', color);
      const verdict = await race(
        harness,
        callFor(OWNER, 'mint', 'first', color),
        lost,
      );
      expect(verdict.outcome).toBe('second-rejected');
      expect(await totalMinted()).toBe(AMOUNT);

      const coin = await harness.apply<ShieldedCoinInfo>(lost);

      expect(coin).toStrictEqual({
        nonce: b32('mint-second'),
        color,
        value: AMOUNT,
      });
      expect(await totalMinted()).toBe(2n * AMOUNT);
    });

    it('lands the losing mint only for the successor after a transfer', async () => {
      const verdict = await race(
        harness,
        callFor(OWNER, 'transferOwnership', 'first', color),
        callFor(OWNER, 'mint', 'second', color),
      );
      expect(verdict.outcome).toBe('second-rejected');

      const snapshot = await harness.snapshot();
      await expect(
        harness.build(callFor(OWNER, 'mint', 'second', color), snapshot),
      ).rejects.toThrow('ZOwnablePK: caller is not the owner');

      const coin = await harness.apply<ShieldedCoinInfo>(
        callFor(SUCCESSOR, 'mint', 'second', color),
      );

      expect(coin).toStrictEqual({
        nonce: b32('mint-second'),
        color,
        value: AMOUNT,
      });
      expect(await totalMinted()).toBe(AMOUNT);
    });
  },
);
