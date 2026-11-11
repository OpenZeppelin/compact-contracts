import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockIssuer,
  pureCircuits,
} from '../../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenIssuer/contract/index.js';
import { INSTANCE_SALT } from '../../../test/witnesses/ConfidentialNoteFungibleTokenWitnesses.js';
import {
  type ConfidentialNoteFungibleTokenIssuerPrivateState,
  ConfidentialNoteFungibleTokenIssuerWitnesses,
  createIssuerWallet,
  type IConfidentialNoteFungibleTokenIssuerWitnesses,
  type IssuerWallet,
  ConfidentialNoteFungibleTokenIssuerPrivateState as PrivateState,
} from '../witnesses/ConfidentialNoteFungibleTokenIssuerWitnesses.js';

type Ledger = ReturnType<typeof ledger>;
type Witnesses = IConfidentialNoteFungibleTokenIssuerWitnesses<
  Ledger,
  ConfidentialNoteFungibleTokenIssuerPrivateState
>;
type Options = SimulatorOptions<
  ConfidentialNoteFungibleTokenIssuerPrivateState,
  Witnesses
>;

type IssuerArgs = readonly [issuerPk: bigint, instanceSalt: Uint8Array];

const ConfidentialNoteFungibleTokenIssuerSimulatorBase = createSimulator<
  ConfidentialNoteFungibleTokenIssuerPrivateState,
  Ledger,
  Witnesses,
  MockIssuer<ConfidentialNoteFungibleTokenIssuerPrivateState>,
  IssuerArgs
>({
  contractFactory: (witnesses) =>
    new MockIssuer<ConfidentialNoteFungibleTokenIssuerPrivateState>(witnesses),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: (issuerPk, instanceSalt) => [issuerPk, instanceSalt],
  ledgerExtractor: (state) => ledger(state),
  // Fallback only: `create` always passes its own witnesses.
  witnessesFactory: () =>
    ConfidentialNoteFungibleTokenIssuerWitnesses<Ledger>(createIssuerWallet()),
  artifactName: 'MockConfidentialNoteFungibleTokenIssuer',
});

/**
 * ConfidentialNoteFungibleTokenIssuer (standalone) simulator.
 *
 * The caller's issuer secret is a witness input: set it on {@link wallet}.
 * `derivePk` is pure: call it through the artifact's `pureCircuits`.
 */
export class ConfidentialNoteFungibleTokenIssuerSimulator extends ConfidentialNoteFungibleTokenIssuerSimulatorBase {
  /** The private input the issuer witness answers with. Mutate between calls. */
  public wallet!: IssuerWallet;

  /**
   * @param options Standard simulator options, plus a `wallet` to reuse across
   * deployments, the `instanceSalt` (default {@link INSTANCE_SALT}) and the
   * `issuerPk` (default: the wallet's key under that salt). Passing
   * `options.witnesses` takes over witness wiring entirely and leaves
   * {@link wallet} disconnected.
   */
  static async create(
    options: Options & {
      wallet?: IssuerWallet;
      instanceSalt?: Uint8Array;
      issuerPk?: bigint;
    } = {},
  ): Promise<ConfidentialNoteFungibleTokenIssuerSimulator> {
    const { wallet: givenWallet, instanceSalt, issuerPk, ...rest } = options;
    const wallet = givenWallet ?? createIssuerWallet();
    const salt = instanceSalt ?? INSTANCE_SALT;
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    const simulator = (await super.create(
      [issuerPk ?? pureCircuits.derivePk(wallet.secretKey, salt), salt],
      {
        ...rest,
        witnesses:
          rest.witnesses ??
          ConfidentialNoteFungibleTokenIssuerWitnesses<Ledger>(wallet),
      },
    )) as ConfidentialNoteFungibleTokenIssuerSimulator;
    simulator.wallet = wallet;
    return simulator;
  }

  /** Domain tag of `derivePk`. */
  public DOMAIN(): Promise<Uint8Array> {
    return this.circuits.pure.DOMAIN();
  }

  /** Passes when the wallet's secret derives `_issuerPk`. */
  public assertOnlyIssuer(): Promise<[]> {
    return this.circuits.impure.assertOnlyIssuer();
  }

  /** Replaces the issuer key. Gated by the current secret. */
  public rotateIssuer(newIssuerPk: bigint): Promise<[]> {
    return this.circuits.impure.rotateIssuer(newIssuerPk);
  }

  /** Writes the issuer key. Ungated. */
  public _setIssuer(newIssuerPk: bigint): Promise<[]> {
    return this.circuits.impure._setIssuer(newIssuerPk);
  }
}
