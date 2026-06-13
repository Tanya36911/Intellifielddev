/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    globals: true,
    clearMocks: true,
    setupFiles: './src/test/setup.ts',
    poolOptions: {
      // Node 23+ ships an experimental localStorage global that shadows
      // jsdom's working one inside vitest workers; turn it off there.
      forks: { execArgv: ['--no-experimental-webstorage'] },
    },
  },
})
