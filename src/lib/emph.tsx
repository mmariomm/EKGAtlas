/**
 * Card copy uses *asterisk emphasis*; render it as real italics so no literal
 * asterisk ever reaches the screen (design-audit F10).
 */
import { ReactNode } from 'react'

export const emph = (text: string): ReactNode => {
  if (!text.includes('*')) return text
  const parts = text.split(/\*([^*]+)\*/g)
  return parts.map((p, i) => (i % 2 === 1 ? <em key={i}>{p}</em> : p))
}
