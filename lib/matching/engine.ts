import type { InvoiceCache } from '@prisma/client'
import {
  extractAllInvoiceNumbers,
  extractFullInvoiceNumbers,
  extractInvoiceNumbersFromInvoiceLines,
} from '@/lib/utils/invoice'

/**
 * Matching Engine — Coolpinguin Betalingen
 *
 * Factuurformaat: I + exact 5 cijfers (I02230). Losse 5 cijfers worden
 * automatisch geïnterpreteerd als factuurnummer (02230 → I02230).
 *
 * ════════════════════════════════════════════════
 * ARCHITECTUUR: 2 paden
 * ════════════════════════════════════════════════
 *
 * PAD A — Factuurnummer leidend (altijd als factuurnummer gevonden):
 *   Zoek alleen die specifieke factuur. Negeer naam en datum volledig.
 *   Scenario's: EXACT_FULL_PAYMENT / EXACT_PARTIAL_PAYMENT / EXACT_OVERPAYMENT / NO_MATCH
 *
 * PAD B — Fallback (alleen als GEEN factuurnummer gevonden):
 *   Match via laatste 4 cijfers, dan bedrag+naam, dan alleen bedrag.
 *   Scenario's: LAST4_* / AMOUNT_NAME_MATCH / AMOUNT_ONLY / NO_MATCH
 *
 * ════════════════════════════════════════════════
 * BESLISMATRIX
 * ════════════════════════════════════════════════
 *
 * Scenario                                      | Auto | Payment | Label
 * ─────────────────────────────────────────────────────────────────────
 * Exact factuurnr + exact bedrag                | JA   | JA      | JA
 * Exact factuurnr + lager bedrag (deelbetaling) | JA   | JA      | NEE
 * Exact factuurnr + hoger bedrag                | NEE  | NEE     | NEE  → Review
 * Last4 + uniek + exact bedrag                  | JA   | JA      | JA
 * Last4 + uniek + lager bedrag                  | JA   | JA      | NEE
 * Last4 + meerdere matches                      | NEE  | NEE     | NEE  → Review
 * Meerdere volledige nrs + som exact            | JA   | JA      | JA*  (*per factuur)
 * Meerdere volledige nrs + som > betaald        | NEE  | NEE     | NEE  → Review (PARTIAL)
 * Meerdere volledige nrs + som < betaald        | NEE  | NEE     | NEE  → Review (OVERPAYMENT)
 * Meerdere verkorte referenties                 | NEE  | NEE     | NEE  → Review
 * Bedrag + naam (geen factuurnr)                | NEE  | NEE     | NEE  → Review
 * Alleen bedrag                                 | NEE  | NEE     | NEE  → Review
 * Geen match                                    | NEE  | NEE     | NEE  → Review
 */

export type DecisionScenario =
  | 'EXACT_FULL_PAYMENT'      // Auto: factuurnr + exact bedrag
  | 'EXACT_PARTIAL_PAYMENT'   // Auto: factuurnr + lager bedrag
  | 'EXACT_OVERPAYMENT'       // Review: factuurnr + hoger bedrag
  | 'LAST4_EXACT_UNIQUE'      // Auto: unieke last4 + exact bedrag
  | 'LAST4_PARTIAL_UNIQUE'    // Auto: unieke last4 + lager bedrag
  | 'LAST4_MULTIPLE_MATCHES'  // Review: last4 matcht meerdere facturen
  | 'MULTI_INVOICE_EXACT'        // Auto: meerdere facturen, som exact
  | 'MULTI_INVOICE_PARTIAL'      // Review: som open > betaald bedrag (deelbetaling)
  | 'MULTI_INVOICE_OVERPAYMENT'  // Review: som open < betaald bedrag (te veel betaald)
  | 'MULTI_SHORT_REF'            // Review: meerdere verkorte referenties
  | 'AMOUNT_NAME_MATCH'       // Review: bedrag + naam
  | 'AMOUNT_ONLY'             // Review: alleen bedrag
  | 'MULTIPLE_MATCHES'        // Review: ambigue
  | 'INVOICE_ALREADY_PAID'    // Duplicaat: factuurnr gevonden, factuur bestaat maar openAmount = 0
  | 'NO_MATCH'                // Review: factuurnr gevonden maar bestaat niet in RM
  | 'DEBIT_TRANSACTION'       // Skip: uitgaand

