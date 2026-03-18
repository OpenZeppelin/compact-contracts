# Contracts README

This package contains the Compact smart contract source files, compiled artifacts, witness implementations, and test infrastructure for OpenZeppelin Contracts for Compact.

## Directory Structure

```
contracts/
├── src/                    # Source files
│   ├── access/             # Access control contracts
│   ├── security/           # Security utility contracts
│   ├── token/              # Token standard contracts
│   ├── utils/              # General utility contracts
│   ├── archive/            # Archived/deprecated contracts
│   └── test-utils/         # Shared test helpers
├── artifacts/              # Compiled contract outputs (generated)
└── dist/                   # Compiled TypeScript witness outputs (generated)
```

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

### src/access/

Access control primitives for restricting who can call contract circuits.

| File | Description |
|------|-------------|
| `AccessControl.compact` | Role-based access control |
| `Ownable.compact` | Single-owner access control |
| `ShieldedAccessControl.compact` | Role-based access control with shielded (private) role assignments |
| `ZOwnablePK.compact` | Single-owner access control with shielded ownership |

### src/security/

Contracts that add common security patterns on top of other modules.

| File | Description |
|------|-------------|
| `Initializable.compact` | One-time initialization mechanism |
| `Pausable.compact` | Emergency pause/unpause mechanism |

### src/token/

Implementations of standard token interfaces.

| File | Description |
|------|-------------|
| `FungibleToken.compact` | ERC-20-style fungible token |
| `NonFungibleToken.compact` | ERC-721-style non-fungible token |
| `MultiToken.compact` | ERC-1155-style multi-token |

### src/utils/

Low-level utilities shared across modules.

| File | Description |
|------|-------------|
| `Utils.compact` | Common helper circuits |

### src/archive/

Contracts that are no longer actively maintained. Do not use in new projects.

### src/test-utils/

Shared TypeScript helpers used across test suites (e.g. address utilities). Not part of the public API.

---

## > ⚠️ Mock Contracts Are For Testing Only

Each module's `test/mocks/` directory contains `Mock*.compact` files (e.g. `MockFungibleToken.compact`, `MockOwnable.compact`, `MockAccessControl.compact`).

**These contracts exist solely to expose internal state and circuits for testing purposes. They must never be used in production.**

Mock contracts typically:
- Expose internal or protected circuits publicly for direct testing
- Skip access control or safety checks to isolate specific behaviors
- Introduce additional state that makes testing easier but is unsafe in deployment

**Using a Mock contract in production would undermine the security guarantees the corresponding production contract is designed to provide.**
