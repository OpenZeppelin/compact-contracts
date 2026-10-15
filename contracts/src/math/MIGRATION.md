# Math migration

Move math imports from `midnight-apps/contracts/src/math` to the `@openzeppelin/compact-contracts/math` package directory.
All 94 exported circuit declarations, four structs, and seven witness declarations remain available.
Overloads keep their input and result types. The `U128` and `U256` structs remain public.
The fixes and the native-addition notes below list every behavior change.

## Source and target paths

| Artifact | Source in midnight-apps | Target in compact-contracts |
|---|---|---|
| Modules | `contracts/src/math/<Module>.compact` | `contracts/src/math/<Module>.compact` |
| Package modules | Source repository imports | `node_modules/@openzeppelin/compact-contracts/math/<Module>` |
| Tests | `contracts/src/math/test/<Module>.test.ts` | `contracts/src/math/test/<Module>.test.ts` |
| Mocks | `contracts/src/math/test/mocks/contracts/<Module>.mock.compact` | `contracts/src/math/test/mocks/Mock<Module>.compact` |
| Simulators | `contracts/src/math/test/mocks/<Module>Simulator.ts` | `contracts/src/math/test/simulators/<Module>Simulator.ts` |
| Witness code | `contracts/src/math/witnesses/wit_*.ts` | `contracts/src/math/test/witnesses/<Module>Witnesses.ts` |
| Square-root helper | `contracts/src/math/utils/sqrtBigint.ts` | `contracts/src/math/test/witnesses/sqrtBigint.ts` |
| Test constants | `contracts/src/math/utils/consts.ts` | `contracts/src/math/test/utils/consts.ts` |

The source repository stays available. This migration does not delete its math library.
The target package ships the Compact modules. Test witnesses are reference code and do not ship in the package.
Author and audit the consumer's witness implementations.

## API mapping

Each row maps the source declaration to the identically named target declaration in the same module.
The signature applies to both locations in the path table.
`Deprecated` means callable with a documented native replacement.
`Alternative` means kept with a documented native expression and cost comparison.
`Kept` means retained as the library API.
Pack uses its generic parameter N.

