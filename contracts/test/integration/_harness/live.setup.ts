import { registerSimulatorLiveBackend } from './registerSimulatorLive.js';

// Runs once per worker before the unit specs when `test:live` is used. Registers
// the live backend so `await Sim.create()` attaches to a freshly-deployed
// contract on the local stack (brought up by `make env-up`). On the dry path
// (default `test`) this file is not loaded, so nothing changes there.
registerSimulatorLiveBackend();
