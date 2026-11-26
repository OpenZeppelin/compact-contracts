import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockAuthority,
} from '../../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAuthority/contract/index.js';
import {
  ConfidentialNoteFungibleTokenAuthorityPrivateState,
  ConfidentialNoteFungibleTokenAuthorityWitnesses,
} from '../witnesses/ConfidentialNoteFungibleTokenAuthorityWitnesses.js';

/** `Identifier`: a `left` public key or a `right` contract address. */
export type Identifier = Either<Uint8Array, ContractAddress>;

type AuthorityArgs = readonly [initialAuthority: Identifier, inits: bigint];

const ConfidentialNoteFungibleTokenAuthoritySimulatorBase = createSimulator<
  ConfidentialNoteFungibleTokenAuthorityPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialNoteFungibleTokenAuthorityWitnesses>,
  MockAuthority<ConfidentialNoteFungibleTokenAuthorityPrivateState>,
  AuthorityArgs
>({
  contractFactory: (witnesses) =>
    new MockAuthority<ConfidentialNoteFungibleTokenAuthorityPrivateState>(
      witnesses,
    ),
  defaultPrivateState: () =>
    ConfidentialNoteFungibleTokenAuthorityPrivateState.generate(),
  contractArgs: (initialAuthority, inits) => [initialAuthority, inits],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialNoteFungibleTokenAuthorityWitnesses(),
  artifactName: 'MockConfidentialNoteFungibleTokenAuthority',
});

/**
 * ConfidentialNoteFungibleTokenAuthority (standalone) simulator.
 *
 * `assertOnlyAuthority` and `transferAuthority` authenticate the private
 * state's secret key under the salt `pad(32, "MockAuthority")`.
 */
export class ConfidentialNoteFungibleTokenAuthoritySimulator extends ConfidentialNoteFungibleTokenAuthoritySimulatorBase {
  /**
   * @param inits The number of `initialize` calls the constructor makes: 0
   * leaves the contract uninitialized, 2 reaches the second-call guard.
   */
  static async create(
    initialAuthority: Identifier,
    inits: bigint,
    options: SimulatorOptions<
      ConfidentialNoteFungibleTokenAuthorityPrivateState,
      ReturnType<typeof ConfidentialNoteFungibleTokenAuthorityWitnesses>
    > = {},
  ): Promise<ConfidentialNoteFungibleTokenAuthoritySimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [initialAuthority, inits],
      options,
    ) as Promise<ConfidentialNoteFungibleTokenAuthoritySimulator>;
  }

  public authority(): Promise<Identifier> {
    return this.circuits.impure.authority();
  }

  /** Throws unless the private state's key is the authority. */
  public assertOnlyAuthority(): Promise<[]> {
    return this.circuits.impure.assertOnlyAuthority();
  }

  /** Hands the role to `newAuthority`. Gated by the private state's key. */
  public transferAuthority(newAuthority: Identifier): Promise<[]> {
    return this.circuits.impure.transferAuthority(newAuthority);
  }

  /** Sets the authority with no caller check. */
  public _transferAuthority(newAuthority: Identifier): Promise<[]> {
    return this.circuits.impure._transferAuthority(newAuthority);
  }

  public readonly privateState = {
    /**
     * @description Replaces the secret key, to act as another account.
     * @param newSK - The new secret key.
     * @returns The updated private state.
     */
    injectSecretKey: (
      newSK: Uint8Array,
    ): Promise<ConfidentialNoteFungibleTokenAuthorityPrivateState> =>
      this.updatePrivateState(
        ConfidentialNoteFungibleTokenAuthorityPrivateState.withSecretKey(newSK),
      ),

    /**
     * @returns A copy of the current secret key.
     * @throws If the secret key is undefined.
     */
    getCurrentSecretKey: async (): Promise<Uint8Array> => {
      const sk = (await this.getPrivateState()).secretKey;
      if (typeof sk === 'undefined') {
        throw new Error('Missing secret key');
      }
      return Uint8Array.from(sk);
    },
  };
}

export type { ContractAddress, Either };
