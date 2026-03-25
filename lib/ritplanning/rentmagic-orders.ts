const BASE_URL = process.env.RENTMAGIC_BASE_URL?.replace(/\/$/, '') ?? ''
const API_KEY = process.env.RENTMAGIC_API_KEY ?? ''

/**
 * Voertuig/aanhangertype voor een artikel of order.
 *
 * Verhuurbare producten (worden afgeleverd/opgehaald — rijden leeg):
 *   KOELAANHANGER   — koelaanhanger
 *   VRIESAANHANGER  — vriesaanhanger
 *   CONTAINER       — (koel)container
 *   REEFER          — reefer (gekoelde container)
 *   REGULIER        — overige aanhanger (verhuur)
 *
 * Eigen vervoersmiddel (nooit verhuurbaar — wordt gebruikt om artikelen te brengen):
 *   KASTENAANHANGER — eigen voertuig voor koelkasten, luchtkoelers, overige artikelen
 *
 * Artikelen (geen aanhanger, rijden mee):
 *   ITEM            — klein artikel, past in elk voertuig
 */
export type TrailerType =
  | 'KOELAANHANGER'
  | 'VRIESAANHANGER'
  | 'CONTAINER'
  | 'REEFER'
  | 'REGULIER'
  | 'KASTENAANHANGER'
  | 'ITEM'

export interface RentMagicOrderItem {
  articleId: string
  articleName: string
  quantity: number
  trailerType: TrailerType
  isTrailer: boolean  // true = aanhanger zelf; false = artikel dat meegaat
}

export interface RentMagicOrder {
  id: string
  customerName: string
  address: string
  city?: string
  postalCode?: string
  deliveryDate?: string
  pickupDate?: string
  status?: string
  type: 'PICKUP' | 'DELIVERY'
  timeWindowStart?: string
  timeWindowEnd?: string
  flexible?: boolean
  items?: RentMagicOrderItem[]
  tripsRequired?: number      // >1 als er meerdere aanhangers nodig zijn
  trailerType?: TrailerType   // dominant aanhangertype voor dit order
  raw: Record<string, unknown>
}

/**
 * Haalt transportorders op uit RentMagic voor een specifieke datum.
 *
 * Filterstrategie:
 * - DeliveryID.Key === "Transport" → dit zijn transportritten
 * - DateTimeBusinessStart op de gevraagde datum → DELIVERY (bezorging)
 * - DateTimeBusinessEnd op de gevraagde datum → PICKUP (ophalen)
 */
export async function fetchOrdersForDate(date: Date): Promise<RentMagicOrder[]> {
  const from = new Date(date)
  from.setHours(0, 0, 0, 0)
  const to = new Date(from)
  to.setDate(to.getDate() + 7)
  to.setHours(23, 59, 59, 999)

  const raw = await tryEndpoint(
    `${BASE_URL}/api/v2/orders?token=${encodeURIComponent(API_KEY)}&size=500`,
  )

  const transport = raw.filter(isTransportOrder)
  const forRange = transport.filter((item) => matchesDateRange(item, from, to))

  console.log(`[RentMagic Orders] ${raw.length} totaal → ${transport.length} transport → ${forRange.length} in de komende 7 dagen`)
  if (forRange.length > 0) {
    const s = forRange[0]
    console.log('[RentMagic Orders] Adres/locatie velden sample:', JSON.stringify({
      // Klantadres (billing)
      AddressStreet: s['AddressStreet'],
      AddressHouseNumber: s['AddressHouseNumber'],
      AddressZipCode: s['AddressZipCode'],
      AddressCity: s['AddressCity'],
      // Mogelijke afleveradres velden
      DeliveryAddressStreet: s['DeliveryAddressStreet'],
      DeliveryAddressHouseNumber: s['DeliveryAddressHouseNumber'],
      DeliveryAddressZipCode: s['DeliveryAddressZipCode'],
      DeliveryAddressCity: s['DeliveryAddressCity'],
      LocationStreet: s['LocationStreet'],
      LocationHouseNumber: s['LocationHouseNumber'],
      LocationZipCode: s['LocationZipCode'],
      LocationCity: s['LocationCity'],
      ProjectAddressStreet: s['ProjectAddressStreet'],
      ProjectAddressCity: s['ProjectAddressCity'],
      SiteStreet: s['SiteStreet'],
      SiteCity: s['SiteCity'],
      VisitAddressStreet: s['VisitAddressStreet'],
      VisitAddressCity: s['VisitAddressCity'],
      DeliveryStreet: s['DeliveryStreet'],
      DeliveryCity: s['DeliveryCity'],
    }))
    console.log('[RentMagic Orders] Alle veldnamen:', Object.keys(s).join(', '))
  }

  // Haal voor elk gevonden order de volledige details op (inclusief klantadres)
  const detailed = await Promise.all(
    forRange.map((item) => fetchOrderDetail(String(item['OrderID'] ?? item['ID'] ?? '')))
  )

  // Haal artikelen op per order
  const orderLines = await Promise.all(
    forRange.map((item, i) => {
      const orderId = String(item['OrderID'] ?? item['ID'] ?? '')
      return fetchOrderLines(orderId, detailed[i] ?? item)
    })
  )

  return forRange.map((item, i) => {
    const detail = detailed[i] ?? item
    const deliveryRaw = String(detail['DateTimeBusinessStart'] ?? item['DateTimeBusinessStart'] ?? '')
    const deliveryDate = deliveryRaw ? new Date(deliveryRaw) : null
    const isDelivery = !!deliveryDate && deliveryDate >= from && deliveryDate <= to
    return mapOrder({ ...item, ...detail }, i, isDelivery, orderLines[i] ?? [])
  })
}

