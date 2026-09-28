import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const localApiOnly: Plugin = {
  name: 'local-api-only',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
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
    })
  },
}

export default defineConfig({
  plugins: [localApiOnly, react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
