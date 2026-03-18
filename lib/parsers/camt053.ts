import { XMLParser } from 'fast-xml-parser'
import type { ParsedTransaction, CreditDebit } from '@/types'
import { hashTransaction } from '@/lib/utils/hash'

/**
 * Parser voor CAMT.053 bankafschriften (ING formaat).
 * Ondersteunt camt.053.001.02 en camt.053.001.08.
 *
 * Structuur:
 * Document > BkToCstmrStmt > Stmt > Ntry[] > NtryDtls > TxDtls[]
 */
export function parseCamt053(xmlContent: string): ParsedTransaction[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '_attr_',
    isArray: (name) =>
      ['Ntry', 'TxDtls', 'NtryDtls', 'Ustrd', 'Strd'].includes(name),
    parseTagValue: true,
    trimValues: true,
  })

  const doc = parser.parse(xmlContent)

  // Navigeer naar de Statement, ongeacht namespace-wrapper
  const root =
    doc?.Document?.BkToCstmrStmt ??
    doc?.['ns2:Document']?.BkToCstmrStmt ??
    doc?.Document?.['ns2:BkToCstmrStmt']

  if (!root) {
    throw new Error('Ongeldige CAMT.053: Document > BkToCstmrStmt niet gevonden')
  }

  const stmt = Array.isArray(root.Stmt) ? root.Stmt[0] : root.Stmt
  if (!stmt) throw new Error('Geen Stmt in CAMT.053')

  const entries: unknown[] = Array.isArray(stmt.Ntry)
    ? stmt.Ntry
    : stmt.Ntry
    ? [stmt.Ntry]
    : []

  const transactions: ParsedTransaction[] = []

  for (const entry of entries) {
    const e = entry as Record<string, unknown>

    try {
      // Bedrag
      const amtNode = e.Amt as Record<string, unknown> | number | string
      const amount =
        typeof amtNode === 'object' && amtNode !== null
          ? parseFloat(String((amtNode as Record<string, unknown>)['#text'] ?? amtNode))
          : parseFloat(String(amtNode))

      if (isNaN(amount)) continue

      // CRDT = inkomend geld, DBIT = uitgaand geld
      const cdInd = String(e.CdtDbtInd ?? '').trim().toUpperCase()
      const creditDebit: CreditDebit =
        cdInd === 'CRDT' || cdInd === 'C' ? 'CRDT' : 'DBIT'

      // Datum
      const bookDate = extractDate(e.BookgDt) ?? extractDate(e.ValDt)
      const valueDate = extractDate(e.ValDt)
      if (!bookDate) continue

      // Detail-niveau (transactiedetails)
      const dtls = e.NtryDtls as Record<string, unknown> | undefined
      const txDtlsRaw = dtls?.TxDtls
      const txDtlsList: Record<string, unknown>[] = Array.isArray(txDtlsRaw)
        ? txDtlsRaw
        : txDtlsRaw
        ? [txDtlsRaw as Record<string, unknown>]
        : [{}]

      for (const txDtl of txDtlsList) {
        const counterparty = extractCounterparty(txDtl, creditDebit)
        const description = extractDescription(txDtl, e)
        const bankRef = extractBankRef(txDtl, e)

        const raw: ParsedTransaction = {
          hash: '', // wordt hieronder berekend
          bankReference: bankRef,
          transactionDate: bookDate,
          valueDate: valueDate ?? undefined,
          amount,
          currency: extractCurrency(e.Amt) ?? 'EUR',
          creditDebit,
          counterpartyName: counterparty.name,
          counterpartyIban: counterparty.iban,
          description,
          rawData: JSON.stringify(e),
        }

        raw.hash = hashTransaction(raw)
        transactions.push(raw)
      }
    } catch (err) {
      console.warn('[CAMT053] Entry overgeslagen:', err)
    }
  }

  return transactions
}

function extractDate(node: unknown): Date | null {
  if (!node) return null
  const n = node as Record<string, unknown>
  const raw = n?.Dt ?? n?.DtTm ?? node
  if (!raw) return null
  const d = new Date(String(raw))
  return isNaN(d.getTime()) ? null : d
}

function extractCurrency(amtNode: unknown): string | undefined {
  if (!amtNode || typeof amtNode !== 'object') return undefined
  const n = amtNode as Record<string, unknown>
  return String(n['_attr_Ccy'] ?? n.Ccy ?? 'EUR')
}

function extractCounterparty(
  txDtl: Record<string, unknown>,
  creditDebit: CreditDebit
): { name?: string; iban?: string } {
  const parties = txDtl.RltdPties as Record<string, unknown> | undefined
  if (!parties) return {}

  // Bij inkomende betaling is de tegenpartij de Debtor
  // Bij uitgaande betaling is de tegenpartij de Creditor
  const counterKey = creditDebit === 'CRDT' ? 'Dbtr' : 'Cdtr'
  const accountKey = creditDebit === 'CRDT' ? 'DbtrAcct' : 'CdtrAcct'

  const partyNode = parties[counterKey] as Record<string, unknown> | undefined
  const accountNode = parties[accountKey] as Record<string, unknown> | undefined

  const name = partyNode?.Nm
    ? String(partyNode.Nm)
    : undefined

  const ibanNode = (accountNode?.Id as Record<string, unknown>)?.IBAN
  const iban = ibanNode ? String(ibanNode) : undefined

  return { name, iban }
}

function extractDescription(
  txDtl: Record<string, unknown>,
  entry: Record<string, unknown>
): string {
  // Probeer gestructureerde beschrijving
  const rmtInf = txDtl.RmtInf as Record<string, unknown> | undefined
  if (rmtInf) {
    const ustrd = rmtInf.Ustrd
    if (ustrd) {
      const parts = Array.isArray(ustrd) ? ustrd : [ustrd]
      return parts.map(String).join(' ').trim()
    }
  }

  // Fallback: AdditionalEntryInformation
  const addlInfo = entry.AddtlNtryInf ?? entry.AddtlTxInf
  if (addlInfo) return String(addlInfo).trim()

  return ''
}

function extractBankRef(
  txDtl: Record<string, unknown>,
  entry: Record<string, unknown>
): string | undefined {
  // Probeer bank transaction code / end-to-end reference
  const refs = txDtl.Refs as Record<string, unknown> | undefined
  if (refs) {
    const ref =
      refs.EndToEndId ??
      refs.TxId ??
      refs.InstrId ??
      refs.MsgId
    if (ref) return String(ref)
  }

  // Fallback: entry account servicer reference
  const acctSvcrRef = entry.AcctSvcrRef
  if (acctSvcrRef) return String(acctSvcrRef)

  return undefined
}
