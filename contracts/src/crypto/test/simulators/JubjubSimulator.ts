import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  ledger,
  Contract as MockJubjub,
} from '../../../../artifacts/MockJubjub/contract/index.js';
import {
  JubjubPrivateState,
  JubjubWitnesses,
} from '../../witnesses/JubjubWitnesses.js';
import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';

type MockJubjubLedger = ReturnType<typeof ledger>;

// `any` matches the convention used elsewhere in this repo's simulators —
// works around in-monorepo type-inference gymnastics.
const JubjubSimulatorBase: any = createSimulator<
  JubjubPrivateState,
  MockJubjubLedger,
  ReturnType<typeof JubjubWitnesses>,
  MockJubjub<JubjubPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) => new MockJubjub<JubjubPrivateState>(witnesses),
  defaultPrivateState: () => JubjubPrivateState,
  contractArgs: () => [] as const,
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => JubjubWitnesses(),
});

/**
 * Drives the MockJubjub contract through the in-process simulator so unit
 * tests can exercise the Jubjub primitives without a live proof server.
 */
export class JubjubSimulator extends JubjubSimulatorBase {
  constructor(
    options: BaseSimulatorOptions<
      JubjubPrivateState,
      ReturnType<typeof JubjubWitnesses>
    > = {},
  ) {
    super([] as const, options);
  }

  testPointsEqual(a: JubjubPoint, b: JubjubPoint): void {
    this.circuits.impure.testPointsEqual(a, b);
  }

  testIsIdentity(p: JubjubPoint): void {
    this.circuits.impure.testIsIdentity(p);
  }

  testAssertNonIdentity(p: JubjubPoint): void {
    this.circuits.impure.testAssertNonIdentity(p);
  }

  testFitInJubjubScalar(c: bigint): void {
    this.circuits.impure.testFitInJubjubScalar(c);
  }

  getLedger(): MockJubjubLedger {
    return this.getPublicState();
  }
}
