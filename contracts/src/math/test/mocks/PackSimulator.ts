import type { Witnesses } from '@artifacts/Pack.mock/contract/index.js';
import { Contract, ledger } from '@artifacts/Pack.mock/contract/index.js';
import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import { wit_unpackBytes } from '@src/math/witnesses/wit_unpackBytes.js';

export type PackPrivateState = Record<string, never>;

export const PackWitnesses = (): Witnesses<PackPrivateState> => ({
  wit_unpackBytes(_context: unknown, bytes: Uint8Array) {
    return [{}, wit_unpackBytes(bytes)];
  },
});

/**
 * Base simulator for Pack mock contract
 */
const PackSimulatorBase = createSimulator<
  PackPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof PackWitnesses>,
  Contract<PackPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) => new Contract<PackPrivateState>(witnesses),
  defaultPrivateState: () => ({}),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => PackWitnesses(),
});

/**
 * @description A simulator implementation for testing Pack conversion operations (N=8, 16, 32).
 */
export class PackSimulator extends PackSimulatorBase {
  constructor(
    options: BaseSimulatorOptions<
      PackPrivateState,
      ReturnType<typeof PackWitnesses>
    > = {},
  ) {
    super([], options);
  }

  /** Packs Vector<8, Uint<8>> into Bytes<8>. */
  public pack8(
    vec: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint],
  ): Uint8Array {
    return this.circuits.impure.pack8(vec);
  }

  /** Unpacks Bytes<8> into Vector<8, Uint<8>>. */
  public unpack8(
    bytes: Uint8Array,
  ): [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] {
    return this.circuits.impure.unpack8(bytes) as [
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

  /** Packs Vector<16, Uint<8>> into Bytes<16>. */
  public pack16(vec: bigint[]): Uint8Array {
    return this.circuits.impure.pack16(vec);
  }

  /** Unpacks Bytes<16> into Vector<16, Uint<8>>. */
  public unpack16(bytes: Uint8Array): bigint[] {
    return this.circuits.impure.unpack16(bytes);
  }

  /** Packs Vector<32, Uint<8>> into Bytes<32>. */
  public pack32(vec: bigint[]): Uint8Array {
    return this.circuits.impure.pack32(vec);
  }

  /** Unpacks Bytes<32> into Vector<32, Uint<8>>. */
  public unpack32(bytes: Uint8Array): bigint[] {
    return this.circuits.impure.unpack32(bytes);
  }
}
