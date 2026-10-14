# Math

Use the math circuits with the witnesses required by the generated consumer interface.

## Supply the witnesses

Read the generated `Witnesses<PrivateState>` type from the consumer's `contract/index.d.ts`.
Supply exactly the reachable witness names. An unused module import does not add a witness.
The pool example requires `wit_divUint128` and `wit_sqrtU128`.
Each witness returns `[context.privateState, result]`.
These math witnesses keep the private state unchanged.

The following test reference uses the repository's witness factory.
Copy the arithmetic into an audited consumer implementation before production use.
The package excludes the `test/witnesses` directory.

```ts
import { Contract, type Witnesses } from './managed/Pool/contract/index.js';
import { Uint128Witnesses } from './test/witnesses/Uint128Witnesses.js';

type PrivateState = Record<string, never>;
const { wit_divUint128, wit_sqrtU128 } = Uint128Witnesses();
const witnesses = {
  wit_divUint128,
  wit_sqrtU128,
} satisfies Witnesses<PrivateState>;
const contract = new Contract<PrivateState>(witnesses);
```

The factory import above refers to a local test reference copied from this repository.
It is not a package export.
The [consumer witness file](test/witnesses/MathConsumerWitnesses.ts) checks the same two names against its generated type.
The [consumer test](test/MathConsumer.test.ts) checks both the returned value and the public ledger value.
Use the async simulator as follows:

```ts
import { MathConsumerSimulator } from './test/simulators/MathConsumerSimulator.js';

const pool = await MathConsumerSimulator.create();
const root = await pool.update(4n, 9n);
const state = await pool.getPublicState();
// root and state.liquidity are 6n.
```

### Witness contracts

The context parameter has type `WitnessContext<Ledger, PrivateState>`.
The table lists the parameters after the context and the result after the private state.
Use `bigint` for Compact integers and fields, `Uint8Array` for bytes, and `bigint[]` for byte vectors.

| Name | Parameters | Result | Reference |
|---|---|---|---|
| `wit_unpackBytes` | `bytes: Uint8Array` | `bigint[]`, one integer per byte | [PackWitnesses](test/witnesses/PackWitnesses.ts) |
| `wit_uint64ToUnpackedBytes` | `value: bigint` | Eight little-endian byte integers | [Uint64Witnesses](test/witnesses/Uint64Witnesses.ts) |
| `wit_divUint64` | `a: bigint, b: bigint` | `{ quotient: bigint, remainder: bigint }` | [Uint64Witnesses](test/witnesses/Uint64Witnesses.ts) |
| `wit_sqrtUint64` | `radicand: bigint` | Integer square root as `bigint` | [Uint64Witnesses](test/witnesses/Uint64Witnesses.ts) |
| `wit_divUint128` | `a: bigint, b: bigint` | `{ quotient: U128, remainder: U128 }` | [Uint128Witnesses](test/witnesses/Uint128Witnesses.ts) |
| `wit_divU128` | `a: U128, b: U128` | `{ quotient: U128, remainder: U128 }` | [Uint128Witnesses](test/witnesses/Uint128Witnesses.ts) |
| `wit_sqrtU128` | `radicand: U128` | Integer square root as `bigint` | [Uint128Witnesses](test/witnesses/Uint128Witnesses.ts) |

These names are global in the generated consumer interface.
An import prefix changes circuit names. It does not rename the witness keys.
All `Pack<N>` instances share `wit_unpackBytes`. Implement it for the input array length.
Avoid declaring another witness with the same name and an incompatible signature.

### Witness-dependent circuits and disclosure

The following table comes from separate compiler probes for every exported mock circuit.
Each probe first returns the value without `disclose()`.
A `yes` entry fails with `potential witness-value disclosure must be declared` and compiles after disclosure is added.
The witness names come from that probe's generated `Witnesses` declaration.
Unlisted circuits have no reachable witness and need no disclosure for public input values.
An input that itself comes from a witness can still make a native result private.

