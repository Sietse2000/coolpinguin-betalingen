import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Labels zoals ze in RentMagic staan (CUST_Label) — vul aan met exacte spellingen uit RentMagic
const CATEGORIEEN = [
  { key: 'wachten',      labels: ['Wachten op betaling', 'Wachten'],                            kleur: 'blue'   },
  { key: 'herinnering1', labels: ['Eerste herinnering gekregen', 'Eerste herinnering', '1e herinnering'],  kleur: 'yellow' },
  { key: 'herinnering2', labels: ['Tweede herinnering gekregen', 'Tweede herinnering', '2e herinnering'],  kleur: 'orange' },
  { key: 'credifxx',     labels: ['Wordt behandeld door Credifixx', 'Wordt behandeld door credifixx', 'Credifixx'],  kleur: 'red'    },
  { key: 'overig',       labels: null,                                                           kleur: 'gray'   },
]

export async function GET() {
  // Haal alle facturen op zonder het label 'Betaald' (incl. facturen zonder label)
  // Let op: NOT + in sluit NULL-waarden uit in SQL — OR: null expliciet meenemen
  const facturen = await db.invoiceCache.findMany({
    where: {
      OR: [
        { label: null },
        { label: { notIn: ['Betaald', 'betaald'] } },
      ],
    },
    select: {
      invoiceId: true,
      customerName: true,
      openAmount: true,
      totalExcVat: true,
      totalVat: true,
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
      label: cat.labels?.[0] ?? 'Openstaand (geen label)',
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
