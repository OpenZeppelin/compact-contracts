#!/usr/bin/env node

import { exec as execCallback } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { promisify } from 'node:util';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { isPromisifiedChildProcessError } from './types/errors.ts';

const exec = promisify(execCallback);
const SRC_DIR: string = 'src';
const ARTIFACTS_DIR: string = 'artifacts';

// Check if compact CLI is available in PATH
async function checkCompactAvailable(): Promise<boolean> {
  try {
    await exec('compact --version');
    return true;
  } catch {
    return false;
  }
}

/**
 * A class to handle compilation of `.compact` files using the `compact compile` command.
 * Provides progress feedback and colored output for success and error states.
 *
 * @example
 * ```typescript
 * const compiler = new CompactCompiler('--skip-zk');
 * compiler.compile().catch(err => console.error(err));
 * ```
 *
 * @example Compile specific directory
 * ```typescript
 * const compiler = new CompactCompiler('--skip-zk', 'security');
 * compiler.compile().catch(err => console.error(err));
 * ```
 *
 * @example Successful Compilation Output
 * ```
 * ℹ [COMPILE] Compact compiler started
 * ℹ [COMPILE] Compact developer tools: compact 0.1.0
 * ℹ [COMPILE] Compact toolchain: Compactc version: 0.24.0
 * ℹ [COMPILE] Found 2 .compact file(s) to compile
 * ✔ [COMPILE] [1/2] Compiled AccessControl.compact
 *     Compact version: 0.24.0
 * ✔ [COMPILE] [2/2] Compiled MockAccessControl.compact
 *     Compact version: 0.24.0
 * ```
 *
 * @example Failed Compilation Output
 * ```
 * ℹ [COMPILE] Found 2 .compact file(s) to compile
 * ✖ [COMPILE] [1/2] Failed AccessControl.compact
 *     Compact version: 0.24.0
 *     Error: Expected ';' at line 5 in AccessControl.compact
 * ```
 */
export class CompactCompiler {
  /** Stores the compiler flags passed via command-line arguments */
  private readonly flags: string;
  /** Optional toolchain version to use (e.g., "+0.24.0") */
  private readonly version?: string;
  /** Optional target directory to limit compilation scope */
  private readonly targetDir?: string;

  /**
   * Constructs a new CompactCompiler instance, validating the `compact` CLI availability.
   *
   * @param flags - Space-separated string of compiler flags (e.g., "--skip-zk --no-communications-commitment")
   * @param version - Optional toolchain version to use (e.g., "0.24.0")
   * @throws {Error} If the `compact` CLI is not found in PATH
   */
  constructor(flags: string, targetDir?: string, version?: string) {
    this.flags = flags.trim();
    this.targetDir = targetDir;
    this.version = version;
  }

  /**
   * Validates that the compact CLI is available and shows version info.
   */
  async validateEnvironment(): Promise<void> {
    const spinner = ora();

    try {
      // Check if compact CLI is available
      const isAvailable = await checkCompactAvailable();
      if (!isAvailable) {
        spinner.fail(
          chalk.red(
            `[COMPILE] Error: 'compact' CLI not found in PATH. Please install the Compact developer tools.`,
          ),
        );
        spinner.info(
          chalk.blue(
            `[COMPILE] Install with: curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh`,
          ),
        );
        throw new Error(`'compact' CLI not found in PATH`);
      }

      // Show version information
      const { stdout: devToolsVersion } = await exec('compact --version');
      spinner.info(
        chalk.blue(
          `[COMPILE] Compact developer tools: ${devToolsVersion.trim()}`,
        ),
      );

      const versionFlag = this.version ? `+${this.version}` : '';
      const { stdout: toolchainVersion } = await exec(
        `compact compile ${versionFlag} --version`,
      );
      spinner.info(
        chalk.blue(`[COMPILE] Compact toolchain: ${toolchainVersion.trim()}`),
      );

      if (this.version) {
        spinner.info(
          chalk.blue(`[COMPILE] Using toolchain version: ${this.version}`),
        );
      }
    } catch (error) {
      if (isPromisifiedChildProcessError(error)) {
        spinner.fail(
          chalk.red(
            `[COMPILE] Environment validation failed: ${error.message}`,
          ),
        );
        throw error;
      }
      throw error;
    }
  }

