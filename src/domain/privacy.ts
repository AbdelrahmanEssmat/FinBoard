/** What privacy mode shows instead of an amount. */
export const HIDDEN = '****'

/**
 * Text with every amount and number in it replaced by ****, for sentences that mention money
 * ("Net worth grew by E£ 13,314.85" → "Net worth grew by ****").
 */
export function maskNumbers(text: string): string {
  return text.replace(/[-+]?(?:E£\s?|[$€£]\s?)?\d[\d,.]*(?:\s?[KMB](?![A-Za-z]))?%?/g, HIDDEN)
}
