import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockIssuer,
} from '../../../../artifacts/MockConfidentialNoteFungibleTokenIssuer/contract/index.js';
import {
  type ConfidentialNoteFungibleTokenIssuerPrivateState,
  ConfidentialNoteFungibleTokenIssuerWitnesses,
  ConfidentialNoteFungibleTokenIssuerPrivateState as PrivateState,
} from '../witnesses/ConfidentialNoteFungibleTokenIssuerWitnesses.js';

const ConfidentialNoteFungibleTokenIssuerSimulatorBase = createSimulator<
  ConfidentialNoteFungibleTokenIssuerPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialNoteFungibleTokenIssuerWitnesses>,
  MockIssuer<ConfidentialNoteFungibleTokenIssuerPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new MockIssuer<ConfidentialNoteFungibleTokenIssuerPrivateState>(witnesses),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialNoteFungibleTokenIssuerWitnesses(),
  artifactName: 'MockConfidentialNoteFungibleTokenIssuer',
});

export class ConfidentialNoteFungibleTokenIssuerSimulator extends ConfidentialNoteFungibleTokenIssuerSimulatorBase {
  static async create(
    options: SimulatorOptions<
      ConfidentialNoteFungibleTokenIssuerPrivateState,
      ReturnType<typeof ConfidentialNoteFungibleTokenIssuerWitnesses>
    > = {},
  ): Promise<ConfidentialNoteFungibleTokenIssuerSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    return super.create(
      [],
      options,
    ) as Promise<ConfidentialNoteFungibleTokenIssuerSimulator>;
  }

  public initialize(issuerPk: bigint): Promise<[]> {
    return this.circuits.impure.initialize(issuerPk);
  }

  public assertIssuer(): Promise<[]> {
    return this.circuits.impure._assertIssuer();
  }

  public rotateIssuer(newIssuerPk: bigint): Promise<[]> {
    return this.circuits.impure._rotateIssuer(newIssuerPk);
  }

  public readonly privateState = {
    // Configure the issuer secret proven by the next call.
    set: async (
      partial: Partial<ConfidentialNoteFungibleTokenIssuerPrivateState>,
    ): Promise<ConfidentialNoteFungibleTokenIssuerPrivateState> => {
      const updated = { ...(await this.getPrivateState()), ...partial };
      this.setPrivateState(updated);
      return updated;
    },
  };
}
