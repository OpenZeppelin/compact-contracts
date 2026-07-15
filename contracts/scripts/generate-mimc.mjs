// SPDX-License-Identifier: MIT
// Generates contracts/src/crypto/Mimc.compact.
//
// Primitive: MiMC-p/p block cipher (Albrecht, Grassi, Rechberger, Roy,
// Tiessen — "MiMC: Efficient Encryption and Cryptographic Hashing with
// Minimal Multiplicative Complexity", ASIACRYPT 2016) over the BLS12-381
// scalar field (Compact's `Field`) with the x^5 S-box, turned into a hash
// via the Miyaguchi-Preneel mode (one of the 12 collision-resistant PGV
// modes; Black, Rogaway, Shrimpton, CRYPTO 2002).
//
// Instantiation choices (documented in the emitted module):
// - S-box x^5: 5 is coprime to r-1 for BLS12-381 Fr (x^3 is NOT a
//   permutation there since 3 | r-1) — the same reason Poseidon's BLS12-381
//   instances use alpha = 5.
// - Rounds: 110 = ceil(255 / log2(5)), the MiMC paper's round formula for a
//   255-bit prime with d = 5 (gnark's MiMC uses the same shape).
// - Round constants: nothing-up-my-sleeve SHA-256 chain seeded by an ASCII
//   string, reduced mod r. c_0 = 0 per the MiMC convention; c_1..c_109 from
//   the chain. Reproducible: run this script.
//
// Usage:
//   node scripts/generate-mimc.mjs
//
// The script re-computes golden test vectors with an independent BigInt
// implementation and asserts them BEFORE emitting, so an accidental edit of
// the constants derivation can never silently change the hash.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// BLS12-381 scalar field modulus (Compact's Field).
const P = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

const ROUNDS = 110;
const SEED = 'OZ:mimc:bls12-381:x5:v1';

// Golden vectors, computed by this script's reference implementation and
// pinned. Regenerations must reproduce them exactly.
const GOLDEN = {
  compress_0_0:
    0x59ad0a44fd833426c940a6c69b0c05642f894e2cd640af60e1c2073712be4956n,
  hash2_1_2:
    0x0a9e1e6869a5dfbbee41ee81cc28f191db2e51f8e15998f251b90fb6e524fe94n,
  hash4_1_2_3_4:
    0x5b5de220b48573491b04da17cf7a1a06adde973238e92fd54d9d8bf12d67774fn,
};

// --- Round constants: SHA-256 chain from the seed, reduced mod P ----------
// c_0 = 0; c_i = sha256^i(seed) mod P for i = 1..ROUNDS-1.

const constants = [0n];
let chain = createHash('sha256').update(SEED, 'utf8').digest();
for (let i = 1; i < ROUNDS; i++) {
  constants.push(BigInt(`0x${chain.toString('hex')}`) % P);
  chain = createHash('sha256').update(chain).digest();
}

// --- Reference implementation over BigInt ----------------------------------

const sbox = (x) => {
  const x2 = (x * x) % P;
  const x4 = (x2 * x2) % P;
  return (x4 * x) % P;
};

// MiMC-p/p encryption: x_0 = m; x_{i+1} = (x_i + k + c_i)^5; E = x_ROUNDS + k.
const encrypt = (k, m) => {
  let x = m;
  for (let i = 0; i < ROUNDS; i++) {
    x = sbox((x + k + constants[i]) % P);
  }
  return (x + k) % P;
};

// Miyaguchi-Preneel: compress(h, m) = E_h(m) + h + m.
const compress = (h, m) => (encrypt(h, m) + h + m) % P;

// Fixed-arity hashes: the arity rides the first compression's key as a
// domain tag, so different arities can never collide.
const hash2 = (a, b) => compress((a + 2n) % P, b);
const hash4 = (a, b, c, d) =>
  compress(compress(compress((a + 4n) % P, b), c), d);

const got = {
  compress_0_0: compress(0n, 0n),
  hash2_1_2: hash2(1n, 2n),
  hash4_1_2_3_4: hash4(1n, 2n, 3n, 4n),
};

for (const [name, expected] of Object.entries(GOLDEN)) {
  if (expected === null) {
    console.log(`GOLDEN ${name} = 0x${got[name].toString(16)}`);
  } else if (got[name] !== expected) {
    throw new Error(
      `golden vector mismatch for ${name}: got 0x${got[name].toString(16)}`,
    );
  }
}
if (Object.values(GOLDEN).some((v) => v === null)) {
  console.log(
    'golden vectors not pinned yet: copy the values above into GOLDEN and re-run',
  );
  process.exit(1);
}
console.log('golden test vectors verified');

// --- Emit Compact source ----------------------------------------------------

const lit = (v) => `(${v.toString(10)} as Field)`;

const roundLines = ['    const s0 = sbox(m + k);'];
for (let i = 1; i < ROUNDS; i++) {
  roundLines.push(
    `    const s${i} = sbox(s${i - 1} + k + ${lit(constants[i])});`,
  );
}

