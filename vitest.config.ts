import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/*.test.ts',
      'apps/api/tests/**/*.test.ts',
      'apps/worker/**/*.test.ts',
      'modules/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', 'apps/web/e2e/**'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
