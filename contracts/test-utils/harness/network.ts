import { LocalTestConfiguration } from '@midnight-ntwrk/testkit-js';

/** Parse a port override, failing with the responsible env var name so a
 * malformed value (empty, non-numeric, out of range) is caught at load time
 * instead of surfacing later as a bad `NaN`/`0` URL. */
function port(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return value;
}

/**
 * Endpoints of the local stack (`local-env.yml`), shared by the live setup and
 * the live harness smoke. `LocalTestConfiguration` builds the `127.0.0.1`
 * `/api/v4/graphql` URLs from these ports; override per port via the
 * `MIDNIGHT_*_PORT` env vars for a relocated stack.
 */
export const PORTS = {
  indexer: port('MIDNIGHT_INDEXER_PORT', 8088),
  node: port('MIDNIGHT_NODE_PORT', 9944),
  proofServer: port('MIDNIGHT_PROOF_SERVER_PORT', 6300),
};

/** A testkit environment config pointed at the local stack. */
export function localEnv(): LocalTestConfiguration {
  return new LocalTestConfiguration(PORTS);
}
