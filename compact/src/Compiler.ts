#!/usr/bin/env node

import { basename, join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import {
  ARTIFACTS_DIR,
  BaseCompactOperation,
  BaseCompactService,
  BaseEnvironmentValidator,
  type ExecFunction,
  SharedUIService,
  SRC_DIR,
} from './BaseServices.js';
import {
  CompilationError,
  isPromisifiedChildProcessError,
} from './types/errors.ts';

/**
 * Environment validator specialized for Compact compilation operations.
 *
 * Extends the base validator with compilation-specific requirements including
 * toolchain version validation and compatibility checking. Ensures the Compact
 * compiler toolchain is available and properly configured before attempting
 * compilation operations.
 *
 * @example
 * ```typescript
 * const validator = new CompilerEnvironmentValidator();
 * const { devToolsVersion, toolchainVersion } = await validator.validate('1.2.0');
 * console.log(`Using toolchain ${toolchainVersion}`);
 * ```
 */
export class CompilerEnvironmentValidator extends BaseEnvironmentValidator {
  /**
   * Retrieves the version string of the Compact compiler toolchain.
   *
   * Queries the Compact CLI for toolchain version information, optionally
   * targeting a specific version. This is separate from the dev tools version
   * and represents the actual compiler backend being used.
   *
   * @param version - Optional specific toolchain version to query (e.g., '1.2.0')
   * @returns Promise resolving to the trimmed toolchain version string
   * @throws Error if the toolchain version command fails or version doesn't exist
   *
   * @example
   * ```typescript
   * // Get default toolchain version
   * const defaultVersion = await validator.getToolchainVersion();
   *
   * // Get specific toolchain version
   * const specificVersion = await validator.getToolchainVersion('1.2.0');
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
   * Performs comprehensive environment validation for compilation operations.
   *
   * Validates both the base Compact CLI environment and compilation-specific
   * requirements. Ensures that the specified toolchain version (if any) is
   * available and properly installed.
   *
   * @param version - Optional specific toolchain version to validate
   * @returns Promise resolving to validation results including both dev tools and toolchain versions
   * @throws CompactCliNotFoundError if CLI is not available
   * @throws Error if specified toolchain version is not available
   *
   * @example
   * ```typescript
   * // Validate with default toolchain
   * const result = await validator.validate();
   *
   * // Validate with specific toolchain version
   * const result = await validator.validate('1.2.0');
   * console.log(`Dev tools: ${result.devToolsVersion}, Toolchain: ${result.toolchainVersion}`);
   * ```
   */
  async validate(version?: string): Promise<{
    devToolsVersion: string;
    toolchainVersion: string;
  }> {
    const { devToolsVersion } = await this.validateBase();
    const toolchainVersion = await this.getToolchainVersion(version);

    return { devToolsVersion, toolchainVersion };
  }
}

/**
 * Service for executing Compact compilation commands.
 *
 * Handles the construction and execution of compilation commands for individual
 * .compact files. Manages input/output path resolution, command flag application,
 * and version targeting. Provides consistent error handling for compilation failures.
 *
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
export class CompilerService extends BaseCompactService {
  /**
   * Compiles a single .compact file using the Compact CLI.
   *
   * Constructs the appropriate compilation command with input/output paths,
   * applies the specified flags and version, then executes the compilation.
   * Input files are resolved relative to SRC_DIR, and output is written to
   * a subdirectory in ARTIFACTS_DIR named after the input file.
   *
   * @param file - Relative path to the .compact file from SRC_DIR (e.g., 'Token.compact')
   * @param flags - Compilation flags to apply (e.g., '--skip-zk')
   * @param version - Optional specific toolchain version to use (e.g., '1.2.0')
   * @returns Promise resolving to command execution results with stdout and stderr
   * @throws CompilationError if the compilation fails
   *
   * @example
   * ```typescript
   * // Basic compilation
   * await compiler.compileFile('Token.compact', '', undefined);
   *
   * // Compilation with flags and version
   * await compiler.compileFile(
   *   'contracts/security/AccessControl.compact',
   *   '--skip-zk',
   *   '1.2.0'
   * );
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

    return this.executeCompactCommand(command, `Failed to compile ${file}`);
  }

  /**
   * Creates compilation-specific error instances.
   *
   * Wraps compilation failures in CompilationError instances that provide
   * additional context including the file that failed to compile. Extracts
   * the filename from error messages when possible for better error reporting.
   *
   * @param message - Error message describing the compilation failure
   * @param cause - Original error that caused the compilation failure (optional)
   * @returns CompilationError instance with file context and cause information
   *
   * @example
   * ```typescript
   * // This method is called automatically by executeCompactCommand
   * // when compilation fails, creating errors like:
   * // CompilationError: Failed to compile Token.compact: syntax error
   * ```
   */
  protected createError(message: string, cause?: unknown): Error {
    // Extract file name from error message for CompilationError
    const match = message.match(/Failed to compile (.+?):/);
    const file = match ? match[1] : 'unknown';
    return new CompilationError(message, file, cause);
  }
}

