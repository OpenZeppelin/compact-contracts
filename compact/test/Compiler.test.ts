import { join } from 'node:path';
import ora from 'ora';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { ARTIFACTS_DIR, SRC_DIR } from '../src/BaseServices.js';
import {
  CompactCompiler,
  CompilerEnvironmentValidator,
  CompilerService,
  CompilerUIService,
} from '../src/Compiler.js';
import { CompilationError } from '../src/types/errors.js';

// Mock dependencies
vi.mock('chalk', () => ({
  default: {
    blue: vi.fn((text) => text),
    green: vi.fn((text) => text),
    red: vi.fn((text) => text),
    yellow: vi.fn((text) => text),
    cyan: vi.fn((text) => text),
  },
}));

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
    info: vi.fn(),
  })),
}));

describe('CompilerEnvironmentValidator', () => {
  let validator: CompilerEnvironmentValidator;
  let mockExec: Mock;

  beforeEach(() => {
    mockExec = vi.fn();
    validator = new CompilerEnvironmentValidator(mockExec);
  });

  describe('getToolchainVersion', () => {
    it('returns default toolchain version', async () => {
      const testData = {
        expectedOutput: 'Compactc version: 0.25.0',
        expectedCommand: 'compact compile  --version',
      };

      mockExec.mockResolvedValue({
        stdout: `  ${testData.expectedOutput}  \n`,
        stderr: '',
      });

      const version = await validator.getToolchainVersion();

      expect(version).toBe(testData.expectedOutput);
      expect(mockExec).toHaveBeenCalledWith(testData.expectedCommand);
    });

    it('returns toolchain version with specific version', async () => {
      const testData = {
        version: '0.25.0',
        expectedOutput: 'Compactc version: 0.25.0',
        expectedCommand: 'compact compile +0.25.0 --version',
      };

      mockExec.mockResolvedValue({
        stdout: testData.expectedOutput,
        stderr: '',
      });

      const version = await validator.getToolchainVersion(testData.version);

      expect(version).toBe(testData.expectedOutput);
      expect(mockExec).toHaveBeenCalledWith(testData.expectedCommand);
    });
  });

  describe('validate', () => {
    it('returns both dev tools and toolchain versions', async () => {
      const testData = {
        devToolsVersion: 'compact 0.2.0',
        toolchainVersion: 'Compactc version: 0.25.0',
      };

      mockExec
        .mockResolvedValueOnce({ stdout: testData.devToolsVersion, stderr: '' })
        .mockResolvedValueOnce({ stdout: testData.devToolsVersion, stderr: '' })
        .mockResolvedValueOnce({
          stdout: testData.toolchainVersion,
          stderr: '',
        });

      const result = await validator.validate();

      expect(result).toEqual({
        devToolsVersion: testData.devToolsVersion,
        toolchainVersion: testData.toolchainVersion,
      });
    });

    it('passes version parameter to getToolchainVersion', async () => {
      const testData = {
        version: '0.25.0',
        devToolsVersion: 'compact 0.2.0',
        toolchainVersion: 'Compactc version: 0.25.0',
      };

      mockExec
        .mockResolvedValueOnce({ stdout: testData.devToolsVersion, stderr: '' })
        .mockResolvedValueOnce({ stdout: testData.devToolsVersion, stderr: '' })
        .mockResolvedValueOnce({
          stdout: testData.toolchainVersion,
          stderr: '',
        });

      await validator.validate(testData.version);

      expect(mockExec).toHaveBeenCalledWith(
        'compact compile +0.25.0 --version',
      );
    });
  });
});

