import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockCtorMint,
} from '../../../../artifacts/MockConfidentialNoteFungibleTokenCtorMint/contract/index.js';
import {
  type ConfidentialNoteFungibleTokenPrivateState,
  ConfidentialNoteFungibleTokenWitnesses,
  createNoteWallet,
  INSTANCE_SALT,
  type Note,
  type NoteWallet,
  ConfidentialNoteFungibleTokenPrivateState as PrivateState,
} from '../witnesses/ConfidentialNoteFungibleTokenWitnesses.js';

type Options = SimulatorOptions<
  ConfidentialNoteFungibleTokenPrivateState,
  ReturnType<typeof ConfidentialNoteFungibleTokenWitnesses>
>;

type CtorMintArgs = readonly [
  instanceSalt: Uint8Array,
  note: Note,
  ownerPk: bigint,
  twice: boolean,
];

/** Same role as `pendingWallet` in ConfidentialNoteFungibleTokenSimulator. */
let pendingWallet: NoteWallet = createNoteWallet();

const ConfidentialNoteFungibleTokenCtorMintSimulatorBase = createSimulator<
  ConfidentialNoteFungibleTokenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialNoteFungibleTokenWitnesses>,
  MockCtorMint<ConfidentialNoteFungibleTokenPrivateState>,
  CtorMintArgs
>({
  contractFactory: (witnesses) =>
    new MockCtorMint<ConfidentialNoteFungibleTokenPrivateState>(witnesses),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: (instanceSalt, note, ownerPk, twice) => [
    instanceSalt,
    note,
    ownerPk,
    twice,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialNoteFungibleTokenWitnesses(pendingWallet),
  artifactName: 'MockConfidentialNoteFungibleTokenCtorMint',
});

/**
 * Simulator for a composer that mints a deployer-built note in its
 * constructor. Only the spend surface is exposed: a spend is the one
 * observation that proves the constructor note is live.
 */
export class ConfidentialNoteFungibleTokenCtorMintSimulator extends ConfidentialNoteFungibleTokenCtorMintSimulatorBase {
  /** The private inputs the witnesses answer with. Mutate between calls. */
  public wallet!: NoteWallet;

  /**
   * @param options Standard simulator options, plus the `note` and `ownerPk`
   * the constructor mints, `twice` to mint it a second time, an optional
   * `wallet`, and the `instanceSalt` (default {@link INSTANCE_SALT}).
   */
  static async create(
    options: Options & {
      note: Note;
      ownerPk: bigint;
      twice?: boolean;
      wallet?: NoteWallet;
      instanceSalt?: Uint8Array;
    },
  ): Promise<ConfidentialNoteFungibleTokenCtorMintSimulator> {
    const {
      note,
      ownerPk,
      twice,
      wallet: givenWallet,
      instanceSalt,
      ...rest
    } = options;
    const wallet = givenWallet ?? createNoteWallet();
    pendingWallet = wallet;
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    const simulator = (await super.create(
      [instanceSalt ?? INSTANCE_SALT, note, ownerPk, twice ?? false],
      rest,
    )) as ConfidentialNoteFungibleTokenCtorMintSimulator;
    simulator.wallet = wallet;
    return simulator;
  }

  /** Spends the caller's input note, re-issuing only the change. */
  public burn(value: bigint): Promise<Note> {
    return this.circuits.impure.burn(value);
  }

  /** Spends the caller's input note into a recipient note plus change. */
  public transfer(recipientPk: bigint, value: bigint): Promise<[Note, Note]> {
    return this.circuits.impure.transfer(recipientPk, value);
  }
}