/**
 * UI service specialized for compilation operations.
 *
 * Provides compilation-specific user interface elements and messaging.
 * Extends the shared UI service with compilation-focused information display,
 * progress reporting, and status messaging. Ensures consistent visual presentation
 * across compilation operations.
 */
export const CompilerUIService = {
  ...SharedUIService,

  /**
   * Displays comprehensive compilation environment information.
   *
   * Shows both developer tools and toolchain versions, along with optional
   * target directory and version override information. Provides users with
   * clear visibility into the compilation environment configuration.
   *
   * @param devToolsVersion - Version of the installed Compact developer tools
   * @param toolchainVersion - Version of the Compact compiler toolchain being used
   * @param targetDir - Optional target directory being compiled (relative to src/)
   * @param version - Optional specific toolchain version being used
   *
   * @example
   * ```typescript
   * CompilerUIService.displayEnvInfo(
   *   'compact-dev-tools 2.1.0',
   *   'compact-toolchain 1.8.0',
   *   'contracts',
   *   '1.8.0'
   * );
   * // Output:
   * // ℹ [COMPILE] TARGET_DIR: contracts
   * // ℹ [COMPILE] Compact developer tools: compact-dev-tools 2.1.0
   * // ℹ [COMPILE] Compact toolchain: compact-toolchain 1.8.0
   * // ℹ [COMPILE] Using toolchain version: 1.8.0
   * ```
   */
  displayEnvInfo(
    devToolsVersion: string,
    toolchainVersion: string,
    targetDir?: string,
    version?: string,
  ): void {
    SharedUIService.displayBaseEnvInfo('COMPILE', devToolsVersion, targetDir);

    const spinner = ora();
    spinner.info(
      chalk.blue(`[COMPILE] Compact toolchain: ${toolchainVersion}`),
    );

    if (version) {
      spinner.info(chalk.blue(`[COMPILE] Using toolchain version: ${version}`));
    }
  },

  /**
   * Displays compilation start message with file count and location context.
   *
   * Informs users about the scope of the compilation operation, including
   * the number of files found and the directory being processed. Provides
   * clear expectations about the work to be performed.
   *
   * @param fileCount - Number of .compact files discovered for compilation
   * @param targetDir - Optional target directory being compiled
   *
   * @example
   * ```typescript
   * CompilerUIService.showCompilationStart(3, 'contracts');
   * // Output: ℹ [COMPILE] Found 3 .compact file(s) to compile in contracts/
   *
   * CompilerUIService.showCompilationStart(1);
   * // Output: ℹ [COMPILE] Found 1 .compact file(s) to compile
   * ```
   */
  showCompilationStart(fileCount: number, targetDir?: string): void {
    SharedUIService.showOperationStart(
      'COMPILE',
      'compile',
      fileCount,
      targetDir,
    );
  },

  /**
   * Displays warning when no .compact files are found for compilation.
   *
   * Provides clear feedback when the compilation operation cannot proceed
   * because no source files were discovered in the target location.
   * Helps users understand where files are expected to be located.
   *
   * @param targetDir - Optional target directory that was searched
   *
   * @example
   * ```typescript
   * CompilerUIService.showNoFiles('contracts');
   * // Output: ⚠ [COMPILE] No .compact files found in contracts/.
   *
   * CompilerUIService.showNoFiles();
   * // Output: ⚠ [COMPILE] No .compact files found in src/.
   * ```
   */
  showNoFiles(targetDir?: string): void {
    SharedUIService.showNoFiles('COMPILE', targetDir);
  },
};

