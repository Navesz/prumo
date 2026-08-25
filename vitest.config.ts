import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // .test.tsx is included from day one, on purpose. The Herz config sets
    // environment 'node' and includes only *.test.ts, so component tests are
    // never even COLLECTED and the whole UI runs without a net. Here the UI is
    // the product and it is where money is shown.
    include: ['apps/**/*.test.{ts,tsx}', 'packages/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    setupFiles: ['apps/server/tests/setup.ts'],
    testTimeout: 30_000,
  },
})
