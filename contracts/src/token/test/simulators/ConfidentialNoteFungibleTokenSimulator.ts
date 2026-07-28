import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockCore,
} from '../../../../artifacts/MockConfidentialNoteFungibleToken/contract/index.js';
import {
  type ConfidentialNoteFungibleTokenPrivateState,
  ConfidentialNoteFungibleTokenWitnesses,
  createNoteWallet,
  type Note,
  type NoteWallet,
  ConfidentialNoteFungibleTokenPrivateState as PrivateState,
} from '../witnesses/ConfidentialNoteFungibleTokenWitnesses.js';

type Options = SimulatorOptions<
  ConfidentialNoteFungibleTokenPrivateState,
  ReturnType<typeof ConfidentialNoteFungibleTokenWitnesses>
>;

/**
 * The wallet the next construction binds its witnesses to. `create` sets it and
 * the factory below reads it, so every instance gets its own wallet while the
 * config stays a module-level constant.
 */
let pendingWallet: NoteWallet = createNoteWallet();

const ConfidentialNoteFungibleTokenSimulatorBase = createSimulator<
  ConfidentialNoteFungibleTokenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialNoteFungibleTokenWitnesses>,
  MockCore<ConfidentialNoteFungibleTokenPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new MockCore<ConfidentialNoteFungibleTokenPrivateState>(witnesses),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialNoteFungibleTokenWitnesses(pendingWallet),
  artifactName: 'MockConfidentialNoteFungibleToken',
});

/**
 * ConfidentialNoteFungibleToken (core) simulator.
 *
 * Methods mirror the mock's circuits one for one, `_` prefixes included, so a
 * spec reads as the circuit it drives. The caller's identity and the note being
 * spent are witness inputs, not arguments: set them on {@link wallet}.
 */
export class ConfidentialNoteFungibleTokenSimulator extends ConfidentialNoteFungibleTokenSimulatorBase {
  /** The private inputs the witnesses answer with. Mutate between calls. */
  public wallet!: NoteWallet;

  /**
   * @param options Standard simulator options, plus a `wallet` to reuse across
   * deployments. Passing `options.witnesses` takes over witness wiring entirely
   * and leaves {@link wallet} disconnected.
   */
  static async create(
    options: Options & { wallet?: NoteWallet } = {},
  ): Promise<ConfidentialNoteFungibleTokenSimulator> {
    const wallet = options.wallet ?? createNoteWallet();
    pendingWallet = wallet;
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    const simulator = (await super.create(
      [],
      options,
    )) as ConfidentialNoteFungibleTokenSimulator;
    simulator.wallet = wallet;
    return simulator;
  }

  /** Spends the caller's input note into a recipient note plus change. */
  public transfer(recipientPk: bigint, value: bigint): Promise<[Note, Note]> {
    return this.circuits.impure.transfer(recipientPk, value);
  }

  /** Spends the caller's input note, re-issuing only the change. */
  public burn(value: bigint): Promise<Note> {
    return this.circuits.impure.burn(value);
  }

  /** The caller's spend identity, `Hf(wit_SecretKey())`. */
  public _spenderPk(): Promise<bigint> {
    return this.circuits.impure._spenderPk();
  }

  /** The input note the next spend will consume. */
  public _inputNote(): Promise<Note> {
    return this.circuits.impure._inputNote();
  }

  /** Commits a caller-built note to `ownerPk`. Ungated. */
  public _mintNote(note: Note, ownerPk: bigint): Promise<[]> {
    return this.circuits.impure._mintNote(note, ownerPk);
  }

  /** Mints `value` to `recipientPk` with a core-derived nonce. Ungated. */
  public _mint(recipientPk: bigint, value: bigint): Promise<Note> {
    return this.circuits.impure._mint(recipientPk, value);
  }

  /** Consumes the input note and commits `outNote` + `changeNote`. Ungated. */
  public _transfer(
    spenderPk: bigint,
    recipientPk: bigint,
    outNote: Note,
    changeNote: Note,
  ): Promise<[]> {
    return this.circuits.impure._transfer(
      spenderPk,
      recipientPk,
      outNote,
      changeNote,
    );
  }

  /** Consumes the input note, re-issuing only `changeNote`. Ungated. */
  public _burn(
    spenderPk: bigint,
    value: bigint,
    changeNote: Note,
  ): Promise<[]> {
    return this.circuits.impure._burn(spenderPk, value, changeNote);
  }

  /** Nullifies the input note owned by `ownerPk`. Ungated. */
  public _consumeNote(ownerPk: bigint): Promise<Note> {
    return this.circuits.impure._consumeNote(ownerPk);
  }
}
