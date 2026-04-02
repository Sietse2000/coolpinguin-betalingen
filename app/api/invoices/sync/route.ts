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
    // Haal alle facturen op via paginering (500 per batch) totdat alles binnen is
    const PAGE_SIZE = 500
    const fetchBatch = async (index: number): Promise<{ items: Record<string, unknown>[]; total: number }> => {
      const url = `${BASE_URL}/api/v2/invoices?token=${encodeURIComponent(API_KEY)}&index=${index}&size=${PAGE_SIZE}&sortOn=InvoiceID&sortReverse=false`
      const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' })
      if (!res.ok) throw new Error(`RentMagic fout: ${res.status}`)
      const data = await res.json() as Record<string, unknown>
      const items: Record<string, unknown>[] = Array.isArray(data)
        ? data
        : Array.isArray(data['Collection']) ? data['Collection'] as Record<string, unknown>[]
        : Array.isArray(data['Items']) ? data['Items'] as Record<string, unknown>[]
        : []
      const total = typeof data['Total'] === 'number' ? data['Total'] : items.length
      return { items, total }
    }

    const first = await fetchBatch(1)
    const totalPages = Math.ceil(first.total / PAGE_SIZE)
    console.log(`[Sync] Totaal in RentMagic: ${first.total}, pagina's: ${totalPages}`)

    const remainingBatches = totalPages > 1
      ? await Promise.all(Array.from({ length: totalPages - 1 }, (_, i) => fetchBatch(i + 2)))
      : []

    const invoiceMap = new Map<string, Record<string, unknown>>()
    for (const inv of [...first.items, ...remainingBatches.flatMap((b) => b.items)]) {
      const id = String(inv['InvoiceID'] ?? inv['ID'] ?? '').trim().toUpperCase()
      if (id) invoiceMap.set(id, inv)
    }
    const invoices = Array.from(invoiceMap.values())

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
      // Sla facturen met saldo 0 over — die zijn al vereffend
      if (openAmount === 0) continue

      const statusLabel = inv['Status'] ? String(inv['Status']) : null
      // Label zit in Label[0].Description (array van objecten met Key/Description)
      const labelArr = Array.isArray(inv['Label']) ? inv['Label'] as Record<string, unknown>[] : null
      const label = labelArr?.[0]?.['Description'] ? String(labelArr[0]['Description']) : null
      const totalExcVat = inv['TotalExcVAT'] != null ? parseFloat(String(inv['TotalExcVAT'])) : null
      const totalVat    = inv['TotalVAT']    != null ? parseFloat(String(inv['TotalVAT']))    : null

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
            label,
            totalExcVat: totalExcVat != null && !isNaN(totalExcVat) ? totalExcVat : null,
            totalVat:    totalVat    != null && !isNaN(totalVat)    ? totalVat    : null,
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
            label,
            totalExcVat: totalExcVat != null && !isNaN(totalExcVat) ? totalExcVat : null,
            totalVat:    totalVat    != null && !isNaN(totalVat)    ? totalVat    : null,
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
