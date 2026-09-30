import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './looks.css'
import App from './App.tsx'
import LiveRoute from './live/LiveRoute.tsx'
import ConnectedApp from './connected/ConnectedApp.tsx'
import { storeLook } from './looks'

storeLook('clear')

// `/` is the product connected to the live API. `?mode=console` is the plain API console, `?mode=mock` the offline design.
const mode = new URLSearchParams(window.location.search).get('mode')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {mode === 'mock' ? <App /> : mode === 'console' ? <LiveRoute /> : <ConnectedApp />}
  </StrictMode>,
)
