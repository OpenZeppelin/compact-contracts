import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockAllowlist,
} from '../../../../artifacts/MockConfidentialNoteFungibleTokenAllowlist/contract/index.js';
import {
  type ConfidentialNoteFungibleTokenAllowlistPrivateState,
  ConfidentialNoteFungibleTokenAllowlistWitnesses,
  ConfidentialNoteFungibleTokenAllowlistPrivateState as PrivateState,
} from '../witnesses/ConfidentialNoteFungibleTokenAllowlistWitnesses.js';

const ConfidentialNoteFungibleTokenAllowlistSimulatorBase = createSimulator<
  ConfidentialNoteFungibleTokenAllowlistPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialNoteFungibleTokenAllowlistWitnesses>,
  MockAllowlist<ConfidentialNoteFungibleTokenAllowlistPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new MockAllowlist<ConfidentialNoteFungibleTokenAllowlistPrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialNoteFungibleTokenAllowlistWitnesses(),
  artifactName: 'MockConfidentialNoteFungibleTokenAllowlist',
});

export class ConfidentialNoteFungibleTokenAllowlistSimulator extends ConfidentialNoteFungibleTokenAllowlistSimulatorBase {
  static async create(
    options: SimulatorOptions<
      ConfidentialNoteFungibleTokenAllowlistPrivateState,
      ReturnType<typeof ConfidentialNoteFungibleTokenAllowlistWitnesses>
    > = {},
  ): Promise<ConfidentialNoteFungibleTokenAllowlistSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    return super.create(
      [],
      options,
    ) as Promise<ConfidentialNoteFungibleTokenAllowlistSimulator>;
  }

  public addAllowed(pk: bigint): Promise<[]> {
    return this.circuits.impure._addAllowed(pk);
  }

  public removeAllowed(index: bigint): Promise<[]> {
    return this.circuits.impure._removeAllowed(index);
  }

  public assertAllowed(pk: bigint): Promise<[]> {
    return this.circuits.impure._assertAllowed(pk);
  }
}
