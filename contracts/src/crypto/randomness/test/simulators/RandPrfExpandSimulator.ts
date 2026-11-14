import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockRandPrfExpand,
} from '../../../../../artifacts/crypto/randomness/test/mocks/MockRandPrfExpand/contract/index.js';
import {
  RandPrfExpandPrivateState,
  RandPrfExpandWitnesses,
} from '../witnesses/RandPrfExpandWitnesses.js';

/**
 * Type constructor args
 */
type RandPrfExpandArgs = readonly [];

const RandPrfExpandSimulatorBase = createSimulator<
  RandPrfExpandPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof RandPrfExpandWitnesses>,
  MockRandPrfExpand<RandPrfExpandPrivateState>,
  RandPrfExpandArgs
>({
  contractFactory: (witnesses) =>
    new MockRandPrfExpand<RandPrfExpandPrivateState>(witnesses),
  defaultPrivateState: () => RandPrfExpandPrivateState.generate(),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => RandPrfExpandWitnesses(),
  artifactName: 'MockRandPrfExpand',
});

/**
 * RandPrfExpand Simulator
 *
 * Each method is a thin pass-through to the mock's matching circuit. The
 * `ref*` methods take the seed as an argument and hash a flat
 * `{ domain, slot, context, seed }` without going through `RandPrfExpand`.
 */
export class RandPrfExpandSimulator extends RandPrfExpandSimulatorBase {
  static async create(
    options: SimulatorOptions<
      RandPrfExpandPrivateState,
      ReturnType<typeof RandPrfExpandWitnesses>
    > = {},
  ): Promise<RandPrfExpandSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<RandPrfExpandSimulator>;
  }

  /** @description `RandPrfExpand.derive` over a `Bytes<32>` context. */
  public deriveOfBytes(
    domain: Uint8Array,
    slot: Uint8Array,
    context: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.deriveOfBytes(domain, slot, context);
  }

  /** @description `RandPrfExpand.derive` over a `Field` context. */
  public deriveOfField(
    domain: Uint8Array,
    slot: Uint8Array,
    context: bigint,
  ): Promise<Uint8Array> {
    return this.circuits.impure.deriveOfField(domain, slot, context);
  }

  /** @description Reference for {@link deriveOfBytes} under `seed`. */
  public refDeriveOfBytes(
    domain: Uint8Array,
    slot: Uint8Array,
    context: Uint8Array,
    seed: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.refDeriveOfBytes(domain, slot, context, seed);
  }

  /** @description Reference for {@link deriveOfField} under `seed`. */
  public refDeriveOfField(
    domain: Uint8Array,
    slot: Uint8Array,
    context: bigint,
    seed: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.refDeriveOfField(domain, slot, context, seed);
  }

  public readonly privateState = {
    /**
     * @description Replaces the seed the witness returns.
     * @param seed - The new 32-byte seed.
     * @returns The updated private state.
     */
    injectSeed: (seed: Uint8Array): Promise<RandPrfExpandPrivateState> =>
      this.updatePrivateState(RandPrfExpandPrivateState.withSeed(seed)),
  };
}
