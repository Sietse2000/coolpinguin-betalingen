/**
 * Robuuste factuurnummer-extractie voor rommelige bankdata.
 *
 * Factuurformaat Coolpinguin: I + exact 5 cijfers (bijv. I02230)
 *
 * Conversieregels:
 *   "I02230"               → "I02230"   (direct herkend)
 *   "USTDI02230"           → "I02230"   (aaneengeplakt, geen \b voor I vereist)
 *   "UST+D+I02230"         → "I02230"   (plustekens als scheidingsteken)
 *   "betaling 2230"        → "2230"     (4 cijfers: last4-hint, geen I-prefix)
 *
 * NIET meer ondersteund (te veel false positives met Kenmerk/Referentie getallen):
 *   "02230" → I02230   (losse 5 cijfers → I-prefix: UITGESCHAKELD)
 *   Gebruik in plaats daarvan expliciete I-prefix of zoek in Invoice-context.
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
 * 3. Losse 4 cijfers → rauw (last4-hint, geen conversie)
 *
 * Stap 3 (losse 5 cijfers → I-prefix) is verwijderd: "14569" uit
 * "Kenmerk: 14569/PT1046431" werd anders foutief I14569.
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

  // Stap 3: losse 4 cijfers → geef rauw terug voor last4-matching
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
 *   - I + cijfers (I-prefix, hoge prioriteit) — altijd vertrouwd
 *   - Losse 4 cijfers → rauw (last4-hint, geen I-prefix)
 *
 * Losse 5-cijfer → I-prefix conversie is UITGESCHAKELD.
 * Reden: "Kenmerk: 14569/..." werd foutief als I14569 geïnterpreteerd.
 * De I-prefix-pattern vindt I02214 / I02224 / I02225 al direct en betrouwbaar.
 */
export function extractAllInvoiceNumbers(description: string): string[] {
  if (!description) return []
  const n = normalize(description)
  const results: string[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null

  // Prioriteit 1: I + cijfers (ook aaneengeplakt, bijv. USTDI02230)
  const iPattern = /I(\d{3,8})(?!\d)/g
  while ((m = iPattern.exec(n)) !== null) {
    const id = `I${m[1]}`
    if (!seen.has(id)) { seen.add(id); results.push(id) }
  }

  // Prioriteit 2: losse 4 cijfers → rauw (last4-matching)
  const fourPattern = /\b(\d{4})\b/g
  while ((m = fourPattern.exec(n)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); results.push(m[1]) }
  }

  return results
}

/**
 * Context-aware extractie: zoek losse nummers ALLEEN in Invoice/Factuur-regels.
 * Gebruik dit als aanvulling wanneer iemand schrijft "Invoice: 02214" zonder I-prefix.
 *
 * Slaat regels over met: Kenmerk, Referentie, IBAN, Naam, BIC.
 */
export function extractInvoiceNumbersFromInvoiceLines(text: string): string[] {
  if (!text) return []
  const results: string[] = []
  const seen = new Set<string>()
  const INVOICE_CONTEXT = /\b(invoice|factuur|factuurnr|factuurnummer)\b/i
  const SKIP_CONTEXT = /\b(kenmerk|referentie|iban|naam|bic)\b/i

  for (const line of text.split(/[\n\r]/)) {
    if (SKIP_CONTEXT.test(line)) continue
    if (!INVOICE_CONTEXT.test(line)) continue
    // Lijn heeft Invoice-context: extract losse 5-cijfer nummers
    const norm = normalize(line)
    const m = norm.match(/\b(\d{5})\b/)
    if (m) {
      const id = `I${m[1]}`
      if (!seen.has(id)) { seen.add(id); results.push(id) }
    }
  }
  return results
}
