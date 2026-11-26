import type { MerkleTreePathEntry } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Core_Note,
  type Either,
  ledger,
  Contract as MockAllowlisted,
  pureCircuits,
} from '../../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAllowlisted/contract/index.js';
import {
  type CustodialConfidentialNoteFungibleTokenPrivateState,
  CustodialConfidentialNoteFungibleTokenWitnesses,
  type CustodialWallet,
  createCustodialWallet,
  type ICustodialConfidentialNoteFungibleTokenWitnesses,
  NOTE_SALT,
  CustodialConfidentialNoteFungibleTokenPrivateState as PrivateState,
} from '../../../presets/test/witnesses/CustodialConfidentialNoteFungibleTokenWitnesses.js';

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

type AllowlistedArgs = readonly [noteSalt: Uint8Array];

const ConfidentialNoteFungibleTokenAllowlistedSimulatorBase = createSimulator<
  CustodialConfidentialNoteFungibleTokenPrivateState,
  Ledger,
  Witnesses,
  MockAllowlisted<CustodialConfidentialNoteFungibleTokenPrivateState>,
  AllowlistedArgs
>({
  contractFactory: (witnesses) =>
    new MockAllowlisted<CustodialConfidentialNoteFungibleTokenPrivateState>(
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
  artifactName: 'MockConfidentialNoteFungibleTokenAllowlisted',
});

/**
 * ConfidentialNoteFungibleTokenAllowlisted simulator: the core and the
 * Allowlist extension, both at depth 32.
 *
 * The caller's secret and the nonce seed are witness inputs: set them on
 * {@link wallet}. A spend takes the note and its path entries as arguments
 * (see {@link pathOf}) and one allowlist path per checked account (see
 * {@link allowPathOf}).
 */
export class ConfidentialNoteFungibleTokenAllowlistedSimulator extends ConfidentialNoteFungibleTokenAllowlistedSimulatorBase {
  /** The private inputs the witnesses answer with. Mutate between calls. */
  public wallet!: CustodialWallet;

  /**
   * @param options Standard simulator options, plus a `wallet` to reuse across
   * deployments and the `noteSalt` (default {@link NOTE_SALT}). Passing
   * `options.witnesses` takes over witness wiring entirely and leaves
   * {@link wallet} disconnected.
   */
  static async create(
    options: Options & { wallet?: CustodialWallet; noteSalt?: Uint8Array } = {},
  ): Promise<ConfidentialNoteFungibleTokenAllowlistedSimulator> {
    const { wallet: givenWallet, noteSalt, ...rest } = options;
    const wallet = givenWallet ?? createCustodialWallet();
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    const simulator = (await super.create([noteSalt ?? NOTE_SALT], {
      ...rest,
      witnesses:
        rest.witnesses ??
        CustodialConfidentialNoteFungibleTokenWitnesses<Ledger>(wallet),
    })) as ConfidentialNoteFungibleTokenAllowlistedSimulator;
    simulator.wallet = wallet;
    return simulator;
  }

  /** Adds `account` to the list. Ungated. */
  public _allow(account: Identifier): Promise<[]> {
    return this.circuits.impure._allow(account);
  }

  /** Removes `account`, whose leaf `path` proves. Ungated. */
  public _disallow(
    account: Identifier,
    path: MerkleTreePathEntry[],
  ): Promise<[]> {
    return this.circuits.impure._disallow(account, path);
  }

  /** Mints `value` to the member `recipientPk`. Ungated. */
  public mint(
    recipientPk: Identifier,
    value: bigint,
    recipientAllowPath: MerkleTreePathEntry[],
  ): Promise<Note> {
    return this.circuits.impure.mint(recipientPk, value, recipientAllowPath);
  }

  /** Spends the member caller's `note` into a member recipient's note plus change. */
  public transfer(
    recipientPk: Identifier,
    value: bigint,
    note: Note,
    path: MerkleTreePathEntry[],
    spenderAllowPath: MerkleTreePathEntry[],
    recipientAllowPath: MerkleTreePathEntry[],
  ): Promise<[Note, Note]> {
    return this.circuits.impure.transfer(
      recipientPk,
      value,
      note,
      path,
      spenderAllowPath,
      recipientAllowPath,
    );
  }

  /** Burns `value` from the member caller's `note` and returns the change. */
  public burn(
    value: bigint,
    note: Note,
    path: MerkleTreePathEntry[],
    spenderAllowPath: MerkleTreePathEntry[],
  ): Promise<Note> {
    return this.circuits.impure.burn(value, note, path, spenderAllowPath);
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

  /**
   * The path entries of `account`'s allowlist leaf, read from the current
   * tree.
   *
   * @throws If the account has no live leaf.
   */
  public async allowPathOf(
    account: Identifier,
  ): Promise<MerkleTreePathEntry[]> {
    const path = (
      await this.getPublicState()
    ).Allowlist__allowed.findPathForLeaf(pureCircuits.leafOf(account));
    if (path === undefined) {
      throw new Error('allowPathOf: leaf not found in tree');
    }
    return path.path;
  }
}