  /**
   * Compiles all `.compact` files in the source directory and its subdirectories (e.g., `src/test/mock/`).
   * Scans the `src` directory recursively for `.compact` files, compiles each one using `compact compile`,
   * and displays progress with a spinner and colored output.
   *
   * @returns A promise that resolves when all files are compiled successfully
   * @throws {Error} If compilation fails for any file
   */
  public async compile(): Promise<void> {
    await this.validateEnvironment();

    const compactFiles: string[] = await this.getCompactFiles(SRC_DIR);

    const spinner = ora();
    if (compactFiles.length === 0) {
      spinner.warn(chalk.yellow('[COMPILE] No .compact files found.'));
      return;
    }

    spinner.info(
      chalk.blue(
        `[COMPILE] Found ${compactFiles.length} .compact file(s) to compile`,
      ),
    );
    for (const [index, file] of compactFiles.entries()) {
      await this.compileFile(file, index, compactFiles.length);
    }
  }

  /**
   * Recursively scans directory and returns an array of relative paths to `.compact`
   * files found within it.
   *
   * @param dir - The absolute or relative path to the directory to scan.
   * @returns A promise that resolves to an array of relative paths from `SRC_DIR`
   * to each `.compact` file.
   *
   * @throws Will log an error if a dir cannot be read or if a file or subdir
   * fails to be accessed. It will not reject the promise. Errors are handled
   * internally and skipped.
   */
  private async getCompactFiles(dir: string): Promise<string[]> {
    try {
      const dirents = await readdir(dir, { withFileTypes: true });
      const filePromises = dirents.map(async (entry) => {
        const fullPath = join(dir, entry.name);
        try {
          if (entry.isDirectory()) {
            return await this.getCompactFiles(fullPath);
          }

          if (entry.isFile() && fullPath.endsWith('.compact')) {
            // Always return relative path from SRC_DIR, regardless of search directory
            return [relative(SRC_DIR, fullPath)];
          }
          return [];
        } catch (err) {
          // biome-ignore lint/suspicious/noConsole: Displays file path that failed to parse
          console.warn(`Error accessing ${fullPath}:`, err);
          return [];
        }
      });

      const results = await Promise.all(filePromises);
      return results.flat();
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: Displays which directory failed to be read
      console.error(`Failed to read dir: ${dir}`, err);
      return [];
    }
  }

  /**
   * Compiles a single `.compact` file.
   * Executes the `compact compile` command with the provided flags, input file, and output directory.
   *
   * @param file - Relative path of the `.compact` file to compile (e.g., "test/mock/MockFile.compact")
   * @param index - Current file index (0-based) for progress display
   * @param total - Total number of files to compile for progress display
   * @returns A promise that resolves when the file is compiled successfully
   * @throws {Error} If compilation fails
   */
  private async compileFile(
    file: string,
    index: number,
    total: number,
  ): Promise<void> {
    const inputPath: string = join(SRC_DIR, file);
    const outputDir: string = join(ARTIFACTS_DIR, basename(file, '.compact'));
    const step: string = `[${index + 1}/${total}]`;
    const spinner: Ora = ora(
      chalk.blue(`[COMPILE] ${step} Compiling ${file}`),
    ).start();

    try {
      const versionFlag = this.version ? `+${this.version}` : '';
      const flagsStr = this.flags ? ` ${this.flags}` : '';
      const command: string = `compact compile${versionFlag ? ` ${versionFlag}` : ''}${flagsStr} "${inputPath}" "${outputDir}"`;

      spinner.text = chalk.blue(`[COMPILE] ${step} Running: ${command}`);
      const { stdout, stderr }: { stdout: string; stderr: string } =
        await exec(command);
      spinner.succeed(chalk.green(`[COMPILE] ${step} Compiled ${file}`));
      this.printOutput(stdout, chalk.cyan);
      this.printOutput(stderr, chalk.yellow);
    } catch (error: unknown) {
      spinner.fail(chalk.red(`[COMPILE] ${step} Failed ${file}`));
      if (isPromisifiedChildProcessError(error)) {
        this.printOutput(error.stdout, chalk.cyan);
        this.printOutput(error.stderr, chalk.red);
      }
      throw error;
    }
  }

  /**
   * Prints compiler output with indentation and specified color.
   *
   * @param output - The compiler output string to print (stdout or stderr)
   * @param colorFn - Chalk color function to style the output (e.g., `chalk.cyan` for success, `chalk.red` for errors)
   */
  private printOutput(output: string, colorFn: (text: string) => string): void {
    const lines: string[] = output
      .split('\n')
      .filter((line: string): boolean => line.trim() !== '')
      .map((line: string): string => `    ${line}`);
    console.log(colorFn(lines.join('\n')));
  }
}