export interface AutoDecision {
  postPayment: boolean
  setLabel: boolean
  autoProcess: boolean
  scenario: DecisionScenario
  reviewReason?: string
}

export interface MatchSuggestion {
  invoiceId: string
  invoiceAmount: number
  openAmount: number
  customerName?: string
  confidence: number
  scenario: DecisionScenario
  decision: AutoDecision
  reason: string
}

export interface EngineResult {
  suggestions: MatchSuggestion[]
  primaryDecision: AutoDecision
  primarySuggestion?: MatchSuggestion
  /** Ingevuld bij MULTI_INVOICE_*: alle facturen die samen betaald worden */
  multiInvoiceMatches?: MatchSuggestion[]
  /** Som van openstaande bedragen bij multi-invoice (voor weergave in UI) */
  multiInvoiceSum?: number
  /**
   * Het factuurnummer dat gevonden is in de omschrijving, ongeacht of het
   * matcht met een openstaande factuur. Gebruikt door de UI om het veld
   * 'factuurnr' altijd te vullen zodra een nummer gevonden is.
   */
  extractedInvoiceId?: string | null
}

const AMOUNT_EPSILON = 0.001

// ────────────────────────────────────────────────
// Publieke functie
// ────────────────────────────────────────────────

export function runMatchingEngine(
  transaction: {
    amount: number
    creditDebit: string
    counterpartyName?: string | null
    description?: string | null
    bankReference?: string | null
    transactionDate: Date
  },
  invoices: InvoiceCache[]
): EngineResult {
  if (transaction.creditDebit !== 'CRDT') {
    return {
      suggestions: [],
      extractedInvoiceId: null,
      primaryDecision: makeDecision('DEBIT_TRANSACTION', false, false, false, 'Uitgaande transactie — wordt overgeslagen'),
    }
  }

  const amount = transaction.amount
  const description = transaction.description ?? ''
  const counterparty = (transaction.counterpartyName ?? '').toLowerCase()
  const descriptionLower = description.toLowerCase()

  // Combineer description + bankReference als zoekbron
  const searchText = [description, transaction.bankReference ?? ''].filter(Boolean).join(' ')

  // Extraheer alle factuurnummers (I-prefix) en last4-hints
  const allExtracted = extractAllInvoiceNumbers(searchText)
  // Strikte I+5-digit formaten (voor multi-invoice detectie)
  const fullIds = extractFullInvoiceNumbers(searchText)
  // Alleen I-geprefixte nummers (volledig factuurnummer)
  let invoiceIds = allExtracted.filter((id) => id.startsWith('I'))
  // Ruwe 4-cijfer nummers (last4-hints)
  const last4Candidates = allExtracted.filter((id) => /^\d{4}$/.test(id))

  // Aanvulling: zoek losse nummers in "Invoice:"-context regels (bijv. "Invoice: 02214")
  // Deze worden NOOIT gevonden in Kenmerk/Referentie-regels
  const contextIds = extractInvoiceNumbersFromInvoiceLines(description)
  for (const id of contextIds) {
    if (!invoiceIds.includes(id)) invoiceIds = [...invoiceIds, id]
  }

  const extractedInvoiceId = invoiceIds[0] ?? null

  // === DEBUG LOG ===
  console.log(
    `[Engine] desc="${description.slice(0, 70).replace(/\n/g, ' ')}"` +
    ` | gevonden=${JSON.stringify(invoiceIds)}` +
    ` | last4=${JSON.stringify(last4Candidates)}` +
    ` | strategie=${invoiceIds.length > 0 ? 'FACTUURNUMMER_LEIDEND' : last4Candidates.length > 0 ? 'LAST4' : 'FALLBACK'}`
  )

  // ══════════════════════════════════════════════════════
  // PAD A: Factuurnummer gevonden → alleen die factuur
  // Naam en datum volledig genegeerd in dit pad.
  // ══════════════════════════════════════════════════════
  if (invoiceIds.length > 0) {
    // Multi-invoice check: twee of meer strikte I+5-digit nummers
    if (fullIds.length >= 2) {
      const multiResult = tryMultiInvoiceMatch(fullIds, amount, invoices)
      if (multiResult) {
        return { ...multiResult, extractedInvoiceId }
      }
    }

    // Single invoice: zoek direct de specifieke factuur
    const targetId = invoiceIds[0]
    const matchedInvoice = findInvoiceById(targetId, invoices)

    if (!matchedInvoice) {
      const reason = `Factuurnummer ${targetId} gevonden in omschrijving maar staat niet in openstaande facturen`
      const cachedIds = invoices.map((i) => i.invoiceId).join(', ') || '(leeg)'
      console.log(`[Engine] → NO_MATCH (niet in cache): ${targetId} | cache bevat: ${cachedIds}`)
      return {
        suggestions: [],
        extractedInvoiceId: targetId,
        primaryDecision: makeDecision('NO_MATCH', false, false, false, reason),
      }
    }

    const openAmount = parseFloat(matchedInvoice.openAmount.toString())
    if (openAmount <= 0) {
      const reason = `Factuur ${targetId} bestaat in RentMagic maar heeft geen openstaand saldo — al betaald`
      console.log(`[Engine] → INVOICE_ALREADY_PAID: ${targetId}`)
      return {
        suggestions: [],
        extractedInvoiceId: targetId,
        primaryDecision: makeDecision('INVOICE_ALREADY_PAID', false, false, false, reason),
      }
    }

    const totalAmount = parseFloat(matchedInvoice.totalAmount.toString())
    let scenario: DecisionScenario
    let reason: string
    const confidence = 0.99

    if (Math.abs(amount - openAmount) < AMOUNT_EPSILON) {
      scenario = 'EXACT_FULL_PAYMENT'
      reason = `Factuurnummer ${targetId} gevonden, bedrag € ${amount.toFixed(2)} klopt exact`
    } else if (amount < openAmount - AMOUNT_EPSILON) {
      scenario = 'EXACT_PARTIAL_PAYMENT'
      reason = `Factuurnummer ${targetId} gevonden, bedrag € ${amount.toFixed(2)} < open saldo € ${openAmount.toFixed(2)} (deelbetaling)`
    } else {
      scenario = 'EXACT_OVERPAYMENT'
      reason = `Factuurnummer ${targetId} gevonden, bedrag € ${amount.toFixed(2)} > open saldo € ${openAmount.toFixed(2)}`
    }

    console.log(`[Engine] → ${scenario}: ${reason}`)

    const suggestion = makeSuggestion(matchedInvoice, amount, openAmount, totalAmount, scenario, confidence, reason)
    return {
      suggestions: [suggestion],
      extractedInvoiceId: targetId,
      primaryDecision: suggestion.decision,
      primarySuggestion: suggestion,
    }
  }

  // ══════════════════════════════════════════════════════
  // PAD B: Geen factuurnummer → fallback matching
  // Last4, dan bedrag+naam, dan alleen bedrag.
  // ══════════════════════════════════════════════════════
  console.log(`[Engine] → fallback (last4/naam/bedrag)`)

  const suggestions: MatchSuggestion[] = []
  for (const invoice of invoices) {
    if (parseFloat(invoice.openAmount.toString()) <= 0) continue
    const s = evaluateFallback(invoice, amount, last4Candidates, counterparty, descriptionLower)
    if (s) suggestions.push(s)
  }
  suggestions.sort((a, b) => b.confidence - a.confidence)

  // Meerdere verkorte referenties → altijd review
  if (last4Candidates.length >= 2) {
    const last4Matches = suggestions.filter(
      (s) => s.scenario === 'LAST4_EXACT_UNIQUE' || s.scenario === 'LAST4_PARTIAL_UNIQUE'
    )
    if (last4Matches.length >= 2) {
      console.log(`[Engine] → MULTI_SHORT_REF: ${last4Candidates.join(', ')}`)
      return {
        suggestions,
        extractedInvoiceId: null,
        primaryDecision: makeDecision(
          'MULTI_SHORT_REF', false, false, false,
          `Meerdere verkorte referenties (${last4Candidates.join(', ')}) — factuurkoppelingen handmatig bevestigen`
        ),
      }
    }
  }

  const result = buildFinalDecision(suggestions)
  if (result.primaryDecision.scenario !== 'NO_MATCH') {
    console.log(`[Engine] → ${result.primaryDecision.scenario} (fallback)`)
  } else {
    console.log(`[Engine] → NO_MATCH (geen factuurnummer, geen bedrag/naam match)`)
  }
  return { ...result, extractedInvoiceId: null }
}

