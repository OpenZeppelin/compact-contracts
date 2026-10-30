import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type Delivery_Delivery as Delivery,
  ledger,
  Contract as MockDelivery,
  type Delivery_RecoveredNote as RecoveredNote,
} from '../../../../artifacts/MockConfidentialNoteFungibleTokenDelivery/contract/index.js';
import {
  type ConfidentialNoteFungibleTokenDeliveryPrivateState,
  ConfidentialNoteFungibleTokenDeliveryWitnesses,
  createDeliveryWallet,
  type DeliveryWallet,
  type IConfidentialNoteFungibleTokenDeliveryWitnesses,
  ConfidentialNoteFungibleTokenDeliveryPrivateState as PrivateState,
} from '../witnesses/ConfidentialNoteFungibleTokenDeliveryWitnesses.js';

export type { Delivery, RecoveredNote };

type Ledger = ReturnType<typeof ledger>;
type Witnesses = IConfidentialNoteFungibleTokenDeliveryWitnesses<
  Ledger,
  ConfidentialNoteFungibleTokenDeliveryPrivateState
>;
type Options = SimulatorOptions<
  ConfidentialNoteFungibleTokenDeliveryPrivateState,
  Witnesses
>;

/** Same role as `pendingWallet` in ConfidentialNoteFungibleTokenSimulator. */
let pendingWallet: DeliveryWallet = createDeliveryWallet();

const ConfidentialNoteFungibleTokenDeliverySimulatorBase = createSimulator<
  ConfidentialNoteFungibleTokenDeliveryPrivateState,
  Ledger,
  Witnesses,
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
  witnessesFactory: () =>
    ConfidentialNoteFungibleTokenDeliveryWitnesses<Ledger>(pendingWallet),
  artifactName: 'MockConfidentialNoteFungibleTokenDelivery',
});

/**
 * ConfidentialNoteFungibleTokenDelivery (standalone) simulator.
 *
 * Drives the extension with nothing committed. `recoverNote` is pure: call it
 * through the artifact's `pureCircuits`, as the core specs do for `commitOf`.
 */
export class ConfidentialNoteFungibleTokenDeliverySimulator extends ConfidentialNoteFungibleTokenDeliverySimulatorBase {
  /** The private input the delivery witness answers with. Mutate between calls. */
  public wallet!: DeliveryWallet;

  /**
   * @param options Standard simulator options, plus a `wallet` to reuse across
   * deployments. Passing `options.witnesses` takes over witness wiring
   * entirely and leaves {@link wallet} disconnected.
   */
  static async create(
    options: Options & { wallet?: DeliveryWallet } = {},
  ): Promise<ConfidentialNoteFungibleTokenDeliverySimulator> {
    const { wallet: givenWallet, ...rest } = options;
    const wallet = givenWallet ?? createDeliveryWallet();
    pendingWallet = wallet;
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    const simulator = (await super.create(
      [],
      rest,
    )) as ConfidentialNoteFungibleTokenDeliverySimulator;
    simulator.wallet = wallet;
    return simulator;
  }

  /** Publishes `(value, nonce)` encrypted to `encPk`. Ungated. */
  public _deliver(
    encPk: JubjubPoint,
    value: bigint,
    nonce: bigint,
    slot: Uint8Array,
  ): Promise<[]> {
    return this.circuits.impure._deliver(encPk, value, nonce, slot);
  }
}
