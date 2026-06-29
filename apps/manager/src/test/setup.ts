import '@testing-library/jest-dom/vitest'
import { configureSession } from '@intelli/api-client'
import { SESSION_KEY } from '../store/auth'

configureSession(SESSION_KEY)

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})
