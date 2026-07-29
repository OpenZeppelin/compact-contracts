/**
 * Asserting *why* a call was rejected, on either backend.
 *
 * `expect(...).rejects.toThrow(msg)` reads `error.message` and nothing else.
 * That is enough when the failure comes from an in-circuit `assert`, whose text
 * the compiler emits into the circuit. It is not enough when the failure comes
 * from a witness throwing: on the live backend that arrives wrapped twice,
 *
 *   Error            "Unexpected error executing scoped transaction '…': …"
 *     cause: ContractRuntimeError  "Error executing circuit 'transfer'"
 *       cause:                     the witness's own error
 *
 * so the real reason sits below the surface and a message assertion that passes
 * dry fails live for no behavioural reason. Both wrappers do preserve `cause`
 * (`midnight-js-contracts` uses `new Error(msg, { cause: err })`, and
 * `compact-js`'s `ContractRuntimeError.make(message, cause)` keeps it), so the
 * reason is still there — just not where vitest looks.
 *
 * {@link expectRejection} walks the whole chain, so one assertion string holds
 * in both backends: dry matches at depth 0, live further down.
 *
 * Effect hides a failure's cause behind a `FiberFailure` that only renders via
 * `toString()`, and an `AggregateError` keeps its children on `errors`, so the
 * walk covers both alongside `cause`.
 */

/**
 * Rendered text for every error reachable from `error`, outermost first.
 *
 * Breadth-first so the printed order matches how deeply each entry was nested,
 * which is what makes a failed match readable. Cycle-safe.
 */
export function causeChain(error: unknown): string[] {
  const seen = new Set<unknown>();
  const queue: unknown[] = [error];
  const rendered: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current == null || seen.has(current)) {
      continue;
    }
    seen.add(current);

    // `String(err)` rather than `.message`: it picks up a custom `toString`,
    // which is the only way a FiberFailure surfaces what it wraps.
    rendered.push(String(current));

    if (current instanceof Error) {
      queue.push(current.cause);
      const { errors } = current as { errors?: unknown };
      if (Array.isArray(errors)) {
        queue.push(...errors);
      }
    }
  }
  return rendered;
}

/** Whether `reason` appears anywhere in `error`'s cause chain. */
export function rejectionIncludes(error: unknown, reason: string): boolean {
  return causeChain(error).some((text) => text.includes(reason));
}

/**
 * Asserts `call` rejects, and that `reason` appears somewhere in the rejection's
 * cause chain.
 *
 * On a miss it prints the entire chain, so a run on a backend that wraps errors
 * differently reports what it actually got instead of just "no match".
 *
 * @param call - The pending call, e.g. `token.burn(30n)`.
 * @param reason - Substring to find, at any depth.
 */
export async function expectRejection(
  call: Promise<unknown>,
  reason: string,
): Promise<void> {
  let thrown: unknown;
  let rejected = false;
  try {
    await call;
  } catch (error) {
    rejected = true;
    thrown = error;
  }

  if (!rejected) {
    throw new Error(
      `expected a rejection including "${reason}", but the call resolved`,
    );
  }
  if (!rejectionIncludes(thrown, reason)) {
    const chain = causeChain(thrown)
      .map((text, depth) => `  [${depth}] ${text}`)
      .join('\n');
    throw new Error(
      `expected a rejection including\n  ${reason}\nbut the cause chain was:\n${chain}`,
    );
  }
}
