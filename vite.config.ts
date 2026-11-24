import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

// index.html loads these public files by fixed name before the app bundle.
// Add a content hash so each release fetches its own copy instead of a cached
// one from an earlier release (which, for example, lacks newer themes).
const VERSIONED_PUBLIC_FILES = ['theme-palettes.css', 'theme-init.js']
const versionPublicFiles = (): Plugin => {
  let publicDir = ''
  return {
    name: 'jern-version-public-files',
    apply: 'build',
    configResolved(config) { publicDir = config.publicDir },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        for (const file of VERSIONED_PUBLIC_FILES) {
          const reference = new RegExp(`(href|src)="/${file.replace(/\./g, '\\.')}"`, 'g')
          if ((html.match(reference) ?? []).length !== 1) {
            throw new Error(`index.html must reference /${file} exactly once`)
          }
          const hash = createHash('sha256').update(readFileSync(join(publicDir, file))).digest('hex').slice(0, 12)
          html = html.replace(reference, `$1="/${file}?v=${hash}"`)
        }
        return html
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [viewportUnits(), versionPublicFiles(), react()],
  test: {
    exclude: [...configDefaults.exclude, 'tests/**'],
    // Let src/shared/lib/theme.test.ts read the palettes; other CSS stays stubbed.
    css: { include: [/theme-palettes\.css/] },
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
