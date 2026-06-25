import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockEcdsaSignerManager,
  pureCircuits,
} from '../../../../artifacts/MockEcdsaSignerManager/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

/**
 * Type constructor args
 */
type EcdsaSignerManagerArgs = readonly [
  salt: Uint8Array,
  signers: Uint8Array[],
  thresh: bigint,
];

const EcdsaSignerManagerSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockEcdsaSignerManager<EmptyPrivateState>,
  EcdsaSignerManagerArgs
>({
  contractFactory: (witnesses) =>
    new MockEcdsaSignerManager<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (salt, signers, thresh) => [salt, signers, thresh],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'MockEcdsaSignerManager',
});

/**
 * EcdsaSignerManager Simulator
 */
export class EcdsaSignerManagerSimulator extends EcdsaSignerManagerSimulatorBase {
  static async create(
    salt: Uint8Array,
    signers: Uint8Array[],
    thresh: bigint,
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<EcdsaSignerManagerSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [salt, signers, thresh],
      options,
    ) as Promise<EcdsaSignerManagerSimulator>;
  }

  /**
   * Pure commitment derivation — callable without a deployed instance.
   */
  public static calculateSignerId(pk: Uint8Array, salt: Uint8Array): Uint8Array {
    return pureCircuits._calculateSignerId(pk, salt);
  }

  public verify(
    msgHash: Uint8Array,
    pubkeys: [Uint8Array, Uint8Array],
    signatures: [Uint8Array, Uint8Array],
  ) {
    return this.circuits.impure.verify(msgHash, pubkeys, signatures);
  }

  public getSignerCount(): Promise<bigint> {
    return this.circuits.impure.getSignerCount();
  }

  public getThreshold(): Promise<bigint> {
    return this.circuits.impure.getThreshold();
  }

  public isSigner(account: Uint8Array): Promise<boolean> {
    return this.circuits.impure.isSigner(account);
  }
}
