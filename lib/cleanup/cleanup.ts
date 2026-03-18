import { db } from '@/lib/db'

/**
 * Cleanup van verlopen importdata.
 *
 * Strategie: "Cleanup on upload" (lazy/passive cleanup)
 * - Wordt aangeroepen aan het begin van elke upload
 * - Ook beschikbaar via POST /api/cleanup voor handmatige uitvoering
 *
 * Waarom deze aanpak voor Neon free tier:
 * - Geen cron job of background worker nodig
 * - Geen extra infrastructuurkosten
 * - Database raakt niet vol: elke upload ruimt oude data op
 * - Predictable timing: cleanup gebeurt bij actief gebruik
 *
 * Wat wordt verwijderd:
 * - BankTransaction waar expiresAt < now() (cascade verwijdert bijbehorende PaymentLogs
 *   voor niet-verwerkte transacties via onDelete: Cascade)
 * - Upload records waar expiresAt < now() EN geen actieve transacties meer aan hangen
 *
 * Wat NIET wordt verwijderd:
 * - BankTransaction met expiresAt = null (verwerkte betalingen — permanent)
 * - PaymentLog voor verwerkte transacties (audit trail)
 * - AuditLog (altijd permanent)
 * - InvoiceCache (wordt bijgehouden via sync)
 */
export async function cleanupExpired(): Promise<{
  transactionsDeleted: number
  uploadsDeleted: number
}> {
  const now = new Date()

  // Verwijder verlopen transacties (cascade verwijdert bijbehorende PaymentLogs
  // voor niet-verwerkte transacties via Prisma onDelete: Cascade)
  const txResult = await db.bankTransaction.deleteMany({
    where: {
      expiresAt: { lt: now },
    },
  })

  // Verwijder Upload records die verlopen zijn en geen transacties meer hebben
  const uploadResult = await db.upload.deleteMany({
    where: {
      expiresAt: { lt: now },
      transactions: { none: {} },
    },
  })

  if (txResult.count > 0 || uploadResult.count > 0) {
    console.log(
      `[Cleanup] Verwijderd: ${txResult.count} transacties, ${uploadResult.count} uploads`
    )
  }

  return {
    transactionsDeleted: txResult.count,
    uploadsDeleted: uploadResult.count,
  }
}

/**
 * Bereken de expiresAt timestamp voor nieuwe importdata.
 * Standaard: 2 uur na aanmaken.
 */
export function importExpiresAt(): Date {
  const ttlHours = parseInt(process.env.IMPORT_TTL_HOURS ?? '2', 10)
  const d = new Date()
  d.setHours(d.getHours() + ttlHours)
  return d
}
