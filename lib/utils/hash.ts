import { createHash } from 'crypto'
import type { ParsedTransaction } from '@/types'

/**
 * Genereert een deterministische SHA256 hash voor een banktransactie.
 * Gebruikt voor idempotency / duplicate prevention.
 *
 * Strategie: als er een bankReference is, gebruiken we die als basis.
 * Anders combineren we datum + bedrag + IBAN + beschrijving.
 * Dit voorkomt dat dezelfde transactie tweemaal verwerkt wordt.
 */
export function hashTransaction(tx: Omit<ParsedTransaction, 'hash'>): string {
  const parts = [
    tx.transactionDate.toISOString().slice(0, 10),
    tx.amount.toFixed(2),
    tx.creditDebit,
    tx.currency,
    tx.counterpartyIban ?? tx.counterpartyName ?? '',
    // Trim description om whitespace-variaties te neutraliseren
    (tx.description ?? '').trim().slice(0, 140),
    // BankReference als sterkste uniekheidsgarantie
    tx.bankReference ?? '',
  ]

  return createHash('sha256').update(parts.join('|')).digest('hex')
}