| Source and target declaration | Status |
|---|---|
| `Pack.pack(vec: Vector<N, Uint<8>>): Bytes<N>` | Deprecated |
| `Pack.unpack(bytes: Bytes<N>): Vector<N, Uint<8>>` | Alternative |
| `Bytes8.pack(vec: Vector<8, Uint<8>>): Bytes<8>` | Deprecated |
| `Bytes8.unpack(bytes: Bytes<8>): Vector<8, Uint<8>>` | Alternative |
| `Bytes8.toUint64(vec: Vector<8, Uint<8>>): Uint<64>` | Deprecated |
| `Bytes8.toUint64(bytes: Bytes<8>): Uint<64>` | Alternative |
| `Uint64.MAX_UINT8(): Uint<8>` | Kept |
| `Uint64.MAX_UINT16(): Uint<16>` | Kept |
| `Uint64.MAX_UINT32(): Uint<32>` | Kept |
| `Uint64.MAX_UINT64(): Uint<64>` | Kept |
| `Uint64.toBytes(value: Uint<64>): Bytes<8>` | Alternative |
| `Uint64.toUnpackedBytes(value: Uint<64>): Vector<8, Uint<8>>` | Alternative |
| `Uint64.add(a: Uint<64>, b: Uint<64>): Uint<128>` | Deprecated |
| `Uint64.addChecked(a: Uint<64>, b: Uint<64>): Uint<64>` | Alternative |
| `Uint64.sub(a: Uint<64>, b: Uint<64>): Uint<64>` | Alternative |
| `Uint64.mul(a: Uint<64>, b: Uint<64>): Uint<128>` | Deprecated |
| `Uint64.mulChecked(a: Uint<64>, b: Uint<64>): Uint<64>` | Alternative |
| `Uint64.div(a: Uint<64>, b: Uint<64>): Uint<64>` | Kept |
| `Uint64.rem(a: Uint<64>, b: Uint<64>): Uint<64>` | Kept |
| `Uint64.divRem(a: Uint<64>, b: Uint<64>): DivResultU64` | Kept |
| `Uint64.sqrt(radicand: Uint<64>): Uint<32>` | Kept |
| `Uint64.isMultiple(a: Uint<64>, b: Uint<64>): Boolean` | Kept |
| `Uint64.min(a: Uint<64>, b: Uint<64>): Uint<64>` | Deprecated |
| `Uint64.max(a: Uint<64>, b: Uint<64>): Uint<64>` | Deprecated |
| `Uint128.MODULUS(): Uint<65>` | Kept |
| `Uint128.ZERO_U128(): U128` | Deprecated |
| `Uint128.MAX_U128(): U128` | Kept |
| `Uint128.MAX_UINT128(): Uint<128>` | Kept |
| `Uint128.toU128(value: Uint<128>): U128` | Alternative |
| `Uint128.toUint128(value: U128): Uint<128>` | Deprecated |
| `Uint128.eq(a: Uint<128>, b: Uint<128>): Boolean` | Deprecated |
| `Uint128.eq(a: U128, b: U128): Boolean` | Deprecated |
| `Uint128.lt(a: Uint<128>, b: Uint<128>): Boolean` | Deprecated |
| `Uint128.lte(a: Uint<128>, b: Uint<128>): Boolean` | Deprecated |
| `Uint128.lt(a: U128, b: U128): Boolean` | Deprecated |
| `Uint128.lte(a: U128, b: U128): Boolean` | Deprecated |
| `Uint128.gt(a: Uint<128>, b: Uint<128>): Boolean` | Deprecated |
| `Uint128.gte(a: Uint<128>, b: Uint<128>): Boolean` | Deprecated |
| `Uint128.gt(a: U128, b: U128): Boolean` | Deprecated |
| `Uint128.gte(a: U128, b: U128): Boolean` | Deprecated |
| `Uint128.add(a: Uint<128>, b: Uint<128>): U256` | Kept |
| `Uint128.add(a: U128, b: U128): U256` | Kept |
| `Uint128.addChecked(a: Uint<128>, b: Uint<128>): Uint<128>` | Alternative |
| `Uint128.addChecked(a: U128, b: U128): Uint<128>` | Alternative |
| `Uint128.sub(a: Uint<128>, b: Uint<128>): Uint<128>` | Alternative |
| `Uint128.sub(a: U128, b: U128): U128` | Alternative |
| `Uint128.mul(a: Uint<128>, b: Uint<128>): U256` | Kept |
| `Uint128.mul(a: U128, b: U128): U256` | Kept |
| `Uint128.mulChecked(a: Uint<128>, b: Uint<128>): Uint<128>` | Kept |
| `Uint128.mulChecked(a: U128, b: U128): Uint<128>` | Kept |
| `Uint128.div(a: Uint<128>, b: Uint<128>): Uint<128>` | Kept |
| `Uint128.div(a: U128, b: U128): U128` | Kept |
| `Uint128.rem(a: Uint<128>, b: Uint<128>): Uint<128>` | Kept |
| `Uint128.rem(a: U128, b: U128): U128` | Kept |
| `Uint128.divRem(a: Uint<128>, b: Uint<128>): DivResultU128` | Kept |
| `Uint128.divRem(a: U128, b: U128): DivResultU128` | Kept |
| `Uint128.sqrt(radicand: Uint<128>): Uint<64>` | Kept |
| `Uint128.sqrt(radicand: U128): Uint<64>` | Kept |
| `Uint128.isZero(a: Uint<128>): Boolean` | Deprecated |
| `Uint128.isZero(a: U128): Boolean` | Deprecated |
| `Uint128.isMultiple(a: Uint<128>, b: Uint<128>): Boolean` | Kept |
| `Uint128.isMultiple(a: U128, b: U128): Boolean` | Kept |
| `Uint128.min(a: Uint<128>, b: Uint<128>): Uint<128>` | Deprecated |
| `Uint128.min(a: U128, b: U128): U128` | Deprecated |
| `Uint128.max(a: Uint<128>, b: Uint<128>): Uint<128>` | Deprecated |
| `Uint128.max(a: U128, b: U128): U128` | Deprecated |
| `Uint256.ZERO_U256(): U256` | Deprecated |
| `Uint256.MAX_U256(): U256` | Kept |
| `Uint256.toBytes(value: U256): Bytes<32>` | Alternative |
| `Uint256.toUnpackedBytes(value: U256): Vector<32, Uint<8>>` | Alternative |
| `Uint256.eq(a: U256, b: U256): Boolean` | Deprecated |
| `Uint256.lt(a: U256, b: U256): Boolean` | Deprecated |
| `Uint256.lte(a: U256, b: U256): Boolean` | Deprecated |
| `Uint256.gt(a: U256, b: U256): Boolean` | Deprecated |
| `Uint256.gte(a: U256, b: U256): Boolean` | Deprecated |
| `Bytes32.pack(vec: Vector<32, Uint<8>>): Bytes<32>` | Deprecated |
| `Bytes32.unpack(bytes: Bytes<32>): Vector<32, Uint<8>>` | Alternative |
| `Bytes32.toU256(vec: Vector<32, Uint<8>>): U256` | Deprecated |
| `Bytes32.toU256(bytes: Bytes<32>): U256` | Alternative |
| `Bytes32.eq(a: Bytes<32>, b: Bytes<32>): Boolean` | Deprecated |
| `Bytes32.lt(a: Bytes<32>, b: Bytes<32>): Boolean` | Alternative |
| `Bytes32.lte(a: Bytes<32>, b: Bytes<32>): Boolean` | Alternative |
| `Bytes32.gt(a: Bytes<32>, b: Bytes<32>): Boolean` | Alternative |
| `Bytes32.gte(a: Bytes<32>, b: Bytes<32>): Boolean` | Alternative |
| `Bytes32.isZero(a: Bytes<32>): Boolean` | Deprecated |
| `Field255.MAX_FIELD(): Field` | Kept |
| `Field255.toBytes(value: Field): Bytes<32>` | Deprecated |
| `Field255.toU256(value: Field): U256` | Alternative |
| `Field255.eq(a: Field, b: Field): Boolean` | Deprecated |
| `Field255.lt(a: Field, b: Field): Boolean` | Alternative |
| `Field255.lte(a: Field, b: Field): Boolean` | Alternative |
| `Field255.gt(a: Field, b: Field): Boolean` | Alternative |
| `Field255.gte(a: Field, b: Field): Boolean` | Alternative |
| `Field255.isZero(a: Field): Boolean` | Deprecated |

