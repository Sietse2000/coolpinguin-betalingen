import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Labels zoals ze in RentMagic staan (CUST_Label)
const CATEGORIEEN = [
  { key: 'wachten',     labels: ['Wachten op betaling'],                  kleur: 'blue'   },
  { key: 'herinnering1', labels: ['Eerste herinnering gekregen'],          kleur: 'yellow' },
  { key: 'herinnering2', labels: ['Tweede herinnering gekregen'],          kleur: 'orange' },
  { key: 'credifxx',    labels: ['Wordt behandeld door credifixx', 'Credifixx', 'credifixx'], kleur: 'red' },
  { key: 'overig',      labels: null,                                      kleur: 'gray'   },
]

export async function GET() {
  // Haal alle facturen met openAmount > 0 op (excl. betaald label)
  const facturen = await db.invoiceCache.findMany({
    where: {
      openAmount: { gt: 0 },
      NOT: { label: 'Betaald' },
    },
    select: {
      invoiceId: true,
      customerName: true,
      openAmount: true,
      invoiceDate: true,
      dueDate: true,
      label: true,
    },
    orderBy: { dueDate: 'asc' },
  })

  const syncedAt = await db.invoiceCache.findFirst({
    orderBy: { syncedAt: 'desc' },
    select: { syncedAt: true },
  })

  // Groepeer per categorie
  const gegroepeerd = CATEGORIEEN.map((cat) => {
    const items = facturen.filter((f) => {
      if (!cat.labels) {
        // "overig": alles wat niet in een andere categorie valt
        return !CATEGORIEEN.filter((c) => c.labels).some((c) =>
          c.labels!.some((l) => l.toLowerCase() === (f.label ?? '').toLowerCase())
        )
      }
      return cat.labels.some((l) => l.toLowerCase() === (f.label ?? '').toLowerCase())
    })

    const totaal = items.reduce((sum, f) => sum + Number(f.openAmount), 0)

    return {
      key: cat.key,
      kleur: cat.kleur,
      label: cat.labels?.[0] ?? 'Overig / geen label',
      aantal: items.length,
      totaal,
      facturen: items,
    }
  }).filter((cat) => cat.aantal > 0)

  const totaalOpenstaand = facturen.reduce((sum, f) => sum + Number(f.openAmount), 0)

  return NextResponse.json({
    categorieen: gegroepeerd,
    totaalOpenstaand,
    aantalFacturen: facturen.length,
    lastSync: syncedAt?.syncedAt ?? null,
  })
}
