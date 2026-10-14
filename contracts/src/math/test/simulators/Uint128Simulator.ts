import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type DivResultU128,
  ledger,
  Contract as MockUint128,
  type U128,
  type U256,
} from '../../../../artifacts/MockUint128/contract/index.js';
import {
  Uint128PrivateState,
  Uint128Witnesses,
} from '../witnesses/Uint128Witnesses.js';

/**
 * Type constructor args
 */
type Uint128Args = readonly [];

const Uint128SimulatorBase = createSimulator<
  Uint128PrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof Uint128Witnesses>,
  MockUint128<Uint128PrivateState>,
  Uint128Args
>({
  contractFactory: (witnesses) =>
    new MockUint128<Uint128PrivateState>(witnesses),
  defaultPrivateState: () => Uint128PrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => Uint128Witnesses(),
  artifactName: 'MockUint128',
});

/**
 * @description A simulator implementation for testing Uint128 math operations.
 */
export class Uint128Simulator extends Uint128SimulatorBase {
  static async create(
    options: SimulatorOptions<
      Uint128PrivateState,
      ReturnType<typeof Uint128Witnesses>
    > = {},
  ): Promise<Uint128Simulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<Uint128Simulator>;
  }

  ////////////////////////////////////////////////////////////////
  // Constants
  ////////////////////////////////////////////////////////////////

  public MODULUS(): Promise<bigint> {
    return this.circuits.impure.MODULUS();
  }

  public ZERO_U128(): Promise<U128> {
    return this.circuits.impure.ZERO_U128();
  }

  public MAX_U128(): Promise<U128> {
    return this.circuits.impure.MAX_U128();
  }

  public MAX_UINT128(): Promise<bigint> {
    return this.circuits.impure.MAX_UINT128();
  }

  ////////////////////////////////////////////////////////////////
  // Conversions
  ////////////////////////////////////////////////////////////////

  public toU128(value: bigint): Promise<U128> {
    return this.circuits.impure.toU128(value);
  }

  public toUint128(value: U128): Promise<bigint> {
    return this.circuits.impure.toUint128(value);
  }

  ////////////////////////////////////////////////////////////////
  // Comparisons
  ////////////////////////////////////////////////////////////////

  public eq(a: bigint, b: bigint): Promise<boolean> {
    return this.circuits.impure.eq(a, b);
  }

  public eqU128(a: U128, b: U128): Promise<boolean> {
    return this.circuits.impure.eqU128(a, b);
  }

  public lt(a: bigint, b: bigint): Promise<boolean> {
    return this.circuits.impure.lt(a, b);
  }

  public lte(a: bigint, b: bigint): Promise<boolean> {
    return this.circuits.impure.lte(a, b);
  }

  public ltU128(a: U128, b: U128): Promise<boolean> {
    return this.circuits.impure.ltU128(a, b);
  }

  public lteU128(a: U128, b: U128): Promise<boolean> {
    return this.circuits.impure.lteU128(a, b);
  }

  public gt(a: bigint, b: bigint): Promise<boolean> {
    return this.circuits.impure.gt(a, b);
  }

  public gtU128(a: U128, b: U128): Promise<boolean> {
    return this.circuits.impure.gtU128(a, b);
  }

  public gte(a: bigint, b: bigint): Promise<boolean> {
    return this.circuits.impure.gte(a, b);
  }

  public gteU128(a: U128, b: U128): Promise<boolean> {
    return this.circuits.impure.gteU128(a, b);
  }

  ////////////////////////////////////////////////////////////////
  // Arithmetic
  ////////////////////////////////////////////////////////////////

  public add(a: bigint, b: bigint): Promise<U256> {
    return this.circuits.impure.add(a, b);
  }

  public addU128(a: U128, b: U128): Promise<U256> {
    return this.circuits.impure.addU128(a, b);
  }

  public addChecked(a: bigint, b: bigint): Promise<bigint> {
    return this.circuits.impure.addChecked(a, b);
  }

  public addCheckedU128(a: U128, b: U128): Promise<bigint> {
    return this.circuits.impure.addCheckedU128(a, b);
  }

  public sub(a: bigint, b: bigint): Promise<bigint> {
    return this.circuits.impure.sub(a, b);
  }

  public subU128(a: U128, b: U128): Promise<U128> {
    return this.circuits.impure.subU128(a, b);
  }

  public mul(a: bigint, b: bigint): Promise<U256> {
    return this.circuits.impure.mul(a, b);
  }

  public mulU128(a: U128, b: U128): Promise<U256> {
    return this.circuits.impure.mulU128(a, b);
  }

  public mulChecked(a: bigint, b: bigint): Promise<bigint> {
    return this.circuits.impure.mulChecked(a, b);
  }

  public mulCheckedU128(a: U128, b: U128): Promise<bigint> {
    return this.circuits.impure.mulCheckedU128(a, b);
  }

  ////////////////////////////////////////////////////////////////
  // Division
  ////////////////////////////////////////////////////////////////

  public div(a: bigint, b: bigint): Promise<bigint> {
    return this.circuits.impure.div(a, b);
  }

  public divU128(a: U128, b: U128): Promise<U128> {
    return this.circuits.impure.divU128(a, b);
  }

  public rem(a: bigint, b: bigint): Promise<bigint> {
    return this.circuits.impure.rem(a, b);
  }

  public remU128(a: U128, b: U128): Promise<U128> {
    return this.circuits.impure.remU128(a, b);
  }

  public divRem(a: bigint, b: bigint): Promise<DivResultU128> {
    return this.circuits.impure.divRem(a, b);
  }

  public divRemU128(a: U128, b: U128): Promise<DivResultU128> {
    return this.circuits.impure.divRemU128(a, b);
  }

  ////////////////////////////////////////////////////////////////
  // Square Root
  ////////////////////////////////////////////////////////////////

  public sqrt(radicand: bigint): Promise<bigint> {
    return this.circuits.impure.sqrt(radicand);
  }

  public sqrtU128(radicand: U128): Promise<bigint> {
    return this.circuits.impure.sqrtU128(radicand);
  }

  ////////////////////////////////////////////////////////////////
  // Utilities
  ////////////////////////////////////////////////////////////////

  public isZero(value: bigint): Promise<boolean> {
    return this.circuits.impure.isZero(value);
  }

  public isZeroU128(value: U128): Promise<boolean> {
    return this.circuits.impure.isZeroU128(value);
  }

  public isMultiple(value: bigint, divisor: bigint): Promise<boolean> {
    return this.circuits.impure.isMultiple(value, divisor);
  }

  public isMultipleU128(value: U128, divisor: U128): Promise<boolean> {
    return this.circuits.impure.isMultipleU128(value, divisor);
  }

  public min(a: bigint, b: bigint): Promise<bigint> {
    return this.circuits.impure.min(a, b);
  }

  public minU128(a: U128, b: U128): Promise<U128> {
    return this.circuits.impure.minU128(a, b);
  }

  public max(a: bigint, b: bigint): Promise<bigint> {
    return this.circuits.impure.max(a, b);
  }

  public maxU128(a: U128, b: U128): Promise<U128> {
    return this.circuits.impure.maxU128(a, b);
  }
}
