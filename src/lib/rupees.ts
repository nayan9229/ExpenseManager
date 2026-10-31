/**
 * Renders an amount as rupees with Indian digit grouping (lakhs and crores).
 * Whole rupees drop the paise; anything else shows exactly two.
 */
export function formatRupees(amount: number): string {
  const fractionDigits = Number.isInteger(amount) ? 0 : 2
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount)
}
