/** HyperK module content — transcribed from docs/rebuild/04-CARDS.md §Lab-K. */

export const MORPH_LABEL = 'one possible trajectory — NOT a K→ECG dial'
export const MORPH_SUB = 'Another patient walks the same K climb with a different ECG story.'
export const GALLERY_BANNER = '⚠ The ECG can never rule out hyperkalemia.'
export const GALLERY_BANNER_CITE = 'MONTAGUE-2008'

export interface GallerySlot {
  traceId: string
  /** the measured K the story reveals */
  k: string
  /** which commit chip is right */
  band: '<5.5' | '5.5–6.4' | '≥6.5'
  reveal: string
}

export const K_BANDS = ['<5.5', '5.5–6.4', '≥6.5'] as const

/** Five patients, one lesson. Slots ship as modeled variance synthesis with
 *  honest badges; each upgrades to a published-case reconstruction when the
 *  named reviewer sources it (tracked in the release report). */
export const GALLERY: GallerySlot[] = [
  { traceId: 'hyperk-var-nearnormal', k: '~6.5', band: '≥6.5', reveal: 'Near-normal trace, dangerous K — the humbling one. The ECG rules IN, never OUT.' },
  { traceId: 'hyperk-var-tented', k: '~6.8', band: '≥6.5', reveal: 'The textbook tented T — when it shows, believe it.' },
  { traceId: 'hyperk-var-bradywide', k: '~7.0', band: '≥6.5', reveal: 'Slow, wide, P-less — sick + brady + wide + weird. Calcium before the algorithm.' },
  { traceId: 'hyperk-var-brugadoid', k: '~7.5', band: '≥6.5', reveal: 'A Brugada phenocopy — potassium impersonating a channelopathy. Treat the K.' },
  { traceId: 'hyperk-var-sine', k: '~8+', band: '≥6.5', reveal: 'The sine-wave merge — peri-arrest. Same number as slot one’s patient, next bed over.' },
]

export const TRIGGER_LINE = 'Sick + brady + wide + weird → think K⁺. Calcium first. Then shift, then eliminate.'
export const TRIGGER_CITE = 'UKKA-K-2023'
export const CLOSING_LESSON = 'Same number, different shadow — treat the ECG.'
