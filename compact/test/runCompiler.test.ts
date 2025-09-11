import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseErrorHandler } from '../src/BaseServices.js';
import { CompactCompiler } from '../src/Compiler.js';
import {
  CompactCliNotFoundError,
  CompilationError,
  isPromisifiedChildProcessError,
} from '../src/types/errors.js';

// Mock dependencies
vi.mock('../src/Compiler.js', () => ({
  CompactCompiler: {
    fromArgs: vi.fn(),
  },
}));

vi.mock('../src/BaseServices.js', () => ({
  BaseErrorHandler: {
    handleCommonErrors: vi.fn(),
    handleUnexpectedError: vi.fn(),
  },
}));

vi.mock('../src/types/errors.js', async () => {
  const actual = await vi.importActual('../src/types/errors.js');
  return {
    ...actual,
    isPromisifiedChildProcessError: vi.fn(),
  };
});

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    blue: (text: string) => text,
    red: (text: string) => text,
    yellow: (text: string) => text,
    gray: (text: string) => text,
  },
}));

// Mock ora
const mockSpinner = {
  info: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
};
vi.mock('ora', () => ({
  default: vi.fn(() => mockSpinner),
}));

// Mock process.exit
const mockExit = vi
  .spyOn(process, 'exit')
  .mockImplementation(() => undefined as never);

// Mock console methods
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

