import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/api/**/*.test.ts'],
    testTimeout: 30000,  // 30s for real API calls
    hookTimeout: 10000,
    sequence: {
      concurrent: false,  // Sequential to respect rate limits
    },
    setupFiles: ['./tests/api/setup.ts'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'tests/'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
