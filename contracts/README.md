# Contracts README

This package contains the Compact smart contract source files, compiled artifacts, witness implementations, and test infrastructure for OpenZeppelin Contracts for Compact.

## src/

The `src/` directory is organized by module category. Each module follows the same internal layout:

```
<module>/
├── <Contract>.compact      # Contract source
├── witnesses/              # TypeScript witness implementations
└── test/
    ├── <Contract>.test.ts  # Test suite
    ├── mocks/              # Mock contracts (test-only — see warning below)
    └── simulators/         # Simulator helpers for testing
```

## > ⚠️ Mock Contracts Are For Testing Only

Each module's `test/mocks/` directory contains `Mock*.compact` files (e.g. `MockFungibleToken.compact`, `MockOwnable.compact`, `MockAccessControl.compact`).

**These contracts exist solely to expose internal state and circuits for testing purposes. They must never be used in production.**

Mock contracts typically:
- Expose internal or protected circuits publicly for direct testing
- Skip access control or safety checks to isolate specific behaviors
- Introduce additional state that makes testing easier but is unsafe in deployment

**Using a Mock contract in production would undermine the security guarantees the corresponding production contract is designed to provide.**
