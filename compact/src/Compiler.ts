#!/usr/bin/env node

import { exec as execCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { promisify } from 'node:util';
import chalk from 'chalk';
import ora from 'ora';
import {
  CompactCliNotFoundError,
  CompilationError,
  DirectoryNotFoundError,
  isPromisifiedChildProcessError,
} from './types/errors.ts';

/** Source directory containing .compact files */
const SRC_DIR: string = 'src';
/** Output directory for compiled artifacts */
const ARTIFACTS_DIR: string = 'artifacts';

/**
 * Function type for executing shell commands.
 * Allows dependency injection for testing and customization.
 *
 * @param command - The shell command to execute
 * @returns Promise resolving to command output
 */
export type ExecFunction = (
  command: string,
) => Promise<{ stdout: string; stderr: string }>;

/**
 * Service responsible for validating the Compact CLI environment.
 * Checks CLI availability, retrieves version information, and ensures
 * the toolchain is properly configured before compilation.
 *
 * @class EnvironmentValidator
 * @example
 * ```typescript
 * const validator = new EnvironmentValidator();
 * await validator.validate('0.25.0');
 * const version = await validator.getDevToolsVersion();
 * ```
 */
export class EnvironmentValidator {
  private execFn: ExecFunction;

  /**
   * Creates a new EnvironmentValidator instance.
   *
   * @param execFn - Function to execute shell commands (defaults to promisified child_process.exec)
   */
  constructor(execFn: ExecFunction = promisify(execCallback)) {
    this.execFn = execFn;
  }

  /**
   * Checks if the Compact CLI is available in the system PATH.
   *
   * @returns Promise resolving to true if CLI is available, false otherwise
   * @example
   * ```typescript
   * const isAvailable = await validator.checkCompactAvailable();
   * if (!isAvailable) {
   *   throw new Error('Compact CLI not found');
   * }
   * ```
   */
  async checkCompactAvailable(): Promise<boolean> {
    try {
      await this.execFn('compact --version');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Retrieves the version of the Compact developer tools.
   *
   * @returns Promise resolving to the version string
   * @throws {Error} If the CLI is not available or command fails
   * @example
   * ```typescript
   * const version = await validator.getDevToolsVersion();
   * console.log(`Using Compact ${version}`);
   * ```
   */
  async getDevToolsVersion(): Promise<string> {
    const { stdout } = await this.execFn('compact --version');
    return stdout.trim();
  }

  /**
   * Retrieves the version of the Compact toolchain/compiler.
   *
   * @param version - Optional specific toolchain version to query
   * @returns Promise resolving to the toolchain version string
   * @throws {Error} If the CLI is not available or command fails
   * @example
   * ```typescript
   * const toolchainVersion = await validator.getToolchainVersion('0.25.0');
   * console.log(`Toolchain: ${toolchainVersion}`);
   * ```
   */
  async getToolchainVersion(version?: string): Promise<string> {
    const versionFlag = version ? `+${version}` : '';
    const { stdout } = await this.execFn(
      `compact compile ${versionFlag} --version`,
    );
    return stdout.trim();
  }

  /**
   * Validates the entire Compact environment and ensures it's ready for compilation.
   * Checks CLI availability and retrieves version information.
   *
   * @param version - Optional specific toolchain version to validate
   * @throws {CompactCliNotFoundError} If the Compact CLI is not available
   * @throws {Error} If version commands fail
   * @example
   * ```typescript
   * try {
   *   await validator.validate('0.25.0');
   *   console.log('Environment validated successfully');
   * } catch (error) {
   *   if (error instanceof CompactCliNotFoundError) {
   *     console.error('Please install Compact CLI');
   *   }
   * }
   * ```
   */
  async validate(
    version?: string,
  ): Promise<{ devToolsVersion: string; toolchainVersion: string }> {
    const isAvailable = await this.checkCompactAvailable();
    if (!isAvailable) {
      throw new CompactCliNotFoundError(
        "'compact' CLI not found in PATH. Please install the Compact developer tools.",
      );
    }

    const devToolsVersion = await this.getDevToolsVersion();
    const toolchainVersion = await this.getToolchainVersion(version);

    return { devToolsVersion, toolchainVersion };
  }
}

/**
 * Service responsible for discovering .compact files in the source directory.
 * Recursively scans directories and filters for .compact file extensions.
 *
 * @class FileDiscovery
 * @example
 * ```typescript
 * const discovery = new FileDiscovery();
 * const files = await discovery.getCompactFiles('src/security');
 * console.log(`Found ${files.length} .compact files`);
 * ```
 */
export class FileDiscovery {
  /**
   * Recursively discovers all .compact files in a directory.
   * Returns relative paths from the SRC_DIR for consistent processing.
   *
   * @param dir - Directory path to search (relative or absolute)
   * @returns Promise resolving to array of relative file paths
   * @example
   * ```typescript
   * const files = await discovery.getCompactFiles('src');
   * // Returns: ['contracts/Token.compact', 'security/AccessControl.compact']
   * ```
   */
  async getCompactFiles(dir: string): Promise<string[]> {
    try {
      const dirents = await readdir(dir, { withFileTypes: true });
      const filePromises = dirents.map(async (entry) => {
        const fullPath = join(dir, entry.name);
        try {
          if (entry.isDirectory()) {
            return await this.getCompactFiles(fullPath);
          }

          if (entry.isFile() && fullPath.endsWith('.compact')) {
            return [relative(SRC_DIR, fullPath)];
          }
          return [];
        } catch (err) {
          // biome-ignore lint/suspicious/noConsole: Needed to display error and file path
          console.warn(`Error accessing ${fullPath}:`, err);
          return [];
        }
      });

      const results = await Promise.all(filePromises);
      return results.flat();
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: Needed to display error and dir path
      console.error(`Failed to read dir: ${dir}`, err);
      return [];
    }
  }
}

/**
 * Service responsible for compiling individual .compact files.
 * Handles command construction, execution, and error processing.
 *
 * @class CompilerService
 * @example
 * ```typescript
 * const compiler = new CompilerService();
 * const result = await compiler.compileFile(
 *   'contracts/Token.compact',
 *   '--skip-zk --verbose',
 *   '0.25.0'
 * );
 * console.log('Compilation output:', result.stdout);
 * ```
 */
export class CompilerService {
  private execFn: ExecFunction;

  /**
   * Creates a new CompilerService instance.
   *
   * @param execFn - Function to execute shell commands (defaults to promisified child_process.exec)
   */
  constructor(execFn: ExecFunction = promisify(execCallback)) {
    this.execFn = execFn;
  }

  /**
   * Compiles a single .compact file using the Compact CLI.
   * Constructs the appropriate command with flags and version, then executes it.
   *
   * @param file - Relative path to the .compact file from SRC_DIR
   * @param flags - Space-separated compiler flags (e.g., '--skip-zk --verbose')
   * @param version - Optional specific toolchain version to use
   * @returns Promise resolving to compilation output (stdout/stderr)
   * @throws {CompilationError} If compilation fails for any reason
   * @example
   * ```typescript
   * try {
   *   const result = await compiler.compileFile(
   *     'security/AccessControl.compact',
   *     '--skip-zk',
   *     '0.25.0'
   *   );
   *   console.log('Success:', result.stdout);
   * } catch (error) {
   *   if (error instanceof CompilationError) {
   *     console.error('Compilation failed for', error.file);
   *   }
   * }
   * ```
   */
  async compileFile(
    file: string,
    flags: string,
    version?: string,
  ): Promise<{ stdout: string; stderr: string }> {
    const inputPath = join(SRC_DIR, file);
    const outputDir = join(ARTIFACTS_DIR, basename(file, '.compact'));

    const versionFlag = version ? `+${version}` : '';
    const flagsStr = flags ? ` ${flags}` : '';
    const command = `compact compile${versionFlag ? ` ${versionFlag}` : ''}${flagsStr} "${inputPath}" "${outputDir}"`;

    try {
      return await this.execFn(command);
    } catch (error: unknown) {
      let message: string;

      if (error instanceof Error) {
        message = error.message;
      } else {
        message = String(error); // fallback for strings, objects, numbers, etc.
      }

      throw new CompilationError(
        `Failed to compile ${file}: ${message}`,
        file,
        error,
      );
    }
  }
}

/**
 * Utility service for handling user interface output and formatting.
 * Provides consistent styling and formatting for compiler messages and output.
 *
 * @class UIService
 * @example
 * ```typescript
 * UIService.displayEnvInfo('compact 0.1.0', 'Compactc 0.25.0', 'security');
 * UIService.printOutput('Compilation successful', chalk.green);
 * ```
 */
export const UIService = {
  /**
   * Prints formatted output with consistent indentation and coloring.
   * Filters empty lines and adds consistent indentation for readability.
   *
   * @param output - Raw output text to format
   * @param colorFn - Chalk color function for styling
   * @example
   * ```typescript
   * UIService.printOutput(stdout, chalk.cyan);
   * UIService.printOutput(stderr, chalk.red);
   * ```
   */
  printOutput(output: string, colorFn: (text: string) => string): void {
    const lines = output
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => `    ${line}`);
    console.log(colorFn(lines.join('\n')));
  },

  /**
   * Displays environment information including tool versions and configuration.
   * Shows developer tools version, toolchain version, and optional settings.
   *
   * @param devToolsVersion - Version string of the Compact developer tools
   * @param toolchainVersion - Version string of the Compact toolchain/compiler
   * @param targetDir - Optional target directory being compiled
   * @param version - Optional specific version being used
   * @example
   * ```typescript
   * UIService.displayEnvInfo(
   *   'compact 0.1.0',
   *   'Compactc version: 0.25.0',
   *   'security',
   *   '0.25.0'
   * );
   * ```
   */
  displayEnvInfo(
    devToolsVersion: string,
    toolchainVersion: string,
    targetDir?: string,
    version?: string,
  ): void {
    const spinner = ora();

    if (targetDir) {
      spinner.info(chalk.blue(`[COMPILE] TARGET_DIR: ${targetDir}`));
    }

    spinner.info(
      chalk.blue(`[COMPILE] Compact developer tools: ${devToolsVersion}`),
    );
    spinner.info(
      chalk.blue(`[COMPILE] Compact toolchain: ${toolchainVersion}`),
    );

    if (version) {
      spinner.info(chalk.blue(`[COMPILE] Using toolchain version: ${version}`));
    }
  },

  /**
   * Displays compilation start message with file count and optional location.
   *
   * @param fileCount - Number of files to be compiled
   * @param targetDir - Optional target directory being compiled
   * @example
   * ```typescript
   * UIService.showCompilationStart(5, 'security');
   * // Output: "Found 5 .compact file(s) to compile in security/"
   * ```
   */
  showCompilationStart(fileCount: number, targetDir?: string): void {
    const searchLocation = targetDir ? ` in ${targetDir}/` : '';
    const spinner = ora();
    spinner.info(
      chalk.blue(
        `[COMPILE] Found ${fileCount} .compact file(s) to compile${searchLocation}`,
      ),
    );
  },

  /**
   * Displays a warning message when no .compact files are found.
   *
   * @param targetDir - Optional target directory that was searched
   * @example
   * ```typescript
   * UIService.showNoFiles('security');
   * // Output: "No .compact files found in security/."
   * ```
   */
  showNoFiles(targetDir?: string): void {
    const searchLocation = targetDir ? `${targetDir}/` : '';
    const spinner = ora();
    spinner.warn(
      chalk.yellow(`[COMPILE] No .compact files found in ${searchLocation}.`),
    );
  },
};

/**
 * Main compiler class that orchestrates the compilation process.
 * Coordinates environment validation, file discovery, and compilation services
 * to provide a complete .compact file compilation solution.
 *
 * Features:
 * - Dependency injection for testability
 * - Structured error propagation with custom error types
 * - Progress reporting and user feedback
 * - Support for compiler flags and toolchain versions
 * - Environment variable integration
 *
 * @class CompactCompiler
 * @example
 * ```typescript
 * // Basic usage
 * const compiler = new CompactCompiler('--skip-zk', 'security', '0.25.0');
 * await compiler.compile();
 *
 * // Factory method usage
 * const compiler = CompactCompiler.fromArgs(['--dir', 'security', '--skip-zk']);
 * await compiler.compile();
 *
 * // With environment variables
 * process.env.SKIP_ZK = 'true';
 * const compiler = CompactCompiler.fromArgs(['--dir', 'token']);
 * await compiler.compile();
 * ```
 */
export class CompactCompiler {
  /** Environment validation service */
  private readonly environmentValidator: EnvironmentValidator;
  /** File discovery service */
  private readonly fileDiscovery: FileDiscovery;
  /** Compilation execution service */
  private readonly compilerService: CompilerService;

  /** Compiler flags to pass to the Compact CLI */
  private readonly flags: string;
  /** Optional target directory to limit compilation scope */
  private readonly targetDir?: string;
  /** Optional specific toolchain version to use */
  private readonly version?: string;

  /**
   * Creates a new CompactCompiler instance with specified configuration.
   *
   * @param flags - Space-separated compiler flags (e.g., '--skip-zk --verbose')
   * @param targetDir - Optional subdirectory within src/ to compile (e.g., 'security', 'token')
   * @param version - Optional toolchain version to use (e.g., '0.25.0')
   * @param execFn - Optional custom exec function for dependency injection
   * @example
   * ```typescript
   * // Compile all files with flags
   * const compiler = new CompactCompiler('--skip-zk --verbose');
   *
   * // Compile specific directory
   * const compiler = new CompactCompiler('', 'security');
   *
   * // Compile with specific version
   * const compiler = new CompactCompiler('--skip-zk', undefined, '0.25.0');
   *
   * // For testing with custom exec function
   * const mockExec = vi.fn();
   * const compiler = new CompactCompiler('', undefined, undefined, mockExec);
   * ```
   */
  constructor(
    flags = '',
    targetDir?: string,
    version?: string,
    execFn?: ExecFunction,
  ) {
    this.flags = flags.trim();
    this.targetDir = targetDir;
    this.version = version;
    this.environmentValidator = new EnvironmentValidator(execFn);
    this.fileDiscovery = new FileDiscovery();
    this.compilerService = new CompilerService(execFn);
  }

  /**
   * Factory method to create a CompactCompiler from command-line arguments.
   * Parses various argument formats including flags, directories, versions, and environment variables.
   *
   * Supported argument patterns:
   * - `--dir <directory>` - Target specific directory
   * - `+<version>` - Use specific toolchain version
   * - Other arguments - Treated as compiler flags
   * - `SKIP_ZK=true` environment variable - Adds --skip-zk flag
   *
   * @param args - Array of command-line arguments
   * @param env - Environment variables (defaults to process.env)
   * @returns New CompactCompiler instance configured from arguments
   * @throws {Error} If --dir flag is provided without a directory name
   * @example
   * ```typescript
   * // Parse command line: compact-compiler --dir security --skip-zk +0.25.0
   * const compiler = CompactCompiler.fromArgs([
   *   '--dir', 'security',
   *   '--skip-zk',
   *   '+0.25.0'
   * ]);
   *
   * // With environment variable
   * const compiler = CompactCompiler.fromArgs(
   *   ['--dir', 'token'],
   *   { SKIP_ZK: 'true' }
   * );
   *
   * // Empty args with environment
   * const compiler = CompactCompiler.fromArgs([], { SKIP_ZK: 'true' });
   * ```
   */
  static fromArgs(
    args: string[],
    env: NodeJS.ProcessEnv = process.env,
  ): CompactCompiler {
    let targetDir: string | undefined;
    const flags: string[] = [];
    let version: string | undefined;

    if (env.SKIP_ZK === 'true') {
      flags.push('--skip-zk');
    }

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--dir') {
        const dirNameExists =
          i + 1 < args.length && !args[i + 1].startsWith('--');
        if (dirNameExists) {
          targetDir = args[i + 1];
          i++;
        } else {
          throw new Error('--dir flag requires a directory name');
        }
      } else if (args[i].startsWith('+')) {
        version = args[i].slice(1);
      } else {
        // Only add flag if it's not already present
        if (!flags.includes(args[i])) {
          flags.push(args[i]);
        }
      }
    }

    return new CompactCompiler(flags.join(' '), targetDir, version);
  }

  /**
   * Validates the compilation environment and displays version information.
   * Performs environment validation, retrieves toolchain versions, and shows configuration details.
   *
   * Process:
   *
   * 1. Validates CLI availability and toolchain compatibility
   * 2. Retrieves developer tools and compiler versions
   * 3. Displays environment configuration information
   *
   * @throws {CompactCliNotFoundError} If Compact CLI is not available in PATH
   * @throws {Error} If version retrieval or other validation steps fail
   * @example
   * ```typescript
   * try {
   *   await compiler.validateEnvironment();
   *   console.log('Environment ready for compilation');
   * } catch (error) {
   *   if (error instanceof CompactCliNotFoundError) {
   *     console.error('Please install Compact CLI');
   *   }
   * }
   * ```
   */
  async validateEnvironment(): Promise<void> {
    const { devToolsVersion, toolchainVersion } =
      await this.environmentValidator.validate(this.version);
    UIService.displayEnvInfo(
      devToolsVersion,
      toolchainVersion,
      this.targetDir,
      this.version,
    );
  }

  /**
   * Main compilation method that orchestrates the entire compilation process.
   *
   * Process flow:
   * 1. Validates environment and shows configuration
   * 2. Discovers .compact files in target directory
   * 3. Compiles each file with progress reporting
   * 4. Handles errors and provides user feedback
   *
   * @throws {CompactCliNotFoundError} If Compact CLI is not available
   * @throws {DirectoryNotFoundError} If target directory doesn't exist
   * @throws {CompilationError} If any file compilation fails
   * @example
   * ```typescript
   * const compiler = new CompactCompiler('--skip-zk', 'security');
   *
   * try {
   *   await compiler.compile();
   *   console.log('All files compiled successfully');
   * } catch (error) {
   *   if (error instanceof DirectoryNotFoundError) {
   *     console.error(`Directory not found: ${error.directory}`);
   *   } else if (error instanceof CompilationError) {
   *     console.error(`Failed to compile: ${error.file}`);
   *   }
   * }
   * ```
   */
  async compile(): Promise<void> {
    await this.validateEnvironment();

    const searchDir = this.targetDir ? join(SRC_DIR, this.targetDir) : SRC_DIR;

    // Validate target directory exists
    if (this.targetDir && !existsSync(searchDir)) {
      throw new DirectoryNotFoundError(
        `Target directory ${searchDir} does not exist`,
        searchDir,
      );
    }

    const compactFiles = await this.fileDiscovery.getCompactFiles(searchDir);

    if (compactFiles.length === 0) {
      UIService.showNoFiles(this.targetDir);
      return;
    }

    UIService.showCompilationStart(compactFiles.length, this.targetDir);

    for (const [index, file] of compactFiles.entries()) {
      await this.compileFile(file, index, compactFiles.length);
    }
  }

  /**
   * Compiles a single file with progress reporting and error handling.
   * Private method used internally by the main compile() method.
   *
   * @param file - Relative path to the .compact file
   * @param index - Current file index (0-based) for progress tracking
   * @param total - Total number of files being compiled
   * @throws {CompilationError} If compilation fails
   * @private
   */
  private async compileFile(
    file: string,
    index: number,
    total: number,
  ): Promise<void> {
    const step = `[${index + 1}/${total}]`;
    const spinner = ora(
      chalk.blue(`[COMPILE] ${step} Compiling ${file}`),
    ).start();

    try {
      const result = await this.compilerService.compileFile(
        file,
        this.flags,
        this.version,
      );

      spinner.succeed(chalk.green(`[COMPILE] ${step} Compiled ${file}`));
      // Filter out compactc version output from compact compile
      const filteredOutput = result.stdout.split('\n').slice(1).join('\n');

      if (filteredOutput) {
        UIService.printOutput(filteredOutput, chalk.cyan);
      }
      UIService.printOutput(result.stderr, chalk.yellow);
    } catch (error) {
      spinner.fail(chalk.red(`[COMPILE] ${step} Failed ${file}`));

      if (
        error instanceof CompilationError &&
        isPromisifiedChildProcessError(error)
      ) {
        const execError = error;
        // Filter out compactc version output from compact compile
        const filteredOutput = execError.stdout.split('\n').slice(1).join('\n');

        if (filteredOutput) {
          UIService.printOutput(filteredOutput, chalk.cyan);
        }
        UIService.printOutput(execError.stderr, chalk.red);
      }

      throw error;
    }
  }

  /**
   * For testing
   */
  get testFlags(): string {
    return this.flags;
  }
  get testTargetDir(): string | undefined {
    return this.targetDir;
  }
  get testVersion(): string | undefined {
    return this.version;
  }
}
