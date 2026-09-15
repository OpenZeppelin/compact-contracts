# Contracts README

This package contains the Compact smart contract source files, compiled artifacts, witness implementations, and test infrastructure for OpenZeppelin Contracts for Compact.

## src/

The `src/` directory is organized by module category. Each module follows the same internal layout:

```
<module>/
├── <Contract>.compact          # Contract source
├── presets/                    # Curated modules composing the module's contracts
│   └── test/                   # Preset specs, with their own mocks/ and simulators/
├── examples/                   # <Preset>Example.compact — deployable, compile-only
└── test/
    ├── <Contract>.test.ts      # Test suite
    ├── mocks/                  # Mock contracts (test-only — see warning below)
    ├── simulators/             # Simulator helpers for testing
    └── witnesses/              # TypeScript witness implementations (test-only)
```

A preset is library code, so it is imported, not deployed. Each one ships a
deployable contract under `examples/`. Preset tests live under `presets/test/`:
the spec next to `presets/test/mocks/Mock<Preset>.compact` and
`presets/test/simulators/<Preset>Simulator.ts`. The `examples/` contracts are
compiled but not tested.

## > ⚠️ Mock Contracts Are For Testing Only

Each module's `test/mocks/` directory (and each preset's `presets/test/mocks/`) contains `Mock*.compact` files (e.g. `MockFungibleToken.compact`, `MockOwnable.compact`, `MockAccessControl.compact`).

**These contracts exist solely to expose internal state and circuits for testing purposes. They must never be used in production.**

Mock contracts typically:
- Expose internal or protected circuits publicly for direct testing
- Skip access control or safety checks to isolate specific behaviors
- Introduce additional state that makes testing easier but is unsafe in deployment

**Using a Mock contract in production would undermine the security guarantees the corresponding production contract is designed to provide.**
