import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fetchOpenInvoices } from '@/lib/rentmagic/client'
import { auditLog } from '@/lib/utils/audit'

/**
 * Synchroniseer openstaande facturen vanuit RentMagic naar de lokale cache.
 * Gebruikt upsert zodat bestaande entries geüpdatet worden.
 */
export async function POST() {
  try {
    const invoices = await fetchOpenInvoices()

    if (invoices.length === 0) {
      return NextResponse.json({ message: 'Geen facturen ontvangen van RentMagic', count: 0 })
    }

    console.log(`[Sync] Ontvangen van RentMagic: ${invoices.length} facturen`)

    let synced = 0
    let skipped = 0
    let errors = 0

    for (const inv of invoices) {
      // RentMagic kan verschillende veldnamen gebruiken; normaliseer naar uppercase + trim
      const invoiceId = String(inv.InvoiceID ?? inv.ID ?? '').trim().toUpperCase()
      if (!invoiceId) continue

      const totalAmount = parseFloat(String(inv.TotalAmount ?? inv.Amount ?? 0))
      // Balance is leidend: RentMagic gebruikt 'Balance' of 'OpenAmount' afhankelijk van versie
      const openAmount = parseFloat(String(inv.Balance ?? inv.OpenAmount ?? inv.TotalAmount ?? inv.Amount ?? 0))

      if (isNaN(totalAmount) || isNaN(openAmount)) continue

      // Filter: ALLEEN openstaand saldo bepaalt of factuur in cache komt.
      // Status/ExportStatus/Label worden volledig genegeerd.
      if (openAmount <= 0) {
        console.log(`[Sync] Overgeslagen: ${invoiceId} | Balance=${inv.Balance ?? '—'} OpenAmount=${inv.OpenAmount ?? '—'} → openAmount=${openAmount}`)
        skipped++
        continue
      }

      console.log(`[Sync] Opslaan: ${invoiceId} | Balance=${inv.Balance ?? '—'} OpenAmount=${inv.OpenAmount ?? '—'} → openAmount=${openAmount} | status=${inv.Status ?? '—'}`)

      try {
        await db.invoiceCache.upsert({
          where: { invoiceId },
          update: {
            customerId: inv.CustomerID ? String(inv.CustomerID) : null,
            customerName: inv.CustomerName ? String(inv.CustomerName) : null,
            totalAmount,
            openAmount,
            invoiceDate: inv.InvoiceDate ? new Date(inv.InvoiceDate) : null,
            dueDate: inv.DueDate ? new Date(inv.DueDate) : null,
            status: inv.Status ? String(inv.Status) : null,
            rawData: inv as object,
            syncedAt: new Date(),
            updatedAt: new Date(),
          },
          create: {
            invoiceId,
            customerId: inv.CustomerID ? String(inv.CustomerID) : null,
            customerName: inv.CustomerName ? String(inv.CustomerName) : null,
            totalAmount,
            openAmount,
            invoiceDate: inv.InvoiceDate ? new Date(inv.InvoiceDate) : null,
            dueDate: inv.DueDate ? new Date(inv.DueDate) : null,
            status: inv.Status ? String(inv.Status) : null,
            rawData: inv as object,
          },
        })
        synced++
      } catch (err) {
        errors++
        console.error(`[Sync] Factuur ${invoiceId} mislukt:`, err)
      }
    }

    console.log(`[Sync] Klaar: ${synced} opgeslagen, ${skipped} overgeslagen (openAmount=0), ${errors} fouten`)

    await auditLog({
      action: 'SYNC_INVOICES',
      entityType: 'InvoiceCache',
      entityId: 'bulk',
      payload: { fetched: invoices.length, synced, skipped, errors },
      response: null,
      success: errors === 0,
    })

    return NextResponse.json({ synced, skipped, errors, total: invoices.length })
  } catch (err) {
    console.error('[Sync] Fout:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
