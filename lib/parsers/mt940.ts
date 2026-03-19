import type { ParsedTransaction, CreditDebit } from '@/types'
import { hashTransaction } from '@/lib/utils/hash'
import { extractInvoiceNumber } from '@/lib/utils/invoice'

/**
 * Parser voor MT940 bankafschriften (ING formaat).
 *
 * MT940 velden:
 *   :20:  Transaction Reference Number
 *   :25:  Account Identification
 *   :28C: Statement Number
 *   :60F: Opening Balance
 *   :61:  Statement Line (transactie)
 *   :86:  Information to Account Owner (beschrijving)
 *   :62F: Closing Balance
 *
 * :61: formaat:
 *   YYMMDD[MMDD][C|D][Ccy][Amount]N[FundsCode][BankRef]//[CustomerRef]
 *   Bedrag gebruikt komma als decimaalscheider
 *
 * :86: ING-structuur:
 *   /TRTP/<type>/IBAN/<iban>/BIC/<bic>/NAME/<naam>/REMI/<omschrijving>/...
 */

interface Mt940Entry {
  statementLine: string
  information: string
}

export function parseMt940(content: string): ParsedTransaction[] {
  // Normaliseer regeleindes
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // Verzamel MT940 fields (tag + inhoud)
  const fields = parseFields(lines)

  const transactions: ParsedTransaction[] = []

  // Loop door alle :61: / :86: paren
  let i = 0
  while (i < fields.length) {
    const field = fields[i]

    if (field.tag === '61') {
      // Zoek bijbehorend :86: veld (direct erna, optioneel)
      const nextField = fields[i + 1]
      const info86 =
        nextField?.tag === '86' ? nextField.value : ''

      try {
        const tx = parseEntry({ statementLine: field.value, information: info86 })
        if (tx) transactions.push(tx)
      } catch (err) {
        console.warn('[MT940] Entry overgeslagen:', err)
      }

      i += info86 ? 2 : 1
    } else {
      i++
    }
  }

  return transactions
}

interface Field {
  tag: string
  value: string
}

function parseFields(content: string): Field[] {
  const fields: Field[] = []
  // Split op MT940 tags: regels die beginnen met :XX: of :XXX:
  const tagPattern = /^:(\d{2}[A-Z]?):/gm
  const matches = Array.from(content.matchAll(tagPattern))

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const tag = match[1]
    const start = (match.index ?? 0) + match[0].length
    const end = i + 1 < matches.length ? matches[i + 1].index ?? content.length : content.length
    const value = content.slice(start, end).trim()
    fields.push({ tag, value })
  }

  return fields
}

function parseEntry(entry: Mt940Entry): ParsedTransaction | null {
  const { statementLine, information } = entry

  // :61: formaat: YYMMDDMMDD[C|D][Ccy]Amount[N][FundsCode][BankRef]//[CustomerRef]
  // ING voorbeeld: 2601170117C1139,82N062NONREF//NONREF
  const lineMatch = statementLine.match(
    /^(\d{6})(\d{4})?\s*([CD]R?)\s*([A-Z]{0,3})\s*([\d,]+)\s*([A-Z]\d{3})?\s*([^\n/]+?)(?:\/\/(.+?))?(?:\n|$)/
  )

  if (!lineMatch) {
    // Tweede poging met relaxter patroon
    const relaxed = statementLine.match(/^(\d{6})\s*([CD])\s*([\d,]+)/)
    if (!relaxed) {
      console.warn('[MT940] Kan :61: niet parsen:', statementLine.slice(0, 80))
      return null
    }

    const [, dateStr, cdRaw, amtStr] = relaxed
    const transactionDate = parseMt940Date(dateStr)
    if (!transactionDate) return null

    const amount = parseFloat(amtStr.replace(',', '.'))
    const creditDebit: CreditDebit = cdRaw.startsWith('C') ? 'CRDT' : 'DBIT'

    const { name, iban, description, bankRef } = parse86(information, statementLine)

    // Zoek factuurnummer in meerdere bronnen (beschrijving, bankRef, ruwe :86: tekst)
    const extractedInvoice = findInvoiceNumber(description, bankRef, information)
    const enrichedDescription = prependInvoice(extractedInvoice, description)

    const raw: ParsedTransaction = {
      hash: '',
      bankReference: bankRef,
      transactionDate,
      amount,
      currency: 'EUR',
      creditDebit,
      counterpartyName: name,
      counterpartyIban: iban,
      description: enrichedDescription,
      rawData: `61:${statementLine}\n86:${information}`,
    }
    raw.hash = hashTransaction(raw)
    return raw
  }

  const [, dateStr, valueDateStr, cdRaw, , amtStr, , bankRef] = lineMatch

  const transactionDate = parseMt940Date(dateStr)
  if (!transactionDate) return null

  // Waardedatum: als alleen MMDD, combineer met jaar van boekingsdatum
  let valueDate: Date | undefined
  if (valueDateStr) {
    const year = transactionDate.getFullYear()
    const month = parseInt(valueDateStr.slice(0, 2), 10) - 1
    const day = parseInt(valueDateStr.slice(2, 4), 10)
    const vd = new Date(year, month, day)
    if (!isNaN(vd.getTime())) valueDate = vd
  }

  const amount = parseFloat(amtStr.replace(',', '.'))
  if (isNaN(amount)) return null

  const creditDebit: CreditDebit = cdRaw.startsWith('C') ? 'CRDT' : 'DBIT'

  const { name, iban, description, bankRef: ref86 } = parse86(information, statementLine)

  // Zoek factuurnummer in meerdere bronnen (beschrijving, bankRef, ruwe :86: tekst)
  const extractedInvoice = findInvoiceNumber(description, bankRef?.trim(), information)
  const enrichedDescription = prependInvoice(extractedInvoice, description)

  // Log alle gevonden facturen voor debugging
  const allFound = description.match(/I\d{4,}/gi) ?? []
  const effectiveBankRef = bankRef?.trim() !== 'NONREF' ? bankRef?.trim() : (ref86 ?? undefined)
  console.log(
    `[MT940] datum=${dateStr} bedrag=${amtStr} | facturen=${JSON.stringify(allFound)} | bankRef="${effectiveBankRef ?? '—'}" | naam="${name ?? '—'}"`
  )

  const raw: ParsedTransaction = {
    hash: '',
    bankReference: effectiveBankRef,
    transactionDate,
    valueDate,
    amount,
    currency: 'EUR',
    creditDebit,
    counterpartyName: name,
    counterpartyIban: iban,
    description: enrichedDescription,
    rawData: `61:${statementLine}\n86:${information}`,
  }

  raw.hash = hashTransaction(raw)
  return raw
}