// ────────────────────────────────────────────────
// Multi-invoice matching (PAD A, meerdere nummers)
// ────────────────────────────────────────────────

function tryMultiInvoiceMatch(
  fullIds: string[],
  txAmount: number,
  invoices: InvoiceCache[]
): EngineResult | null {
  const openMatches: Array<{ invoice: InvoiceCache; openAmount: number }> = []
  const alreadyPaid: string[] = []
  const notFound: string[] = []

  for (const id of fullIds) {
    const invoice = findInvoiceById(id, invoices)
    if (!invoice) { notFound.push(id); continue }
    const open = parseFloat(invoice.openAmount.toString())
    if (open <= 0) { alreadyPaid.push(id) } else { openMatches.push({ invoice, openAmount: open }) }
  }

  // Minder dan 2 openstaande facturen → laat het single-invoice pad het afhandelen
  if (openMatches.length < 2) return null

  const openSum = openMatches.reduce((acc, m) => acc + m.openAmount, 0)

  // Bepaal scenario op basis van som vs betaald bedrag
  let scenario: DecisionScenario
  let reviewReason: string | undefined

  if (Math.abs(openSum - txAmount) < AMOUNT_EPSILON) {
    if (notFound.length > 0 || alreadyPaid.length > 0) {
      // Som klopt, maar niet alle nummers gevonden/open → review
      scenario = 'MULTI_INVOICE_EXACT'
      const issues: string[] = []
      if (notFound.length) issues.push(`niet in RM: ${notFound.join(', ')}`)
      if (alreadyPaid.length) issues.push(`al betaald: ${alreadyPaid.join(', ')}`)
      reviewReason = `Som klopt (€ ${openSum.toFixed(2)}) maar sommige facturen ontbreken — ${issues.join('; ')}`
    } else {
      scenario = 'MULTI_INVOICE_EXACT'
    }
  } else if (txAmount < openSum - AMOUNT_EPSILON) {
    scenario = 'MULTI_INVOICE_PARTIAL'
    reviewReason = `Betaald bedrag € ${txAmount.toFixed(2)} < som open facturen € ${openSum.toFixed(2)} (deelbetaling op ${openMatches.length} facturen)`
  } else {
    scenario = 'MULTI_INVOICE_OVERPAYMENT'
    reviewReason = `Betaald bedrag € ${txAmount.toFixed(2)} > som open facturen € ${openSum.toFixed(2)} (te veel betaald voor ${openMatches.length} facturen)`
  }

  const isExactAuto = scenario === 'MULTI_INVOICE_EXACT' && !reviewReason
  console.log(`[Engine] → ${scenario}: ${reviewReason ?? `${openMatches.map((m) => m.invoice.invoiceId).join(' + ')} som=€${openSum.toFixed(2)}`}`)

  const multiMatches = openMatches.map(({ invoice, openAmount }) =>
    makeSuggestion(
      invoice, openAmount, openAmount,
      parseFloat(invoice.totalAmount.toString()),
      scenario, isExactAuto ? 0.99 : 0.85,
      `Factuur ${invoice.invoiceId} (€ ${openAmount.toFixed(2)}) onderdeel van gesplitste betaling € ${txAmount.toFixed(2)}`
    )
  )

  return {
    suggestions: multiMatches,
    primaryDecision: makeDecision(scenario, isExactAuto, isExactAuto, isExactAuto, reviewReason),
    primarySuggestion: multiMatches[0],
    multiInvoiceMatches: multiMatches,
    multiInvoiceSum: openSum,
  }
}

