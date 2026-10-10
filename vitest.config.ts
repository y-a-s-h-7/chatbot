import { defineConfig } from 'vitest/config';

/**
 * Standalone Vitest config: unit tests run in a plain Node environment with no
 * UI plugins (React refresh, Tailwind, dev-server middleware) involved.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    reporters: ['default'],
  },
});
