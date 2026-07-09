import { LocalTestConfiguration } from '@midnight-ntwrk/testkit-js';

/**
 * Endpoints of the local stack (`local-env.yml`), shared by the live setup and
 * the live harness smoke. `LocalTestConfiguration` builds the `127.0.0.1`
 * `/api/v4/graphql` URLs from these ports; override per port via the
 * `MIDNIGHT_*_PORT` env vars for a relocated stack.
 */
export const PORTS = {
  indexer: Number(process.env.MIDNIGHT_INDEXER_PORT ?? 8088),
  node: Number(process.env.MIDNIGHT_NODE_PORT ?? 9944),
  proofServer: Number(process.env.MIDNIGHT_PROOF_SERVER_PORT ?? 6300),
};

/** A testkit environment config pointed at the local stack. */
export function localEnv(): LocalTestConfiguration {
  return new LocalTestConfiguration(PORTS);
}
