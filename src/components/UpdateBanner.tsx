import { RefreshCw } from 'lucide-react'
import { useUpdateReady } from '../lib/appUpdate'
import { Button } from './Button'

/**
 * "New version ready" on the home screens once a new deploy has taken over
 * (src/lib/appUpdate.ts). The app also reloads by itself the next time it
 * goes to the background, so ignoring this is fine.
 */
export function UpdateBanner() {
  const ready = useUpdateReady()
  if (!ready) return null
  return (
    <section role="status" className="flex flex-col gap-3 rounded-3xl bg-sand p-5 text-lg">
      <p className="font-semibold">A new version of the app is ready.</p>
      <Button icon={RefreshCw} onClick={() => window.location.reload()} className="w-full">
        Reload now
      </Button>
    </section>
  )
}