// ────────────────────────────────────────────────
// Directe lookup op factuurnummer
// ────────────────────────────────────────────────

function findInvoiceById(invoiceId: string, invoices: InvoiceCache[]): InvoiceCache | undefined {
  const idUpper = invoiceId.toUpperCase()
  const idNumeric = invoiceId.replace(/\D/g, '')
  return invoices.find((inv) => {
    return (
      inv.invoiceId.toUpperCase() === idUpper ||
      inv.invoiceId.replace(/\D/g, '') === idNumeric
    )
  })
}

// ────────────────────────────────────────────────
// Fallback evaluatie per factuur (PAD B)
// ────────────────────────────────────────────────

function evaluateFallback(
  invoice: InvoiceCache,
  txAmount: number,
  last4: string[],
  counterpartyLower: string,
  descriptionLower: string
): MatchSuggestion | null {
  const openAmount = parseFloat(invoice.openAmount.toString())
  const totalAmount = parseFloat(invoice.totalAmount.toString())
  const invoiceLast4 = invoice.invoiceId.replace(/\D/g, '').slice(-4)

  // ── Last4 matching ──
  if (last4.includes(invoiceLast4) && invoiceLast4.length === 4) {
    if (Math.abs(txAmount - openAmount) < AMOUNT_EPSILON) {
      return makeSuggestion(invoice, txAmount, openAmount, totalAmount, 'LAST4_EXACT_UNIQUE', 0.72,
        `Laatste 4 cijfers "${invoiceLast4}" gevonden, bedrag € ${txAmount.toFixed(2)} klopt`
      )
    }
    if (txAmount < openAmount - AMOUNT_EPSILON) {
      return makeSuggestion(invoice, txAmount, openAmount, totalAmount, 'LAST4_PARTIAL_UNIQUE', 0.68,
        `Laatste 4 cijfers "${invoiceLast4}" gevonden, bedrag € ${txAmount.toFixed(2)} < open saldo € ${openAmount.toFixed(2)} (deelbetaling)`
      )
    }
  }

  // ── Bedrag + naam ──
  if (Math.abs(txAmount - openAmount) < AMOUNT_EPSILON && counterpartyLower) {
    const invoiceNameLower = (invoice.customerName ?? '').toLowerCase()
    if (invoiceNameLower && nameSimilarity(counterpartyLower, invoiceNameLower) >= 0.75) {
      return makeSuggestion(invoice, txAmount, openAmount, totalAmount, 'AMOUNT_NAME_MATCH', 0.60,
        `Bedrag € ${txAmount.toFixed(2)} klopt, klantnaam lijkt op "${invoice.customerName}" — handmatige controle`
      )
    }
  }

  // ── Alleen bedrag ──
  if (Math.abs(txAmount - openAmount) < AMOUNT_EPSILON) {
    return makeSuggestion(invoice, txAmount, openAmount, totalAmount, 'AMOUNT_ONLY', 0.35,
      `Alleen bedrag € ${txAmount.toFixed(2)} overeenkomstig — te zwak voor automatische verwerking`
    )
  }

  return null
}