/**
 * Main compiler orchestrator for Compact compilation operations.
 *
 * Coordinates the complete compilation workflow from environment validation
 * through file processing. Manages compilation configuration including flags,
 * toolchain versions, and target directories. Provides progress reporting
 * and error handling for batch compilation operations.
 *
 * @example
 * ```typescript
 * // Basic compilation of all files in src/
 * const compiler = new CompactCompiler();
 * await compiler.compile();
 *
 * // Compilation with optimization flags
 * const compiler = new CompactCompiler('--skip-zk');
 * await compiler.compile();
 *
 * // Compilation of specific directory with version override
 * const compiler = new CompactCompiler('', 'contracts', '1.2.0');
 * await compiler.compile();
 * ```
 */
export class CompactCompiler extends BaseCompactOperation {
  private readonly environmentValidator: CompilerEnvironmentValidator;
  private readonly compilerService: CompilerService;
  private readonly flags: string;
  private readonly version?: string;

  /**
   * Creates a new CompactCompiler instance with specified configuration.
   *
   * Initializes the compiler with compilation flags, target directory scope,
   * and optional toolchain version override. Sets up the necessary services
   * for environment validation and command execution.
   *
   * @param flags - Compilation flags to apply to all files (e.g., '--skip-zk')
   * @param targetDir - Optional subdirectory within src/ to limit compilation scope
   * @param version - Optional specific toolchain version to use (e.g., '1.2.0')
   * @param execFn - Optional command execution function for testing/customization
   *
   * @example
   * ```typescript
   * // Compile all files with default settings
   * const compiler = new CompactCompiler();
   * ```
   */
  constructor(
    flags = '',
    targetDir?: string,
    version?: string,
    execFn?: ExecFunction,
  ) {
    super(targetDir);
    this.flags = flags.trim();
    this.version = version;
    this.environmentValidator = new CompilerEnvironmentValidator(execFn);
    this.compilerService = new CompilerService(execFn);
  }

  /**
   * Factory method to create a CompactCompiler from command-line arguments.
   *
   * Parses command-line arguments and environment variables to construct
   * a properly configured CompactCompiler instance. Handles flag processing,
   * directory targeting, version specification, and environment-based configuration.
   *
   * @param args - Raw command-line arguments array
   * @param env - Process environment variables (defaults to process.env)
   * @returns Configured CompactCompiler instance ready for execution
   * @throws Error if arguments are malformed (e.g., --dir without directory name)
   *
   * @example
   * ```typescript
   * // Parse from command line: ['--dir', 'contracts', '+1.2.0']
   * const compiler = CompactCompiler.fromArgs([
   *   '--dir', 'contracts',
   *   '+1.2.0'
   * ]);
   *
   * // With environment variable for skipping ZK proofs
   * const compiler = CompactCompiler.fromArgs(
   *   { SKIP_ZK: 'true' }
   * );
   *
   * // Parse from actual process arguments
   * const compiler = CompactCompiler.fromArgs(process.argv.slice(2));
   * ```
   */
  static fromArgs(
    args: string[],
    env: NodeJS.ProcessEnv = process.env,
  ): CompactCompiler {
    const { targetDir, remainingArgs } = CompactCompiler.parseBaseArgs(args);

    const flags: string[] = [];
    let version: string | undefined;

    if (env.SKIP_ZK === 'true') {
      flags.push('--skip-zk');
    }

    for (const arg of remainingArgs) {
      if (arg.startsWith('+')) {
        version = arg.slice(1);
      } else {
        // Only add flag if it's not already present
        if (!flags.includes(arg)) {
          flags.push(arg);
        }
      }
    }

    return new CompactCompiler(flags.join(' '), targetDir, version);
  }