describe('CompilerService', () => {
  let service: CompilerService;
  let mockExec: Mock;

  beforeEach(() => {
    mockExec = vi.fn();
    service = new CompilerService(mockExec);
  });

  describe('compileFile', () => {
    it('constructs correct command with all parameters', async () => {
      const testData = {
        file: 'contracts/MyToken.compact',
        flags: '--skip-zk --verbose',
        version: '0.25.0',
        expectedInputPath: join(SRC_DIR, 'contracts/MyToken.compact'),
        expectedOutputDir: join(ARTIFACTS_DIR, 'MyToken'),
        expectedCommand:
          'compact compile +0.25.0 --skip-zk --verbose "src/contracts/MyToken.compact" "artifacts/MyToken"',
      };

      mockExec.mockResolvedValue({ stdout: 'Success', stderr: '' });

      await service.compileFile(
        testData.file,
        testData.flags,
        testData.version,
      );

      expect(mockExec).toHaveBeenCalledWith(testData.expectedCommand);
    });

    it('constructs command without version flag', async () => {
      const testData = {
        file: 'MyToken.compact',
        flags: '--skip-zk',
        expectedCommand:
          'compact compile --skip-zk "src/MyToken.compact" "artifacts/MyToken"',
      };

      mockExec.mockResolvedValue({ stdout: 'Success', stderr: '' });

      await service.compileFile(testData.file, testData.flags);

      expect(mockExec).toHaveBeenCalledWith(testData.expectedCommand);
    });

    it('constructs command without flags', async () => {
      const testData = {
        file: 'MyToken.compact',
        flags: '',
        expectedCommand:
          'compact compile "src/MyToken.compact" "artifacts/MyToken"',
      };

      mockExec.mockResolvedValue({ stdout: 'Success', stderr: '' });

      await service.compileFile(testData.file, testData.flags);

      expect(mockExec).toHaveBeenCalledWith(testData.expectedCommand);
    });

    it('throws CompilationError on failure', async () => {
      const testData = {
        file: 'MyToken.compact',
        flags: '--skip-zk',
        errorMessage: 'Syntax error on line 10',
      };

      mockExec.mockRejectedValue(new Error(testData.errorMessage));

      await expect(
        service.compileFile(testData.file, testData.flags),
      ).rejects.toThrow(CompilationError);
    });

    it('CompilationError includes file name', async () => {
      const testData = {
        file: 'contracts/MyToken.compact',
        flags: '--skip-zk',
      };

      mockExec.mockRejectedValue(new Error('Compilation failed'));

      try {
        await service.compileFile(testData.file, testData.flags);
      } catch (error) {
        expect(error).toBeInstanceOf(CompilationError);
        expect((error as CompilationError).file).toBe(testData.file);
      }
    });

    it('should include cause in CompilationError', async () => {
      const mockError = new Error('Syntax error');
      mockExec.mockRejectedValue(mockError);

      try {
        await service.compileFile('MyToken.compact', '--skip-zk');
      } catch (error) {
        expect(error).toBeInstanceOf(CompilationError);
        expect((error as CompilationError).cause).toEqual(mockError);
      }
    });
  });

  describe('createError', () => {
    it('extracts file name from error message', () => {
      const testData = {
        message: 'Failed to compile contracts/MyToken.compact: Syntax error',
        expectedFile: 'contracts/MyToken.compact',
      };

      const error = service['createError'](testData.message);

      expect(error).toBeInstanceOf(CompilationError);
      expect((error as CompilationError).file).toBe(testData.expectedFile);
    });

    it('uses "unknown" when file name cannot be extracted', () => {
      const testData = {
        message: 'Some generic error message',
        expectedFile: 'unknown',
      };

      const error = service['createError'](testData.message);

      expect(error).toBeInstanceOf(CompilationError);
      expect((error as CompilationError).file).toBe(testData.expectedFile);
    });
  });
});

describe('CompilerUIService', () => {
  let mockSpinner: any;

  beforeEach(() => {
    mockSpinner = {
      info: vi.fn(),
    };
    vi.mocked(ora).mockReturnValue(mockSpinner);
  });

  describe('displayEnvInfo', () => {
    it('displays all environment information', () => {
      const testData = {
        devToolsVersion: 'compact 0.2.0',
        toolchainVersion: 'Compactc version: 0.25.0',
        targetDir: 'security',
        version: '0.25.0',
      };

      CompilerUIService.displayEnvInfo(
        testData.devToolsVersion,
        testData.toolchainVersion,
        testData.targetDir,
        testData.version,
      );

      expect(mockSpinner.info).toHaveBeenCalledWith(
        '[COMPILE] TARGET_DIR: security',
      );
      expect(mockSpinner.info).toHaveBeenCalledWith(
        '[COMPILE] Compact developer tools: compact 0.2.0',
      );
      expect(mockSpinner.info).toHaveBeenCalledWith(
        '[COMPILE] Compact toolchain: Compactc version: 0.25.0',
      );
      expect(mockSpinner.info).toHaveBeenCalledWith(
        '[COMPILE] Using toolchain version: 0.25.0',
      );
    });

    it('displays minimal environment information', () => {
      const testData = {
        devToolsVersion: 'compact 0.2.0',
        toolchainVersion: 'Compactc version: 0.25.0',
      };

      CompilerUIService.displayEnvInfo(
        testData.devToolsVersion,
        testData.toolchainVersion,
      );

      expect(mockSpinner.info).toHaveBeenCalledWith(
        '[COMPILE] Compact developer tools: compact 0.2.0',
      );
      expect(mockSpinner.info).toHaveBeenCalledWith(
        '[COMPILE] Compact toolchain: Compactc version: 0.25.0',
      );
      expect(mockSpinner.info).not.toHaveBeenCalledWith(
        expect.stringContaining('TARGET_DIR'),
      );
      expect(mockSpinner.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Using toolchain version'),
      );
    });
  });
});