/**
 * Haalt volledige orderdetails op via /api/v2/orders/{id}.
 * De lijstresponse heeft soms lege adresvelden; de detailresponse kan meer bevatten.
 * Als het adres nog steeds leeg is, proberen we het via de klantrelatie.
 */
async function fetchOrderDetail(orderId: string): Promise<Record<string, unknown>> {
  if (!orderId) return {}
  try {
    const res = await fetch(
      `${BASE_URL}/api/v2/orders/${encodeURIComponent(orderId)}?token=${encodeURIComponent(API_KEY)}`,
      { headers: { Accept: 'application/json' }, cache: 'no-store' }
    )
    if (!res.ok) return {}
    const data = await res.json()
    const detail = (data && typeof data === 'object' && !Array.isArray(data))
      ? data as Record<string, unknown>
      : {}

    // Log adresvelden in de detailresponse (eenmalig voor eerste order)
    if (orderId) {
      const addrKeys = Object.keys(detail).filter(k =>
        /address|street|city|zip|postal|location|delivery|project|site|visit/i.test(k)
      )
      if (addrKeys.length > 0) {
        console.log(`[RentMagic Orders] Adresvelden in detail voor ${orderId}:`,
          Object.fromEntries(addrKeys.map(k => [k, detail[k]]))
        )
      }
    }

    // Klantadres opzoeken alleen als AddressID.Description ook leeg is
    const hasAddressId = !!parseAddressId(detail['AddressID'])?.street
    if (!detail['AddressStreet'] && !hasAddressId) {
      const customerKey = getKey(detail['CustomerID'])
      const contactKey = getKey(detail['ContactID'])

      // Probeer eerst CustomerID (meest betrouwbaar voor adres)
      if (customerKey) {
        const addr = await fetchRelationAddress(customerKey, ['customers', 'relations'])
        if (addr) return { ...detail, ...addr }
      }
      // Daarna ContactID
      if (contactKey && contactKey !== customerKey) {
        const addr = await fetchRelationAddress(contactKey, ['contacts', 'relations'])
        if (addr) return { ...detail, ...addr }
      }

      console.warn(`[RentMagic Orders] Geen adres gevonden voor order ${orderId} (customer: ${customerKey}, contact: ${contactKey})`)
    }
    return detail
  } catch {
    return {}
  }
}