The remaining public declarations map as follows.

| Source and target declaration | Type and visibility |
|---|---|
| `Types.U128` | Exported struct: `{ low: Uint<64>, high: Uint<64> }` |
| `Types.U256` | Exported struct: `{ low: U128, high: U128 }` |
| `Uint64.DivResultU64` | Exported struct: `{ quotient: Uint<64>, remainder: Uint<64> }` |
| `Uint128.DivResultU128` | Exported struct: `{ quotient: U128, remainder: U128 }` |
| `Pack.wit_unpackBytes` | Module-local witness, global generated key, `Bytes<N>` to `Vector<N, Uint<8>>` |
| `Uint64.wit_divUint64` | Module-local witness, global generated key, two `Uint<64>` inputs to `DivResultU64` |
| `Uint64.wit_sqrtUint64` | Module-local witness, global generated key, `Uint<64>` to `Uint<32>` |
| `Uint64.wit_uint64ToUnpackedBytes` | Module-local witness, global generated key, `Uint<64>` to `Vector<8, Uint<8>>` |
| `Uint128.wit_divU128` | Exported witness, two `U128` inputs to `DivResultU128` |
| `Uint128.wit_divUint128` | Exported witness, two `Uint<128>` inputs to `DivResultU128` |
| `Uint128.wit_sqrtU128` | Exported witness, `U128` to `Uint<64>` |

