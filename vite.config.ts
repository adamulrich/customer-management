import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'

const repoBase = '/customer-management/'
const hasCustomDomain = process.env.GITHUB_PAGES_CUSTOM_DOMAIN === 'true'
const base = process.env.GITHUB_PAGES === 'true' && !hasCustomDomain ? repoBase : '/'
const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string }
const appVersion = packageJson.version

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Prime Pianos CM',
        short_name: 'ppcm',
        description: `Customer management for a prime piano tuning. Version ${appVersion}.`,
        theme_color: '#1f4d3d',
        background_color: '#f4efe6',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          {
            src: `${base}pwa-192.svg`,
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: `${base}pwa-512.svg`,
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
})
