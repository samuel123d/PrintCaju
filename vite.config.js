import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'firebase',
              test: /node_modules[\\/](?:firebase|@firebase)[\\/]/,
              maxSize: 400_000,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  resolve: {
    dedupe: ['@firebase/app', '@firebase/component'],
  },
})