/**
 * Parseer ING :86: structuur.
 * Formaat: /KEY/VALUE/KEY/VALUE/... of vrije tekst in REMI.
 * Bekende keys: TRTP, IBAN, BIC, NAME, REMI, EREF, ORDP, BENM, CSID, ISDT
 *
 * Ondersteunt ook het gelabelde formaat:
 *   Naam: Collins Foods NLD Operations B.V.
 *   Invoice: I02214
 *   I02224
 *   I02225
 *   Kenmerk: 14569/PT1046431
 */
function parse86(
  info: string,
  fallback: string
): { name?: string; iban?: string; description: string; bankRef?: string } {
  const parts: Record<string, string> = {}

  // ING /KEY/VALUE/ structuur parsen
  const segments = info.split('/')
  let currentKey = ''
  for (const seg of segments) {
    if (seg === '') continue
    if (/^[A-Z]{2,6}$/.test(seg)) {
      currentKey = seg
    } else if (currentKey) {
      parts[currentKey] = (parts[currentKey] ? parts[currentKey] + ' ' : '') + seg.trim()
    }
  }

  // Fix: /REMI/USTD// of /REMI/STRD// — USTD/STRD zijn REMI sub-type indicatoren, geen echte keys.
  // In de parser neemt USTD/STRD de currentKey over waardoor parts['REMI'] undefined blijft.
  // De werkelijke omschrijvingstekst staat dan in parts['USTD'] of parts['STRD'].
  if (!parts['REMI'] && (parts['USTD'] ?? parts['STRD'])) {
    parts['REMI'] = parts['USTD'] ?? parts['STRD']
  }

  // Omschrijving: REMI of vrije tekst
  const remi =
    parts['REMI'] ??
    parts['EREF'] ??
    (info.replace(/\/[A-Z]{2,6}\//g, ' ').replace(/\s+/g, ' ').trim() || fallback.trim())

  // Kenmerk uit REMI → bankRef (NOOIT als factuurnummer behandelen)
  const kenmerk = extractLabelValue(remi, /Kenmerk:\s*([^\n\r]+)/i)

  // Tegenpartijnaam: gestructureerde /KEY/ → CNTP (IBAN BIC Naam) → "Naam:"-label → veilige fallback
  // Kenmerk-waarde wordt NOOIT als naam gebruikt
  const name =
    parts['NAME'] ??
    parts['BENM'] ??
    parts['ORDP'] ??
    parts['CDTR'] ??
    extractNameFromCntp(parts['CNTP']) ??
    extractLabelValue(remi, /Naam:\s*([^\n\r]+)/i) ??
    extractNameFallback(info)

  // Log voor debugging
  const invoiceMatches = remi.match(/I\d{4,}/gi) ?? []
  console.log(
    `[MT940:86] facturen=${JSON.stringify(invoiceMatches)} | naam="${name ?? '—'}" | kenmerk="${kenmerk ?? '—'}" | remi="${remi.slice(0, 100)}"`
  )

  return {
    name,
    iban: parts['IBAN'],
    description: remi,
    bankRef: parts['EREF'] ?? kenmerk,
  }
}

/**
 * Extraheer de waarde achter een gelabeld veld (bijv. "Kenmerk:", "Naam:").
 */
function extractLabelValue(text: string, pattern: RegExp): string | undefined {
  const m = text.match(pattern)
  return m ? m[1].trim() : undefined
}

/**
 * Extraheer de klantnaam uit het /CNTP/ veld.
 * CNTP-formaat (ING): IBAN BIC Naam  (spatie-gescheiden na /-split)
 * Voorbeeld: "NL70RABO0374482233 RABONL2U Collins Foods NLD Operations B.V."
 *
 * MT940 regels worden afgebroken bij ~75 tekens (transport wrapping).
 * Daardoor kan de IBAN, BIC of naam een \n bevatten — die normaliseren we eerst.
 */
function extractNameFromCntp(cntp?: string): string | undefined {
  if (!cntp) return undefined
  // Verwijder transport-regelafbrekingen (bijv. "...0224/I\nNGBNL2A/..." → "...0224/INGBNL2A/...")
  const normalized = cntp.replace(/[\n\r]+/g, '')
  // Verwijder IBAN (begint met 2 letters + 2 cijfers) en BIC (6-11 alfanumeriek) van het begin
  const m = normalized.match(/^[A-Z]{2}\d{2}[A-Z0-9]+ [A-Z][A-Z0-9]+ (.+)$/)
  if (m) return m[1].trim()
  // Fallback: als er geen IBAN/BIC prefix is, geef de hele waarde terug mits het een naam lijkt
  return /[a-z]/.test(normalized) ? normalized.trim() : undefined
}

/**
 * Veilige naam-fallback: splitst op newlines en slashes.
 * Slaat regels over die eruitzien als:
 *   - MT940-sleutelwoorden
 *   - IBAN / BIC
 *   - Getallen of referentiecodes (alleen cijfers of alfanumeriek zonder spaties)
 *   - Factuurregels (I\d{4,}, "Invoice:", "Kenmerk:", "Naam:", "Referentie:")
 */
function extractNameFallback(info: string): string | undefined {
  const SKIP = [
    /^[A-Z]{2,6}$/,                    // MT940 sleutelwoord
    /^[A-Z]{2}\d{2}[A-Z0-9]{4}\d/,    // IBAN
    /^[A-Z]{6}[A-Z0-9]{2}/,           // BIC
    /^\d+([,./][\dA-Z]+)*$/,           // getal of referentiecode (14569/PT1046431)
    /^I\d{4,}/i,                        // factuurnummer
    /^(Invoice|Kenmerk|Naam|Referentie|Betalingskenmerk):/i,
  ]
  const lines = info.split(/[\n\r]/).flatMap((l) => l.split('/'))
  for (const line of lines) {
    const s = line.trim()
    if (!s || s.length < 3) continue
    if (SKIP.some((r) => r.test(s))) continue
    // Namen hebben kleine letters; referentiecodes (bijv. "14569 PT1046431") zijn ALLCAPS
    if (/[a-z]/.test(s) && /\s/.test(s)) return s
    // Korte enkelvoudige waarden overslaan (te generiek)
  }
  return undefined
}

/**
 * Zoek factuurnummer in meerdere bronnen, in volgorde van betrouwbaarheid:
 * 1. De verwerkte beschrijving (REMI/EREF veld)
 * 2. De bankRef uit de :61: regel
 * 3. De ruwe :86: tekst (vangt gevallen op waar parse86 REMI mist door slash-structuur)
 */
function findInvoiceNumber(
  description: string,
  bankRef?: string,
  rawInfo?: string
): string | null {
  return (
    extractInvoiceNumber(description) ??
    extractInvoiceNumber(bankRef ?? '') ??
    extractInvoiceNumber(rawInfo ?? '')
  )
}

/**
 * Zet het factuurnummer expliciet vooraan in de beschrijving als het er niet
 * al in staat in genormaliseerde vorm. Zo vindt de matching engine het altijd.
 */
function prependInvoice(invoiceId: string | null, description: string): string {
  if (!invoiceId) return description
  // Genormaliseerde vergelijking: scheidingstekens (/, +, .) tellen niet mee
  const normalizedDesc = description.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const normalizedInvoice = invoiceId.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (normalizedDesc.includes(normalizedInvoice)) return description
  return `${invoiceId} ${description}`.trim()
}

function parseMt940Date(yymmdd: string): Date | null {
  if (yymmdd.length !== 6) return null
  const yy = parseInt(yymmdd.slice(0, 2), 10)
  const mm = parseInt(yymmdd.slice(2, 4), 10) - 1
  const dd = parseInt(yymmdd.slice(4, 6), 10)
  // Assumptie: YY >= 00 zijn 2000+, maar pas op voor toekomstige jaren
  const year = yy + (yy >= 0 && yy <= 99 ? 2000 : 1900)
  const d = new Date(year, mm, dd)
  return isNaN(d.getTime()) ? null : d
}
