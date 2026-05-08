import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  ledger,
  Contract as MockSchnorr,
  type Schnorr_JubjubSchnorrSignature,
} from '../../../../artifacts/MockSchnorr/contract/index.js';
import {
  SchnorrPrivateState,
  SchnorrWitnesses,
} from '../../witnesses/SchnorrWitnesses.js';
import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';

type MockSchnorrLedger = ReturnType<typeof ledger>;

// `any` matches the convention used by ZOwnablePKSimulator in the same repo —
// avoids in-monorepo type-inference gymnastics. Drop once the simulator is
// consumed as a packaged dependency.
const SchnorrSimulatorBase: any = createSimulator<
  SchnorrPrivateState,
  MockSchnorrLedger,
  ReturnType<typeof SchnorrWitnesses>,
  MockSchnorr<SchnorrPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new MockSchnorr<SchnorrPrivateState>(witnesses),
  defaultPrivateState: () => SchnorrPrivateState,
  contractArgs: () => [] as const,
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => SchnorrWitnesses(),
});

/**
 * Drives the MockSchnorr contract through the in-process simulator so unit
 * tests can exercise the Schnorr verifier without a live proof-server.
 */
export class SchnorrSimulator extends SchnorrSimulatorBase {
  constructor(
    options: BaseSimulatorOptions<
      SchnorrPrivateState,
      ReturnType<typeof SchnorrWitnesses>
    > = {},
  ) {
    super([] as const, options);
  }

  testVerify(
    P: JubjubPoint,
    m: Uint8Array,
    sig: Schnorr_JubjubSchnorrSignature,
  ): void {
    this.circuits.impure.testVerify(P, m, sig);
  }

  testAssertValid(
    P: JubjubPoint,
    m: Uint8Array,
    sig: Schnorr_JubjubSchnorrSignature,
  ): void {
    this.circuits.impure.testAssertValid(P, m, sig);
  }

  testChallenge(R: JubjubPoint, P: JubjubPoint, m: Uint8Array): void {
    this.circuits.impure.testChallenge(R, P, m);
  }

  getLedger(): MockSchnorrLedger {
    return this.getPublicState();
  }
}
