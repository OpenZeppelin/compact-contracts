# Simulator Tests

All tests live under the `test/` directory, which is organized by type and purpose.
The testing structure ensures consistency, reusability,
and clear separation between unit, integration, and shared test resources.

## 📁 Structure

```bash
test/
  ├── fixtures/
  ├── integration/
  └── unit/
```

### 🧩 Fixtures (`test/fixtures`)

Test fixtures contain reusable components and resources shared across tests.
These help keep test files clean and consistent.

- `test-contracts/` – Smart contracts and associated simulators used exclusively for testing.
- `artifacts/` – Precompiled contract artifacts needed by tests.
- `utils/` – Helper functions and common utilities for key encoding and keypair generation.

### 🔗 Integration Tests (`test/integration`)

The `integration/` directory contains tests that verify how multiple components interact as a system.
These tests use simulated dependencies (from `fixtures/`)
to ensure contracts and the simulator package work together as expected in end-to-end scenarios.

### 🧪 Unit Tests (`test/unit`)

The `unit/` directory contains isolated tests focused on individual functions and classes.
These tests mock external dependencies and use lightweight fixtures to validate correctness
and edge cases in a controlled environment.