  /**
   * Validates the compilation environment and displays configuration information.
   *
   * Performs comprehensive environment validation including CLI availability,
   * toolchain version verification, and configuration display. Must be called
   * before attempting compilation operations.
   *
   * @throws CompactCliNotFoundError if Compact CLI is not available
   * @throws Error if specified toolchain version is not available
   *
   * @example
   * ```typescript
   * try {
   *   await compiler.validateEnvironment();
   *   // Environment is valid, proceed with compilation
   * } catch (error) {
   *   if (error instanceof CompactCliNotFoundError) {
   *     console.error('Please install Compact CLI first');
   *   }
   * }
   * ```
   */
  async validateEnvironment(): Promise<void> {
    const { devToolsVersion, toolchainVersion } =
      await this.environmentValidator.validate(this.version);

    CompilerUIService.displayEnvInfo(
      devToolsVersion,
      toolchainVersion,
      this.targetDir,
      this.version,
    );
  }

  /**
   * Displays warning message when no .compact files are found.
   *
   * Shows operation-specific messaging when file discovery returns no results.
   * Provides clear feedback about the search location and expected file locations.
   */
  showNoFiles(): void {
    CompilerUIService.showNoFiles(this.targetDir);
  }

  /**
   * Executes the complete compilation workflow.
   *
   * Orchestrates the full compilation process: validates environment, discovers
   * source files, and compiles each file with progress reporting. Handles batch
   * compilation of multiple files with individual error isolation.
   *
   * @throws CompactCliNotFoundError if Compact CLI is not available
   * @throws DirectoryNotFoundError if target directory doesn't exist
   * @throws CompilationError if any file fails to compile
   *
   * @example
   * ```typescript
   * const compiler = new CompactCompiler('--skip-zk');
   *
   * try {
   *   await compiler.compile();
   *   console.log('Compilation completed successfully');
   * } catch (error) {
   *   if (error instanceof CompilationError) {
   *     console.error(`Failed to compile ${error.file}: ${error.message}`);
   *   }
   * }
   * ```
   */
  async compile(): Promise<void> {
    await this.validateEnvironment();

    const { files } = await this.discoverFiles();
    if (files.length === 0) return;

    CompilerUIService.showCompilationStart(files.length, this.targetDir);

    for (const [index, file] of files.entries()) {
      await this.compileFile(file, index, files.length);
    }
  }

  /**
   * Compiles a single file with progress reporting and error handling.
   *
   * Handles the compilation of an individual .compact file with visual progress
   * indicators, output formatting, and comprehensive error reporting. Provides
   * detailed feedback about compilation status and results.
   *
   * @param file - Relative path to the .compact file from SRC_DIR
   * @param index - Current file index in the batch (0-based)
   * @param total - Total number of files being compiled
   * @throws CompilationError if the file fails to compile
   *
   * @example
   * ```typescript
   * // This method is typically called internally by compile()
   * // but can be used for individual file compilation:
   * await compiler.compileFile('Token.compact', 0, 1);
   * ```
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
      SharedUIService.printOutput(result.stdout, chalk.cyan);
      SharedUIService.printOutput(result.stderr, chalk.yellow);
    } catch (error) {
      spinner.fail(chalk.red(`[COMPILE] ${step} Failed ${file}`));

      if (
        error instanceof CompilationError &&
        isPromisifiedChildProcessError(error.cause)
      ) {
        const execError = error.cause;
        SharedUIService.printOutput(execError.stdout, chalk.cyan);
        SharedUIService.printOutput(execError.stderr, chalk.red);
      }

      throw error;
    }
  }

  /**
   * For testing - expose internal state
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
