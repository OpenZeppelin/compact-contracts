import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import type { Witnesses } from '@artifacts/Bytes8.mock/contract/index.js';
import {
  Contract,
  ledger,
} from '@artifacts/Bytes8.mock/contract/index.js';
import { wit_unpackBytes } from '@src/math/witnesses/wit_unpackBytes.js';

export type Bytes8PrivateState = Record<string, never>;

export const Bytes8Witnesses = (): Witnesses<Bytes8PrivateState> => ({
  wit_unpackBytes(_context, bytes) {
    return [{}, wit_unpackBytes(bytes)];
  },
});

/**
 * Base simulator for Bytes8 mock contract
 */
const Bytes8SimulatorBase = createSimulator<
  Bytes8PrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof Bytes8Witnesses>,
  Contract<Bytes8PrivateState>,
  readonly []
>({
  contractFactory: (witnesses) => new Contract<Bytes8PrivateState>(witnesses),
  defaultPrivateState: () => ({}),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => Bytes8Witnesses(),
});

/**
 * @description A simulator implementation for testing Bytes8 conversion operations.
 */
export class Bytes8Simulator extends Bytes8SimulatorBase {
  constructor(
    options: BaseSimulatorOptions<
      Bytes8PrivateState,
      ReturnType<typeof Bytes8Witnesses>
    > = {},
  ) {
    super([], options);
  }

  ////////////////////////////////////////////////////////////////
  // Conversions
  ////////////////////////////////////////////////////////////////

  public pack(
    vec: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint],
  ): Uint8Array {
    return this.circuits.impure.pack(vec);
  }
  public unpack(
    bytes: Uint8Array,
  ): [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] {
    return this.circuits.impure.unpack(bytes) as [
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ];
  }

  public vectorToUint64(
    vec: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint],
  ): bigint {
    return this.circuits.impure.vectorToUint64(vec);
  }

  public bytesToUint64(bytes: Uint8Array): bigint {
    return this.circuits.impure.bytesToUint64(bytes);
  }
}
