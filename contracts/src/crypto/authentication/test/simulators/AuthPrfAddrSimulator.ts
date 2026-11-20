import {
  type ContractAddress,
  createSimulator,
  type Either,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockAuthPrfAddr,
} from '../../../../../artifacts/crypto/authentication/test/mocks/MockAuthPrfAddr/contract/index.js';
import {
  AuthPrfAddrPrivateState,
  AuthPrfAddrWitnesses,
} from '../witnesses/AuthPrfAddrWitnesses.js';

/** `Account`: a `left` public key or a `right` contract address. */
export type Account = Either<Uint8Array, ContractAddress>;

/** `IAuthenticator.Caller`. */
export type Caller = { account: Account };

/**
 * Type constructor args
 */
type AuthPrfAddrArgs = readonly [];

const AuthPrfAddrSimulatorBase = createSimulator<
  AuthPrfAddrPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof AuthPrfAddrWitnesses>,
  MockAuthPrfAddr<AuthPrfAddrPrivateState>,
  AuthPrfAddrArgs
>({
  contractFactory: (witnesses) =>
    new MockAuthPrfAddr<AuthPrfAddrPrivateState>(witnesses),
  defaultPrivateState: () => AuthPrfAddrPrivateState.generate(),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => AuthPrfAddrWitnesses(),
  artifactName: 'MockAuthPrfAddr',
});

/**
 * AuthPrfAddr Simulator
 *
 * Each method is a thin pass-through to the mock's matching circuit. The
 * secret key comes from the private state.
 */
export class AuthPrfAddrSimulator extends AuthPrfAddrSimulatorBase {
  static async create(
    options: SimulatorOptions<
      AuthPrfAddrPrivateState,
      ReturnType<typeof AuthPrfAddrWitnesses>
    > = {},
  ): Promise<AuthPrfAddrSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<AuthPrfAddrSimulator>;
  }

  /** @description `AuthPrfAddr.authenticate`. */
  public authenticate(salt: Uint8Array): Promise<Caller> {
    return this.circuits.impure.authenticate(salt);
  }

  /** @description `AuthPrfAddr.authenticateForThisContract`. */
  public authenticateForThisContract(): Promise<Caller> {
    return this.circuits.impure.authenticateForThisContract();
  }

  /** @description `AuthPrfAddr.deriveAccount`. */
  public deriveAccount(
    secretKey: Uint8Array,
    salt: Uint8Array,
  ): Promise<Account> {
    return this.circuits.pure.deriveAccount(secretKey, salt);
  }
}
