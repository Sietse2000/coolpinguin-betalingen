import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * DEV-ONLY reset endpoint.
 *
 * Verwijdert alle import/testdata:
 *   - Upload            (cascades naar BankTransaction → PaymentLog)
 *   - AuditLog          (optioneel, via ?auditlog=1)
 *
 * Raakt NOOIT aan:
 *   - InvoiceCache      (data uit RentMagic)
 *   - RentMagic zelf    (geen API-aanroepen)
 *
 * Beschermd door:
 *   1. NODE_ENV === 'development' check
 *   2. Vereist header X-Dev-Reset: true (voorkomt per ongeluk aanroepen)
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { error: 'Deze route is alleen beschikbaar in development mode.' },
      { status: 403 }
    )
  }

  const header = req.headers.get('X-Dev-Reset')
  if (header !== 'true') {
    return NextResponse.json(
      { error: 'Ontbrekende header X-Dev-Reset: true' },
      { status: 400 }
    )
  }

  const { searchParams } = new URL(req.url)
  const clearAuditLog = searchParams.get('auditlog') === '1'

  // Verwijder in volgorde: PaymentLog → BankTransaction → Upload
  // (niet op cascade vertrouwen — werkt alleen als de FK op DB-niveau staat)
  try {
    await db.paymentLog.deleteMany({})
    await db.bankTransaction.deleteMany({})
    await db.upload.deleteMany({})
  } catch (err) {
    console.error('[DevReset] DB-fout:', err)
    return NextResponse.json(
      { error: 'DB-fout bij reset', details: String(err) },
      { status: 500 }
    )
  }

  const auditLogs = clearAuditLog
    ? await db.auditLog.deleteMany({})
    : { count: 0 }


  return NextResponse.json({
    ok: true,
    deleted: {
      auditLogs: auditLogs.count,
      note: 'Upload, BankTransaction en PaymentLog verwijderd.',
    },
  })
}