async function fetchRelationAddress(relationId: string, endpoints = ['customers', 'relations', 'contacts']): Promise<Record<string, unknown> | null> {
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(
        `${BASE_URL}/api/v2/${endpoint}/${encodeURIComponent(relationId)}?token=${encodeURIComponent(API_KEY)}`,
        { headers: { Accept: 'application/json' }, cache: 'no-store' }
      )
      if (!res.ok) continue
      const data = await res.json() as Record<string, unknown>
      if (data['AddressStreet'] || data['Street'] || data['Address']) {
        console.log(`[RentMagic Orders] Adres gevonden via /${endpoint}/${relationId}`)
        return {
          AddressStreet: data['AddressStreet'] ?? data['Street'] ?? data['Address'],
          AddressHouseNumber: data['AddressHouseNumber'] ?? data['HouseNumber'] ?? '',
          AddressHouseNumberAddition: data['AddressHouseNumberAddition'] ?? '',
          AddressZipCode: data['AddressZipCode'] ?? data['ZipCode'] ?? data['PostalCode'] ?? '',
          AddressCity: data['AddressCity'] ?? data['City'] ?? '',
        }
      }
    } catch { continue }
  }
  return null
}

/**
 * Bouwt een ISO datetime string van datum + tijdveld.
 * BusinessHourStart kan zijn: "08:00:00", 8.0, "8", null.
 */
function buildTimeWindow(dateOnly: string, timeField: unknown): string | null {
  if (!dateOnly || timeField == null) return null
  const t = String(timeField)
  // Decimaal getal (bijv. 8.5 = 08:30)
  if (/^\d+(\.\d+)?$/.test(t)) {
    const hours = Math.floor(parseFloat(t))
    const minutes = Math.round((parseFloat(t) - hours) * 60)
    return `${dateOnly}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`
  }
  // Tijdstring "HH:MM" of "HH:MM:SS"
  if (/^\d{1,2}:\d{2}/.test(t)) {
    return `${dateOnly}T${t.length === 5 ? t + ':00' : t}`
  }
  return null
}

function getKey(field: unknown): string | null {
  if (!field || typeof field !== 'object') return null
  const f = field as Record<string, unknown>
  return String(f['Key'] ?? '') || null
}

/**
 * Parseert het afleveradres uit AddressID.Description.
 * RentMagic formaat: "Straat Huisnummer  - Stad"  (twee spaties voor het streepje)
 */
function parseAddressId(field: unknown): { street: string; city: string } | null {
  if (!field || typeof field !== 'object') return null
  const f = field as Record<string, unknown>
  const desc = String(f['Description'] ?? '').trim()
  if (!desc) return null

  // Splits op "  - " (twee spaties + streepje) of " - "
  const match = desc.match(/^(.+?)\s{2,}-\s*(.+)$/) ?? desc.match(/^(.+?)\s+-\s+(.+)$/)
  if (match) return { street: match[1].trim(), city: match[2].trim() }

  return { street: desc, city: '' }
}

function matchesDateRange(item: Record<string, unknown>, from: Date, to: Date): boolean {
  const deliveryRaw = String(item['DateTimeBusinessStart'] ?? item['DesiredDeliveryDate'] ?? '')
  const pickupRaw = String(item['DateTimeBusinessEnd'] ?? item['DesiredReturnDate'] ?? '')
  const delivery = deliveryRaw ? new Date(deliveryRaw) : null
  const pickup = pickupRaw ? new Date(pickupRaw) : null
  return (!!delivery && delivery >= from && delivery <= to) ||
         (!!pickup && pickup >= from && pickup <= to)
}

function isTransportOrder(item: Record<string, unknown>): boolean {
  const deliveryId = item['DeliveryID']
  if (deliveryId && typeof deliveryId === 'object') {
    const d = deliveryId as Record<string, unknown>
    const key = String(d['Key'] ?? '').toLowerCase()
    const desc = String(d['Description'] ?? '').toLowerCase()
    if (key.includes('transport') || desc.includes('transport')) return true
  }
  return false
}

async function tryEndpoint(url: string): Promise<Record<string, unknown>[]> {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) {
      console.warn(`[RentMagic Orders] HTTP ${res.status}`)
      return []
    }
    const data = await res.json()
    return normalizeResponse(data)
  } catch (err) {
    console.warn('[RentMagic Orders] Fout:', err)
    return []
  }
}

/**
 * Haalt orderregels (artikelen) op voor een order.
 * Probeert meerdere mogelijke veldnamen en endpoints.
 */