describe('runCompiler CLI', () => {
  let mockCompile: ReturnType<typeof vi.fn>;
  let mockFromArgs: ReturnType<typeof vi.fn>;
  let mockHandleCommonErrors: ReturnType<typeof vi.fn>;
  let mockHandleUnexpectedError: ReturnType<typeof vi.fn>;
  let originalArgv: string[];

  beforeEach(() => {
    // Store original argv
    originalArgv = [...process.argv];

    vi.clearAllMocks();
    vi.resetModules();

    mockCompile = vi.fn();
    mockFromArgs = vi.mocked(CompactCompiler.fromArgs);
    mockHandleCommonErrors = vi.mocked(BaseErrorHandler.handleCommonErrors);
    mockHandleUnexpectedError = vi.mocked(
      BaseErrorHandler.handleUnexpectedError,
    );

    // Mock CompactCompiler instance
    mockFromArgs.mockReturnValue({
      compile: mockCompile,
    } as any);

    // Clear all mock calls
    mockSpinner.info.mockClear();
    mockSpinner.fail.mockClear();
    mockSpinner.succeed.mockClear();
    mockConsoleLog.mockClear();
    mockExit.mockClear();
  });

  afterEach(() => {
    // Restore original argv
    process.argv = originalArgv;
  });

  describe('successful compilation', () => {
    it('compiles successfully with no arguments', async () => {
      const testData = {
        expectedArgs: [],
      };

      mockCompile.mockResolvedValue(undefined);

      // Import and run the CLI
      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith(testData.expectedArgs);
      expect(mockCompile).toHaveBeenCalled();
      expect(mockExit).not.toHaveBeenCalled();
    });

    it('compiles successfully with arguments', async () => {
      const testData = {
        args: ['--dir', 'security', '--skip-zk'],
        processArgv: [
          'node',
          'runCompiler.js',
          '--dir',
          'security',
          '--skip-zk',
        ],
      };

      process.argv = testData.processArgv;
      mockCompile.mockResolvedValue(undefined);

      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith(testData.args);
      expect(mockCompile).toHaveBeenCalled();
      expect(mockExit).not.toHaveBeenCalled();
    });
  });

  describe('error handling delegation', () => {
    it('delegates to BaseErrorHandler.handleCommonErrors first', async () => {
      const testData = {
        error: new CompactCliNotFoundError('CLI not found'),
        operation: 'COMPILE',
      };

      mockHandleCommonErrors.mockReturnValue(true); // Indicates error was handled
      mockCompile.mockRejectedValue(testData.error);

      await import('../src/runCompiler.js');

      expect(mockHandleCommonErrors).toHaveBeenCalledWith(
        testData.error,
        expect.any(Object), // spinner
        testData.operation,
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('handles compiler-specific errors when BaseErrorHandler returns false', async () => {
      const testData = {
        error: new CompilationError('Compilation failed', 'MyToken.compact'),
        expectedMessage:
          '[COMPILE] Compilation failed for file: MyToken.compact',
      };

      mockHandleCommonErrors.mockReturnValue(false); // Not handled by base
      mockCompile.mockRejectedValue(testData.error);

      await import('../src/runCompiler.js');

      expect(mockHandleCommonErrors).toHaveBeenCalled();
      expect(mockSpinner.fail).toHaveBeenCalledWith(testData.expectedMessage);
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('handles CompilationError with unknown file', async () => {
      const testData = {
        error: new CompilationError('Compilation failed', ''),
        expectedMessage: '[COMPILE] Compilation failed for file: unknown',
      };

      mockHandleCommonErrors.mockReturnValue(false);
      mockCompile.mockRejectedValue(testData.error);

      await import('../src/runCompiler.js');

      expect(mockSpinner.fail).toHaveBeenCalledWith(testData.expectedMessage);
    });

    it('shows usage help for argument parsing errors', async () => {
      const testData = {
        error: new Error('--dir flag requires a directory name'),
      };

      mockHandleCommonErrors.mockReturnValue(false);
      mockCompile.mockRejectedValue(testData.error);

      await import('../src/runCompiler.js');

      expect(mockConsoleLog).toHaveBeenCalledWith(
        '\nUsage: compact-compiler [options]',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith('\nOptions:');
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('delegates unexpected errors to BaseErrorHandler', async () => {
      const testData = {
        error: new Error('Unexpected error'),
        operation: 'COMPILE',
      };

      mockHandleCommonErrors.mockReturnValue(false);
      mockCompile.mockRejectedValue(testData.error);

      await import('../src/runCompiler.js');

      expect(mockHandleUnexpectedError).toHaveBeenCalledWith(
        testData.error,
        expect.any(Object), // spinner
        testData.operation,
      );
    });
  });

  describe('CompilationError handling', () => {
    it('displays stderr output when available', async () => {
      const testData = {
        execError: {
          stderr: 'Detailed error output',
          stdout: 'some output',
        },
      };

      const compilationError = new CompilationError(
        'Compilation failed',
        'MyToken.compact',
        testData.execError,
      );

      mockHandleCommonErrors.mockReturnValue(false);
      vi.mocked(isPromisifiedChildProcessError).mockReturnValue(true);
      mockCompile.mockRejectedValue(compilationError);

      await import('../src/runCompiler.js');

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining(
          'Additional error details: Detailed error output',
        ),
      );
    });

    it('skips stderr output when it contains stdout/stderr keywords', async () => {
      const testData = {
        execError: {
          stderr: 'Error: stdout and stderr already displayed',
          stdout: 'some output',
        },
      };

      const compilationError = new CompilationError(
        'Compilation failed',
        'MyToken.compact',
        testData.execError,
      );

      mockHandleCommonErrors.mockReturnValue(false);
      vi.mocked(isPromisifiedChildProcessError).mockReturnValue(true);
      mockCompile.mockRejectedValue(compilationError);

      await import('../src/runCompiler.js');

      expect(mockConsoleLog).not.toHaveBeenCalledWith(
        expect.stringContaining('Additional error details'),
      );
    });
  });

  describe('argument parsing error handling', () => {
    it('shows complete usage help', async () => {
      const testData = {
        error: new Error('--dir flag requires a directory name'),
        expectedSections: [
          '\nUsage: compact-compiler [options]',
          '\nOptions:',
          '  --dir <directory> Compile specific directory (access, archive, security, token, utils)',
          '  --skip-zk         Skip zero-knowledge proof generation',
          '  +<version>        Use specific toolchain version (e.g., +0.25.0)',
          '\nExamples:',
          '  compact-compiler                            # Compile all files',
          '  SKIP_ZK=true compact-compiler --dir token   # Use environment variable',
          '\nTurbo integration:',
          '  turbo compact                               # Full build',
        ],
      };

      mockHandleCommonErrors.mockReturnValue(false);
      mockCompile.mockRejectedValue(testData.error);

      await import('../src/runCompiler.js');

      testData.expectedSections.forEach((section) => {
        expect(mockConsoleLog).toHaveBeenCalledWith(section);
      });
    });
  });

  describe('real-world command scenarios', () => {
    beforeEach(() => {
      mockCompile.mockResolvedValue(undefined);
    });

    it('handles turbo compact', async () => {
      const testData = {
        processArgv: ['node', 'runCompiler.js'],
        expectedArgs: [],
      };

      process.argv = testData.processArgv;

      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith(testData.expectedArgs);
    });

    it('handles turbo compact:security', async () => {
      const testData = {
        processArgv: ['node', 'runCompiler.js', '--dir', 'security'],
        expectedArgs: ['--dir', 'security'],
      };

      process.argv = testData.processArgv;

      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith(testData.expectedArgs);
    });

    it('handles complex command with multiple flags', async () => {
      const testData = {
        processArgv: [
          'node',
          'runCompiler.js',
          '--dir',
          'security',
          '--skip-zk',
          '--verbose',
          '+0.24.0',
        ],
        expectedArgs: [
          '--dir',
          'security',
          '--skip-zk',
          '--verbose',
          '+0.24.0',
        ],
      };

      process.argv = testData.processArgv;

      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith(testData.expectedArgs);
    });
  });

  describe('integration with CompactCompiler', () => {
    it('passes arguments correctly to CompactCompiler.fromArgs', async () => {
      const testData = {
        args: ['--dir', 'token', '--skip-zk', '+0.24.0'],
        processArgv: [
          'node',
          'runCompiler.js',
          '--dir',
          'token',
          '--skip-zk',
          '+0.24.0',
        ],
      };

      process.argv = testData.processArgv;
      mockCompile.mockResolvedValue(undefined);

      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith(testData.args);
      expect(mockFromArgs).toHaveBeenCalledTimes(1);
      expect(mockCompile).toHaveBeenCalledTimes(1);
    });

    it('handles fromArgs throwing errors', async () => {
      const testData = {
        error: new Error('Invalid arguments'),
      };

      mockFromArgs.mockImplementation(() => {
        throw testData.error;
      });

      await import('../src/runCompiler.js');

      expect(mockHandleCommonErrors).toHaveBeenCalledWith(
        testData.error,
        expect.any(Object),
        'COMPILE',
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });
});
