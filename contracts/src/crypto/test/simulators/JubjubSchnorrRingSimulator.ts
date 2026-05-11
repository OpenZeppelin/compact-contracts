import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  ledger,
  Contract as MockJubjubSchnorrRing,
  type RingSig_JubjubRingSignature,
} from '../../../../artifacts/MockJubjubSchnorrRing/contract/index.js';
import {
  JubjubSchnorrRingPrivateState,
  JubjubSchnorrRingWitnesses,
} from '../../witnesses/JubjubSchnorrRingWitnesses.js';
import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';

type MockJubjubSchnorrRingLedger = ReturnType<typeof ledger>;

// `any` matches the convention used by SchnorrSimulator in the same repo —
// avoids in-monorepo type-inference gymnastics. Drop once the simulator is
// consumed as a packaged dependency.
const JubjubSchnorrRingSimulatorBase: any = createSimulator<
  JubjubSchnorrRingPrivateState,
  MockJubjubSchnorrRingLedger,
  ReturnType<typeof JubjubSchnorrRingWitnesses>,
  MockJubjubSchnorrRing<JubjubSchnorrRingPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new MockJubjubSchnorrRing<JubjubSchnorrRingPrivateState>(witnesses),
  defaultPrivateState: () => JubjubSchnorrRingPrivateState,
  contractArgs: () => [] as const,
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => JubjubSchnorrRingWitnesses(),
});

/**
 * Drives the MockJubjubSchnorrRing contract through the in-process simulator
 * so unit tests can exercise the K-of-N ring verifier without a live
 * proof-server.
 */
export class JubjubSchnorrRingSimulator extends JubjubSchnorrRingSimulatorBase {
  constructor(
    options: BaseSimulatorOptions<
      JubjubSchnorrRingPrivateState,
      ReturnType<typeof JubjubSchnorrRingWitnesses>
    > = {},
  ) {
    super([] as const, options);
  }

  testRingVerify(
    ring: [JubjubPoint, JubjubPoint, JubjubPoint],
    m: Uint8Array,
    sig: RingSig_JubjubRingSignature,
  ): void {
    this.circuits.impure.testRingVerify(ring, m, sig);
  }

  testRingAssertValid(
    ring: [JubjubPoint, JubjubPoint, JubjubPoint],
    m: Uint8Array,
    sig: RingSig_JubjubRingSignature,
  ): void {
    this.circuits.impure.testRingAssertValid(ring, m, sig);
  }

  testRingChallenge(
    R: [JubjubPoint, JubjubPoint, JubjubPoint],
    m: Uint8Array,
  ): void {
    this.circuits.impure.testRingChallenge(R, m);
  }

  getLedger(): MockJubjubSchnorrRingLedger {
    return this.getPublicState();
  }
}