async function fetchOrderLines(orderId: string, orderDetail: Record<string, unknown>): Promise<RentMagicOrderItem[]> {
  // 1. Kijk of de orderdetail al een artikellijst bevat
  const inlineLines = extractLinesFromDetail(orderDetail)
  if (inlineLines.length > 0) return inlineLines

  // Haal ReservationID op uit het detail — artikelen zitten mogelijk op de reservering
  const reservationId = String(orderDetail['ReservationID'] ?? '')

  // 2. Probeer endpoints met zowel OrderID als ReservationID
  const paths: string[] = [
    `/api/v2/orders/${encodeURIComponent(orderId)}/items`,
    `/api/v2/orders/${encodeURIComponent(orderId)}/lines`,
    `/api/v2/orderlines?OrderID=${encodeURIComponent(orderId)}`,
  ]
  if (reservationId) {
    paths.push(
      `/api/v2/reservationlines?ReservationID=${encodeURIComponent(reservationId)}`,
      `/api/v2/reservations/${encodeURIComponent(reservationId)}/lines`,
    )
  }

  for (const path of paths) {
    try {
      const sep = path.includes('?') ? '&' : '?'
      const res = await fetch(`${BASE_URL}${path}${sep}token=${encodeURIComponent(API_KEY)}`, {
        headers: { Accept: 'application/json' }, cache: 'no-store',
      })
      if (!res.ok) {
        console.log(`[RentMagic Articles] ${path} → ${res.status}`)
        continue
      }
      const data = await res.json()
      const lines = normalizeResponse(data)
      if (lines.length > 0) {
        const parsed = lines.map(parseOrderLine).filter(isPhysicalItem)
        console.log(`[RentMagic Articles] ✓ ${parsed.length}/${lines.length} fysieke artikelen voor order ${orderId} via ${path}`)
        return parsed
      }
      console.log(`[RentMagic Articles] ${path} → leeg: ${JSON.stringify(data).slice(0, 100)}`)
    } catch (e) {
      console.log(`[RentMagic Articles] ${path} → fout: ${e}`)
    }
  }

  console.log(`[RentMagic Articles] Geen artikelen voor order ${orderId} (ReservationID: ${reservationId || 'onbekend'})`)
  return []
}

/** Zoek artikelarray in het al opgehaalde orderdetail */
function extractLinesFromDetail(detail: Record<string, unknown>): RentMagicOrderItem[] {
  for (const key of ['OrderLines', 'Lines', 'Items', 'ArticleLines', 'Lines', 'ProductLines', 'ReservationLines']) {
    if (Array.isArray(detail[key]) && (detail[key] as unknown[]).length > 0) {
      console.log(`[RentMagic Articles] Artikelen gevonden in veld "${key}"`)
      return (detail[key] as Record<string, unknown>[]).map(parseOrderLine).filter(isPhysicalItem)
    }
  }
  // Log alle arrayvelden zodat we het juiste veld kunnen identificeren
  const arrayFields = Object.entries(detail)
    .filter(([, v]) => Array.isArray(v) && (v as unknown[]).length > 0)
    .map(([k, v]) => `${k}(${(v as unknown[]).length})`)
  if (arrayFields.length > 0) {
    console.log(`[RentMagic Articles] Arrayvelden in orderdetail: ${arrayFields.join(', ')}`)
  }
  return []
}

/**
 * Classificeert een artikel op basis van de naam.
 *
 * Verhuurbare producten (isTrailer: true) → rijden leeg naar de klant.
 * Artikelen voor kastenaanhanger (isTrailer: false) → worden vervoerd met
 * de eigen kastenaanhanger (koelkasten, luchtkoelers, overige artikelen).
 */
function classifyArticle(name: string): Pick<RentMagicOrderItem, 'trailerType' | 'isTrailer'> {
  const lower = name.toLowerCase()

  // ── Verhuurbare producten ──────────────────────────────────────────────
  if (/koelaanhanger|koeltrailer|koel.{0,4}wagen/.test(lower))
    return { trailerType: 'KOELAANHANGER', isTrailer: true }
  if (/vriesaanhanger|vriestrailer|vries.{0,4}wagen/.test(lower))
    return { trailerType: 'VRIESAANHANGER', isTrailer: true }
  if (/\breefer\b/.test(lower))
    return { trailerType: 'REEFER', isTrailer: true }
  if (/\bcontainer\b/.test(lower))
    return { trailerType: 'CONTAINER', isTrailer: true }
  if (/\baanhanger\b|\btrailer\b/.test(lower))
    return { trailerType: 'REGULIER', isTrailer: true }

  // ── Artikelen → vervoer met eigen kastenaanhanger ──────────────────────
  // Koelkasten, luchtkoelers, airco's, overige apparatuur
  return { trailerType: 'KASTENAANHANGER', isTrailer: false }
}

