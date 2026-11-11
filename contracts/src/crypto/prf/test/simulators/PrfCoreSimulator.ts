import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockPrfCore,
} from '../../../../../artifacts/crypto/prf/test/mocks/MockPrfCore/contract/index.js';

// The PrfCore module is stateless and declares no witnesses, so the private
// state and witness set are both empty.
export type PrfCorePrivateState = Record<string, never>;
export const PrfCorePrivateState: PrfCorePrivateState = {};
export const PrfCoreWitnesses = () => ({});

/**
 * Type constructor args
 */
type PrfCoreArgs = readonly [];

const PrfCoreSimulatorBase = createSimulator<
  PrfCorePrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof PrfCoreWitnesses>,
  MockPrfCore<PrfCorePrivateState>,
  PrfCoreArgs
>({
  contractFactory: (witnesses) =>
    new MockPrfCore<PrfCorePrivateState>(witnesses),
  defaultPrivateState: () => PrfCorePrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => PrfCoreWitnesses(),
  artifactName: 'MockPrfCore',
});

/**
 * PrfCore Simulator
 *
 * Each method is a thin pass-through to the mock's matching circuit. The
 * wrappers pass `{ domain, input }` as the `PrfCore.evaluate` input. The `ref*`
 * methods hash a flat `{ domain, input, key }` without going through `PrfCore`.
 */
export class PrfCoreSimulator extends PrfCoreSimulatorBase {
  static async create(
    options: SimulatorOptions<
      PrfCorePrivateState,
      ReturnType<typeof PrfCoreWitnesses>
    > = {},
  ): Promise<PrfCoreSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<PrfCoreSimulator>;
  }

  /** @description `PrfCore.evaluate` over a tagged `Bytes<32>` input. */
  public evaluateOfBytes(
    domain: Uint8Array,
    input: Uint8Array,
    key: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.evaluateOfBytes(domain, input, key);
  }

  /** @description `PrfCore.evaluate` over a tagged `Field` input. */
  public evaluateOfField(
    domain: Uint8Array,
    input: bigint,
    key: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.evaluateOfField(domain, input, key);
  }

  /** @description {@link evaluateOfField} reduced via `degradeToTransient`. */
  public evaluateReducedOfField(
    domain: Uint8Array,
    input: bigint,
    key: Uint8Array,
  ): Promise<bigint> {
    return this.circuits.impure.evaluateReducedOfField(domain, input, key);
  }

  /** @description Reference for {@link evaluateOfBytes}. */
  public refEvaluateOfBytes(
    domain: Uint8Array,
    input: Uint8Array,
    key: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.refEvaluateOfBytes(domain, input, key);
  }

  /** @description Reference for {@link evaluateOfField}. */
  public refEvaluateOfField(
    domain: Uint8Array,
    input: bigint,
    key: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.refEvaluateOfField(domain, input, key);
  }

  /** @description Reference for {@link evaluateReducedOfField}. */
  public refEvaluateReducedOfField(
    domain: Uint8Array,
    input: bigint,
    key: Uint8Array,
  ): Promise<bigint> {
    return this.circuits.impure.refEvaluateReducedOfField(domain, input, key);
  }
}
