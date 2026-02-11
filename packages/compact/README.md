# @openzeppelin/compact-tools-cli

CLI utilities for compiling and building Compact smart contracts.

## Installation

Until published to npm, use via git submodule or local path:

```bash
# As a local dependency
yarn add @openzeppelin/compact-tools-cli@file:./compact-tools/packages/cli

# Or invoke directly after building
node compact-tools/packages/cli/dist/runCompiler.js
```

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
| `--src <directory>` | Source directory containing `.compact` files | `src` |
| `--out <directory>` | Output directory for compiled artifacts | `artifacts` |
| `--hierarchical` | Preserve source directory structure in output | `false` |
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

**Hierarchical (`--hierarchical`):** Preserves source directory structure.

```
artifacts/           # Hierarchical output
  access/
    AccessControl/
  token/
    Token/
```

### Examples

```bash
# Compile all contracts (flattened output)
compact-compiler

# Compile with hierarchical artifact structure
compact-compiler --hierarchical

# Compile specific directory only
compact-compiler --dir security

# Skip ZK proof generation (faster, for development)
compact-compiler --skip-zk

# Use specific toolchain version
compact-compiler +0.29.0

# Custom source and output directories
compact-compiler --src contracts --out build

# Combine options
compact-compiler --dir access --skip-zk --hierarchical

# Use environment variable
SKIP_ZK=true compact-compiler
```

## Builder CLI

The builder runs the compiler as a prerequisite, then executes additional build steps:

1. Compile `.compact` files (via `compact-compiler`)
2. Compile TypeScript (`tsc --project tsconfig.build.json`)
3. Copy artifacts to `dist/artifacts/`
4. Copy and clean `.compact` files to `dist/`

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

# Build with custom directories
compact-builder --src contracts --out build
```

## Programmatic API

The compiler can be used programmatically:

```typescript
import { CompactCompiler } from '@openzeppelin/compact-tools-cli';

// Using options object
const compiler = new CompactCompiler({
  flags: '--skip-zk',
  targetDir: 'security',
  version: '0.29.0',
  hierarchical: true,
  srcDir: 'src',
  outDir: 'artifacts',
});

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
  constructor(options?: CompilerOptions, execFn?: ExecFunction);
  static fromArgs(args: string[], env?: NodeJS.ProcessEnv): CompactCompiler;
  static parseArgs(args: string[], env?: NodeJS.ProcessEnv): CompilerOptions;
  compile(): Promise<void>;
  validateEnvironment(): Promise<void>;
}

// Builder class
class CompactBuilder {
  constructor(options?: CompilerOptions);
  static fromArgs(args: string[], env?: NodeJS.ProcessEnv): CompactBuilder;
  build(): Promise<void>;
}

// Options interface
interface CompilerOptions {
  flags?: string;           // Compiler flags (e.g., '--skip-zk --verbose')
  targetDir?: string;       // Subdirectory within srcDir to compile
  version?: string;         // Toolchain version (e.g., '0.29.0')
  hierarchical?: boolean;   // Preserve directory structure in output
  srcDir?: string;          // Source directory (default: 'src')
  outDir?: string;          // Output directory (default: 'artifacts')
}
```

### Error Types

```typescript
import {
  CompactCliNotFoundError,  // Compact CLI not in PATH
  CompilationError,         // Compilation failed (includes file path)
  DirectoryNotFoundError,   // Target directory doesn't exist
} from '@openzeppelin/compact-tools-cli';
```

## Development

```bash
cd packages/cli

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