/** Filtert kostregels (transport, bezorgkosten) die geen fysiek artikel zijn */
function isPhysicalItem(item: RentMagicOrderItem): boolean {
  const lower = item.articleName.toLowerCase()
  // "Transport", "Bezorgkosten", "Transportkosten" zijn kostenregels, geen fysieke artikelen
  if (/^transport|bezorgkost|transportkost/.test(lower)) return false
  return true
}

function parseOrderLine(line: Record<string, unknown>): RentMagicOrderItem {
  // ItemID is een nested object: { Key: "103", Description: "103 - Koelkast Horeca RVS 600L" }
  const itemId = line['ItemID'] as Record<string, unknown> | null | undefined
  const itemIdKey = (itemId && typeof itemId === 'object') ? String(itemId['Key'] ?? '') : String(line['ItemID'] ?? '')
  const itemIdDesc = (itemId && typeof itemId === 'object') ? String(itemId['Description'] ?? '') : ''

  const rawName = String(
    line['ItemDescription'] ??
    (itemIdDesc || line['ArticleName'] || line['Description'] || line['ItemName'] ||
    line['Article'] || line['ProductName'] || line['Name'] || '')
  )
  // Strip leading article-number prefix: "103 - Koelkast..." → "Koelkast..."
  const name = rawName.replace(/^\d+\s*-\s*/, '').trim()

  const articleId = itemIdKey || String(line['ArticleID'] ?? line['ArticleCode'] ?? '')
  const qty = Number(line['Quantity'] ?? line['Amount'] ?? line['Qty'] ?? 1)
  const { trailerType, isTrailer } = classifyArticle(name)
  return {
    articleId,
    articleName: name || '(onbekend)',
    quantity: isNaN(qty) ? 1 : qty,
    trailerType,
    isTrailer,
  }
}

/**
 * Bepaal hoeveel ritten en welk aanhangertype voor dit order.
 *
 * Regels:
 * - Elke aanhanger in het order = 1 rit (aanhangers rijden leeg)
 * - Items (koelkast, airco) passen mee in de aanhanger van dezelfde rit — geen extra rit
 * - Meerdere aanhangers in één order = meerdere ritten (1 aanhanger per truck)
 * - Gemengde typen (bijv. koelaanhanger + kastenaanhanger) = aparte ritten per type
 */
function calcTripsRequired(items: RentMagicOrderItem[]): {
  tripsRequired: number
  trailerType: TrailerType | undefined
} {
  if (items.length === 0) return { tripsRequired: 1, trailerType: undefined }

  const trailers = items.filter((i) => i.isTrailer)
  if (trailers.length === 0) {
    // Alleen artikelen, geen huurtrailer — vervoer met eigen kastenaanhanger
    const needsKasten = items.some((i) => i.trailerType === 'KASTENAANHANGER')
    return { tripsRequired: 1, trailerType: needsKasten ? 'KASTENAANHANGER' : undefined }
  }

  // Tel aanhangers per type (elk exemplaar = 1 rit)
  const tripsByType: Partial<Record<TrailerType, number>> = {}
  for (const t of trailers) {
    const count = t.quantity
    tripsByType[t.trailerType] = (tripsByType[t.trailerType] ?? 0) + count
  }

  const totalTrips = Object.values(tripsByType).reduce((s, n) => s + (n ?? 0), 0)

  // Dominant type = meeste ritten, bij gelijkspel: volgorde van specificiteit
  const order: TrailerType[] = ['KOELAANHANGER', 'VRIESAANHANGER', 'KASTENAANHANGER', 'REGULIER', 'ITEM']
  const dominantType = order.find((t) => (tripsByType[t] ?? 0) > 0)

  return { tripsRequired: totalTrips, trailerType: dominantType }
}

