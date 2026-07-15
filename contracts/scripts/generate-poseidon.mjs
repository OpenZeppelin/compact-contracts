// SPDX-License-Identifier: MIT
// Generates contracts/src/crypto/Poseidon.compact from the official Poseidon
// reference instantiation.
//
// Reference: Grassi, Khovratovich, Rechberger, Roy, Schofnegger,
// "Poseidon: A New Hash Function for Zero-Knowledge Proof Systems"
// (USENIX Security 2021), reference repository
// https://extgit.iaik.tugraz.at/krypto/hadeshash, instance file
// code/poseidonperm_x5_255_3.sage (x^5 S-box, 255-bit prime = BLS12-381
// scalar field, t = 3, R_F = 8, R_P = 57).
//
// Usage (from contracts/):
//   node scripts/generate-poseidon.mjs [path-to-poseidonperm_x5_255_3.sage]
// The reference file defaults to the vendored copy in scripts/vendor/.
//
// The script asserts the reference file's sha256 and re-computes the
// permutation over BigInt, checking the official test vector
// (perm(0, 1, 2), published in the reference repository's
// code/test_vectors.txt) BEFORE emitting any Compact source, so a wrong or
// tampered input file can never produce a module.
//
// COMPILER WORKAROUND (compactc 0.31.1): chained constant-coefficient linear
// layers (the MDS mix) blow up the compiler front-end exponentially. The
// emitted module therefore routes every round's state through a witness hint
// pinned by asserts (`materialize`), which keeps each round's expressions
// over opaque wires. Soundness is unaffected (the asserts force the hint to
// equal the computed state); a wrong hint implementation can only make
// proving fail, never forge. Minimal repros: compact-bug-report/ (repo root).

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REFERENCE_SHA256 =
  'a1d6378253fd87a2b7dc5c40a870723462fb7f624487cd62acd96d6d49e33ea1';

// BLS12-381 scalar field modulus (Compact's Field).
const P = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

const T = 3;
const R_FULL = 8;
const R_PARTIAL = 57;

// Official test vector for poseidonperm_x5_255_3 (hadeshash
// code/test_vectors.txt): perm(0, 1, 2).
const TEST_VECTOR_OUTPUT = [
  0x28ce19420fc246a05553ad1e8c98f5c9d67166be2c18e9e4cb4b4e317dd2a78an,
  0x51f3e312c95343a896cfd8945ea82ba956c1118ce9b9859b6ea56637b4b1ddc4n,
  0x3b2b69139b235626a0bfb56c9527ae66a7bf486ad8c11c14d1da0c69bbe0f79an,
];

const scriptDir = dirname(fileURLToPath(import.meta.url));
const inputPath =
  process.argv[2] ?? join(scriptDir, 'vendor', 'poseidonperm_x5_255_3.sage');

const source = readFileSync(inputPath);
const digest = createHash('sha256').update(source).digest('hex');
if (digest !== REFERENCE_SHA256) {
  throw new Error(
    `reference file sha256 mismatch: got ${digest}, expected ${REFERENCE_SHA256}`,
  );
}
const text = source.toString('utf8');

const parseHexList = (snippet) =>
  [...snippet.matchAll(/'0x([0-9a-fA-F]+)'/g)].map((m) => BigInt(`0x${m[1]}`));

const roundConstantsSrc = text.match(/round_constants = \[([\s\S]*?)\]\n/);
const mdsSrc = text.match(/MDS_matrix = \[([\s\S]*?)\]\n/);
if (!roundConstantsSrc || !mdsSrc)
  throw new Error('failed to locate constants in reference file');

const roundConstants = parseHexList(roundConstantsSrc[1]);
const mdsFlat = parseHexList(mdsSrc[1]);
if (roundConstants.length !== (R_FULL + R_PARTIAL) * T) {
  throw new Error(
    `expected ${(R_FULL + R_PARTIAL) * T} round constants, got ${roundConstants.length}`,
  );
}
if (mdsFlat.length !== T * T)
  throw new Error(`expected ${T * T} MDS entries, got ${mdsFlat.length}`);
for (const c of [...roundConstants, ...mdsFlat]) {
  if (c < 0n || c >= P) throw new Error('constant out of field range');
}
const mds = [mdsFlat.slice(0, 3), mdsFlat.slice(3, 6), mdsFlat.slice(6, 9)];

// --- Reference permutation over BigInt (mirrors the sage code exactly) ----

const sbox = (x) => {
  const x2 = (x * x) % P;
  const x4 = (x2 * x2) % P;
  return (x4 * x) % P;
};

const applyMds = (s) =>
  mds.map((row) => row.reduce((acc, m, j) => (acc + m * s[j]) % P, 0n));

