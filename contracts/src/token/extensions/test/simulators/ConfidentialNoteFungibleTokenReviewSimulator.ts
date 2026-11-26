import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockReview,
  type Review_RecoveredRecord as RecoveredRecord,
  type Review_ReviewRecord as ReviewRecord,
} from '../../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenReview/contract/index.js';
import {
  type ConfidentialNoteFungibleTokenReviewPrivateState,
  ConfidentialNoteFungibleTokenReviewWitnesses,
  createReviewWallet,
  type IConfidentialNoteFungibleTokenReviewWitnesses,
  ConfidentialNoteFungibleTokenReviewPrivateState as PrivateState,
  type ReviewWallet,
} from '../witnesses/ConfidentialNoteFungibleTokenReviewWitnesses.js';

export type { RecoveredRecord, ReviewRecord };

/** `Identifier`: a `left` public key or a `right` contract address. */
export type Identifier = Either<Uint8Array, ContractAddress>;

type Ledger = ReturnType<typeof ledger>;
type Witnesses = IConfidentialNoteFungibleTokenReviewWitnesses<
  Ledger,
  ConfidentialNoteFungibleTokenReviewPrivateState
>;
type Options = SimulatorOptions<
  ConfidentialNoteFungibleTokenReviewPrivateState,
  Witnesses
>;

const ConfidentialNoteFungibleTokenReviewSimulatorBase = createSimulator<
  ConfidentialNoteFungibleTokenReviewPrivateState,
  Ledger,
  Witnesses,
  MockReview<ConfidentialNoteFungibleTokenReviewPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new MockReview<ConfidentialNoteFungibleTokenReviewPrivateState>(witnesses),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  // Fallback only: `create` always passes its own witnesses.
  witnessesFactory: () =>
    ConfidentialNoteFungibleTokenReviewWitnesses<Ledger>(createReviewWallet()),
  artifactName: 'MockConfidentialNoteFungibleTokenReview',
});

/**
 * ConfidentialNoteFungibleTokenReview (standalone) simulator.
 *
 * Drives the extension with nothing committed. `recoverRecord` and `ownerOf`
 * are pure: call them through the artifact's `pureCircuits`.
 */
export class ConfidentialNoteFungibleTokenReviewSimulator extends ConfidentialNoteFungibleTokenReviewSimulatorBase {
  /** The private input the seed witness answers with. Mutate between calls. */
  public wallet!: ReviewWallet;

  /**
   * @param options Standard simulator options, plus a `wallet` to reuse across
   * deployments. Passing `options.witnesses` takes over witness wiring
   * entirely and leaves {@link wallet} disconnected.
   */
  static async create(
    options: Options & { wallet?: ReviewWallet } = {},
  ): Promise<ConfidentialNoteFungibleTokenReviewSimulator> {
    const { wallet: givenWallet, ...rest } = options;
    const wallet = givenWallet ?? createReviewWallet();
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    const simulator = (await super.create([], {
      ...rest,
      witnesses:
        rest.witnesses ??
        ConfidentialNoteFungibleTokenReviewWitnesses<Ledger>(wallet),
    })) as ConfidentialNoteFungibleTokenReviewSimulator;
    simulator.wallet = wallet;
    return simulator;
  }

  /** Approves `reviewerKey`. Ungated. */
  public _addReviewer(reviewerKey: JubjubPoint): Promise<[]> {
    return this.circuits.impure._addReviewer(reviewerKey);
  }

  /** Withdraws `reviewerKey`'s approval. Ungated. */
  public _removeReviewer(reviewerKey: JubjubPoint): Promise<[]> {
    return this.circuits.impure._removeReviewer(reviewerKey);
  }

  /** Publishes `(owner, value, nonce)` encrypted to an approved key. Ungated. */
  public _review(
    reviewerKey: JubjubPoint,
    owner: Identifier,
    value: bigint,
    nonce: bigint,
    slot: Uint8Array,
  ): Promise<[]> {
    return this.circuits.impure._review(reviewerKey, owner, value, nonce, slot);
  }
}