function normalizeResponse(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[]
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    for (const key of ['Collection', 'Items', 'orders', 'data', 'Orders', 'Results', 'results']) {
      if (Array.isArray(d[key])) return d[key] as Record<string, unknown>[]
    }
  }
  return []
}

function extractCustomerName(item: Record<string, unknown>): string {
  const customerId = item['CustomerID']
  if (customerId && typeof customerId === 'object') {
    const d = customerId as Record<string, unknown>
    const desc = String(d['Description'] ?? '')
    const match = desc.match(/^\S+\s*-\s*(.+)$/)
    if (match) return match[1].trim()
    if (desc) return desc
  }
  return String(item['CustomerName'] ?? item['RelationName'] ?? '(onbekend)')
}

/**
 * Leidt het tijdvak af uit het referentieveld van een order.
 *
 * Ondersteunde patronen (hoofdletterongevoelig):
 *   T1, T2, T: 1              → tijdvak 1 of 2 voor dit type
 *   T1T2, T1 T2               → eerste T = uitlevering, laatste T = retour
 *   B1, B: 1, B2              → Brengen (DELIVERY) in tijdvak
 *   R1, R: 2, R2              → Retour (PICKUP) in tijdvak
 *   B1R2, B1 | R2, B1 R: 2   → uitlevering T1, retour T2
 *   T:?, R?, B?               → tijdstip onbekend → flexible = true
 *
 * Strategie: extraheer alle [T/B/R][1/2]-combinaties op volgorde.
 * - B = specifiek voor delivery, R = specifiek voor pickup
 * - Bij meerdere T's: eerste T = delivery, laatste T = pickup
 */
function parseTijdvakFromReference(
  ref: string,
  type: 'PICKUP' | 'DELIVERY',
): { tijdvak: 1 | 2 | null; flexible: boolean } {
  if (!ref) return { tijdvak: null, flexible: false }
  const upper = ref.toUpperCase()

  // Onbekend tijdstip: T?, T:?, R?, R:?, B?, B:?
  if (/[TBR]:?\s*\?/.test(upper)) {
    return { tijdvak: null, flexible: true }
  }

  // Extraheer alle prefix+cijfer combinaties op volgorde
  // Bijv. "T1T2" → [{p:'T',n:1},{p:'T',n:2}]
  // Bijv. "B1 | R: 2 REF: 123" → [{p:'B',n:1},{p:'R',n:2}]  (REF: 1.. heeft geen [12] na de R)
  const hits = Array.from(upper.matchAll(/([TBR]):?\s*([12])/g)).map((m) => ({
    p: m[1] as 'T' | 'B' | 'R',
    n: parseInt(m[2]) as 1 | 2,
  }))

  if (hits.length === 0) return { tijdvak: null, flexible: false }

  if (type === 'DELIVERY') {
    // B (brengen) is type-specifiek voor delivery
    const b = hits.find((h) => h.p === 'B')
    if (b) return { tijdvak: b.n, flexible: false }
    // Eerste T (bij T1T2: delivery = eerste)
    const t = hits.find((h) => h.p === 'T')
    if (t) return { tijdvak: t.n, flexible: false }
  }

  if (type === 'PICKUP') {
    // R (retour) is type-specifiek voor pickup
    const r = hits.find((h) => h.p === 'R')
    if (r) return { tijdvak: r.n, flexible: false }
    // Laatste T (bij T1T2: pickup = laatste)
    const ts = hits.filter((h) => h.p === 'T')
    if (ts.length > 0) return { tijdvak: ts[ts.length - 1].n, flexible: false }
  }

  return { tijdvak: null, flexible: false }
}

const TIJDVAK_WINDOWS: Record<1 | 2, { start: string; end: string }> = {
  1: { start: '08:00', end: '11:00' },
  2: { start: '11:00', end: '17:00' },
}

/** Geeft het referentieveld terug uit één van de bekende veldnamen */
function getReferenceField(item: Record<string, unknown>): string {
  for (const key of [
    'Remarks', 'Reference', 'Description', 'Notes', 'Comment',
    'Memo', 'Opmerking', 'Referentie', 'OrderReference',
    'ExternalReference', 'CustomerReference', 'Toelichting',
  ]) {
    const val = item[key]
    if (val && typeof val === 'string' && val.trim()) return val.trim()
  }
  return ''
}

