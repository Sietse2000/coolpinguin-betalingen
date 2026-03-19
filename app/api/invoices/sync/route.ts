import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditLog } from '@/lib/utils/audit'

/**
 * Synchroniseer de meest recente 500 facturen vanuit RentMagic naar de lokale cache.
 *
 * Slaat alle facturen op — ook volledig betaalde (openAmount = 0).
 * De matching engine gebruikt openAmount om drie gevallen te onderscheiden:
 *   openAmount > 0  → factuur is openstaand → koppelen + verwerken
 *   openAmount = 0  → factuur bestaat maar is betaald → INVOICE_ALREADY_PAID (→ status PAID)
 *   niet in cache   → factuur bestaat niet in RM → NO_MATCH (echte review)
 */
export async function POST() {
  try {
    const BASE_URL = process.env.RENTMAGIC_BASE_URL?.replace(/\/$/, '') ?? ''
    const API_KEY = process.env.RENTMAGIC_API_KEY ?? ''
    const url = `${BASE_URL}/api/v2/invoices?token=${encodeURIComponent(API_KEY)}&index=1&size=500&sortOn=InvoiceID&sortReverse=true`

    console.log('[Sync] Ophalen facturen:', url.replace(API_KEY, '***'))

    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })

    const rawText = await res.text()
    console.log('[Sync] Status:', res.status, '| Preview:', rawText.slice(0, 300))

    if (!res.ok) {
      return NextResponse.json(
        { error: `RentMagic fout: ${res.status} ${rawText.slice(0, 200)}` },
        { status: 502 }
      )
    }

    let data: unknown
    try {
      data = JSON.parse(rawText)
    } catch {
      return NextResponse.json({ error: 'Ongeldige JSON van RentMagic' }, { status: 502 })
    }

    // Ondersteun array, { Collection }, { Items }, { invoices }, { data }
    let invoices: Record<string, unknown>[] = []
    if (Array.isArray(data)) {
      invoices = data
    } else if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>
      const candidate = d['Collection'] ?? d['Items'] ?? d['invoices'] ?? d['data'] ?? d['Invoices']
      if (Array.isArray(candidate)) {
        invoices = candidate as Record<string, unknown>[]
      } else {
        console.log('[Sync] Onbekende response-structuur, keys:', Object.keys(d).join(', '))
      }
    }

    console.log(`[Sync] Ontvangen: ${invoices.length} facturen`)
    if (invoices.length > 0) {
      console.log('[Sync] Keys eerste factuur:', Object.keys(invoices[0]).join(', '))
    }

    let synced = 0
    let errors = 0

    for (const inv of invoices) {
      const invoiceId = String(inv['InvoiceID'] ?? inv['ID'] ?? '').trim().toUpperCase()
      if (!invoiceId) continue

      const totalAmount = parseFloat(String(inv['TotalAmount'] ?? inv['Amount'] ?? 0))
      // Balance is leidend; OpenAmount als fallback
      const openAmount = parseFloat(String(inv['Balance'] ?? inv['OpenAmount'] ?? inv['TotalAmount'] ?? inv['Amount'] ?? 0))

      if (isNaN(totalAmount) || isNaN(openAmount)) continue

      const statusLabel = inv['Status'] ? String(inv['Status']) : null

      try {
        await db.invoiceCache.upsert({
          where: { invoiceId },
          update: {
            customerId: inv['CustomerID'] ? String(inv['CustomerID']) : null,
            customerName: inv['CustomerName'] ? String(inv['CustomerName']) : null,
            totalAmount,
            openAmount,
            invoiceDate: inv['InvoiceDate'] ? new Date(String(inv['InvoiceDate'])) : null,
            dueDate: inv['DueDate'] ? new Date(String(inv['DueDate'])) : null,
            status: statusLabel,
            rawData: inv as object,
            syncedAt: new Date(),
            updatedAt: new Date(),
          },
          create: {
            invoiceId,
            customerId: inv['CustomerID'] ? String(inv['CustomerID']) : null,
            customerName: inv['CustomerName'] ? String(inv['CustomerName']) : null,
            totalAmount,
            openAmount,
            invoiceDate: inv['InvoiceDate'] ? new Date(String(inv['InvoiceDate'])) : null,
            dueDate: inv['DueDate'] ? new Date(String(inv['DueDate'])) : null,
            status: statusLabel,
            rawData: inv as object,
          },
        })
        synced++
      } catch (err) {
        errors++
        console.error(`[Sync] Factuur ${invoiceId} mislukt:`, err)
      }
    }

    console.log(`[Sync] Klaar: ${synced} opgeslagen, ${errors} fouten`)

    await auditLog({
      action: 'SYNC_INVOICES',
      entityType: 'InvoiceCache',
      entityId: 'bulk',
      payload: { fetched: invoices.length, synced, errors },
      response: null,
      success: errors === 0,
    })

    return NextResponse.json({ synced, errors, total: invoices.length })
  } catch (err) {
    console.error('[Sync] Fout:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
