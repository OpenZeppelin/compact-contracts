import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockDelivery,
} from '../../../../artifacts/MockConfidentialNoteFungibleTokenDelivery/contract/index.js';
import {
  type ConfidentialNoteFungibleTokenDeliveryPrivateState,
  ConfidentialNoteFungibleTokenDeliveryWitnesses,
  ConfidentialNoteFungibleTokenDeliveryPrivateState as PrivateState,
} from '../witnesses/ConfidentialNoteFungibleTokenDeliveryWitnesses.js';

const ConfidentialNoteFungibleTokenDeliverySimulatorBase = createSimulator<
  ConfidentialNoteFungibleTokenDeliveryPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialNoteFungibleTokenDeliveryWitnesses>,
  MockDelivery<ConfidentialNoteFungibleTokenDeliveryPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new MockDelivery<ConfidentialNoteFungibleTokenDeliveryPrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialNoteFungibleTokenDeliveryWitnesses(),
  artifactName: 'MockConfidentialNoteFungibleTokenDelivery',
});

export class ConfidentialNoteFungibleTokenDeliverySimulator extends ConfidentialNoteFungibleTokenDeliverySimulatorBase {
  static async create(
    options: SimulatorOptions<
      ConfidentialNoteFungibleTokenDeliveryPrivateState,
      ReturnType<typeof ConfidentialNoteFungibleTokenDeliveryWitnesses>
    > = {},
  ): Promise<ConfidentialNoteFungibleTokenDeliverySimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    return super.create(
      [],
      options,
    ) as Promise<ConfidentialNoteFungibleTokenDeliverySimulator>;
  }

  public deliver(
    encPk: JubjubPoint,
    value: bigint,
    nonce: bigint,
    slot: Uint8Array,
  ): Promise<[]> {
    return this.circuits.impure._deliver(encPk, value, nonce, slot);
  }
}
