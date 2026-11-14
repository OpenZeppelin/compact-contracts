import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockPrfExpand,
} from '../../../../../artifacts/crypto/prf/test/mocks/MockPrfExpand/contract/index.js';

// The PrfExpand module is stateless and declares no witnesses, so the private
// state and witness set are both empty.
export type PrfExpandPrivateState = Record<string, never>;
export const PrfExpandPrivateState: PrfExpandPrivateState = {};
export const PrfExpandWitnesses = () => ({});

/**
 * Type constructor args
 */
type PrfExpandArgs = readonly [];

const PrfExpandSimulatorBase = createSimulator<
  PrfExpandPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof PrfExpandWitnesses>,
  MockPrfExpand<PrfExpandPrivateState>,
  PrfExpandArgs
>({
  contractFactory: (witnesses) =>
    new MockPrfExpand<PrfExpandPrivateState>(witnesses),
  defaultPrivateState: () => PrfExpandPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => PrfExpandWitnesses(),
  artifactName: 'MockPrfExpand',
});

/**
 * PrfExpand Simulator
 *
 * Each method is a thin pass-through to the mock's matching circuit. The
 * `ref*` methods hash a flat `{ domain, slot, context, seed }` without going
 * through `PrfExpand`.
 */
export class PrfExpandSimulator extends PrfExpandSimulatorBase {
  static async create(
    options: SimulatorOptions<
      PrfExpandPrivateState,
      ReturnType<typeof PrfExpandWitnesses>
    > = {},
  ): Promise<PrfExpandSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<PrfExpandSimulator>;
  }

  /** @description `PrfExpand.expand` over a `Bytes<32>` context. */
  public expandOfBytes(
    domain: Uint8Array,
    slot: Uint8Array,
    context: Uint8Array,
    seed: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.expandOfBytes(domain, slot, context, seed);
  }

  /** @description `PrfExpand.expand` over a `Field` context. */
  public expandOfField(
    domain: Uint8Array,
    slot: Uint8Array,
    context: bigint,
    seed: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.expandOfField(domain, slot, context, seed);
  }

  /** @description Reference for {@link expandOfBytes}. */
  public refExpandOfBytes(
    domain: Uint8Array,
    slot: Uint8Array,
    context: Uint8Array,
    seed: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.refExpandOfBytes(domain, slot, context, seed);
  }

  /** @description Reference for {@link expandOfField}. */
  public refExpandOfField(
    domain: Uint8Array,
    slot: Uint8Array,
    context: bigint,
    seed: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.refExpandOfField(domain, slot, context, seed);
  }
}
