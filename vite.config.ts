import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createScriptRunnerMiddleware } from './server/middleware.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'script-runner-api',
      configureServer(server) {
        server.middlewares.use(createScriptRunnerMiddleware())
      },
    },
  ],
})
