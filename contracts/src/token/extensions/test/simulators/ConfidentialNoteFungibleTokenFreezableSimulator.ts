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
  Contract as MockFreezable,
  pureCircuits,
} from '../../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenFreezable/contract/index.js';
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

type FreezableArgs = readonly [noteSalt: Uint8Array];

const ConfidentialNoteFungibleTokenFreezableSimulatorBase = createSimulator<
  CustodialConfidentialNoteFungibleTokenPrivateState,
  Ledger,
  Witnesses,
  MockFreezable<CustodialConfidentialNoteFungibleTokenPrivateState>,
  FreezableArgs
>({
  contractFactory: (witnesses) =>
    new MockFreezable<CustodialConfidentialNoteFungibleTokenPrivateState>(
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
  artifactName: 'MockConfidentialNoteFungibleTokenFreezable',
});

/**
 * Simulator for the core + freeze composition.
 *
 * The spender's secret and the nonce seed are witness inputs: set them on
 * {@link wallet}. A spend takes the note and its path entries as arguments,
 * see {@link pathOf}. `mint`, `seize`, `_freeze` and `_unfreeze` are ungated.
 */
export class ConfidentialNoteFungibleTokenFreezableSimulator extends ConfidentialNoteFungibleTokenFreezableSimulatorBase {
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
  ): Promise<ConfidentialNoteFungibleTokenFreezableSimulator> {
    const { wallet: givenWallet, noteSalt, ...rest } = options;
    const wallet = givenWallet ?? createCustodialWallet();
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    const simulator = (await super.create([noteSalt ?? NOTE_SALT], {
      ...rest,
      witnesses:
        rest.witnesses ??
        CustodialConfidentialNoteFungibleTokenWitnesses<Ledger>(wallet),
    })) as ConfidentialNoteFungibleTokenFreezableSimulator;
    simulator.wallet = wallet;
    return simulator;
  }

  /** Mints `value` to `recipientPk`. Ungated. */
  public mint(recipientPk: Identifier, value: bigint): Promise<Note> {
    return this.circuits.impure.mint(recipientPk, value);
  }

  /** Spends the caller's unfrozen `note` into a recipient note plus change. */
  public transfer(
    recipientPk: Identifier,
    value: bigint,
    note: Note,
    path: MerkleTreePathEntry[],
  ): Promise<[Note, Note]> {
    return this.circuits.impure.transfer(recipientPk, value, note, path);
  }

  /** Burns `value` from the caller's unfrozen `note` and returns the change. */
  public burn(
    value: bigint,
    note: Note,
    path: MerkleTreePathEntry[],
  ): Promise<Note> {
    return this.circuits.impure.burn(value, note, path);
  }

  /** Freezes `nf`. Ungated. */
  public _freeze(nf: Uint8Array): Promise<[]> {
    return this.circuits.impure._freeze(nf);
  }

  /** Unfreezes `nf`. Ungated. */
  public _unfreeze(nf: Uint8Array): Promise<[]> {
    return this.circuits.impure._unfreeze(nf);
  }

  public isFrozen(nf: Uint8Array): Promise<boolean> {
    return this.circuits.impure.isFrozen(nf);
  }

  /**
   * Consumes `targetPk`'s `note`, frozen or not, and mints its value to
   * `recoveryPk`. Ungated.
   */
  public seize(
    targetPk: Identifier,
    recoveryPk: Identifier,
    note: Note,
    path: MerkleTreePathEntry[],
  ): Promise<Note> {
    return this.circuits.impure.seize(targetPk, recoveryPk, note, path);
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