const permute = (input) => {
  let s = [...input];
  let rc = 0;
  const halfFull = R_FULL / 2;
  for (let r = 0; r < halfFull; r++) {
    s = s.map((x) => (x + roundConstants[rc++]) % P);
    s = s.map(sbox);
    s = applyMds(s);
  }
  for (let r = 0; r < R_PARTIAL; r++) {
    s = s.map((x) => (x + roundConstants[rc++]) % P);
    s[0] = sbox(s[0]);
    s = applyMds(s);
  }
  for (let r = 0; r < halfFull; r++) {
    s = s.map((x) => (x + roundConstants[rc++]) % P);
    s = s.map(sbox);
    s = applyMds(s);
  }
  return s;
};

const got = permute([0n, 1n, 2n]);
for (let i = 0; i < T; i++) {
  if (got[i] !== TEST_VECTOR_OUTPUT[i]) {
    throw new Error(
      `test vector mismatch at lane ${i}: got 0x${got[i].toString(16)}`,
    );
  }
}
console.log(
  'reference test vector verified: perm(0, 1, 2) matches hadeshash test_vectors.txt',
);

// --- Emit Compact source ---------------------------------------------------

const lit = (v) => `(${v.toString(10)} as Field)`;

const roundCall = (kind, index, r) => {
  const c = roundConstants.slice(3 * r, 3 * r + 3);
  return `    const s${index + 1} = ${kind}(s${index}, ${lit(c[0])}, ${lit(c[1])}, ${lit(c[2])});`;
};

const rounds = [];
let r = 0;
for (let i = 0; i < R_FULL / 2; i++, r++)
  rounds.push(roundCall('fullRound', r, r));
for (let i = 0; i < R_PARTIAL; i++, r++)
  rounds.push(roundCall('partialRound', r, r));
for (let i = 0; i < R_FULL / 2; i++, r++)
  rounds.push(roundCall('fullRound', r, r));

