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

  const raw: ParsedTransaction = {
    hash: '',
    bankReference: bankRef?.trim() !== 'NONREF' ? bankRef?.trim() : (ref86 ?? undefined),
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
 * Formaat: /KEY/VALUE/KEY/VALUE/...
 * Bekende keys: TRTP, IBAN, BIC, NAME, REMI, EREF, ORDP, BENM, CSID, ISDT
 */
function parse86(
  info: string,
  fallback: string
): { name?: string; iban?: string; description: string; bankRef?: string } {
  const parts: Record<string, string> = {}

  // ING slaat soms /TRTP/ weg en begint direct met de omschrijving
  const segments = info.split('/')
  let currentKey = ''
  for (const seg of segments) {
    if (seg === '') continue
    // Controleer of dit een sleutelwoord is (all caps, max 4 chars)
    if (/^[A-Z]{2,6}$/.test(seg)) {
      currentKey = seg
    } else if (currentKey) {
      parts[currentKey] = (parts[currentKey] ? parts[currentKey] + ' ' : '') + seg.trim()
    }
  }

  // Omschrijving: REMI of vrije tekst
  const description =
    parts['REMI'] ??
    parts['EREF'] ??
    (info.replace(/\/[A-Z]{2,6}\//g, ' ').replace(/\s+/g, ' ').trim() ||
    fallback.trim())

  return {
    name: parts['NAME'],
    iban: parts['IBAN'],
    description,
    bankRef: parts['EREF'],
  }
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
