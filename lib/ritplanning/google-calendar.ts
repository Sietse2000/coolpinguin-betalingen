import { google } from 'googleapis'
import { db } from '@/lib/db'
import { env } from '@/lib/env'

function createOAuthClient() {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI
  )
}

export function getAuthUrl(): string {
  const client = createOAuthClient()
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.readonly'],
  })
}

export async function exchangeCodeForTokens(code: string): Promise<void> {
  const client = createOAuthClient()
  const { tokens } = await client.getToken(code)

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Geen access_token of refresh_token ontvangen van Google')
  }

  await db.googleToken.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600 * 1000),
    },
    update: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600 * 1000),
    },
  })
}

async function getAuthenticatedClient() {
  const token = await db.googleToken.findUnique({ where: { id: 'singleton' } })
  if (!token) throw new Error('GOOGLE_NOT_CONNECTED')

  const client = createOAuthClient()
  client.setCredentials({
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
    expiry_date: token.expiresAt.getTime(),
  })

  // Ververs token als verlopen
  client.on('tokens', async (newTokens) => {
    await db.googleToken.update({
      where: { id: 'singleton' },
      data: {
        accessToken: newTokens.access_token ?? token.accessToken,
        expiresAt: new Date(newTokens.expiry_date ?? Date.now() + 3600 * 1000),
      },
    })
  })

  return client
}

export interface CalendarEvent {
  id: string
  title: string
  start: Date
  end: Date
  location?: string
  customerName?: string
  description?: string
  timeWindowStart?: string  // ISO datetime — afgeleid uit titel (t1/t2/tijdstip)
  timeWindowEnd?: string    // ISO datetime
  inferredType?: 'PICKUP' | 'DELIVERY'
  couplingAddress?: string  // Adres waar aanhanger eerst opgekoppeld moet worden (bijv. wijnfestijn)
}

/**
 * Vaste koppellocaties voor bepaalde event-typen.
 * Key = trefwoord dat als los woord in de titel voorkomt.
 */
const COUPLING_LOCATIONS: Array<{ keyword: string; address: string }> = [
  { keyword: 'wijnfestijn', address: 'Rooseveltstraat 14b, 2321 BM Leiden' },
]

function getCouplingAddress(title: string): string | undefined {
  const lower = title.toLowerCase()
  for (const { keyword, address } of COUPLING_LOCATIONS) {
    if (matchesWord(lower, keyword)) return address
  }
  return undefined
}

// Vaste tijdvakken
const TIJDVAK: Record<string, { start: string; end: string }> = {
  t1: { start: '08:00', end: '11:00' },
  t2: { start: '11:00', end: '17:00' },
}

/**
 * Trefwoorden voor transportritten.
 * Alleen duidelijk transport-gerelateerde woorden — geen algemene woorden
 * die ook in andere contexten voorkomen (bijv. "verhuizen" voor IT-migraties).
 * Elk trefwoord wordt als los woord gematcht (woordgrens aan beide kanten).
 */
// Alleen echte transport-acties — t1/t2 zijn tijdvak-aanduidingen, geen transporttriggers
const TRANSPORT_KEYWORDS = [
  'ophalen', 'transport', 'retour', 'bezorging', 'bezorgen',
  'aflevering', 'uitlevering', 'inboedel',
]

function matchesWord(text: string, keyword: string): boolean {
  const idx = text.indexOf(keyword)
  if (idx === -1) return false
  const before = idx === 0 ? '' : text[idx - 1]
  const after = text[idx + keyword.length] ?? ''
  const startOk = before === '' || /[^a-zà-ÿ]/.test(before)
  const endOk = after === '' || /[^a-zà-ÿ]/.test(after)
  return startOk && endOk
}

function isTransportEvent(title: string): boolean {
  const lower = title.toLowerCase()
  const matched = TRANSPORT_KEYWORDS.find((kw) => matchesWord(lower, kw))
  if (matched) {
    console.log(`[Google Calendar] "${title}" → transport (trefwoord: "${matched}")`)
  }
  return !!matched
}

/**
 * Leid tijdvak en stoptype af uit de agentatitel.
 *
 * Prioriteit:
 * 1. Expliciet tijdstip in titel: "14:00" of "14u" → timeWindowStart = dat tijdstip
 * 2. T1/T2-aanduiding: "t1" → 08:00-11:00, "t2" → 11:00-17:00
 * 3. Niets gevonden → geen tijdvak (valt terug op agendatijd)
 */
