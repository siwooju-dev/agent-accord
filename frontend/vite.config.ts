import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite'

/**
 * Where `/api` is proxied. Set ACCORD_API_TARGET in `frontend/.env.local` (git-ignored), e.g.
 *   ACCORD_API_TARGET=https://<name>.trycloudflare.com
 * Default: the backend running on this machine.
 */
const DEFAULT_TARGET = 'http://localhost:8000'
const isLocalTarget = (target: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/i.test(target)

/** A backend on this machine stays reachable only from this machine, also when the UI is shared through a tunnel. */
function guardApi(req: IncomingMessage, res: ServerResponse, next: () => void) {
  if (!/^\/(?:api|__backend)(?:\/|\?|$)/.test(req.url ?? '')) return next()
  const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase()
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(host)
  if (isLocal && !req.headers['x-forwarded-for'] && !req.headers['x-forwarded-host']) return next()
  res.statusCode = 403
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ error: {
    code: 'API_LOCAL_ONLY',
    message: '로컬 백엔드는 이 컴퓨터에서만 사용할 수 있습니다.',
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

// Tunnel hosts allowed to open the UI (e.g. `ngrok http 4173`).
const tunnelHosts = ['.ngrok-free.app', '.ngrok.app', '.ngrok.io', '.trycloudflare.com']

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = (env.ACCORD_API_TARGET || DEFAULT_TARGET).replace(/\/+$/, '')
  const local = isLocalTarget(target)
  const forwardless = local ? undefined : (proxyServer: Parameters<NonNullable<ProxyOptions['configure']>>[0]) => {
    proxyServer.on('proxyReq', (proxyReq) => {
      for (const name of ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip']) proxyReq.removeHeader(name)
    })
  }
  const proxy: Record<string, ProxyOptions> = {
    // Backend health for the status chip in the header (the backend serves it outside the API prefix).
    '/__backend/health': { target, changeOrigin: !local, secure: true, rewrite: () => '/health', configure: forwardless },
    '/api': {
      target,
      changeOrigin: !local,
      secure: true,
      // Don't pass the viewer's tunnel forwarding headers (their IP) on to a remote backend.
      configure: forwardless,
    },
  }
  return {
    plugins: local ? [localApiOnly, react()] : [react()],
    server: { allowedHosts: tunnelHosts, proxy },
    preview: { allowedHosts: tunnelHosts, proxy },
  }
})