// ────────────────────────────────────────────────
// Bouw finale beslissing (voor fallback-pad)
// ────────────────────────────────────────────────

function buildFinalDecision(suggestions: MatchSuggestion[]): EngineResult {
  if (suggestions.length === 0) {
    return {
      suggestions: [],
      primaryDecision: makeDecision('NO_MATCH', false, false, false, 'Geen overeenkomende factuur gevonden'),
    }
  }

  const top = suggestions[0]

  // Meerdere last4-kandidaten → altijd review
  const last4Suggestions = suggestions.filter(
    (s) => s.scenario === 'LAST4_EXACT_UNIQUE' || s.scenario === 'LAST4_PARTIAL_UNIQUE'
  )
  if (last4Suggestions.length > 1) {
    const ids = last4Suggestions.map((s) => s.invoiceId).join(', ')
    return {
      suggestions,
      primaryDecision: makeDecision(
        'LAST4_MULTIPLE_MATCHES', false, false, false,
        `Meerdere facturen matchen op laatste 4 cijfers: ${ids} — handmatige keuze verplicht`
      ),
    }
  }

  // Meerdere sterke kandidaten → altijd review
  const strongCandidates = suggestions.filter(
    (s) => s.confidence >= 0.70 && s.scenario !== 'AMOUNT_ONLY'
  )
  if (strongCandidates.length > 1) {
    const ids = strongCandidates.map((s) => s.invoiceId).join(', ')
    return {
      suggestions,
      primaryDecision: makeDecision(
        'MULTIPLE_MATCHES', false, false, false,
        `Meerdere facturen komen overeen: ${ids} — handmatige keuze verplicht`
      ),
    }
  }

  return {
    suggestions,
    primaryDecision: top.decision,
    primarySuggestion: top,
  }
}

