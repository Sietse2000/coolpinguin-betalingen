/**
 * Dev-only reset script.
 * Gebruik: npx tsx scripts/dev-reset.ts
 *
 * Verwijdert: Upload, BankTransaction (cascade), PaymentLog (cascade)
 * Behoudt:    InvoiceCache, AuditLog
 *
 * Met --auditlog ook AuditLog wissen.
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌  Weigert te draaien in production (NODE_ENV=production)')
    process.exit(1)
  }

  const clearAuditLog = process.argv.includes('--auditlog')

  console.log('🗑  Testdata wissen...')

  // Verwijder in volgorde zodat FK-constraints niet blokkeren
  await db.paymentLog.deleteMany({})
  await db.bankTransaction.deleteMany({})
  const uploads = await db.upload.deleteMany({})
  console.log(`   ✓ ${uploads.count} uploads verwijderd (+ bijbehorende transacties en logs)`)

  if (clearAuditLog) {
    const audit = await db.auditLog.deleteMany({})
    console.log(`   ✓ ${audit.count} auditlog-regels verwijderd`)
  } else {
    console.log('   ℹ  AuditLog behouden (gebruik --auditlog om ook dit te wissen)')
  }

  console.log('\n✅  Reset klaar. Je kunt nu opnieuw uploaden en testen.')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
