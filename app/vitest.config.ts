import { defineConfig } from 'vitest/config'

export default defineConfig({
  mode: 'test',
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    env: { NODE_ENV: 'test' }
  }
})
