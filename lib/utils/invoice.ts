/**
 * Robuuste factuurnummer-extractie voor rommelige bankdata.
 *
 * Factuurformaat Coolpinguin: I + exact 5 cijfers (bijv. I02230)
 *
 * Conversieregels:
 *   "I02230"               → "I02230"   (direct herkend)
 *   "USTDI02230"           → "I02230"   (aaneengeplakt, geen \b voor I vereist)
 *   "UST+D+I02230"         → "I02230"   (plustekens als scheidingsteken)
 *   "02230"                → "I02230"   (losse 5 cijfers → I-prefix)
 *   "BETALING 02230"       → "I02230"   (losse 5 cijfers → I-prefix)
 *   "I02230 000089500..."  → "I02230"   (lange referentienummers negeren)
 *   "betaling 2230"        → "2230"     (4 cijfers: last4-hint, geen I-prefix)
 */

function normalize(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
}

/**
 * Extraheer één factuurnummer uit een bankbeschrijving.
 *
 * Prioriteit:
 * 1. I + exact 5 cijfers, ook aaneengeplakt (USTDI02230 → I02230)
 * 2. I + 3–8 cijfers met woordgrens (niet-standaard formaten)
 * 3. Losse 5 cijfers → I-prefix (02230 → I02230)
 * 4. Losse 4 cijfers → rauw (last4-hint, geen conversie)
 */
export function extractInvoiceNumber(description: string): string | null {
  if (!description) return null
  const n = normalize(description)

  // Stap 1: I + exact 5 cijfers, geen \b voor I vereist
  const strict = n.match(/I(\d{5})(?!\d)/)
  if (strict) return `I${strict[1]}`

  // Stap 2: I + 3–8 cijfers met woordgrens
  const loose = n.match(/\bI(\d{3,8})\b/)
  if (loose) return `I${loose[1]}`

  // Stap 3: losse 5 cijfers → interpreteer als factuurnummer met I-prefix
  // "02230" → I02230 (precies 5 cijfers, niet meer)
  const fiveDigits = n.match(/\b(\d{5})\b/)
  if (fiveDigits) return `I${fiveDigits[1]}`

  // Stap 4: losse 4 cijfers → geef rauw terug voor last4-matching
  const fourDigits = n.match(/\b(\d{4})\b/)
  if (fourDigits) return fourDigits[1]

  return null
}

/**
 * Extraheer volledige factuurnummers in het strikte formaat I + exact 5 cijfers.
 * Gebruikt voor multi-invoice detectie (twee of meer volledige nummers).
 * Werkt ook zonder woordgrens vóór de I.
 */
export function extractFullInvoiceNumbers(description: string): string[] {
  if (!description) return []
  const n = normalize(description)
  const results: string[] = []
  const seen = new Set<string>()
  const pattern = /I(\d{5})(?!\d)/g
  let m: RegExpExecArray | null
  while ((m = pattern.exec(n)) !== null) {
    const id = `I${m[1]}`
    if (!seen.has(id)) { seen.add(id); results.push(id) }
  }
  return results
}

/**
 * Extraheer álle mogelijke factuurnummers en hints uit een tekst.
 *
 * Geeft een gededupliceerde lijst:
 *   - I + cijfers (I-prefix, hoge prioriteit)
 *   - Losse 5 cijfers → geconverteerd naar I-prefix (02230 → I02230)
 *   - Losse 4 cijfers → rauw (last4-hint, geen I-prefix)
 */
export function extractAllInvoiceNumbers(description: string): string[] {
  if (!description) return []
  const n = normalize(description)
  const results: string[] = []
  const seen = new Set<string>()

  // Prioriteit 1: I + cijfers (ook aaneengeplakt)
  const iPattern = /I(\d{3,8})(?!\d)/g
  let m: RegExpExecArray | null
  while ((m = iPattern.exec(n)) !== null) {
    const id = `I${m[1]}`
    if (!seen.has(id)) { seen.add(id); results.push(id) }
  }

  // Prioriteit 2: losse 5 cijfers → I-prefix
  const fivePattern = /\b(\d{5})\b/g
  while ((m = fivePattern.exec(n)) !== null) {
    const id = `I${m[1]}`
    if (!seen.has(id)) { seen.add(id); results.push(id) }
  }

  // Prioriteit 3: losse 4 cijfers → rauw (last4-matching)
  const fourPattern = /\b(\d{4})\b/g
  while ((m = fourPattern.exec(n)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); results.push(m[1]) }
  }

  return results
}
