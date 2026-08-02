import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockFreeze,
} from '../../../../artifacts/MockConfidentialNoteFungibleTokenFreeze/contract/index.js';

// The freeze extension declares no witnesses and keeps no private state.
export type ConfidentialNoteFungibleTokenFreezePrivateState = Record<
  string,
  never
>;

const emptyWitnesses = () => ({});

const ConfidentialNoteFungibleTokenFreezeSimulatorBase = createSimulator<
  ConfidentialNoteFungibleTokenFreezePrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockFreeze<ConfidentialNoteFungibleTokenFreezePrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new MockFreeze<ConfidentialNoteFungibleTokenFreezePrivateState>(witnesses),
  defaultPrivateState: () => ({}),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: emptyWitnesses,
  artifactName: 'MockConfidentialNoteFungibleTokenFreeze',
});

export class ConfidentialNoteFungibleTokenFreezeSimulator extends ConfidentialNoteFungibleTokenFreezeSimulatorBase {
  static async create(
    options: SimulatorOptions<
      ConfidentialNoteFungibleTokenFreezePrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<ConfidentialNoteFungibleTokenFreezeSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    return super.create(
      [],
      options,
    ) as Promise<ConfidentialNoteFungibleTokenFreezeSimulator>;
  }

  public freeze(nf: Uint8Array): Promise<[]> {
    return this.circuits.impure._freeze(nf);
  }

  public unfreeze(nf: Uint8Array): Promise<[]> {
    return this.circuits.impure._unfreeze(nf);
  }

  public assertNotFrozen(nf: Uint8Array): Promise<[]> {
    return this.circuits.impure._assertNotFrozen(nf);
  }
}
