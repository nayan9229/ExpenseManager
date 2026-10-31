import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'danger'

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** Every action carries an icon next to its label. */
  icon: LucideIcon
  /** The visible label. Icons alone are not enough for the parents. */
  children: ReactNode
  variant?: Variant
}

const base =
  'inline-flex min-h-touch min-w-touch items-center justify-center gap-3 rounded-2xl px-6 py-3 ' +
  'text-lg font-semibold leading-tight select-none ' +
  'outline-none focus-visible:ring-4 focus-visible:ring-olive-sage ' +
  'active:scale-[0.98] transition-transform ' +
  'disabled:opacity-50 disabled:active:scale-100'

const variants: Record<Variant, string> = {
  primary: 'bg-mocha text-warm-white',
  secondary: 'bg-sand text-mocha',
  danger: 'bg-terracotta text-warm-white',
}

/**
 * The one button primitive. At least 56px tall and wide, labelled, with an
 * icon, so it reads at arm's length on a phone.
 */
export function Button({ icon: Icon, children, variant = 'primary', className = '', type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={`${base} ${variants[variant]} ${className}`} {...rest}>
      <Icon aria-hidden="true" className="size-7 shrink-0" strokeWidth={2.25} />
      <span>{children}</span>
    </button>
  )
}
