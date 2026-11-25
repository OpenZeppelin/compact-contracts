import {
  type ContractAddress,
  createSimulator,
  type Either,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockAuthPrfPseudonym,
} from '../../../../../artifacts/crypto/authentication/test/mocks/MockAuthPrfPseudonym/contract/index.js';
import {
  AuthPrfPseudonymPrivateState,
  AuthPrfPseudonymWitnesses,
} from '../witnesses/AuthPrfPseudonymWitnesses.js';

/** `Identifier`: a `left` public key or a `right` contract address. */
export type Identifier = Either<Uint8Array, ContractAddress>;

/** `Caller`: a caller an authenticator produced. */
export type Caller = { identifier: Identifier };

/**
 * Type constructor args
 */
type AuthPrfPseudonymArgs = readonly [];

const AuthPrfPseudonymSimulatorBase = createSimulator<
  AuthPrfPseudonymPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof AuthPrfPseudonymWitnesses>,
  MockAuthPrfPseudonym<AuthPrfPseudonymPrivateState>,
  AuthPrfPseudonymArgs
>({
  contractFactory: (witnesses) =>
    new MockAuthPrfPseudonym<AuthPrfPseudonymPrivateState>(witnesses),
  defaultPrivateState: () => AuthPrfPseudonymPrivateState.generate(),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => AuthPrfPseudonymWitnesses(),
  artifactName: 'MockAuthPrfPseudonym',
});

/**
 * AuthPrfPseudonym Simulator
 *
 * Each method is a thin pass-through to the mock's matching circuit. The
 * secret key comes from the private state.
 */
export class AuthPrfPseudonymSimulator extends AuthPrfPseudonymSimulatorBase {
  static async create(
    options: SimulatorOptions<
      AuthPrfPseudonymPrivateState,
      ReturnType<typeof AuthPrfPseudonymWitnesses>
    > = {},
  ): Promise<AuthPrfPseudonymSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<AuthPrfPseudonymSimulator>;
  }

  /** @description `AuthPrfPseudonym.authenticate`. */
  public authenticate(salt: Uint8Array): Promise<Caller> {
    return this.circuits.impure.authenticate(salt);
  }

  /** @description `AuthPrfPseudonym.authenticateForThisContract`. */
  public authenticateForThisContract(): Promise<Caller> {
    return this.circuits.impure.authenticateForThisContract();
  }

  /** @description `AuthPrfPseudonym.deriveIdentifier`. */
  public deriveIdentifier(
    secretKey: Uint8Array,
    salt: Uint8Array,
  ): Promise<Identifier> {
    return this.circuits.pure.deriveIdentifier(secretKey, salt);
  }
}
