import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockPrf,
} from '../../../../../artifacts/crypto/prf/test/mocks/MockPrf/contract/index.js';

// The Prf module is stateless and declares no witnesses, so the private
// state and witness set are both empty.
export type PrfPrivateState = Record<string, never>;
export const PrfPrivateState: PrfPrivateState = {};
export const PrfWitnesses = () => ({});

/**
 * Type constructor args
 */
type PrfArgs = readonly [];

const PrfSimulatorBase = createSimulator<
  PrfPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof PrfWitnesses>,
  MockPrf<PrfPrivateState>,
  PrfArgs
>({
  contractFactory: (witnesses) => new MockPrf<PrfPrivateState>(witnesses),
  defaultPrivateState: () => PrfPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => PrfWitnesses(),
  artifactName: 'MockPrf',
});

/**
 * Prf Simulator
 *
 * Each method is a thin pass-through to the mock's matching circuit. The
 * wrappers pass `{ domain, input }` as the `Prf.evaluate` input. The `ref*`
 * methods hash a flat `{ domain, input, key }` without going through `Prf`.
 */
export class PrfSimulator extends PrfSimulatorBase {
  static async create(
    options: SimulatorOptions<
      PrfPrivateState,
      ReturnType<typeof PrfWitnesses>
    > = {},
  ): Promise<PrfSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<PrfSimulator>;
  }

  /** @description `Prf.evaluate` over a tagged `Bytes<32>` input. */
  public evaluateOfBytes(
    domain: Uint8Array,
    input: Uint8Array,
    key: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.evaluateOfBytes(domain, input, key);
  }

  /** @description {@link evaluateOfBytes} under a `Field` key. */
  public evaluateWithFieldKey(
    domain: Uint8Array,
    input: Uint8Array,
    key: bigint,
  ): Promise<Uint8Array> {
    return this.circuits.impure.evaluateWithFieldKey(domain, input, key);
  }

  /** @description `Prf.evaluate` over a tagged `Field` input. */
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

  /**
   * @description Reference for {@link evaluateWithFieldKey}: the key hashed as
   * its `Bytes<32>` cast.
   */
  public refEvaluateWithFieldKey(
    domain: Uint8Array,
    input: Uint8Array,
    key: bigint,
  ): Promise<Uint8Array> {
    return this.circuits.impure.refEvaluateWithFieldKey(domain, input, key);
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