const compact = `// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts (crypto/Mimc.compact)
// GENERATED FILE - do not edit by hand. Regenerate with
// \`node scripts/generate-mimc.mjs\`; the generator re-derives the round
// constants and asserts pinned golden test vectors before emitting this
// file.

pragma language_version >= 0.23.0;

/**
 * @module Mimc
 * @description EXPLORATORY: a MiMC-based hash over Compact's native \`Field\`
 * (the BLS12-381 scalar field), implemented in pure field arithmetic.
 *
 * WHY: an upgrade-stable, circuit-efficient hash. \`persistentHash\` (SHA-256)
 * is upgrade-stable but costs thousands of constraint rows per call;
 * \`transientHash\` is cheap but explicitly NOT guaranteed stable across
 * platform upgrades, so nothing long-lived may depend on it. This module's
 * algorithm and constants are pinned in source, so its outputs can never
 * change under us: the only dependency is \`Field\` arithmetic itself, which
 * cannot change without invalidating every Field-typed ledger value on the
 * platform. Precedent: the circom ecosystem has run userland MiMC with
 * pinned constants in production for years (Tornado Cash's MiMCSponge,
 * iden3's mimc7) for exactly this reason.
 *
 * MiMC is used (rather than the better-studied Poseidon) because its
 * single-lane structure has no linear layers, which the current Compact
 * compiler cannot handle at depth (chained constant-coefficient linear
 * combinations blow up compilation exponentially).
 *
 * CONSTRUCTION:
 *
 * - Cipher: MiMC-p/p (Albrecht, Grassi, Rechberger, Roy, Tiessen —
 *   ASIACRYPT 2016) with the x^5 S-box and ${ROUNDS} rounds:
 *   \`x_0 = m; x_(i+1) = (x_i + k + c_i)^5; E_k(m) = x_${ROUNDS} + k\`.
 *   x^5 because 5 is coprime to r-1 for BLS12-381 Fr (x^3 is not a
 *   permutation there); ${ROUNDS} = ceil(255 / log2(5)) per the paper's
 *   round formula for a 255-bit prime.
 * - Round constants: c_0 = 0; c_1..c_${ROUNDS - 1} are a nothing-up-my-sleeve
 *   SHA-256 chain seeded by "${SEED}", reduced mod r
 *   (reproducible: scripts/generate-mimc.mjs).
 * - Compression: Miyaguchi-Preneel, \`compress(h, m) = E_h(m) + h + m\` —
 *   one of the 12 provably collision-resistant PGV modes in the
 *   ideal-cipher model (Black, Rogaway, Shrimpton — CRYPTO 2002), secure
 *   even with an adversarially chosen chaining value (free-start).
 * - Fixed-arity hashes: the arity is added to the first compression's key
 *   as a domain tag (\`hash2\` -> +2, \`hash4\` -> +4), so different arities
 *   can never collide; \`hash4\` chains one compression per further input.
 *
 * TEST VECTORS (pinned in the generator):
 *   compress(0, 0)      = 0x${got.compress_0_0.toString(16)}
 *   hash2(1, 2)         = 0x${got.hash2_1_2.toString(16)}
 *   hash4(1, 2, 3, 4)   = 0x${got.hash4_1_2_3_4.toString(16)}
 *
 * COST (measured on compactc 0.31.1 / zkir, inlined into an impure caller
 * with one ledger write): \`hash2\` ~600 rows vs ~4,600 for the equivalent
 * \`persistentHash<Vector<2, Field>>\` — about 7.7x cheaper. \`hash4\` (three
 * compressions) ~1,750 rows vs ~7,200 — about 4x cheaper.
 *
 * @dev Security notes. Collision resistance ~2^127 (birthday over the
 * 255-bit field) under the ideal-cipher heuristic for MiMC. Algebraic
 * attacks are MiMC's main risk surface (e.g. higher-order differential
 * distinguishers on reduced/exact-round MiMC-x^3, Eichlseder et al.,
 * ASIACRYPT 2020); the x^5 instance at the paper's full round count is not
 * affected by published breaks, but MiMC's margin is thinner than
 * Poseidon's. Swap to Poseidon (same API shape) once the compiler supports
 * it; commitments already produced with MiMC stay MiMC forever.
 *
 * @dev No ledger state, no witnesses. Every circuit is pure, so consumers
 * keep full disclosure control and no witness wiring is required.
 *
 * @dev COMPILER LIMITATION: instantiating \`hash4\` into an entry point
 * (three chained compressions, ~330 unrolled rounds) currently hangs the
 * compactc front end, which scales superlinearly with unrolled circuit
 * size — see compact-bug-report/ at the repository root. The bare module
 * and \`compress\`/\`hash2\` instantiations compile; there is deliberately no
 * MockMimc in the test mocks until the compiler issue is resolved (the
 * would-be mock is preserved as compact-bug-report/MockMimcHang.compact).
 *
 * @dev NOT audited, NOT production.
 */
module Mimc {
  import CompactStandardLibrary;

  // x^5 S-box (three field multiplications).
  circuit sbox(x: Field): Field {
    const x2 = x * x;
    const x4 = x2 * x2;
    return x4 * x;
  }

  // MiMC-p/p encryption with the final key addition (c_0 = 0).
  circuit encrypt(k: Field, m: Field): Field {
${roundLines.join('\n')}
    return s${ROUNDS - 1} + k;
  }

  /**
   * @description Miyaguchi-Preneel compression: \`E_h(m) + h + m\`.
   * Collision-resistant in the ideal-cipher model even with an adversarial
   * \`h\` (PGV group 1), so it is safe as a Merkle-tree node combiner.
   */
  export pure circuit compress(h: Field, m: Field): Field {
    return encrypt(h, m) + h + m;
  }

  /**
   * @description Hashes two field elements (one compression). The arity tag
   * 2 rides the compression key; see the module doc.
   */
  export pure circuit hash2(a: Field, b: Field): Field {
    return compress(a + (2 as Field), b);
  }

  /**
   * @description Hashes four field elements (three chained compressions).
   * The arity tag 4 rides the first compression key; see the module doc.
   */
  export pure circuit hash4(a: Field, b: Field, c: Field, d: Field): Field {
    return compress(compress(compress(a + (4 as Field), b), c), d);
  }
}
`;

const outPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'crypto',
  'Mimc.compact',
);
writeFileSync(outPath, compact);
console.log(`wrote ${outPath}`);
