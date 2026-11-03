import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockDelivered,
} from '../../../../artifacts/MockConfidentialNoteFungibleTokenDelivered/contract/index.js';
import {
  ConfidentialNoteFungibleTokenDeliveryWitnesses,
  createDeliveryWallet,
  type DeliveryWallet,
} from '../witnesses/ConfidentialNoteFungibleTokenDeliveryWitnesses.js';
import {
  type ConfidentialNoteFungibleTokenPrivateState,
  ConfidentialNoteFungibleTokenWitnesses,
  createNoteWallet,
  INSTANCE_SALT,
  type NoteCommitmentLedger,
  type NoteWallet,
  ConfidentialNoteFungibleTokenPrivateState as PrivateState,
} from '../witnesses/ConfidentialNoteFungibleTokenWitnesses.js';

/** The core's four witnesses plus delivery's one, over the core's private state. */
const ConfidentialNoteFungibleTokenDeliveredWitnesses = (
  noteWallet: NoteWallet,
  deliveryWallet: DeliveryWallet,
) => ({
  ...ConfidentialNoteFungibleTokenWitnesses<NoteCommitmentLedger>(noteWallet),
  ...ConfidentialNoteFungibleTokenDeliveryWitnesses<
    NoteCommitmentLedger,
    ConfidentialNoteFungibleTokenPrivateState
  >(deliveryWallet),
});

type Options = SimulatorOptions<
  ConfidentialNoteFungibleTokenPrivateState,
  ReturnType<typeof ConfidentialNoteFungibleTokenDeliveredWitnesses>
>;

type DeliveredArgs = readonly [
  instanceSalt: Uint8Array,
  ownerPk: bigint,
  ownerEncPk: JubjubPoint,
  value: bigint,
];

/** Same role as `pendingWallet` in ConfidentialNoteFungibleTokenSimulator. */
let pendingWallets: { note: NoteWallet; delivery: DeliveryWallet } = {
  note: createNoteWallet(),
  delivery: createDeliveryWallet(),
};

const ConfidentialNoteFungibleTokenDeliveredSimulatorBase = createSimulator<
  ConfidentialNoteFungibleTokenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialNoteFungibleTokenDeliveredWitnesses>,
  MockDelivered<ConfidentialNoteFungibleTokenPrivateState>,
  DeliveredArgs
>({
  contractFactory: (witnesses) =>
    new MockDelivered<ConfidentialNoteFungibleTokenPrivateState>(witnesses),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: (instanceSalt, ownerPk, ownerEncPk, value) => [
    instanceSalt,
    ownerPk,
    ownerEncPk,
    value,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () =>
    ConfidentialNoteFungibleTokenDeliveredWitnesses(
      pendingWallets.note,
      pendingWallets.delivery,
    ),
  artifactName: 'MockConfidentialNoteFungibleTokenDelivered',
});

/**
 * Simulator for the core + delivery composition. The constructor mints one
 * note and delivers it, so a deployment already has one leaf and one entry.
 * Every circuit returns nothing: a spec learns the notes it created the way a
 * wallet does, by opening `Delivery__deliveries` with `pureCircuits.recoverNote`.
 */
export class ConfidentialNoteFungibleTokenDeliveredSimulator extends ConfidentialNoteFungibleTokenDeliveredSimulatorBase {
  /** The spender's private inputs. Mutate between calls. */
  public wallet!: NoteWallet;

  /** The delivery witness's private input. Mutate between calls. */
  public deliveryWallet!: DeliveryWallet;

  /**
   * @param options Standard simulator options, plus the constructor mint
   * (`ownerPk`, `ownerEncPk`, `value`), optional wallets to reuse across
   * deployments, and the `instanceSalt` (default {@link INSTANCE_SALT}).
   */
  static async create(
    options: Options & {
      ownerPk: bigint;
      ownerEncPk: JubjubPoint;
      value: bigint;
      wallet?: NoteWallet;
      deliveryWallet?: DeliveryWallet;
      instanceSalt?: Uint8Array;
    },
  ): Promise<ConfidentialNoteFungibleTokenDeliveredSimulator> {
    const {
      ownerPk,
      ownerEncPk,
      value,
      wallet: givenWallet,
      deliveryWallet: givenDeliveryWallet,
      instanceSalt,
      ...rest
    } = options;
    const wallet = givenWallet ?? createNoteWallet();
    const deliveryWallet = givenDeliveryWallet ?? createDeliveryWallet();
    pendingWallets = { note: wallet, delivery: deliveryWallet };
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    const simulator = (await super.create(
      [instanceSalt ?? INSTANCE_SALT, ownerPk, ownerEncPk, value],
      rest,
    )) as ConfidentialNoteFungibleTokenDeliveredSimulator;
    simulator.wallet = wallet;
    simulator.deliveryWallet = deliveryWallet;
    return simulator;
  }

  /** Mints `value` to `recipientPk` and delivers it to `recipientEncPk`. Ungated. */
  public mint(
    recipientPk: bigint,
    recipientEncPk: JubjubPoint,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure.mint(recipientPk, recipientEncPk, value);
  }

  /** Spends the input note; delivers the output to the recipient, the change to the sender. */
  public transfer(
    recipientPk: bigint,
    recipientEncPk: JubjubPoint,
    senderEncPk: JubjubPoint,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure.transfer(
      recipientPk,
      recipientEncPk,
      senderEncPk,
      value,
    );
  }

  /** Burns `value` from the input note; delivers the change to the sender. */
  public burn(senderEncPk: JubjubPoint, value: bigint): Promise<[]> {
    return this.circuits.impure.burn(senderEncPk, value);
  }
}
