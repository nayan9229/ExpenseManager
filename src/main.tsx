import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './app.css'
import { checkForUpdates, updateActivated } from './lib/appUpdate'
import { startOffline } from './lib/offlineStart'
import { queryClient } from './lib/readModel'

// Precaches the shell. A new deploy's worker takes over at once and the
// page reloads at the next safe moment (src/lib/appUpdate.ts).
registerSW({
  immediate: true,
  onNeedReload: updateActivated,
  onRegisteredSW: (_url, registration) => checkForUpdates(registration),
})

const root = document.getElementById('root')
if (!root) throw new Error('index.html is missing #root')

// Device settings and the kept read model come out of Dexie first, so the
// first screen already knows the Member and works with no network.
void startOffline().finally(() => {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
})
