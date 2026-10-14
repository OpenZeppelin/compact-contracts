import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockUint256,
  type U256,
} from '../../../../artifacts/MockUint256/contract/index.js';
import {
  Uint64PrivateState,
  Uint64Witnesses,
} from '../witnesses/Uint64Witnesses.js';

/**
 * Type constructor args
 */
type Uint256Args = readonly [];

// Uint256 calls only the Uint64 byte witness, so the simulator binds only
// that witness.
const Uint256Witnesses = () => {
  const { wit_uint64ToUnpackedBytes } = Uint64Witnesses();
  return { wit_uint64ToUnpackedBytes };
};

const Uint256SimulatorBase = createSimulator<
  Uint64PrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof Uint256Witnesses>,
  MockUint256<Uint64PrivateState>,
  Uint256Args
>({
  contractFactory: (witnesses) =>
    new MockUint256<Uint64PrivateState>(witnesses),
  defaultPrivateState: () => Uint64PrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => Uint256Witnesses(),
  artifactName: 'MockUint256',
});

/**
 * @description A simulator implementation for testing Uint256 math operations.
 */
export class Uint256Simulator extends Uint256SimulatorBase {
  static async create(
    options: SimulatorOptions<
      Uint64PrivateState,
      ReturnType<typeof Uint256Witnesses>
    > = {},
  ): Promise<Uint256Simulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<Uint256Simulator>;
  }

  ////////////////////////////////////////////////////////////////
  // Constants
  ////////////////////////////////////////////////////////////////

  public ZERO_U256(): Promise<U256> {
    return this.circuits.impure.ZERO_U256();
  }

  public MAX_U256(): Promise<U256> {
    return this.circuits.impure.MAX_U256();
  }

  ////////////////////////////////////////////////////////////////
  // Conversions
  ////////////////////////////////////////////////////////////////

  public toUnpackedBytes(value: U256): Promise<bigint[]> {
    return this.circuits.impure.toUnpackedBytes(value);
  }

  public toBytes(value: U256): Promise<Uint8Array> {
    return this.circuits.impure.toBytes(value);
  }

  ////////////////////////////////////////////////////////////////
  // Comparisons
  ////////////////////////////////////////////////////////////////

  public eq(a: U256, b: U256): Promise<boolean> {
    return this.circuits.impure.eq(a, b);
  }

  public lt(a: U256, b: U256): Promise<boolean> {
    return this.circuits.impure.lt(a, b);
  }

  public lte(a: U256, b: U256): Promise<boolean> {
    return this.circuits.impure.lte(a, b);
  }

  public gt(a: U256, b: U256): Promise<boolean> {
    return this.circuits.impure.gt(a, b);
  }

  public gte(a: U256, b: U256): Promise<boolean> {
    return this.circuits.impure.gte(a, b);
  }
}