const compact = `// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts (crypto/Poseidon.compact)
// GENERATED FILE - do not edit by hand. Regenerate with
// \`node scripts/generate-poseidon.mjs\` (see that script for the pinned
// reference input); the generator verifies the official test vector before
// emitting this file.

pragma language_version >= 0.23.0;

/**
 * @module Poseidon
 * @description EXPLORATORY: the Poseidon permutation and fixed-length hashes
 * over Compact's native \`Field\` (the BLS12-381 scalar field), implemented in
 * pure field arithmetic.
 *
 * WHY: an upgrade-stable, circuit-efficient hash. \`persistentHash\` (SHA-256)
 * is upgrade-stable but costs thousands of constraint rows per call;
 * \`transientHash\` is cheap but explicitly NOT guaranteed stable across
 * platform upgrades, so nothing long-lived may depend on it. This module's
 * algorithm and constants are pinned in source, so its outputs can never
 * change under us: the only dependency is \`Field\` arithmetic itself, which
 * cannot change without invalidating every Field-typed ledger value on the
 * platform. Precedent: the circom ecosystem (Tornado Cash, Semaphore) has run
 * userland Poseidon/MiMC with pinned constants in production for years for
 * exactly this reason.
 *
 * REFERENCE: Grassi, Khovratovich, Rechberger, Roy, Schofnegger — "Poseidon:
 * A New Hash Function for Zero-Knowledge Proof Systems", USENIX Security
 * 2021. Instantiation \`poseidonperm_x5_255_3\` from the authors' reference
 * repository (https://extgit.iaik.tugraz.at/krypto/hadeshash): x^5 S-box,
 * p = BLS12-381 scalar modulus, state width t = 3, R_F = 8 full rounds,
 * R_P = 57 partial rounds, Grain-LFSR round constants and Cauchy MDS matrix
 * taken from that file byte-for-byte (sha256
 * ${REFERENCE_SHA256}).
 *
 * TEST VECTOR (hadeshash code/test_vectors.txt):
 *   permute(0, 1, 2) =
 *     (0x28ce19420fc246a05553ad1e8c98f5c9d67166be2c18e9e4cb4b4e317dd2a78a,
 *      0x51f3e312c95343a896cfd8945ea82ba956c1118ce9b9859b6ea56637b4b1ddc4,
 *      0x3b2b69139b235626a0bfb56c9527ae66a7bf486ad8c11c14d1da0c69bbe0f79a)
 *
 * SPONGE (module-owned convention): \`hash2\`/\`hash4\` run a sponge with
 * capacity lane \`s0\` and rate lanes \`s1, s2\`. The capacity is initialized
 * with the input arity as a domain tag (2 for \`hash2\`, 4 for \`hash4\`), so
 * different arities can never collide; blocks of two field elements are
 * absorbed by field addition into the rate lanes with one permutation per
 * block; the output is squeezed from rate lane \`s1\`. Security rests on the
 * standard sponge argument over the Poseidon permutation with capacity
 * c = 1 field element (~127-bit collision resistance).
 *
 * @dev COMPILER WORKAROUND — \`wit_wire\`. compactc 0.31.1's front end blows
 * up exponentially on chained constant-coefficient linear layers (the MDS
 * mix): 8 chained rounds compile in seconds, 16 need minutes, 65 never
 * finish. Every round therefore routes its state through the \`wit_wire\`
 * witness hint, pinned by asserts in \`materialize\`, so each round's
 * expressions reference only opaque witness wires and the blowup cannot
 * occur. Consequences:
 *
 * - The circuits are witness-bearing, hence NOT \`pure\`. Off-chain
 *   recomputation uses the TS reference implementation instead (see the
 *   generator script).
 * - Every consuming contract must implement the witness as the identity:
 *   \`Poseidon_wit_wire: (ctx, s) => [ctx.privateState, s]\`.
 * - Soundness does NOT depend on the witness: the asserts force
 *   \`wit_wire(s) == s\`, so a wrong implementation only fails proving.
 * - The hint costs 3 asserts per round (~200 extra rows per permutation).
 *
 * Remove the workaround (restore plain \`mds\` results and \`pure\`) once the
 * compiler handles chained linear layers.
 *
 * @dev NOT audited, NOT production.
 */
module Poseidon {
  import CompactStandardLibrary;

  // Permutation state: capacity lane s0, rate lanes s1 and s2.
  export struct PoseidonState {
    s0: Field;
    s1: Field;
    s2: Field;
  }

  // Compiler-workaround hint (see module doc). MUST be implemented as the
  // identity; enforced in-circuit by materialize().
  witness wit_wire(s: PoseidonState): PoseidonState;

  // Pins the hint to the computed state and returns the (opaque) hint wires.
  circuit materialize(s: PoseidonState): PoseidonState {
    const h = wit_wire(s);
    assert(h.s0 == s.s0, "Poseidon: wire hint mismatch");
    assert(h.s1 == s.s1, "Poseidon: wire hint mismatch");
    assert(h.s2 == s.s2, "Poseidon: wire hint mismatch");
    return h;
  }

  // x^5 S-box (three field multiplications).
  circuit sbox(x: Field): Field {
    const x2 = x * x;
    const x4 = x2 * x2;
    return x4 * x;
  }

  // MDS mix: state' = M * state, with the reference Cauchy matrix inlined.
  circuit mds(s: PoseidonState): PoseidonState {
    return PoseidonState {
      s0: ${lit(mds[0][0])} * s.s0
        + ${lit(mds[0][1])} * s.s1
        + ${lit(mds[0][2])} * s.s2,
      s1: ${lit(mds[1][0])} * s.s0
        + ${lit(mds[1][1])} * s.s1
        + ${lit(mds[1][2])} * s.s2,
      s2: ${lit(mds[2][0])} * s.s0
        + ${lit(mds[2][1])} * s.s1
        + ${lit(mds[2][2])} * s.s2
    };
  }

  // Full round: add round constants, S-box every lane, mix, materialize.
  circuit fullRound(s: PoseidonState, c0: Field, c1: Field, c2: Field): PoseidonState {
    return materialize(mds(PoseidonState {
      s0: sbox(s.s0 + c0),
      s1: sbox(s.s1 + c1),
      s2: sbox(s.s2 + c2)
    }));
  }

  // Partial round: add round constants, S-box lane 0 only, mix, materialize.
  circuit partialRound(s: PoseidonState, c0: Field, c1: Field, c2: Field): PoseidonState {
    return materialize(mds(PoseidonState {
      s0: sbox(s.s0 + c0),
      s1: s.s1 + c1,
      s2: s.s2 + c2
    }));
  }

  /**
   * @description The raw Poseidon permutation (reference instantiation; see
   * the module doc for parameters and test vector). Prefer \`hash2\`/\`hash4\`
   * unless you are building your own sponge mode.
   */
  export circuit permute(state: PoseidonState): PoseidonState {
    const s0 = state;
${rounds.join('\n')}
    return s${r};
  }

  /**
   * @description Hashes two field elements (one permutation). Sponge with
   * arity tag 2 in the capacity lane; see the module doc.
   */
  export circuit hash2(a: Field, b: Field): Field {
    const out = permute(PoseidonState { s0: 2 as Field, s1: a, s2: b });
    return out.s1;
  }

  /**
   * @description Hashes four field elements (two permutations). Sponge with
   * arity tag 4 in the capacity lane; see the module doc.
   */
  export circuit hash4(a: Field, b: Field, c: Field, d: Field): Field {
    const first = permute(PoseidonState { s0: 4 as Field, s1: a, s2: b });
    const out = permute(PoseidonState {
      s0: first.s0,
      s1: first.s1 + c,
      s2: first.s2 + d
    });
    return out.s1;
  }
}
`;

const outPath = join(scriptDir, '..', 'src', 'crypto', 'Poseidon.compact');
writeFileSync(outPath, compact);
console.log(`wrote ${outPath}`);
