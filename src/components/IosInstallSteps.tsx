import { Share, SquarePlus } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * The iPhone "Add to Home Screen" steps (iOS has no install prompt;
 * docs/research/mobile-browser-capabilities.md, question 6). Shown by the
 * Gatekeeper before pairing and by Simple Mode on a device paired in the
 * browser. `afterInstall` is the last step, which differs between the two;
 * `children` go under the steps (a note, a dismiss button).
 */
export function IosInstallSteps({
  platform,
  afterInstall,
  children,
}: {
  platform: 'ios-safari' | 'ios-other-browser'
  afterInstall: ReactNode
  children?: ReactNode
}) {
  return (
    <section aria-labelledby="install-title" className="flex flex-col gap-3 rounded-3xl bg-sand p-5 text-lg">
      <h2 id="install-title" className="text-xl font-bold">
        First, add the app to your Home Screen
      </h2>
      {platform === 'ios-safari' ? (
        <ol className="flex flex-col gap-3">
          <Step n={1}>
            Tap the Share button <Share aria-label="Share" className="inline size-6 align-text-bottom" /> at the bottom of
            Safari.
          </Step>
          <Step n={2}>
            Scroll down and tap <strong>Add to Home Screen</strong>{' '}
            <SquarePlus aria-hidden="true" className="inline size-6 align-text-bottom" />.
          </Step>
          <Step n={3}>
            Tap <strong>Add</strong>.
          </Step>
          <Step n={4}>{afterInstall}</Step>
        </ol>
      ) : (
        <p>
          Open this page in <strong>Safari</strong>, tap Share <Share aria-label="Share" className="inline size-6 align-text-bottom" />,
          then <strong>Add to Home Screen</strong>. {afterInstall}
        </p>
      )}
      {children}
    </section>
  )
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-mocha text-base font-bold text-warm-white"
      >
        {n}
      </span>
      <span>{children}</span>
    </li>
  )
}