The table describes the implementation in this documentation branch before native-addition integration.
Both `Uint128.addChecked` overloads appear here because this branch still uses the splitter.
The [native-addition migration notes](MIGRATION.md#native-addition-and-witness-interfaces) describe the integration change.

| Circuit | Generated witness keys | Needs disclose() |
|---|---|---|
| `Pack.unpack(bytes: Bytes<N>): Vector<N, Uint<8>>` | `wit_unpackBytes` | yes |
| `Bytes8.unpack(bytes: Bytes<8>): Vector<8, Uint<8>>` | `wit_unpackBytes` | yes |
| `Bytes8.toUint64(bytes: Bytes<8>): Uint<64>` | `wit_unpackBytes` | yes |
| `Uint64.toBytes(value: Uint<64>): Bytes<8>` | `wit_uint64ToUnpackedBytes` | yes |
| `Uint64.toUnpackedBytes(value: Uint<64>): Vector<8, Uint<8>>` | `wit_uint64ToUnpackedBytes` | yes |
| `Uint64.div(a: Uint<64>, b: Uint<64>): Uint<64>` | `wit_divUint64` | yes |
| `Uint64.rem(a: Uint<64>, b: Uint<64>): Uint<64>` | `wit_divUint64` | yes |
| `Uint64.divRem(a: Uint<64>, b: Uint<64>): DivResultU64` | `wit_divUint64` | yes |
| `Uint64.sqrt(radical: Uint<64>): Uint<32>` | `wit_sqrtUint64` | yes |
| `Uint64.isMultiple(value: Uint<64>, b: Uint<64>): Boolean` | `wit_divUint64` | yes |
| `Uint128.toU128(value: Uint<128>): U128` | `wit_divUint128` | yes |
| `Uint128.add(a: Uint<128>, b: Uint<128>): U256` | `wit_divUint128` | yes |
| `Uint128.add(a: U128, b: U128): U256` | `wit_divUint128` | yes |
| `Uint128.addChecked(a: Uint<128>, b: Uint<128>): Uint<128>` | `wit_divUint128` | yes |
| `Uint128.addChecked(a: U128, b: U128): Uint<128>` | `wit_divUint128` | yes |
| `Uint128.mul(a: Uint<128>, b: Uint<128>): U256` | `wit_divUint128` | yes |
| `Uint128.mul(a: U128, b: U128): U256` | `wit_divUint128` | yes |
| `Uint128.mulChecked(a: Uint<128>, b: Uint<128>): Uint<128>` | `wit_divUint128` | yes |
| `Uint128.mulChecked(a: U128, b: U128): Uint<128>` | `wit_divUint128` | yes |
| `Uint128.div(a: Uint<128>, b: Uint<128>): Uint<128>` | `wit_divU128`, `wit_divUint128` | yes |
| `Uint128.div(a: U128, b: U128): U128` | `wit_divU128`, `wit_divUint128` | yes |
| `Uint128.rem(a: Uint<128>, b: Uint<128>): Uint<128>` | `wit_divU128`, `wit_divUint128` | yes |
| `Uint128.rem(a: U128, b: U128): U128` | `wit_divU128`, `wit_divUint128` | yes |
| `Uint128.divRem(a: Uint<128>, b: Uint<128>): DivResultU128` | `wit_divU128`, `wit_divUint128` | yes |
| `Uint128.divRem(a: U128, b: U128): DivResultU128` | `wit_divU128`, `wit_divUint128` | yes |
| `Uint128.sqrt(radicand: Uint<128>): Uint<64>` | `wit_divUint128`, `wit_sqrtU128` | yes |
| `Uint128.sqrt(radicand: U128): Uint<64>` | `wit_divUint128`, `wit_sqrtU128` | yes |
| `Uint128.isMultiple(value: Uint<128>, b: Uint<128>): Boolean` | `wit_divU128`, `wit_divUint128` | yes |
| `Uint128.isMultiple(value: U128, b: U128): Boolean` | `wit_divU128`, `wit_divUint128` | yes |
| `Uint256.toBytes(value: U256): Bytes<32>` | `wit_uint64ToUnpackedBytes` | yes |
| `Uint256.toUnpackedBytes(value: U256): Vector<32, Uint<8>>` | `wit_uint64ToUnpackedBytes` | yes |
| `Bytes32.unpack(bytes: Bytes<32>): Vector<32, Uint<8>>` | `wit_unpackBytes` | yes |
| `Bytes32.toU256(bytes: Bytes<32>): U256` | `wit_unpackBytes` | yes |
| `Bytes32.lt(a: Bytes<32>, b: Bytes<32>): Boolean` | `wit_unpackBytes` | yes |
| `Bytes32.lte(a: Bytes<32>, b: Bytes<32>): Boolean` | `wit_unpackBytes` | yes |
| `Bytes32.gt(a: Bytes<32>, b: Bytes<32>): Boolean` | `wit_unpackBytes` | yes |
| `Bytes32.gte(a: Bytes<32>, b: Bytes<32>): Boolean` | `wit_unpackBytes` | yes |
| `Field255.toU256(value: Field): U256` | `wit_unpackBytes` | yes |
| `Field255.lt(a: Field, b: Field): Boolean` | `wit_unpackBytes` | yes |
| `Field255.lte(a: Field, b: Field): Boolean` | `wit_unpackBytes` | yes |
| `Field255.gt(a: Field, b: Field): Boolean` | `wit_unpackBytes` | yes |
| `Field255.gte(a: Field, b: Field): Boolean` | `wit_unpackBytes` | yes |

`Uint128.mul` needs `wit_divUint128` in both forms.
`Uint256.toBytes` needs `wit_uint64ToUnpackedBytes`.
`Bytes32.lt` needs `wit_unpackBytes`.
Provide these dependencies when the consumer calls these circuits.

