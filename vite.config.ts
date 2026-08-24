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
        description: 'Real ECG recordings synced to a manipulable conduction model — see why each waveform looks the way it does.',
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
        navigateFallback: '/index.html',
      },
    }),
  ],
})
