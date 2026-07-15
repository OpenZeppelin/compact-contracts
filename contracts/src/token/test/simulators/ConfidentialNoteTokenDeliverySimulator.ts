import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockDelivery,
} from '../../../../artifacts/MockConfidentialNoteTokenDelivery/contract/index.js';
import {
  type ConfidentialNoteTokenDeliveryPrivateState,
  ConfidentialNoteTokenDeliveryWitnesses,
  ConfidentialNoteTokenDeliveryPrivateState as PrivateState,
} from '../witnesses/ConfidentialNoteTokenDeliveryWitnesses.js';

const ConfidentialNoteTokenDeliverySimulatorBase = createSimulator<
  ConfidentialNoteTokenDeliveryPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialNoteTokenDeliveryWitnesses>,
  MockDelivery<ConfidentialNoteTokenDeliveryPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new MockDelivery<ConfidentialNoteTokenDeliveryPrivateState>(witnesses),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialNoteTokenDeliveryWitnesses(),
  artifactName: 'MockConfidentialNoteTokenDelivery',
});

export class ConfidentialNoteTokenDeliverySimulator extends ConfidentialNoteTokenDeliverySimulatorBase {
  static async create(
    options: SimulatorOptions<
      ConfidentialNoteTokenDeliveryPrivateState,
      ReturnType<typeof ConfidentialNoteTokenDeliveryWitnesses>
    > = {},
  ): Promise<ConfidentialNoteTokenDeliverySimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    return super.create(
      [],
      options,
    ) as Promise<ConfidentialNoteTokenDeliverySimulator>;
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
