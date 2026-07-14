import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockNativeShieldedTokenDerivedNonce,
} from '../../../../artifacts/MockNativeShieldedTokenDerivedNonce/contract/index.js';

/**
 * The derived-nonce extension declares no witnesses, so the private state is
 * empty and the witnesses object is `{}`.
 */
export type NativeShieldedTokenDerivedNoncePrivateState = Record<string, never>;
export const NativeShieldedTokenDerivedNoncePrivateState: NativeShieldedTokenDerivedNoncePrivateState =
  {};
export const NativeShieldedTokenDerivedNonceWitnesses = () => ({});

/** Counter-only: the extension needs no initialization, so the ctor is nullary. */
type NativeShieldedTokenDerivedNonceArgs = readonly [];

const NativeShieldedTokenDerivedNonceSimulatorBase = createSimulator<
  NativeShieldedTokenDerivedNoncePrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof NativeShieldedTokenDerivedNonceWitnesses>,
  MockNativeShieldedTokenDerivedNonce<NativeShieldedTokenDerivedNoncePrivateState>,
  NativeShieldedTokenDerivedNonceArgs
>({
  contractFactory: (witnesses) =>
    new MockNativeShieldedTokenDerivedNonce<NativeShieldedTokenDerivedNoncePrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => NativeShieldedTokenDerivedNoncePrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => NativeShieldedTokenDerivedNonceWitnesses(),
  artifactName: 'MockNativeShieldedTokenDerivedNonce',
});

/**
 * NativeShieldedTokenDerivedNonce (extension) Simulator.
 *
 * Drives `_deriveNonce` directly and reads the counter; the extension imports
 * no token module and needs no initialization.
 */
export class NativeShieldedTokenDerivedNonceSimulator extends NativeShieldedTokenDerivedNonceSimulatorBase {
  static async create(
    options: SimulatorOptions<
      NativeShieldedTokenDerivedNoncePrivateState,
      ReturnType<typeof NativeShieldedTokenDerivedNonceWitnesses>
    > = {},
  ): Promise<NativeShieldedTokenDerivedNonceSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [],
      options,
    ) as Promise<NativeShieldedTokenDerivedNonceSimulator>;
  }

  /** @description Advances the counter and returns the next derived coin nonce. */
  public _deriveNonce(): Promise<Uint8Array> {
    return this.circuits.impure._deriveNonce();
  }

  /** @description Current value of the derived-nonce counter. */
  public async nonceCounter(): Promise<bigint> {
    return (await this.getPublicState())
      .NativeShieldedTokenDerivedNonce__counter;
  }
}
