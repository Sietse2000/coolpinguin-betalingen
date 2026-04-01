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
  'ophalen', 'afhaal', 'transport', 'retour', 'bezorging', 'bezorgen',
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

/** Verwijdert HTML-opmaak en zet blokelementen om naar regeleindes */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(div|p|li|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
}

/**
 * Probeert klantgegevens te parsen uit de beschrijving van een agenda-event.
 *
 * Ondersteunt twee formaten:
 * 1. Google Forms-stijl: label op eigen regel, waarde op volgende regel
 *    (Google stuurt formulierresponses als <b>Label</b><br>Waarde<br><br>...)
 * 2. Klassiek: "Label: waarde" op één regel (voor handmatig aangemaakte events)
 */
function parseDescriptionFields(description: string): {
  customerName?: string
  address?: string
  timeSlot?: string
} {
  const cleaned = stripHtml(description)
  // Normaliseer meerdere spaties (ook van &nbsp; of Google Forms HTML) naar één spatie
  const lines = cleaned.split(/\n|\r\n/).map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean)

  /**
   * Vindt een veldwaarde ongeacht het exacte formaat:
   *   "Label: waarde"        → waarde op dezelfde regel
   *   "Label:\nwaarde"       → waarde op de volgende regel (label eindigt op :)
   *   "Label\nwaarde"        → waarde op de volgende regel (label zonder :)
   */
  const get = (labels: string[]): string | undefined => {
    for (const label of labels) {
      const lowerLabel = label.toLowerCase()
      for (let i = 0; i < lines.length; i++) {
        const lower = lines[i].toLowerCase()
        // "Label: waarde" of "Label : waarde" op één regel
        if (lower.startsWith(lowerLabel + ':') || lower.startsWith(lowerLabel + ' :')) {
          const colonIdx = lines[i].indexOf(':')
          const val = lines[i].slice(colonIdx + 1).trim()
          // Als de waarde leeg is staat hij op de volgende regel (bv. "Label:" + newline + "waarde")
          if (val) return val
          if (i + 1 < lines.length) return lines[i + 1]
        }
        // Label staat exact op eigen regel (met of zonder afsluitende dubbele punt)
        if (lower === lowerLabel || lower === lowerLabel + ':') {
          if (i + 1 < lines.length) return lines[i + 1]
        }
      }
    }
    return undefined
  }

  const NAAM_LABELS   = ['Volledige naam', 'Naam', 'Name', 'Klant', 'Klantnaam']
  const STRAAT_LABELS = ['Adresregel 1A', 'Adresregel 1', 'Straat en huisnummer',
                         'Straatnaam en huisnummer', 'Straat + huisnummer', 'Adres', 'Address', 'Straat']
  const PC_LABELS     = ['Postcode']
  const STAD_LABELS   = ['Woonplaats', 'Stad', 'City', 'Plaats', 'Gemeente']
  const TIJD_LABELS   = ['Kies een tijdstip', 'Tijdstip', 'Tijdvak', 'Gewenste bezorgtijd', 'Bezorgtijd', 'Levertijd']

  // Sommige formulieren sturen de naam als eerste regel zonder label
  const customerName = get(NAAM_LABELS) ?? lines[0]
  const street       = get(STRAAT_LABELS)
  const postcode     = get(PC_LABELS)
  const city         = get(STAD_LABELS)
  const timeSlot     = get(TIJD_LABELS)

  // Combineer postcode en woonplaats (bijv. "5213 HR" + "Den Bosch" → "5213 HR Den Bosch")
  const postcodeCity = [postcode, city].filter(Boolean).join(' ') || undefined
  const address = [street, postcodeCity].filter(Boolean).join(', ') || undefined

  console.log('[Google Calendar] parseDescriptionFields →', { customerName, street, postcode, city, address, timeSlot })
  return { customerName, address, timeSlot }
}

/**
 * Parseert een tijdslot-string zoals "Tussen 08:00 - 11:00" of "08:00 - 11:00"
 * naar start- en eindtijd voor een bepaalde datum.
 */
function parseTimeSlot(
  timeSlot: string,
  dateOnly: string,
): Pick<CalendarEvent, 'timeWindowStart' | 'timeWindowEnd'> | null {
  const match = timeSlot.match(/(\d{1,2})[:.hH](\d{2})\s*[-–]\s*(\d{1,2})[:.hH](\d{2})/)
  if (!match) return null
  const [, h1, m1, h2, m2] = match
  return {
    timeWindowStart: `${dateOnly}T${String(parseInt(h1)).padStart(2, '0')}:${m1}:00`,
    timeWindowEnd:   `${dateOnly}T${String(parseInt(h2)).padStart(2, '0')}:${m2}:00`,
  }
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
  console.log(`[Google Calendar] ${date.toISOString().slice(0,10)}: ${events.length} event(s) opgehaald:`, events.map((e) => e.summary))
  const filtered = events
    .filter((e) => e.id && (e.start?.dateTime || e.start?.date))
    .filter((e) => {
      const pass = isTransportEvent(e.summary ?? '')
      if (!pass) console.log(`[Google Calendar] ✗ gefilterd (geen transport-trefwoord): "${e.summary}"`)
      return pass
    })
  console.log(`[Google Calendar] ${filtered.length} event(s) na filter`)
  return filtered
    .map((e) => {
      const description = e.description ?? ''
      const parsed = description ? parseDescriptionFields(description) : {}
      const title = e.summary ?? '(geen titel)'
      const start = new Date(e.start!.dateTime ?? e.start!.date!)
      const end = new Date(e.end!.dateTime ?? e.end!.date!)
      const dateOnly = start.toISOString().slice(0, 10)
      const titleMeta = parseTitleMeta(title, start)

      // Tijdvak: titel heeft voorrang; beschrijving is fallback (bijv. "Kies een tijdstip: Tussen 08:00 - 11:00")
      const descTimeSlot = parsed.timeSlot ? parseTimeSlot(parsed.timeSlot, dateOnly) : null
      const timeWindowStart = titleMeta.timeWindowStart ?? descTimeSlot?.timeWindowStart
      const timeWindowEnd   = titleMeta.timeWindowEnd   ?? descTimeSlot?.timeWindowEnd

      return {
        id: e.id!,
        title,
        start,
        end,
        location: e.location ?? parsed.address ?? undefined,
        customerName: parsed.customerName ?? undefined,
        description: description || undefined,
        timeWindowStart,
        timeWindowEnd,
        inferredType: titleMeta.inferredType,
        couplingAddress: getCouplingAddress(title),
      }
    })
}

export async function isGoogleConnected(): Promise<boolean> {
  const token = await db.googleToken.findUnique({ where: { id: 'singleton' } })
  return !!token
}