The named bound circuits remain in the circuit table.
The global witness names do not receive the Compact import prefix.

## Fixes

| Fix | Observable behavior and reference |
|---|---|
| BUG-1 | `Uint128.sub(U128)` uses a branchless borrow calculation. See [the source fix](https://github.com/OpenZeppelin/midnight-apps/pull/309) and [the subtraction tests](test/Uint128.zkir-shape.test.ts). |
| Audit L-06 | Multiplication uses seven splitter calls for the U128 form. A defensive `Uint128: unexpected multiplication overflow` assertion protects the final carry. See [the audit fix](https://github.com/OpenZeppelin/midnight-apps/pull/313) and [the tests](test/Uint128.test.ts). |
| Audit N-01 | The circuit titles and witness names match the declarations. See [the documentation fix](https://github.com/OpenZeppelin/midnight-apps/pull/312). |
| BUG-2 | A Uint64 division witness whose sum exceeds 64 bits fails with `Uint64: division invalid`. See [Uint64](Uint64.compact) and [its tests](test/Uint64.test.ts). |
| BUG-3 | A Uint128 witness quotient that passes the remainder check and whose product with `b` fits in 128 bits but exceeds the dividend fails with `Uint128: division invalid`. A product that does not fit in 128 bits fails earlier with `Uint128: division product overflow`. See [Uint128](Uint128.compact) and [its tests](test/Uint128.test.ts). |
| BUG-6 | The scalar remainder tests override the actual `wit_divU128` call. Separate conversion tests check `wit_divUint128`. See [the tests](test/Uint128.test.ts). |
| BUG-4 | The [math guide](README.md#supply-the-witnesses) gives the generated witness names and reachable dependencies. |
| BUG-5 | The [consumer example](test/mocks/MockMathConsumer.compact) uses valid overloads and result widths. Its TypeScript witness object matches the generated type. |
| Documentation section 8.2 | The guide gives the direct import graph, supported structs, widened arithmetic, current witness names, failure requirements, and measured backend costs. |

For an honest witness, the arithmetic fixes preserve the result and the caller's failure messages.
The BUG-2 and BUG-3 failure changes apply to incorrect witness outputs.

## Native addition and witness interfaces

Both `Uint128.addChecked` overloads compute the sum with native addition. Compared with the source library:

- Both declarations are `pure circuit`.
- Both forms return the same checked `Uint<128>` result.
- Overflow still fails with `Uint128: addition overflow`.
- The scalar form makes no `wit_divUint128` call (four in the source). The U128 form makes none (two in the source).
- An incorrect `wit_divUint128` result can no longer make these forms fail with `Uint128: conversion invalid`.
- The result has no splitter witness taint.
- A consumer that uses only these forms has an empty generated `Witnesses` type.
- A consumer that calls other witness circuits still supplies their reachable witnesses.

No other behavior changes. Every honest input keeps its result and its failure message.
Every witness call that remains must still reject an incorrect result.
An override for a removed witness is not executed and is not a forgery test for the native expression.

For a nonempty `Witnesses<PrivateState>` type, TypeScript rejects unknown keys on a directly typed object literal.
An empty generated witness type is `{}`. That type permits extra keys.
After a witness-set reduction, remove unused keys from the object even when TypeScript accepts them.
Destructure the required functions and use `satisfies Witnesses<PrivateState>`, as in the consumer example.
Do not change the witness names that remain reachable.

## Deprecated circuits

A circuit is deprecated when a native expression gives the same result for every input, the circuit has no library-specific failure message, and the native expression costs no more v3 rows at compiler 0.34.0.
Native expressions include composed casts, arithmetic, and ternary expressions.
There are 38 deprecated declarations, 26 declarations with documented native alternatives, and 30 kept declarations.
The following native expressions use the arguments in each signature.

| Deprecated declaration | Native replacement |
|---|---|
| `Pack.pack(vec: Vector<N, Uint<8>>): Bytes<N>` | `vec as Bytes<N>` |
| `Bytes8.pack(vec: Vector<8, Uint<8>>): Bytes<8>` | `vec as Bytes<8>` |
| `Bytes8.toUint64(vec: Vector<8, Uint<8>>): Uint<64>` | `vec[0] + vec[1] * 0x100 + vec[2] * 0x10000 + vec[3] * 0x1000000 + vec[4] * 0x100000000 + vec[5] * 0x10000000000 + vec[6] * 0x1000000000000 + vec[7] * 0x100000000000000` |
| `Uint64.add(a: Uint<64>, b: Uint<64>): Uint<128>` | `a + b` |
| `Uint64.mul(a: Uint<64>, b: Uint<64>): Uint<128>` | `a * b` |
| `Uint64.min(a: Uint<64>, b: Uint<64>): Uint<64>` | `a < b ? a : b` |
| `Uint64.max(a: Uint<64>, b: Uint<64>): Uint<64>` | `a > b ? a : b` |
| `Uint128.ZERO_U128(): U128` | `default<U128>` |
| `Uint128.toUint128(value: U128): Uint<128>` | `((value.high * 0x10000000000000000 + value.low) as Uint<128>)` |
| `Uint128.eq(a: Uint<128>, b: Uint<128>): Boolean` | `a == b` |
| `Uint128.eq(a: U128, b: U128): Boolean` | `a == b` |
| `Uint128.lt(a: Uint<128>, b: Uint<128>): Boolean` | `a < b` |
| `Uint128.lte(a: Uint<128>, b: Uint<128>): Boolean` | `a <= b` |
| `Uint128.lt(a: U128, b: U128): Boolean` | `((a.high * 0x10000000000000000 + a.low) as Uint<128>) < ((b.high * 0x10000000000000000 + b.low) as Uint<128>)` |
| `Uint128.lte(a: U128, b: U128): Boolean` | `((a.high * 0x10000000000000000 + a.low) as Uint<128>) <= ((b.high * 0x10000000000000000 + b.low) as Uint<128>)` |
| `Uint128.gt(a: Uint<128>, b: Uint<128>): Boolean` | `a > b` |
| `Uint128.gte(a: Uint<128>, b: Uint<128>): Boolean` | `a >= b` |
| `Uint128.gt(a: U128, b: U128): Boolean` | `((a.high * 0x10000000000000000 + a.low) as Uint<128>) > ((b.high * 0x10000000000000000 + b.low) as Uint<128>)` |
| `Uint128.gte(a: U128, b: U128): Boolean` | `((a.high * 0x10000000000000000 + a.low) as Uint<128>) >= ((b.high * 0x10000000000000000 + b.low) as Uint<128>)` |
| `Uint128.isZero(a: Uint<128>): Boolean` | `a == default<Uint<128>>` |
| `Uint128.isZero(a: U128): Boolean` | `a == default<U128>` |
| `Uint128.min(a: Uint<128>, b: Uint<128>): Uint<128>` | `a <= b ? a : b` |
| `Uint128.min(a: U128, b: U128): U128` | `((a.high * 0x10000000000000000 + a.low) as Uint<128>) <= ((b.high * 0x10000000000000000 + b.low) as Uint<128>) ? a : b` |
| `Uint128.max(a: Uint<128>, b: Uint<128>): Uint<128>` | `a >= b ? a : b` |
| `Uint128.max(a: U128, b: U128): U128` | `((a.high * 0x10000000000000000 + a.low) as Uint<128>) >= ((b.high * 0x10000000000000000 + b.low) as Uint<128>) ? a : b` |
| `Uint256.ZERO_U256(): U256` | `default<U256>` |
| `Uint256.eq(a: U256, b: U256): Boolean` | `(a.high.low == b.high.low && a.high.high == b.high.high) && (a.low.low == b.low.low && a.low.high == b.low.high)` |
| `Uint256.lt(a: U256, b: U256): Boolean` | `(((a.high.high * 0x10000000000000000 + a.high.low) as Uint<128>) < ((b.high.high * 0x10000000000000000 + b.high.low) as Uint<128>) \|\| (a.high == b.high && ((a.low.high * 0x10000000000000000 + a.low.low) as Uint<128>) < ((b.low.high * 0x10000000000000000 + b.low.low) as Uint<128>)))` |
| `Uint256.lte(a: U256, b: U256): Boolean` | `!(((b.high.high * 0x10000000000000000 + b.high.low) as Uint<128>) < ((a.high.high * 0x10000000000000000 + a.high.low) as Uint<128>) \|\| (b.high == a.high && ((b.low.high * 0x10000000000000000 + b.low.low) as Uint<128>) < ((a.low.high * 0x10000000000000000 + a.low.low) as Uint<128>)))` |
| `Uint256.gt(a: U256, b: U256): Boolean` | `(((b.high.high * 0x10000000000000000 + b.high.low) as Uint<128>) < ((a.high.high * 0x10000000000000000 + a.high.low) as Uint<128>) \|\| (b.high == a.high && ((b.low.high * 0x10000000000000000 + b.low.low) as Uint<128>) < ((a.low.high * 0x10000000000000000 + a.low.low) as Uint<128>)))` |
| `Uint256.gte(a: U256, b: U256): Boolean` | `!(((a.high.high * 0x10000000000000000 + a.high.low) as Uint<128>) < ((b.high.high * 0x10000000000000000 + b.high.low) as Uint<128>) \|\| (a.high == b.high && ((a.low.high * 0x10000000000000000 + a.low.low) as Uint<128>) < ((b.low.high * 0x10000000000000000 + b.low.low) as Uint<128>)))` |
| `Bytes32.pack(vec: Vector<32, Uint<8>>): Bytes<32>` | `vec as Bytes<32>` |
| `Bytes32.toU256(vec: Vector<32, Uint<8>>): U256` | `U256 { low: U128 { low: vec[0] + vec[1] * 0x100 + vec[2] * 0x10000 + vec[3] * 0x1000000 + vec[4] * 0x100000000 + vec[5] * 0x10000000000 + vec[6] * 0x1000000000000 + vec[7] * 0x100000000000000, high: vec[8] + vec[9] * 0x100 + vec[10] * 0x10000 + vec[11] * 0x1000000 + vec[12] * 0x100000000 + vec[13] * 0x10000000000 + vec[14] * 0x1000000000000 + vec[15] * 0x100000000000000 }, high: U128 { low: vec[16] + vec[17] * 0x100 + vec[18] * 0x10000 + vec[19] * 0x1000000 + vec[20] * 0x100000000 + vec[21] * 0x10000000000 + vec[22] * 0x1000000000000 + vec[23] * 0x100000000000000, high: vec[24] + vec[25] * 0x100 + vec[26] * 0x10000 + vec[27] * 0x1000000 + vec[28] * 0x100000000 + vec[29] * 0x10000000000 + vec[30] * 0x1000000000000 + vec[31] * 0x100000000000000 } }` |
| `Bytes32.eq(a: Bytes<32>, b: Bytes<32>): Boolean` | `a == b` |
| `Bytes32.isZero(a: Bytes<32>): Boolean` | `a == default<Bytes<32>>` |
| `Field255.toBytes(value: Field): Bytes<32>` | `value as Bytes<32>` |
| `Field255.eq(a: Field, b: Field): Boolean` | `a == b` |
| `Field255.isZero(a: Field): Boolean` | `a == default<Field>` |

`Uint64.add` has an inferred native range of 65 bits. Its result is assignable to `Uint<128>`.
The U128 recomposition fits within 128 bits because each limb is at most `2^64 - 1`.
The U256 expressions compare the high half first and then the low half.
`Pack.pack` has the same cast identity for each supported N; measurements cover N = 8, 16 and 32.

## Retained alternatives

Use the [native alternatives table](README.md#native-alternatives) for exact expressions and both backend costs for all 26 retained alternatives.
`Bytes8.toUint64(Bytes<8>)` retains `Pack: unpack verification failed` and the `wit_unpackBytes` dependency.
`Uint64.toBytes` retains `Uint64: toUnpackedBytes verification failed` and the `wit_uint64ToUnpackedBytes` dependency.
Their native casts give equal honest values but have no corresponding witness checks or witness taint.
The same inherited-message rule applies to unpack, limb splitting, and composed conversion or comparison paths.

The vector forms of `Bytes8.toUint64` and `Bytes32.toU256` are deprecated in favor of weighted byte sums. Each sum fits in `Uint<64>`.
`Uint256.eq` is deprecated in favor of a comparison of the four limbs.
These three expressions compile to the same rows as the library circuits on both backends. The cast compositions and the direct `a == b` cost more v3 rows.
The minimum, maximum, and U128-to-Uint128 forms in the mapping table pass the cost rule above and are deprecated.

`Uint64.addChecked`, `Uint64.sub`, `Uint64.mulChecked`, and scalar `Uint128.sub` retain their library messages around native arithmetic.
Both `Uint128.addChecked` forms keep their overflow message with native addition (see above).
`Utils.UINT128_MAX` remains available with `Uint128.MAX_UINT128` as its math alternative.

## SDK and test integration

The source uses compiler 0.28.0 and runtime 0.14.0.
The target pins compiler 0.34.0 and runtime 0.19.0.
Use the target pragma `>= 0.26.0` and relative Compact imports without the `.compact` suffix.
Use `await Simulator.create()` and await every circuit call with `@openzeppelin/compact-simulator`.
The generated impure circuit API and `initialState` return promises.
Use async rejection assertions. Runtime type-error text can differ between runtime releases.
Keep assertions on library messages when the message is part of the API.

Compiler 0.35.0 targets language 0.27.0 and runtime 0.20.0.
The source research compiles the math modules on both supported ZKIR backends with 0.35.0.
This does not establish that the full simulator stack supports runtime 0.20.0.
Runtime 0.20.0 changes `createCircuitContext` from positional arguments to an options object.
Simulator 0.4.1 uses the positional interface. A repository-wide SDK upgrade needs a compatible simulator and a complete validation run.
See the [0.35.0 release notes](https://github.com/midnightntwrk/compact/releases/tag/compactc-v0.35.0).

The unreleased compiler main revision `39a2dfb` removes ZKIR v2 and rejects `--feature-zkir-v3`.
Keep the flag for the pinned 0.34.0 v3 build and the 0.35.0 check.
Remove the flag when upgrading to a compiler that requires its removal.
See the [compiler changelog at that revision](https://github.com/LFDT-Minokawa/compact/blob/39a2dfb/CHANGELOG.md).

Midnight.js 5.0.0-rc.4 deprecates `@midnight-ntwrk/midnight-js-network-id` in favor of `MidnightConfig`.
The math modules do not require this package.
The target's live harness still uses `setNetworkId`; update that harness as part of the separate SDK upgrade.
See the [Midnight.js release notes](https://github.com/midnightntwrk/midnight-js/releases/tag/v5.0.0-rc.4).

## Consumer checklist

1. Pin compatible compiler, runtime, ledger, and proof-server versions.
2. Change the module imports to the target package path.
3. Keep overload argument types consistent. Convert both operands when selecting a struct or scalar overload.
4. Read the generated consumer `Witnesses` type and supply every required key.
5. Add `disclose()` at each intended public boundary for witness-derived results.
6. Check the deprecated expression and its result type before replacing a call.
7. Keep the library form when a caller depends on its failure messages.
8. Compile the consumer and generate fresh keys for its compiler and backend.
9. Run consumer tests for boundary inputs, incorrect witnesses, and public-state updates.