function mapOrder(item: Record<string, unknown>, index: number, isDelivery: boolean, items: RentMagicOrderItem[] = []): RentMagicOrder {
  const id = String(item['OrderID'] ?? item['ID'] ?? item['id'] ?? `order-${index}`)

  const deliveryDateRaw = String(item['DateTimeBusinessStart'] ?? item['DesiredDeliveryDate'] ?? '')
  const pickupDateRaw = String(item['DateTimeBusinessEnd'] ?? item['DesiredReturnDate'] ?? '')
  // Status "Active" (verhuurperiode loopt) → einde huur → Retour (PICKUP)
  // Status "Open" / overig → nog uit te leveren → Uitlevering (DELIVERY)
  const statusRaw = String(item['Status'] ?? '').toLowerCase()
  const isRetour = statusRaw === 'active'
  const type: 'PICKUP' | 'DELIVERY' = (isRetour || !isDelivery) ? 'PICKUP' : 'DELIVERY'

  // Prioriteit: AddressID.Description (projectadres) > losse adresvelden > klantadres
  const parsedAddressId = parseAddressId(item['AddressID'])
  let street: string, city: string, zip: string

  if (parsedAddressId?.street) {
    // Afleveradres uit AddressID.Description — meest betrouwbaar
    street = parsedAddressId.street
    city = parsedAddressId.city
    zip = String(item['AddressZipCode'] ?? '')  // postcode zit soms nog apart
    console.log(`[RentMagic Orders] Afleveradres (AddressID) voor order ${String(item['OrderID'] ?? item['ID'] ?? '')}: ${street} — ${city}`)
  } else {
    // Terugval: losse adresvelden
    const rawStreet = String(item['AddressStreet'] ?? item['Address'] ?? '')
    const houseNr = String(item['AddressHouseNumber'] ?? '')
    const addition = String(item['AddressHouseNumberAddition'] ?? '')
    street = [rawStreet, [houseNr, addition].filter(Boolean).join('')].filter(Boolean).join(' ').trim()
    city = String(item['AddressCity'] ?? '')
    zip = String(item['AddressZipCode'] ?? '')
  }

  const address = street || '(geen adres)'

  const relevantDate = isDelivery ? deliveryDateRaw : pickupDateRaw
  const dateOnly = relevantDate ? relevantDate.slice(0, 10) : ''

  // Tijdvak prioriteit:
  // 1. BusinessHourStart/End (exacte tijd) — altijd leidend
  // 2. T1/T2/B1/R:2 uit het referentieveld
  // 3. Geen tijdvak
  let timeWindowStart = buildTimeWindow(dateOnly, item['BusinessHourStart'])
  let timeWindowEnd = buildTimeWindow(dateOnly, item['BusinessHourEnd'])

  let flexible = false
  if (!timeWindowStart && dateOnly) {
    const ref = getReferenceField(item)
    const parsed = parseTijdvakFromReference(ref, type)
    flexible = parsed.flexible
    if (parsed.tijdvak) {
      const win = TIJDVAK_WINDOWS[parsed.tijdvak]
      timeWindowStart = `${dateOnly}T${win.start}:00`
      timeWindowEnd = `${dateOnly}T${win.end}:00`
      console.log(`[RentMagic Orders] Tijdvak ${parsed.tijdvak} uit referentie "${ref}" voor order ${id}`)
    } else if (parsed.flexible) {
      console.log(`[RentMagic Orders] Flexibel (tijdstip onbekend) uit referentie "${ref}" voor order ${id}`)
    }
  }

  const { tripsRequired, trailerType } = calcTripsRequired(items)

  return {
    id,
    customerName: extractCustomerName(item),
    address,
    city: city || undefined,
    postalCode: zip || undefined,
    deliveryDate: deliveryDateRaw || undefined,
    pickupDate: pickupDateRaw || undefined,
    status: String(item['Status'] ?? item['StatusCode'] ?? ''),
    type,
    timeWindowStart: timeWindowStart || undefined,
    timeWindowEnd: timeWindowEnd || undefined,
    flexible: flexible || undefined,
    items: items.length > 0 ? items : undefined,
    tripsRequired: tripsRequired > 1 ? tripsRequired : undefined,
    trailerType,
    raw: item,
  }
}
