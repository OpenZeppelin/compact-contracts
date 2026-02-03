#!/usr/bin/env node

import chalk from 'chalk';
import ora from 'ora';
import { CompactBuilder } from './Builder.ts';

/**
 * Executes the Compact builder CLI.
 * Builds projects using the `CompactBuilder` class with provided options, including compilation and additional steps.
 *
 * Supports compiler options:
 * - `--dir <directory>` - Compile specific subdirectory
 * - `--src <directory>` - Source directory (default: src)
 * - `--out <directory>` - Output directory (default: artifacts)
 * - `--hierarchical` - Preserve directory structure in output
 * - `+<version>` - Use specific toolchain version
 *
 * @example
 * ```bash
 * npx compact-builder
 * npx compact-builder --src contracts --out build
 * ```
 * Expected output:
 * ```
 * ℹ [BUILD] Compact builder started
 * ℹ [COMPILE] Found 1 .compact file(s) to compile
 * ✔ [COMPILE] [1/1] Compiled Foo.compact
 *     Compactc version: 0.26.0
 * ✔ [BUILD] [1/3] Compiling TypeScript
 * ✔ [BUILD] [2/3] Copying artifacts
 * ✔ [BUILD] [3/3] Copying and cleaning .compact files
 * ```
 */
async function runBuilder(): Promise<void> {
  const spinner = ora(chalk.blue('[BUILD] Compact Builder started')).info();

  try {
    const args = process.argv.slice(2);
    const builder = CompactBuilder.fromArgs(args);
    await builder.build();
  } catch (err) {
    spinner.fail(
      chalk.red('[BUILD] Unexpected error:', (err as Error).message),
    );
    process.exit(1);
  }
}

runBuilder();
