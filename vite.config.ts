import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'EKG Atlas',
        short_name: 'EKG Atlas',
        description: 'Catch the cannot-miss ECGs. Real recordings, a manipulable conduction model, and the occlusions the STEMI criteria miss — mechanism first.',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#070a0f',
        theme_color: '#070a0f',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,json}'],
        // Recordings are heavy (the quiz bank alone is ~24 MB): never precache
        // them — cache each strip the first time the learner meets it.
        globIgnores: ['**/recordings/**'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: /\/recordings\/.*\.json$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'recordings',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 24 * 3600 },
            },
          },
        ],
      },
    }),
  ],
})
