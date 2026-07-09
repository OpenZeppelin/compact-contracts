import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  ensureLiveDeployerReady,
  registerSimulatorLiveBackend,
} from './registerSimulatorLive.js';

// Runs once per worker before the unit specs when `test:live` is used. Pins the
// process network id to the local `undeployed` devnet (deployContract and the
// indexer provider read it globally), then registers the live backend so
// `await Sim.create()` attaches to a freshly-deployed contract on the local
// stack (`make env-up`). On the dry path (default `test`) this file is not
// loaded, so nothing changes there.
setNetworkId('undeployed');
registerSimulatorLiveBackend();

// Start the deployer wallet up front (publishes `MIDNIGHT_DEPLOYER_COIN_PK`)
// so specs can read the deployer key at module load — e.g. a forwarder whose
// parent is the deployer's own key, needed to construct the contract before its
// first `create()`. Top-level await; setup files are awaited before test files.
await ensureLiveDeployerReady();
