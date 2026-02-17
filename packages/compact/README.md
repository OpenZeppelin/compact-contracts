# @openzeppelin-compact/compact

CLI utilities for compiling and building Compact smart contracts.

## Requirements

- Node.js >= 20
- Midnight Compact toolchain installed and available in `PATH`

Verify your Compact installation:

```bash
$ compact compile --version
Compactc version: 0.29.0
```

## Binaries

This package provides two CLI binaries:

| Binary | Script | Description |
|--------|--------|-------------|
| `compact-compiler` | `dist/runCompiler.js` | Compile `.compact` files to artifacts |
| `compact-builder` | `dist/runBuilder.js` | Compile + build TypeScript + copy artifacts |

## Compiler CLI

### Usage

```bash
compact-compiler [options]
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--dir <directory>` | Compile specific subdirectory within src | (all) |
| `--skip-zk` | Skip zero-knowledge proof generation | `false` |
| `+<version>` | Use specific toolchain version (e.g., `+0.29.0`) | (default) |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `SKIP_ZK=true` | Equivalent to `--skip-zk` flag |

### Artifact Output Structure

**Default (flattened):** All contract artifacts go directly under the output directory.

```
src/
  access/
    AccessControl.compact
  token/
    Token.compact

artifacts/           # Flattened output
  AccessControl/
  Token/
```

### Examples

```bash
# Compile all contracts (flattened output)
compact-compiler

# Compile specific directory only
compact-compiler --dir security

# Skip ZK proof generation (faster, for development)
compact-compiler --skip-zk

# Use specific toolchain version
compact-compiler +0.29.0

# Combine options
compact-compiler --dir access --skip-zk

# Use environment variable
SKIP_ZK=true compact-compiler
```

## Builder CLI

The builder runs the compiler as a prerequisite, then executes additional build steps:

1. Clean `dist/` directory
2. Compile TypeScript (`tsc --project tsconfig.build.json`)
3. Copy .compact files preserving structure (excludes Mock* files and archive/)
4. Copy package.json and README for distribution

### Usage

```bash
compact-builder [options]
```

Accepts all compiler options except `--skip-zk` (builds always include ZK proofs).

### Examples

```bash
# Full build
compact-builder

# Build specific directory
compact-builder --dir token

# Build specific directory and skip proving key generation
compact-builder --dir token --skip-zk

## Programmatic API

The compiler can be used programmatically:

```typescript
import { CompactCompiler } from '@openzeppelin-compact/compact';

const compiler = new CompactCompiler(
  '--skip-zk',
  'security',
  '0.29.0',
);

await compiler.compile();

// Using factory method (parses CLI-style args)
const compiler = CompactCompiler.fromArgs([
  '--dir', 'security',
  '--skip-zk',
  '+0.29.0'
]);

await compiler.compile();
```

### Classes and Types

```typescript
// Main compiler class
class CompactCompiler {
  constructor(flags = '', targetDir?: string, version?: string, execFn?: ExecFunction)
  static fromArgs(args: string[], env?: NodeJS.ProcessEnv): CompactCompiler;
  compile(): Promise<void>;
  validateEnvironment(): Promise<void>;
}

// Builder class
class CompactBuilder {
  constructor(compilerFlags = '')
  build(): Promise<void>;
}

### Error Types

```typescript
import {
  CompactCliNotFoundError,  // Compact CLI not in PATH
  CompilationError,         // Compilation failed (includes file path)
  DirectoryNotFoundError,   // Target directory doesn't exist
} from '@openzeppelin-compact/compact';
```

## Development

```bash
cd packages/compact

# Build
yarn build

# Type-check only
yarn types

# Run tests
yarn test

# Clean
yarn clean
```

## Output Example

```bash
ℹ [COMPILE] Compact compiler started
ℹ [COMPILE] Compact developer tools: compact 0.4.0
ℹ [COMPILE] Compact toolchain: Compactc version: 0.29.0
ℹ [COMPILE] Found 2 .compact file(s) to compile
✔ [COMPILE] [1/2] Compiled AccessControl.compact
    Compactc version: 0.29.0
✔ [COMPILE] [2/2] Compiled Token.compact
    Compactc version: 0.29.0
```

## License

MIT