function parseTitleMeta(
  title: string,
  eventDate: Date,
): Pick<CalendarEvent, 'timeWindowStart' | 'timeWindowEnd' | 'inferredType'> {
  const lower = title.toLowerCase()
  const dateOnly = eventDate.toISOString().slice(0, 10)

  // Stoptype afleiden
  const isPickup = /\b(retour|ophalen|haal op|terugbreng|terugbrengen)\b/.test(lower)
  const isDelivery = /\b(bezorg|breng|lever\b|aflevering|uitlevering)\b/.test(lower)
  const inferredType: 'PICKUP' | 'DELIVERY' | undefined = isPickup
    ? 'PICKUP'
    : isDelivery
    ? 'DELIVERY'
    : undefined

  // 1. Expliciet tijdstip: "14:00", "14.00", "14u00", "14u"
  const timeMatch = title.match(/\b(\d{1,2})[:.hH](\d{2})\b/) ?? title.match(/\b(\d{1,2})u\b/)
  if (timeMatch) {
    const h = String(parseInt(timeMatch[1])).padStart(2, '0')
    const m = timeMatch[2] ? String(parseInt(timeMatch[2])).padStart(2, '0') : '00'
    return {
      timeWindowStart: `${dateOnly}T${h}:${m}:00`,
      timeWindowEnd: undefined,  // geen eindtijd opgegeven — gebruik agendaeinde
      inferredType,
    }
  }

  // 2. T1 of T2 aanduiding (als los woord of aan het einde van de titel)
  for (const [key, window] of Object.entries(TIJDVAK)) {
    // Match "t1", "t2" als los woord of na spatie/slash/komma
    if (new RegExp(`(^|[\\s/,])${key}(\\s|$)`, 'i').test(title)) {
      return {
        timeWindowStart: `${dateOnly}T${window.start}:00`,
        timeWindowEnd: `${dateOnly}T${window.end}:00`,
        inferredType,
      }
    }
  }

  return { inferredType }
}

/**
 * Probeert klantgegevens te parsen uit de beschrijving van een agenda-event.
 * Werkt voor events met velden als "Volledige naam: ...", "Adresregel 1A: ..."
 */
function parseDescriptionFields(description: string): { customerName?: string; address?: string } {
  const lines = description.split(/\n|\r\n/)
  const get = (labels: string[]) => {
    for (const label of labels) {
      const line = lines.find((l) => l.toLowerCase().startsWith(label.toLowerCase()))
      if (line) return line.split(':').slice(1).join(':').trim()
    }
    return undefined
  }

  const customerName = get(['Volledige naam', 'Naam', 'Name', 'Klant'])
  const street = get(['Adresregel 1A', 'Adres', 'Address', 'Straat'])
  const city = get(['Postcode', 'Stad', 'City', 'Plaats'])
  const address = [street, city].filter(Boolean).join(', ') || undefined

  return { customerName, address }
}

export async function getCalendarEvents(date: Date): Promise<CalendarEvent[]> {
  const client = await getAuthenticatedClient()
  const calendar = google.calendar({ version: 'v3', auth: client })

  const startOfDay = new Date(date)
  startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(date)
  endOfDay.setHours(23, 59, 59, 999)

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  })

  const events = response.data.items ?? []
  return events
    .filter((e) => e.id && (e.start?.dateTime || e.start?.date))
    .filter((e) => isTransportEvent(e.summary ?? ''))
    .map((e) => {
      const description = e.description ?? ''
      const parsed = description ? parseDescriptionFields(description) : {}
      const title = e.summary ?? '(geen titel)'
      const start = new Date(e.start!.dateTime ?? e.start!.date!)
      const end = new Date(e.end!.dateTime ?? e.end!.date!)
      const titleMeta = parseTitleMeta(title, start)
      return {
        id: e.id!,
        title,
        start,
        end,
        location: e.location ?? parsed.address ?? undefined,
        customerName: parsed.customerName ?? undefined,
        description: description || undefined,
        timeWindowStart: titleMeta.timeWindowStart,
        timeWindowEnd: titleMeta.timeWindowEnd,
        inferredType: titleMeta.inferredType,
        couplingAddress: getCouplingAddress(title),
      }
    })
}

export async function isGoogleConnected(): Promise<boolean> {
  const token = await db.googleToken.findUnique({ where: { id: 'singleton' } })
  return !!token
}
