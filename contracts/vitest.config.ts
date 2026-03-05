import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '#test-utils': './test-utils'
    }
  },
  test: {
    projects: [
      './vitest.config.ts',
      {
        test: {
          name: 'unit',
          globals: true,
          environment: 'node',
          include: ['*.test.ts'],
          exclude: [...configDefaults.exclude, '*.e2e.test.ts'],
        }
      },
      {
        test: {
          name: 'e2e',
          pool: 'forks',       // use forks for process isolation
          include: ['src/**/test/*.e2e.test.ts'],
          exclude: [...configDefaults.exclude],
          hookTimeout: 120_000,
          testTimeout: 60_000,
          environment: 'node',
          globalSetup: './test-utils/e2e-global-setup.ts',
        }
      }
    ]
  },
});
