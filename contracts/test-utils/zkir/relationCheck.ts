import {
  type CallProofData,
  type ProofData,
  proofDataIntoSerializedPreimage,
} from '@midnight-ntwrk/compact-runtime';
import { check, jsonIrToBinary } from '@midnight-ntwrk/zkir-v2';
import { DryBackend } from '@openzeppelin/compact-simulator';
import { readZkirV2, type ZkirV2 } from './zkirV2.js';

/**
 * In-process check of a ZKIR v2 relation on the proof preimage of a dry call.
 *
 * `@midnight-ntwrk/zkir-v2` `check` runs the constraint system of a circuit on
 * a serialized preimage, without proving keys. It accepts the preimage only
 * if every constraint holds, so a test can show that the circuit itself
 * rejects a forged witness result. It reads ZKIR v2 only. ZKIR v3 has no
 * local check.
 *
 * {@link traceCall} reads the proof data from a simulator. It uses an
 * internal field of `@openzeppelin/compact-simulator` 0.4.1: the dry backend
 * keeps its in-memory simulator in `DryBackend.sim`, and that simulator keeps
 * the call trace of the runtime in `circuitContext.callProofDataTrace`. The
 * package has no public API for the trace. The adapter checks each step and
 * throws when the layout is different, so a simulator update fails loudly.
 */

const ARTIFACTS = new URL('../../artifacts/', import.meta.url);

/** The path of the ZKIR v2 file of `circuit` in the compiled `artifact`. */
export const zkirPath = (artifact: string, circuit: string): URL =>
  new URL(`${artifact}/zkir/${circuit}.zkir`, ARTIFACTS);

const zkirCache = new Map<string, ZkirV2>();
const binaryCache = new WeakMap<ZkirV2, Uint8Array>();

/** Reads the ZKIR v2 circuit of `circuit` in `artifact` (cached). */
export function loadZkir(artifact: string, circuit: string): ZkirV2 {
  const key = `${artifact}/${circuit}`;
  let zkir = zkirCache.get(key);
  if (zkir === undefined) {
    zkir = readZkirV2(zkirPath(artifact, circuit));
    zkirCache.set(key, zkir);
  }
  return zkir;
}

/**
 * Returns the call trace of a simulator on the dry backend.
 *
 * @throws If the simulator does not run on the dry backend, or if the
 * simulator package has a different layout.
 */
function dryCallTrace(simulator: unknown): readonly CallProofData[] {
  const backend = (simulator as { _backend?: unknown } | null)?._backend;
  if (!(backend instanceof DryBackend)) {
    throw new Error(
      'relation check: the simulator does not run on the dry backend',
    );
  }
  // `sim` is private in the type declarations of the package.
  const inner = (backend as unknown as { sim?: unknown }).sim as
    | { circuitContext?: { callProofDataTrace?: unknown } }
    | undefined;
  const trace = inner?.circuitContext?.callProofDataTrace;
  if (!Array.isArray(trace)) {
    throw new Error(
      'relation check: no call trace at DryBackend.sim.circuitContext.callProofDataTrace',
    );
  }
  return trace as CallProofData[];
}

/**
 * Runs `call` on `simulator` and returns its result and its proof data.
 *
 * The simulator labels every call in the trace with the same circuit id, so
 * the adapter identifies the call by the trace length: the call must add
 * exactly one entry.
 *
 * @param simulator - An instance of a class built with `createSimulator`.
 * @param call - One circuit call on `simulator`.
 * @throws If the simulator does not run on the dry backend, if the layout of
 * the simulator package is different, or if the call does not add exactly
 * one entry to the trace.
 */
export async function traceCall<R>(
  simulator: unknown,
  call: () => Promise<R>,
): Promise<{ result: R; proofData: CallProofData }> {
  const before = dryCallTrace(simulator).length;
  const result = await call();
  const trace = dryCallTrace(simulator);
  const proofData = trace[before];
  if (trace.length !== before + 1 || proofData === undefined) {
    throw new Error(
      `relation check: the call added ${trace.length - before} trace entries, not 1`,
    );
  }
  return { result, proofData };
}

/** The result of a relation check. */
export type RelationVerdict =
  | { accepted: true }
  | { accepted: false; reason: string };

/**
 * Error texts of `check` for a preimage that does not satisfy the relation.
 * Any other error of `check` is a defect of the test setup, and
 * {@link checkRelation} throws it.
 */
export const RELATION_FAILURES: readonly string[] = [
  'Failed direct assertion',
  'Bit bound failed',
  'Failed equality constraint',
  'Communications commitment mismatch',
];

/**
 * Runs the ZKIR v2 relation of `circuit` on the preimage of `proofData`.
 *
 * @param zkir - The circuit, as {@link loadZkir} returns it. A test can pass a
 * changed copy, for example one with a constraint removed.
 * @param circuit - The circuit name. It is the key location in the preimage.
 * @param proofData - The proof data of one call.
 * @returns `accepted: true` if every constraint holds.
 * @throws If the preimage cannot be built, or if `check` fails for a reason
 * that is not in {@link RELATION_FAILURES}.
 */
export async function checkRelation(
  zkir: ZkirV2,
  circuit: string,
  proofData: ProofData,
): Promise<RelationVerdict> {
  let ir = binaryCache.get(zkir);
  if (ir === undefined) {
    ir = jsonIrToBinary(JSON.stringify(zkir));
    binaryCache.set(zkir, ir);
  }
  const binary = ir;
  const preimage = proofDataIntoSerializedPreimage(
    proofData.input,
    proofData.output,
    proofData.publicTranscript,
    proofData.privateTranscriptOutputs,
    circuit,
  );
  const provider = {
    lookupKey: async () => ({
      ir: binary,
      proverKey: new Uint8Array(),
      verifierKey: new Uint8Array(),
    }),
    getParams: async (k: number): Promise<Uint8Array> => {
      throw new Error(`relation check: unexpected request for k=${k} params`);
    },
  };
  try {
    await check(preimage, provider);
    return { accepted: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (!RELATION_FAILURES.some((failure) => reason.includes(failure))) {
      throw error;
    }
    return { accepted: false, reason };
  }
}
