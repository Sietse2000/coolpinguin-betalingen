import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseCamt053 } from '@/lib/parsers/camt053'
import { parseMt940 } from '@/lib/parsers/mt940'
import { runMatchingEngine } from '@/lib/matching/engine'
import { checkDuplicateFromCache } from '@/lib/duplicate/detector'
import { cleanupExpired, importExpiresAt } from '@/lib/cleanup/cleanup'
import type { FileType } from '@/types'

export async function POST(req: NextRequest) {
  try {
    // ── Stap 0: Cleanup verlopen data van vorige uploads ──
    // Passieve cleanup: elke upload ruimt verlopen importdata op.
    // Zo blijft Neon schoon zonder cron job.
    cleanupExpired().catch((err) => console.error('[Cleanup] Fout:', err))

    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'Geen bestand ontvangen' }, { status: 400 })
    }

    const filename = file.name
    const content = await file.text()

    const fileType = detectFileType(filename, content)
    if (!fileType) {
      return NextResponse.json(
        { error: 'Bestandstype niet herkend. Upload een .xml (CAMT.053) of .sta/.mt940 bestand.' },
        { status: 400 }
      )
    }

    const expiresAt = importExpiresAt()

    const upload = await db.upload.create({
      data: { filename, fileType, status: 'PROCESSING', transactionCount: 0, expiresAt },
    })

    let parsed
    try {
      parsed = fileType === 'CAMT053' ? parseCamt053(content) : parseMt940(content)
    } catch (err) {
      await db.upload.update({ where: { id: upload.id }, data: { status: 'FAILED' } })
      return NextResponse.json(
        { error: `Parsefout: ${err instanceof Error ? err.message : String(err)}` },
        { status: 422 }
      )
    }

    if (parsed.length === 0) {
      await db.upload.update({ where: { id: upload.id }, data: { status: 'FAILED' } })
      return NextResponse.json({ error: 'Geen transacties gevonden in bestand' }, { status: 422 })
    }

    // ── Dedup check op hash ──
    const hashes = parsed.map((t) => t.hash)
    const existing = await db.bankTransaction.findMany({
      where: { hash: { in: hashes } },
      select: { hash: true },
    })
    const existingHashes = new Set(existing.map((e) => e.hash))

    // ── Haal factuurcache op voor matching + duplicate detectie ──
    const invoices = await db.invoiceCache.findMany()

    let newCount = 0
    let dupCount = 0
    let autoCount = 0
    let reviewCount = 0
    let skippedDebit = 0

    for (const tx of parsed) {
      // Afschrijvingen overslaan
      if (tx.creditDebit === 'DBIT') {
        skippedDebit++
        continue
      }

      // Hash-duplicaat: al eerder gezien
      if (existingHashes.has(tx.hash)) {
        dupCount++
        continue
      }

      // ── Matching engine ──
      const matchResult = runMatchingEngine({
        amount: tx.amount,
        creditDebit: tx.creditDebit,
        counterpartyName: tx.counterpartyName,
        description: tx.description,
        bankReference: tx.bankReference,
        transactionDate: tx.transactionDate,
      }, invoices)
      const top = matchResult.primarySuggestion
      const dec = matchResult.primaryDecision

      // ── Duplicate detectie op basis van factuurcache ──
      let isDuplicate = false
      let duplicateReason = ''
      const invoicesForDupCheck = invoices.map((i) => ({
        invoiceId: i.invoiceId,
        openAmount: i.openAmount.toString(),
      }))

      // Bij multi-invoice: check alle facturen, één duplicaat blokkeert de hele batch
      const invoicesToCheck = matchResult.multiInvoiceMatches
        ? matchResult.multiInvoiceMatches.map((m) => m.invoiceId)
        : top?.invoiceId ? [top.invoiceId] : []

      for (const invoiceId of invoicesToCheck) {
        const dupCheck = checkDuplicateFromCache(invoiceId, parseFloat(tx.amount.toFixed(2)), invoicesForDupCheck)
        if (dupCheck.isDuplicate) {
          isDuplicate = true
          duplicateReason = dupCheck.reason
          break
        }
      }

      // ── Status bepalen ──
      let status: 'DUPLICATE' | 'AUTO_MATCHED' | 'REVIEW' | 'PENDING'
      if (isDuplicate) {
        status = 'DUPLICATE'
      } else if (dec.autoProcess && (top || matchResult.multiInvoiceMatches)) {
        status = 'AUTO_MATCHED'
        autoCount++
      } else if (top || (dec.scenario !== 'NO_MATCH' && dec.scenario !== 'DEBIT_TRANSACTION')) {
        status = 'REVIEW'
        reviewCount++
      } else if (matchResult.extractedInvoiceId) {
        // Factuurnummer gevonden maar niet in openstaande facturen → review zodat
        // de medewerker het kan controleren (gefactureerd maar niet in RentMagic?)
        status = 'REVIEW'
        reviewCount++
      } else {
        status = 'PENDING'
      }

      // matchedInvoiceId: altijd vullen als factuurnummer gevonden is, ook bij NO_MATCH.
      // Zo is het veld in de UI direct zichtbaar zonder te wachten op een succesvolle match.
      const matchedInvoiceId = matchResult.multiInvoiceMatches
        ? matchResult.multiInvoiceMatches.map((m) => m.invoiceId).join(',')
        : (top?.invoiceId ?? matchResult.extractedInvoiceId ?? null)

      await db.bankTransaction.create({
        data: {
          hash: tx.hash,
          uploadId: upload.id,
          bankReference: tx.bankReference,
          transactionDate: tx.transactionDate,
          valueDate: tx.valueDate,
          amount: tx.amount,
          currency: tx.currency,
          creditDebit: tx.creditDebit,
          counterpartyName: tx.counterpartyName,
          counterpartyIban: tx.counterpartyIban,
          description: tx.description,
          rawData: tx.rawData,
          status,
          matchedInvoiceId,
          confidence: top?.confidence ?? null,
          matchType: isDuplicate ? 'DUPLICATE' : dec.scenario,
          matchReason: dec.reviewReason ?? top?.reason ?? null,
          duplicateReason: isDuplicate ? duplicateReason : null,
          expiresAt,
        },
      })

      newCount++
    }

    await db.upload.update({
      where: { id: upload.id },
      data: { status: 'DONE', transactionCount: newCount },
    })

    // ── Verwerk auto-matched transacties op de achtergrond ──
    if (autoCount > 0) {
      processAutoMatched(upload.id).catch((err) =>
        console.error('[AutoProcess] Fout:', err)
      )
    }

    return NextResponse.json({
      uploadId: upload.id,
      total: parsed.length,
      new: newCount,
      duplicates: dupCount,
      skippedDebit,
      autoProcessing: autoCount,
      needsReview: reviewCount,
      pending: newCount - autoCount - reviewCount,
      expiresAt: expiresAt.toISOString(),
    })
  } catch (err) {
    console.error('[Upload] Onverwachte fout:', err)
    return NextResponse.json({ error: 'Interne serverfout', details: String(err) }, { status: 500 })
  }
}

function detectFileType(filename: string, content: string): FileType | null {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.xml')) return 'CAMT053'
  if (lower.endsWith('.sta') || lower.endsWith('.mt940') || lower.endsWith('.940')) return 'MT940'
  if (content.trimStart().startsWith('<') && content.includes('BkToCstmrStmt')) return 'CAMT053'
  if (content.includes(':20:') && content.includes(':61:')) return 'MT940'
  return null
}

async function processAutoMatched(uploadId: string) {
  const { processTransaction, processMultipleInvoices } = await import('@/lib/processing/processor')

  const autoTxs = await db.bankTransaction.findMany({
    where: { uploadId, status: 'AUTO_MATCHED' },
  })

  for (const tx of autoTxs) {
    if (!tx.matchedInvoiceId) continue
    try {
      if (tx.matchedInvoiceId.includes(',')) {
        // MULTI_INVOICE_EXACT: komma-gescheiden factuurnummers
        await processMultipleInvoices(tx.id, tx.matchedInvoiceId.split(','))
      } else {
        await processTransaction(tx.id, tx.matchedInvoiceId)
      }
    } catch (err) {
      console.error(`[AutoProcess] Transactie ${tx.id} mislukt:`, err)
    }
  }
}
