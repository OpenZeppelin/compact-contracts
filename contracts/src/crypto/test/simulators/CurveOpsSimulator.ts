import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockCurveOps,
} from '../../../../artifacts/MockCurveOps/contract/index.js';

// The mock wraps stdlib curve built-ins and declares no witnesses, so the
// private state and witness set are both empty.
export type CurveOpsPrivateState = Record<string, never>;
export const CurveOpsPrivateState: CurveOpsPrivateState = {};
export const CurveOpsWitnesses = () => ({});

/**
 * Type constructor args
 */
type CurveOpsArgs = readonly [];

const CurveOpsSimulatorBase = createSimulator<
  CurveOpsPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof CurveOpsWitnesses>,
  MockCurveOps<CurveOpsPrivateState>,
  CurveOpsArgs
>({
  contractFactory: (witnesses) =>
    new MockCurveOps<CurveOpsPrivateState>(witnesses),
  defaultPrivateState: () => CurveOpsPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => CurveOpsWitnesses(),
  artifactName: 'MockCurveOps',
});

/**
 * CurveOps Simulator
 *
 * Each method is a thin pass-through to the mock's matching circuit.
 */
export class CurveOpsSimulator extends CurveOpsSimulatorBase {
  static async create(
    options: SimulatorOptions<
      CurveOpsPrivateState,
      ReturnType<typeof CurveOpsWitnesses>
    > = {},
  ): Promise<CurveOpsSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<CurveOpsSimulator>;
  }

  /**
   * @description Scalar-multiplies `p` by `k`.
   */
  public doEcMul(p: JubjubPoint, k: bigint): Promise<JubjubPoint> {
    return this.circuits.impure.doEcMul(p, k);
  }

  /**
   * @description Adds two curve points.
   */
  public doEcAdd(a: JubjubPoint, b: JubjubPoint): Promise<JubjubPoint> {
    return this.circuits.impure.doEcAdd(a, b);
  }

  /**
   * @description Scalar-multiplies the Jubjub generator by `k`.
   */
  public genMul(k: bigint): Promise<JubjubPoint> {
    return this.circuits.impure.genMul(k);
  }
}
