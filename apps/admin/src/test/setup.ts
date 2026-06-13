import '@testing-library/jest-dom/vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})
