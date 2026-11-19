import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'
import { scaleViewportUnits } from './src/shared/lib/viewportUnits.ts'

// Large screens zoom the whole app (src/shared/lib/viewportScale.ts); keep
// viewport units relative to the real screen while zoomed.
const viewportUnits = (): Plugin => ({
  name: 'jern-viewport-units',
  enforce: 'pre',
  transform(code, id) {
    if (!/\.css(?:$|\?)/.test(id)) return null
    return { code: scaleViewportUnits(code), map: null }
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [viewportUnits(), react()],
  test: {
    exclude: [...configDefaults.exclude, 'tests/**'],
  },
  server: {
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
  preview: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
