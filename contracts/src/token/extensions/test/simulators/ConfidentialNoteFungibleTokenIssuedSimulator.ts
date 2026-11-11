import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockIssued,
  pureCircuits,
} from '../../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenIssued/contract/index.js';
import {
  type ConfidentialNoteFungibleTokenPrivateState,
  ConfidentialNoteFungibleTokenWitnesses,
  createNoteWallet,
  INSTANCE_SALT,
  type Note,
  type NoteCommitmentLedger,
  type NoteWallet,
  ConfidentialNoteFungibleTokenPrivateState as PrivateState,
} from '../../../test/witnesses/ConfidentialNoteFungibleTokenWitnesses.js';
import {
  ConfidentialNoteFungibleTokenIssuerWitnesses,
  createIssuerWallet,
  type IssuerWallet,
} from '../witnesses/ConfidentialNoteFungibleTokenIssuerWitnesses.js';

/** The core's four witnesses plus the issuer's one, over the core's private state. */
const ConfidentialNoteFungibleTokenIssuedWitnesses = (
  noteWallet: NoteWallet,
  issuerWallet: IssuerWallet,
) => ({
  ...ConfidentialNoteFungibleTokenWitnesses<NoteCommitmentLedger>(noteWallet),
  ...ConfidentialNoteFungibleTokenIssuerWitnesses<
    NoteCommitmentLedger,
    ConfidentialNoteFungibleTokenPrivateState
  >(issuerWallet),
});

type Options = SimulatorOptions<
  ConfidentialNoteFungibleTokenPrivateState,
  ReturnType<typeof ConfidentialNoteFungibleTokenIssuedWitnesses>
>;

type IssuedArgs = readonly [instanceSalt: Uint8Array, issuerPk: bigint];

const ConfidentialNoteFungibleTokenIssuedSimulatorBase = createSimulator<
  ConfidentialNoteFungibleTokenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialNoteFungibleTokenIssuedWitnesses>,
  MockIssued<ConfidentialNoteFungibleTokenPrivateState>,
  IssuedArgs
>({
  contractFactory: (witnesses) =>
    new MockIssued<ConfidentialNoteFungibleTokenPrivateState>(witnesses),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: (instanceSalt, issuerPk) => [instanceSalt, issuerPk],
  ledgerExtractor: (state) => ledger(state),
  // Fallback only: `create` always passes its own witnesses.
  witnessesFactory: () =>
    ConfidentialNoteFungibleTokenIssuedWitnesses(
      createNoteWallet(),
      createIssuerWallet(),
    ),
  artifactName: 'MockConfidentialNoteFungibleTokenIssued',
});

/**
 * Simulator for the core + issuer composition: `mint` is gated by the issuer
 * secret on {@link issuerWallet}, and `_setIssuer` is not reachable. The pure
 * `derivePk` (note identity) and `deriveIssuerPk` are on the artifact's
 * `pureCircuits`.
 */
export class ConfidentialNoteFungibleTokenIssuedSimulator extends ConfidentialNoteFungibleTokenIssuedSimulatorBase {
  /** The core witnesses' private inputs. Mutate between calls. */
  public wallet!: NoteWallet;

  /** The issuer witness's private input. Mutate between calls. */
  public issuerWallet!: IssuerWallet;

  /**
   * @param options Standard simulator options, plus optional wallets to reuse
   * across deployments, the `instanceSalt` (default {@link INSTANCE_SALT}) and
   * the `issuerPk` (default: the issuer wallet's key under that salt).
   */
  static async create(
    options: Options & {
      wallet?: NoteWallet;
      issuerWallet?: IssuerWallet;
      instanceSalt?: Uint8Array;
      issuerPk?: bigint;
    } = {},
  ): Promise<ConfidentialNoteFungibleTokenIssuedSimulator> {
    const {
      wallet: givenWallet,
      issuerWallet: givenIssuerWallet,
      instanceSalt,
      issuerPk,
      ...rest
    } = options;
    const wallet = givenWallet ?? createNoteWallet();
    const issuerWallet = givenIssuerWallet ?? createIssuerWallet();
    const salt = instanceSalt ?? INSTANCE_SALT;
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    const simulator = (await super.create(
      [
        salt,
        issuerPk ?? pureCircuits.deriveIssuerPk(issuerWallet.secretKey, salt),
      ],
      {
        ...rest,
        witnesses:
          rest.witnesses ??
          ConfidentialNoteFungibleTokenIssuedWitnesses(wallet, issuerWallet),
      },
    )) as ConfidentialNoteFungibleTokenIssuedSimulator;
    simulator.wallet = wallet;
    simulator.issuerWallet = issuerWallet;
    return simulator;
  }

  /** Mints `value` to `recipientPk`. Gated by the issuer secret. */
  public mint(recipientPk: bigint, value: bigint): Promise<Note> {
    return this.circuits.impure.mint(recipientPk, value);
  }

  /** Replaces the issuer key. Gated by the current secret. */
  public rotateIssuer(newIssuerPk: bigint): Promise<[]> {
    return this.circuits.impure.rotateIssuer(newIssuerPk);
  }
}
