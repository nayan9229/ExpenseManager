import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './app.css'

// Precaches the shell and swaps in new versions on the next load.
registerSW({ immediate: true })

const root = document.getElementById('root')
if (!root) throw new Error('index.html is missing #root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
