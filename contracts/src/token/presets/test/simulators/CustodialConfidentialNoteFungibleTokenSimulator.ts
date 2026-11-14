import type { MerkleTreePathEntry } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockCustodial,
  pureCircuits,
  type Token_Core_Note,
} from '../../../../../artifacts/token/presets/test/mocks/MockCustodialConfidentialNoteFungibleToken/contract/index.js';
import {
  type CustodialConfidentialNoteFungibleTokenPrivateState,
  CustodialConfidentialNoteFungibleTokenWitnesses,
  type CustodialWallet,
  createCustodialWallet,
  type ICustodialConfidentialNoteFungibleTokenWitnesses,
  ISSUER_SALT,
  NOTE_SALT,
  CustodialConfidentialNoteFungibleTokenPrivateState as PrivateState,
} from '../witnesses/CustodialConfidentialNoteFungibleTokenWitnesses.js';

/** `Account`: a `left` public key or a `right` contract address. */
export type Account = Either<Uint8Array, ContractAddress>;

export type Note = Token_Core_Note;

type Ledger = ReturnType<typeof ledger>;
type Witnesses = ICustodialConfidentialNoteFungibleTokenWitnesses<
  Ledger,
  CustodialConfidentialNoteFungibleTokenPrivateState
>;
type Options = SimulatorOptions<
  CustodialConfidentialNoteFungibleTokenPrivateState,
  Witnesses
>;

type CustodialArgs = readonly [
  issuer: Account,
  issuerSalt: Uint8Array,
  noteSalt: Uint8Array,
  inits: bigint,
];

const CustodialConfidentialNoteFungibleTokenSimulatorBase = createSimulator<
  CustodialConfidentialNoteFungibleTokenPrivateState,
  Ledger,
  Witnesses,
  MockCustodial<CustodialConfidentialNoteFungibleTokenPrivateState>,
  CustodialArgs
>({
  contractFactory: (witnesses) =>
    new MockCustodial<CustodialConfidentialNoteFungibleTokenPrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: (issuer, issuerSalt, noteSalt, inits) => [
    issuer,
    issuerSalt,
    noteSalt,
    inits,
  ],
  ledgerExtractor: (state) => ledger(state),
  // Fallback only: `create` always passes its own witnesses.
  witnessesFactory: () =>
    CustodialConfidentialNoteFungibleTokenWitnesses<Ledger>(
      createCustodialWallet(),
    ),
  artifactName: 'MockCustodialConfidentialNoteFungibleToken',
});

/**
 * CustodialConfidentialNoteFungibleToken simulator.
 *
 * The caller's secret and the nonce seed are witness inputs: set them on
 * {@link wallet}. The secret acts as the issuer in `mint` and
 * `transferOwnership` and as a holder in `transfer` and `burn`. A spend takes
 * the note and its path entries as arguments, see {@link pathOf}.
 */
export class CustodialConfidentialNoteFungibleTokenSimulator extends CustodialConfidentialNoteFungibleTokenSimulatorBase {
  /** The private inputs the witnesses answer with. Mutate between calls. */
  public wallet!: CustodialWallet;

  /**
   * @param options Standard simulator options, plus a `wallet` to reuse across
   * deployments, both salts (default {@link ISSUER_SALT} and
   * {@link NOTE_SALT}), the `issuer` (default: the wallet's account under the
   * issuer salt) and `inits`, the number of `initialize` calls the
   * constructor makes (default 1). Passing `options.witnesses` takes over
   * witness wiring entirely and leaves {@link wallet} disconnected.
   */
  static async create(
    options: Options & {
      wallet?: CustodialWallet;
      issuer?: Account;
      issuerSalt?: Uint8Array;
      noteSalt?: Uint8Array;
      inits?: bigint;
    } = {},
  ): Promise<CustodialConfidentialNoteFungibleTokenSimulator> {
    const {
      wallet: givenWallet,
      issuer,
      issuerSalt,
      noteSalt,
      inits,
      ...rest
    } = options;
    const wallet = givenWallet ?? createCustodialWallet();
    const salt = issuerSalt ?? ISSUER_SALT;
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    const simulator = (await super.create(
      [
        issuer ?? pureCircuits.deriveAccount(wallet.secretKey, salt),
        salt,
        noteSalt ?? NOTE_SALT,
        inits ?? 1n,
      ],
      {
        ...rest,
        witnesses:
          rest.witnesses ??
          CustodialConfidentialNoteFungibleTokenWitnesses<Ledger>(wallet),
      },
    )) as CustodialConfidentialNoteFungibleTokenSimulator;
    simulator.wallet = wallet;
    return simulator;
  }

  /** Mints `value` to `recipientPk`. Gated by the issuer secret. */
  public mint(recipientPk: Account, value: bigint): Promise<Note> {
    return this.circuits.impure.mint(recipientPk, value);
  }

  /** Spends the caller's `note` into a recipient note plus change. */
  public transfer(
    recipientPk: Account,
    value: bigint,
    note: Note,
    path: MerkleTreePathEntry[],
  ): Promise<[Note, Note]> {
    return this.circuits.impure.transfer(recipientPk, value, note, path);
  }

  /** Burns `value` from the caller's `note` and returns the change. */
  public burn(
    value: bigint,
    note: Note,
    path: MerkleTreePathEntry[],
  ): Promise<Note> {
    return this.circuits.impure.burn(value, note, path);
  }

  /** Hands the issuer role to `newOwner`. Gated by the issuer secret. */
  public transferOwnership(newOwner: Account): Promise<[]> {
    return this.circuits.impure.transferOwnership(newOwner);
  }

  /** The current issuer id. */
  public owner(): Promise<Account> {
    return this.circuits.impure.owner();
  }

  public deriveAccount(
    secretKey: Uint8Array,
    salt: Uint8Array,
  ): Promise<Account> {
    return this.circuits.pure.deriveAccount(secretKey, salt);
  }

  public commitOf(note: Note, pk: Account): Promise<Uint8Array> {
    return this.circuits.pure.commitOf(note, pk);
  }

  public nullifierOf(note: Note): Promise<Uint8Array> {
    return this.circuits.pure.nullifierOf(note);
  }

  /**
   * The path entries of `note`'s commitment under `ownerPk`, read from the
   * current tree.
   *
   * @throws If no such leaf is committed.
   */
  public async pathOf(
    note: Note,
    ownerPk: Account,
  ): Promise<MerkleTreePathEntry[]> {
    const path = (
      await this.getPublicState()
    ).Token_Core__commitments.findPathForLeaf(
      pureCircuits.commitOf(note, ownerPk),
    );
    if (path === undefined) {
      throw new Error('pathOf: commitment not found in tree');
    }
    return path.path;
  }
}