// ────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────

function makeSuggestion(
  invoice: InvoiceCache,
  txAmount: number,
  openAmount: number,
  totalAmount: number,
  scenario: DecisionScenario,
  confidence: number,
  reason: string
): MatchSuggestion {
  const decision = scenarioToDecision(scenario, reason)
  return {
    invoiceId: invoice.invoiceId,
    invoiceAmount: totalAmount,
    openAmount,
    customerName: invoice.customerName ?? undefined,
    confidence,
    scenario,
    decision,
    reason,
  }
}

function scenarioToDecision(scenario: DecisionScenario, reason: string): AutoDecision {
  switch (scenario) {
    case 'EXACT_FULL_PAYMENT':
      return makeDecision(scenario, true, true, true)

    case 'EXACT_PARTIAL_PAYMENT':
      return makeDecision(scenario, true, false, true,
        'Deelbetaling: payment geregistreerd, label NIET gezet (openstaand saldo > €0)')

    case 'EXACT_OVERPAYMENT':
      return makeDecision(scenario, false, false, false, reason)

    case 'LAST4_EXACT_UNIQUE':
      return makeDecision(scenario, true, true, true,
        'Unieke last4 match + exact bedrag — automatisch verwerkt')

    case 'LAST4_PARTIAL_UNIQUE':
      return makeDecision(scenario, true, false, true,
        'Unieke last4 + deelbetaling: payment geregistreerd, label NIET gezet')

    case 'MULTI_INVOICE_EXACT':
      return makeDecision(scenario, true, true, true)

    case 'MULTI_INVOICE_PARTIAL':
      return makeDecision(scenario, false, false, false, reason)

    case 'MULTI_INVOICE_OVERPAYMENT':
      return makeDecision(scenario, false, false, false, reason)

    case 'INVOICE_ALREADY_PAID':
      return makeDecision(scenario, false, false, false, reason)

    case 'LAST4_MULTIPLE_MATCHES':
    case 'MULTI_SHORT_REF':
    case 'AMOUNT_NAME_MATCH':
    case 'AMOUNT_ONLY':
    case 'MULTIPLE_MATCHES':
    case 'NO_MATCH':
    default:
      return makeDecision(scenario, false, false, false, reason)
  }
}

function makeDecision(
  scenario: DecisionScenario,
  postPayment: boolean,
  setLabel: boolean,
  autoProcess: boolean,
  reviewReason?: string
): AutoDecision {
  return { scenario, postPayment, setLabel, autoProcess, reviewReason }
}

function nameSimilarity(a: string, b: string): number {
  const ta = tokenize(a)
  const tb = tokenize(b)
  if (!ta.length || !tb.length) return 0
  const sa = new Set<string>()
  ta.forEach((t) => sa.add(t))
  const sb = new Set<string>()
  tb.forEach((t) => sb.add(t))
  let intersection = 0
  sa.forEach((t) => { if (sb.has(t)) intersection++ })
  const union = sa.size + sb.size - intersection
  return intersection / union
}

function tokenize(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/[.,\-_]/g, ' ')
    .replace(/\b(BV|B\.V\.|NV|N\.V\.|VOF|CV|BVBA|INC|LTD|GMBH)\b/g, '')
    .split(/\s+/)
    .filter((t) => t.length > 1)
}
