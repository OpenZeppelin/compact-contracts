import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type Caller,
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockAuthorityCaller,
} from '../../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAuthorityCaller/contract/index.js';

// The mock declares no witnesses, so the private state and witness set are
// both empty.
export type ConfidentialNoteFungibleTokenAuthorityCallerPrivateState = Record<
  string,
  never
>;
export const ConfidentialNoteFungibleTokenAuthorityCallerPrivateState: ConfidentialNoteFungibleTokenAuthorityCallerPrivateState =
  {};
export const ConfidentialNoteFungibleTokenAuthorityCallerWitnesses = () => ({});

/** `Identifier`: a `left` public key or a `right` contract address. */
export type Identifier = Either<Uint8Array, ContractAddress>;

type AuthorityCallerArgs = readonly [
  initialAuthority: Identifier,
  inits: bigint,
];

const ConfidentialNoteFungibleTokenAuthorityCallerSimulatorBase =
  createSimulator<
    ConfidentialNoteFungibleTokenAuthorityCallerPrivateState,
    ReturnType<typeof ledger>,
    ReturnType<typeof ConfidentialNoteFungibleTokenAuthorityCallerWitnesses>,
    MockAuthorityCaller<ConfidentialNoteFungibleTokenAuthorityCallerPrivateState>,
    AuthorityCallerArgs
  >({
    contractFactory: (witnesses) =>
      new MockAuthorityCaller<ConfidentialNoteFungibleTokenAuthorityCallerPrivateState>(
        witnesses,
      ),
    defaultPrivateState: () =>
      ConfidentialNoteFungibleTokenAuthorityCallerPrivateState,
    contractArgs: (initialAuthority, inits) => [initialAuthority, inits],
    ledgerExtractor: (state) => ledger(state),
    witnessesFactory: () =>
      ConfidentialNoteFungibleTokenAuthorityCallerWitnesses(),
    artifactName: 'MockConfidentialNoteFungibleTokenAuthorityCaller',
  });

/**
 * ConfidentialNoteFungibleTokenAuthority simulator for the mock that takes
 * the caller as an argument.
 *
 * Each method is a thin pass-through to the mock's matching circuit.
 */
export class ConfidentialNoteFungibleTokenAuthorityCallerSimulator extends ConfidentialNoteFungibleTokenAuthorityCallerSimulatorBase {
  /**
   * @param inits The number of `initialize` calls the constructor makes: 0
   * leaves the contract uninitialized, 2 reaches the second-call guard.
   */
  static async create(
    initialAuthority: Identifier,
    inits: bigint,
    options: SimulatorOptions<
      ConfidentialNoteFungibleTokenAuthorityCallerPrivateState,
      ReturnType<typeof ConfidentialNoteFungibleTokenAuthorityCallerWitnesses>
    > = {},
  ): Promise<ConfidentialNoteFungibleTokenAuthorityCallerSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [initialAuthority, inits],
      options,
    ) as Promise<ConfidentialNoteFungibleTokenAuthorityCallerSimulator>;
  }

  public authority(): Promise<Identifier> {
    return this.circuits.impure.authority();
  }

  /** Throws unless `caller` is the authority. */
  public assertOnlyAuthority(caller: Caller): Promise<[]> {
    return this.circuits.impure.assertOnlyAuthority(caller);
  }

  /** Hands the role to `newAuthority`, acting as `caller`. */
  public transferAuthority(
    caller: Caller,
    newAuthority: Identifier,
  ): Promise<[]> {
    return this.circuits.impure.transferAuthority(caller, newAuthority);
  }
}

export type { Caller, ContractAddress, Either };
