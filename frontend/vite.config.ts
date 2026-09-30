import react from '@vitejs/plugin-react'
import { isIP } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite'

/**
 * Where `/api` is proxied. Set ACCORD_API_TARGET in `frontend/.env.local` (git-ignored), e.g.
 *   ACCORD_API_TARGET=http://127.0.0.1:8000
 * Default: the backend running on this machine.
 */
const DEFAULT_TARGET = 'http://localhost:8000'
const isLocalTarget = (target: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/i.test(target)

/** A backend on this machine stays reachable only from this machine, also when the UI is shared through a tunnel. */
function guardApi(req: IncomingMessage, res: ServerResponse, next: () => void, allowPublicTunnel: boolean) {
  if (!/^\/(?:api|__backend)(?:\/|\?|$)/.test(req.url ?? '')) return next()
  const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase()
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(host)
  if (isLocal && !req.headers['x-forwarded-for'] && !req.headers['x-forwarded-host']) return next()
  const forwardedHost = String(req.headers['x-forwarded-host'] ?? '').split(',')[0].trim().replace(/:\d+$/, '').toLowerCase()
  const origin = String(req.headers.origin ?? '').toLowerCase()
  const publicHostAllowed = tunnelHosts.some((suffix) => forwardedHost.endsWith(suffix))
  const safeOriginlessRead = !origin && ['GET', 'HEAD'].includes(req.method ?? '') && host === forwardedHost
  const matchingOrigin = origin === `https://${forwardedHost}`
  if (allowPublicTunnel && publicHostAllowed && req.headers['x-forwarded-proto'] === 'https' &&
      (matchingOrigin || safeOriginlessRead)) return next()
  res.statusCode = 403
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ error: {
    code: 'API_LOCAL_ONLY',
    message: '로컬 백엔드는 이 컴퓨터에서만 사용할 수 있습니다.',
  } }))
}

const localApiOnly = (allowPublicTunnel: boolean): Plugin => ({
  name: 'local-api-only',
  configureServer(server) {
    server.middlewares.use((req, res, next) => guardApi(req, res, next, allowPublicTunnel))
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, res, next) => guardApi(req, res, next, allowPublicTunnel))
  },
})

// Tunnel hosts allowed to open the UI (e.g. `ngrok http 4173`).
const tunnelHosts = ['.ngrok-free.app', '.ngrok.app', '.ngrok.io']
function trustedTunnelClientIp(req: IncomingMessage, allowPublicTunnel: boolean): string | undefined {
  const forwardedHost = String(req.headers['x-forwarded-host'] ?? '').split(',')[0].trim().replace(/:\d+$/, '').toLowerCase()
  const origin = String(req.headers.origin ?? '').toLowerCase()
  const trustedTunnel = allowPublicTunnel && tunnelHosts.some((suffix) => forwardedHost.endsWith(suffix)) &&
    req.headers['x-forwarded-proto'] === 'https' && origin === `https://${forwardedHost}`
  if (!trustedTunnel) return undefined
  const forwardedFor = String(req.headers['x-forwarded-for'] ?? '')
  if (forwardedFor.length > 1024) return undefined
  const rightmost = forwardedFor.split(',').at(-1)?.trim()
  return rightmost && isIP(rightmost) ? rightmost : undefined
}

const securityHeaders = {
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = (env.ACCORD_API_TARGET || DEFAULT_TARGET).replace(/\/+$/, '')
  const local = isLocalTarget(target)
  const allowPublicTunnel = env.ACCORD_PUBLIC_TUNNEL_API === 'true'
  const configureProxy = (proxyServer: Parameters<NonNullable<ProxyOptions['configure']>>[0]) => {
    proxyServer.on('proxyReq', (proxyReq, req) => {
      for (const name of ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'x-accord-client-ip']) {
        proxyReq.removeHeader(name)
      }
      if (local) {
        const clientIp = trustedTunnelClientIp(req, allowPublicTunnel)
        if (clientIp) proxyReq.setHeader('x-accord-client-ip', clientIp)
      }
    })
  }
  const proxy: Record<string, ProxyOptions> = {
    // Backend health for the status chip in the header (the backend serves it outside the API prefix).
    '/__backend/health': { target, changeOrigin: !local, secure: true, rewrite: () => '/health', configure: configureProxy },
    '/api': {
      target,
      changeOrigin: !local,
      secure: true,
      // Don't pass the viewer's tunnel forwarding headers (their IP) on to a remote backend.
      configure: configureProxy,
    },
  }
  return {
    plugins: local ? [localApiOnly(allowPublicTunnel), react()] : [react()],
    server: { allowedHosts: tunnelHosts, proxy, headers: securityHeaders },
    preview: { allowedHosts: tunnelHosts, proxy, headers: securityHeaders },
  }
})