describe('CompactCompiler', () => {
  let compiler: CompactCompiler;
  let mockExec: Mock;

  beforeEach(() => {
    mockExec = vi.fn();
  });

  describe('constructor', () => {
    it('creates instance with default parameters', () => {
      compiler = new CompactCompiler();

      expect(compiler).toBeInstanceOf(CompactCompiler);
      expect(compiler.testFlags).toBe('');
      expect(compiler.testTargetDir).toBeUndefined();
      expect(compiler.testVersion).toBeUndefined();
    });

    it('creates instance with all parameters', () => {
      const testData = {
        flags: '--skip-zk --verbose',
        targetDir: 'security',
        version: '0.25.0',
      };

      compiler = new CompactCompiler(
        testData.flags,
        testData.targetDir,
        testData.version,
        mockExec,
      );

      expect(compiler.testFlags).toBe(testData.flags);
      expect(compiler.testTargetDir).toBe(testData.targetDir);
      expect(compiler.testVersion).toBe(testData.version);
    });

    it('trims flags parameter', () => {
      const testData = {
        inputFlags: '  --skip-zk --verbose  ',
        expectedFlags: '--skip-zk --verbose',
      };

      compiler = new CompactCompiler(testData.inputFlags);

      expect(compiler.testFlags).toBe(testData.expectedFlags);
    });
  });

  describe('fromArgs', () => {
    it('parses empty arguments', () => {
      compiler = CompactCompiler.fromArgs([]);

      expect(compiler.testFlags).toBe('');
      expect(compiler.testTargetDir).toBeUndefined();
      expect(compiler.testVersion).toBeUndefined();
    });

    it('parses SKIP_ZK environment variable', () => {
      const testData = {
        env: { SKIP_ZK: 'true' },
        expectedFlags: '--skip-zk',
      };

      compiler = CompactCompiler.fromArgs([], testData.env);

      expect(compiler.testFlags).toBe(testData.expectedFlags);
    });

    it('ignores SKIP_ZK when not "true"', () => {
      const testData = {
        env: { SKIP_ZK: 'false' },
        expectedFlags: '',
      };

      compiler = CompactCompiler.fromArgs([], testData.env);

      expect(compiler.testFlags).toBe(testData.expectedFlags);
    });

    it('parses complex arguments with all options', () => {
      const testData = {
        args: ['--dir', 'security', '--skip-zk', '--verbose', '+0.25.0'],
        env: {},
        expectedTargetDir: 'security',
        expectedFlags: '--skip-zk --verbose',
        expectedVersion: '0.25.0',
      };

      compiler = CompactCompiler.fromArgs(testData.args, testData.env);

      expect(compiler.testTargetDir).toBe(testData.expectedTargetDir);
      expect(compiler.testFlags).toBe(testData.expectedFlags);
      expect(compiler.testVersion).toBe(testData.expectedVersion);
    });

    it('combines environment variables with CLI flags', () => {
      const testData = {
        args: ['--dir', 'access', '--verbose'],
        env: { SKIP_ZK: 'true' },
        expectedFlags: '--skip-zk --verbose',
      };

      compiler = CompactCompiler.fromArgs(testData.args, testData.env);

      expect(compiler.testFlags).toBe(testData.expectedFlags);
    });

    it('deduplicates flags from environment and CLI', () => {
      const testData = {
        args: ['--skip-zk', '--verbose'],
        env: { SKIP_ZK: 'true' },
        expectedFlags: '--skip-zk --verbose',
      };

      compiler = CompactCompiler.fromArgs(testData.args, testData.env);

      expect(compiler.testFlags).toBe(testData.expectedFlags);
    });

    it('throws error for --dir without argument', () => {
      expect(() => CompactCompiler.fromArgs(['--dir'])).toThrow(
        '--dir flag requires a directory name',
      );
    });

    it('throws error for --dir followed by another flag', () => {
      expect(() => CompactCompiler.fromArgs(['--dir', '--skip-zk'])).toThrow(
        '--dir flag requires a directory name',
      );
    });
  });

  describe('validateEnvironment', () => {
    it('calls validator and displays environment info', async () => {
      const testData = {
        devToolsVersion: 'compact 0.2.0',
        toolchainVersion: 'Compactc version: 0.25.0',
        targetDir: 'security',
        version: '0.25.0',
      };

      mockExec
        .mockResolvedValueOnce({ stdout: testData.devToolsVersion, stderr: '' })
        .mockResolvedValueOnce({ stdout: testData.devToolsVersion, stderr: '' })
        .mockResolvedValueOnce({
          stdout: testData.toolchainVersion,
          stderr: '',
        });

      const displaySpy = vi
        .spyOn(CompilerUIService, 'displayEnvInfo')
        .mockImplementation(() => {});

      compiler = new CompactCompiler(
        '--skip-zk',
        testData.targetDir,
        testData.version,
        mockExec,
      );

      await compiler.validateEnvironment();

      expect(displaySpy).toHaveBeenCalledWith(
        testData.devToolsVersion,
        testData.toolchainVersion,
        testData.targetDir,
        testData.version,
      );

      displaySpy.mockRestore();
    });
  });
});
