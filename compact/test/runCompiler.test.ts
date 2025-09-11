import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompactCompiler } from '../src/Compiler.js';
import {
  CompactCliNotFoundError,
  CompilationError,
  DirectoryNotFoundError,
  isPromisifiedChildProcessError,
  PromisifiedChildProcessError,
} from '../src/types/errors.js';

// Mock CompactCompiler
vi.mock('../src/Compiler.js', () => ({
  CompactCompiler: {
    fromArgs: vi.fn(),
  },
}));

// Mock error utilities
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
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => { });

describe('runCompiler CLI', () => {
  let mockCompile: ReturnType<typeof vi.fn>;
  let mockFromArgs: ReturnType<typeof vi.fn>;
  let originalArgv: string[];

  beforeEach(() => {
    // Store original argv
    originalArgv = [...process.argv];

    vi.clearAllMocks();
    vi.resetModules();

    mockCompile = vi.fn();
    mockFromArgs = vi.mocked(CompactCompiler.fromArgs);

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
    it('should compile successfully with no arguments', async () => {
      mockCompile.mockResolvedValue(undefined);

      // Import and run the CLI
      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith([]);
      expect(mockCompile).toHaveBeenCalled();
      expect(mockExit).not.toHaveBeenCalled();
    });

    it('should compile successfully with arguments', async () => {
      process.argv = [
        'node',
        'runCompiler.js',
        '--dir',
        'security',
        '--skip-zk',
      ];
      mockCompile.mockResolvedValue(undefined);

      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith([
        '--dir',
        'security',
        '--skip-zk',
      ]);
      expect(mockCompile).toHaveBeenCalled();
      expect(mockExit).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle CompactCliNotFoundError with installation instructions', async () => {
      const error = new CompactCliNotFoundError('CLI not found');
      mockCompile.mockRejectedValue(error);

      await import('../src/runCompiler.js');

      expect(mockSpinner.fail).toHaveBeenCalledWith(
        '[COMPILE] Error: CLI not found',
      );
      expect(mockSpinner.info).toHaveBeenCalledWith(
        "[COMPILE] Install with: curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh",
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should handle DirectoryNotFoundError with helpful message', async () => {
      const error = new DirectoryNotFoundError(
        'Directory not found',
        'src/nonexistent',
      );
      mockCompile.mockRejectedValue(error);

      await import('../src/runCompiler.js');

      expect(mockSpinner.fail).toHaveBeenCalledWith(
        '[COMPILE] Error: Directory not found',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith('\nAvailable directories:');
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  --dir access    # Compile access control contracts',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  --dir archive   # Compile archive contracts',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  --dir security  # Compile security contracts',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  --dir token     # Compile token contracts',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  --dir utils     # Compile utility contracts',
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should handle CompilationError with file context and cause', async () => {
      const mockIsPromisifiedChildProcessError = vi.mocked(
        isPromisifiedChildProcessError,
      );

      const childProcessError = {
        message: 'Syntax error',
        stdout: 'some output',
        stderr: 'error details',
      };

      // Return true for this specific error
      mockIsPromisifiedChildProcessError.mockImplementation(
        (err) => err === childProcessError,
      );

      const error = new CompilationError(
        'Compilation failed',
        'MyToken.compact',
        childProcessError
      );
      mockCompile.mockRejectedValue(error);

      await import('../src/runCompiler.js');

      expect(mockSpinner.fail).toHaveBeenCalledWith(
        '[COMPILE] Compilation failed for file: MyToken.compact',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(`    Additional error details: ${(error.cause as PromisifiedChildProcessError).stderr}`)
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should handle CompilationError with unknown file', async () => {
      const error = new CompilationError('Compilation failed');
      mockCompile.mockRejectedValue(error);

      await import('../src/runCompiler.js');

      expect(mockSpinner.fail).toHaveBeenCalledWith(
        '[COMPILE] Compilation failed for file: unknown',
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should handle argument parsing errors', async () => {
      const error = new Error('--dir flag requires a directory name');
      mockFromArgs.mockImplementation(() => {
        throw error;
      });

      await import('../src/runCompiler.js');

      expect(mockSpinner.fail).toHaveBeenCalledWith(
        '[COMPILE] Error: --dir flag requires a directory name',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '\nUsage: compact-compiler [options]',
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should handle unexpected errors', async () => {
      const msg = 'Something unexpected happened';
      const error = new Error(msg);
      mockCompile.mockRejectedValue(error);

      await import('../src/runCompiler.js');

      expect(mockSpinner.fail).toHaveBeenCalledWith(
        `[COMPILE] Unexpected error: ${msg}`,
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '\nIf this error persists, please check:',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  • Compact CLI is installed and in PATH',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  • Source files exist and are readable',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  • Specified Compact version exists',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  • File system permissions are correct',
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should handle non-Error exceptions', async () => {
      const msg = 'String error';
      mockCompile.mockRejectedValue(msg);

      await import('../src/runCompiler.js');

      expect(mockSpinner.fail).toHaveBeenCalledWith(
        `[COMPILE] Unexpected error: ${msg}`,
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe('environment validation errors', () => {
    it('should handle promisified child process errors', async () => {
      const mockIsPromisifiedChildProcessError = vi.mocked(
        isPromisifiedChildProcessError,
      );

      const error = {
        message: 'Command failed',
        stdout: 'some output',
        stderr: 'error details',
      };

      // Return true for this specific error
      mockIsPromisifiedChildProcessError.mockImplementation(
        (err) => err === error,
      );
      mockCompile.mockRejectedValue(error);

      await import('../src/runCompiler.js');

      expect(mockIsPromisifiedChildProcessError).toHaveBeenCalledWith(error);
      expect(mockSpinner.fail).toHaveBeenCalledWith(
        '[COMPILE] Environment validation failed: Command failed',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith('\nTroubleshooting:');
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  • Check that Compact CLI is installed and in PATH',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  • Verify the specified Compact version exists',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  • Ensure you have proper permissions',
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe('usage help', () => {
    it('should show complete usage help for argument parsing errors', async () => {
      const error = new Error('--dir flag requires a directory name');
      mockFromArgs.mockImplementation(() => {
        throw error;
      });

      await import('../src/runCompiler.js');

      // Verify all sections of help are shown
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '\nUsage: compact-compiler [options]',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith('\nOptions:');
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  --dir <directory> Compile specific directory (access, archive, security, token, utils)',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  --skip-zk         Skip zero-knowledge proof generation',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  +<version>        Use specific toolchain version (e.g., +0.24.0)',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith('\nExamples:');
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  compact-compiler                           # Compile all files',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  compact-compiler --dir security             # Compile security directory',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  compact-compiler --dir access --skip-zk     # Compile access with flags',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  SKIP_ZK=true compact-compiler --dir token   # Use environment variable',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  compact-compiler --skip-zk +0.24.0          # Use specific version',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith('\nTurbo integration:');
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  turbo compact                               # Full build',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  turbo compact:security -- --skip-zk         # Directory with flags',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  SKIP_ZK=true turbo compact                  # Environment variables',
      );
    });
  });

  describe('directory error help', () => {
    it('should show all available directories', async () => {
      const error = new DirectoryNotFoundError(
        'Directory not found',
        'src/invalid',
      );
      mockCompile.mockRejectedValue(error);

      await import('../src/runCompiler.js');

      expect(mockConsoleLog).toHaveBeenCalledWith('\nAvailable directories:');
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  --dir access    # Compile access control contracts',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  --dir archive   # Compile archive contracts',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  --dir security  # Compile security contracts',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  --dir token     # Compile token contracts',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '  --dir utils     # Compile utility contracts',
      );
    });
  });

  describe('real-world command scenarios', () => {
    beforeEach(() => {
      mockCompile.mockResolvedValue(undefined);
    });

    it('should handle turbo compact', async () => {
      process.argv = ['node', 'runCompiler.js'];

      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith([]);
    });

    it('should handle turbo compact:security', async () => {
      process.argv = ['node', 'runCompiler.js', '--dir', 'security'];

      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith(['--dir', 'security']);
    });

    it('should handle turbo compact:access -- --skip-zk', async () => {
      process.argv = ['node', 'runCompiler.js', '--dir', 'access', '--skip-zk'];

      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith([
        '--dir',
        'access',
        '--skip-zk',
      ]);
    });

    it('should handle version specification', async () => {
      process.argv = ['node', 'runCompiler.js', '+0.24.0', '--skip-zk'];

      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith(['+0.24.0', '--skip-zk']);
    });

    it('should handle complex command', async () => {
      process.argv = [
        'node',
        'runCompiler.js',
        '--dir',
        'security',
        '--skip-zk',
        '--verbose',
        '+0.24.0',
      ];

      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith([
        '--dir',
        'security',
        '--skip-zk',
        '--verbose',
        '+0.24.0',
      ]);
    });
  });

  describe('integration with CompactCompiler', () => {
    it('should pass arguments correctly to CompactCompiler.fromArgs', async () => {
      const args = ['--dir', 'token', '--skip-zk', '+0.24.0'];
      process.argv = ['node', 'runCompiler.js', ...args];
      mockCompile.mockResolvedValue(undefined);

      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith(args);
      expect(mockFromArgs).toHaveBeenCalledTimes(1);
      expect(mockCompile).toHaveBeenCalledTimes(1);
    });

    it('should handle empty arguments', async () => {
      process.argv = ['node', 'runCompiler.js'];
      mockCompile.mockResolvedValue(undefined);

      await import('../src/runCompiler.js');

      expect(mockFromArgs).toHaveBeenCalledWith([]);
    });
  });
});
