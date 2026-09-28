import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import LiveRoute from './live/LiveRoute.tsx'

const liveMode = new URLSearchParams(window.location.search).get('mode') === 'live'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {liveMode ? <LiveRoute /> : <App />}
  </StrictMode>,
)
