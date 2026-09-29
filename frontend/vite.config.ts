import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'

/** The demo API stays reachable only from this machine, also when the UI is shared through a tunnel. */
function guardApi(req: IncomingMessage, res: ServerResponse, next: () => void) {
  if (!/^\/api(?:\/|\?|$)/.test(req.url ?? '')) return next()
  const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase()
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(host)
  if (isLocal && !req.headers['x-forwarded-for'] && !req.headers['x-forwarded-host']) return next()
  res.statusCode = 403
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ error: {
    code: 'API_LOCAL_ONLY',
    message: '데모 API는 로컬 주소에서만 사용할 수 있습니다.',
  } }))
}

const localApiOnly: Plugin = {
  name: 'local-api-only',
  configureServer(server) {
    server.middlewares.use(guardApi)
  },
  configurePreviewServer(server) {
    server.middlewares.use(guardApi)
  },
}

// Tunnel hosts allowed to open the UI (e.g. `ngrok http 4173`). The /api guard above still applies.
const tunnelHosts = ['.ngrok-free.app', '.ngrok.app', '.ngrok.io', '.trycloudflare.com']

export default defineConfig({
  plugins: [localApiOnly, react()],
  server: {
    allowedHosts: tunnelHosts,
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  preview: {
    allowedHosts: tunnelHosts,
  },
})
