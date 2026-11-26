import type {
  JubjubPoint,
  MerkleTreePathEntry,
} from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Core_Note,
  type Either,
  ledger,
  Contract as MockReviewed,
  pureCircuits,
  type Review_RecoveredRecord as RecoveredRecord,
  type Review_ReviewRecord as ReviewRecord,
} from '../../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenReviewed/contract/index.js';
import {
  type CustodialConfidentialNoteFungibleTokenPrivateState,
  CustodialConfidentialNoteFungibleTokenWitnesses,
  type CustodialWallet,
  createCustodialWallet,
  type ICustodialConfidentialNoteFungibleTokenWitnesses,
  NOTE_SALT,
  CustodialConfidentialNoteFungibleTokenPrivateState as PrivateState,
} from '../../../presets/test/witnesses/CustodialConfidentialNoteFungibleTokenWitnesses.js';

export type { RecoveredRecord, ReviewRecord };

/** `Identifier`: a `left` public key or a `right` contract address. */
export type Identifier = Either<Uint8Array, ContractAddress>;

export type Note = Core_Note;

type Ledger = ReturnType<typeof ledger>;
type Witnesses = ICustodialConfidentialNoteFungibleTokenWitnesses<
  Ledger,
  CustodialConfidentialNoteFungibleTokenPrivateState
>;
type Options = SimulatorOptions<
  CustodialConfidentialNoteFungibleTokenPrivateState,
  Witnesses
>;

type ReviewedArgs = readonly [noteSalt: Uint8Array];

const ConfidentialNoteFungibleTokenReviewedSimulatorBase = createSimulator<
  CustodialConfidentialNoteFungibleTokenPrivateState,
  Ledger,
  Witnesses,
  MockReviewed<CustodialConfidentialNoteFungibleTokenPrivateState>,
  ReviewedArgs
>({
  contractFactory: (witnesses) =>
    new MockReviewed<CustodialConfidentialNoteFungibleTokenPrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: (noteSalt) => [noteSalt],
  ledgerExtractor: (state) => ledger(state),
  // Fallback only: `create` always passes its own witnesses.
  witnessesFactory: () =>
    CustodialConfidentialNoteFungibleTokenWitnesses<Ledger>(
      createCustodialWallet(),
    ),
  artifactName: 'MockConfidentialNoteFungibleTokenReviewed',
});

/**
 * Simulator for the core + review composition.
 *
 * The caller's secret and the seed are witness inputs: set them on
 * {@link wallet}. A spend takes the note and its path entries as arguments,
 * see {@link pathOf}. Every created note gets one `Review__reviewTrail` record
 * to the reviewer key the call names.
 */
export class ConfidentialNoteFungibleTokenReviewedSimulator extends ConfidentialNoteFungibleTokenReviewedSimulatorBase {
  /** The private inputs the witnesses answer with. Mutate between calls. */
  public wallet!: CustodialWallet;

  /**
   * @param options Standard simulator options, plus the `noteSalt` (default
   * {@link NOTE_SALT}) and a `wallet` to reuse across deployments. Passing
   * `options.witnesses` takes over witness wiring entirely and leaves
   * {@link wallet} disconnected.
   */
  static async create(
    options: Options & {
      noteSalt?: Uint8Array;
      wallet?: CustodialWallet;
    } = {},
  ): Promise<ConfidentialNoteFungibleTokenReviewedSimulator> {
    const { noteSalt, wallet: givenWallet, ...rest } = options;
    const wallet = givenWallet ?? createCustodialWallet();
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    const simulator = (await super.create([noteSalt ?? NOTE_SALT], {
      ...rest,
      witnesses:
        rest.witnesses ??
        CustodialConfidentialNoteFungibleTokenWitnesses<Ledger>(wallet),
    })) as ConfidentialNoteFungibleTokenReviewedSimulator;
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

  /** Mints `value` to `recipientPk` and reviews it to `reviewerKey`. Ungated. */
  public mint(
    recipientPk: Identifier,
    value: bigint,
    reviewerKey: JubjubPoint,
  ): Promise<Note> {
    return this.circuits.impure.mint(recipientPk, value, reviewerKey);
  }

  /** Spends the caller's `note` into a recipient note plus change, both reviewed. */
  public transfer(
    recipientPk: Identifier,
    value: bigint,
    note: Note,
    path: MerkleTreePathEntry[],
    reviewerKey: JubjubPoint,
  ): Promise<[Note, Note]> {
    return this.circuits.impure.transfer(
      recipientPk,
      value,
      note,
      path,
      reviewerKey,
    );
  }

  /** Burns `value` from the caller's `note` and reviews the change. */
  public burn(
    value: bigint,
    note: Note,
    path: MerkleTreePathEntry[],
    reviewerKey: JubjubPoint,
  ): Promise<Note> {
    return this.circuits.impure.burn(value, note, path, reviewerKey);
  }

  /**
   * The path entries of `note`'s commitment under `ownerPk`, read from the
   * current tree.
   *
   * @throws If no such leaf is committed.
   */
  public async pathOf(
    note: Note,
    ownerPk: Identifier,
  ): Promise<MerkleTreePathEntry[]> {
    const path = (
      await this.getPublicState()
    ).Core__commitments.findPathForLeaf(pureCircuits.commitOf(note, ownerPk));
    if (path === undefined) {
      throw new Error('pathOf: commitment not found in tree');
    }
    return path.path;
  }
}
