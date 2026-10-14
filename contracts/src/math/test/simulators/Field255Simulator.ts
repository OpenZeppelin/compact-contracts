import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockField255,
  type U256,
} from '../../../../artifacts/MockField255/contract/index.js';
import { PackPrivateState, PackWitnesses } from '../witnesses/PackWitnesses.js';

/**
 * Type constructor args
 */
type Field255Args = readonly [];

// Field255 declares no witness of its own. Its byte conversion calls the
// Pack witness, so the simulator uses the Pack witnesses.
const Field255SimulatorBase = createSimulator<
  PackPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof PackWitnesses>,
  MockField255<PackPrivateState>,
  Field255Args
>({
  contractFactory: (witnesses) => new MockField255<PackPrivateState>(witnesses),
  defaultPrivateState: () => PackPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => PackWitnesses(),
  artifactName: 'MockField255',
});

/**
 * @description A simulator implementation for testing Field255 math operations.
 */
export class Field255Simulator extends Field255SimulatorBase {
  static async create(
    options: SimulatorOptions<
      PackPrivateState,
      ReturnType<typeof PackWitnesses>
    > = {},
  ): Promise<Field255Simulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<Field255Simulator>;
  }

  ////////////////////////////////////////////////////////////////
  // Constants
  ////////////////////////////////////////////////////////////////

  public MAX_FIELD(): Promise<bigint> {
    return this.circuits.impure.MAX_FIELD();
  }

  ////////////////////////////////////////////////////////////////
  // Conversions
  ////////////////////////////////////////////////////////////////

  public toBytes(value: bigint): Promise<Uint8Array> {
    return this.circuits.impure.toBytes(value);
  }

  public toU256(value: bigint): Promise<U256> {
    return this.circuits.impure.toU256(value);
  }

  ////////////////////////////////////////////////////////////////
  // Comparisons
  ////////////////////////////////////////////////////////////////

  public eq(a: bigint, b: bigint): Promise<boolean> {
    return this.circuits.impure.eq(a, b);
  }

  public lt(a: bigint, b: bigint): Promise<boolean> {
    return this.circuits.impure.lt(a, b);
  }

  public lte(a: bigint, b: bigint): Promise<boolean> {
    return this.circuits.impure.lte(a, b);
  }

  public gt(a: bigint, b: bigint): Promise<boolean> {
    return this.circuits.impure.gt(a, b);
  }

  public gte(a: bigint, b: bigint): Promise<boolean> {
    return this.circuits.impure.gte(a, b);
  }

  ////////////////////////////////////////////////////////////////
  // Utilities
  ////////////////////////////////////////////////////////////////

  public isZero(a: bigint): Promise<boolean> {
    return this.circuits.impure.isZero(a);
  }
}
