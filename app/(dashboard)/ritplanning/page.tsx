'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { deriveStopKey } from '@/lib/ritplanning/stop-key'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Vehicle {
  id: string
  name: string
  licensePlate: string | null
  hasTrailer: boolean
}

type TrailerType = 'KOELAANHANGER' | 'VRIESAANHANGER' | 'CONTAINER' | 'REEFER' | 'KASTENAANHANGER' | 'REGULIER' | 'ITEM'

interface OrderItem {
  articleName: string
  quantity: number
  trailerType: TrailerType
  isTrailer: boolean
}

interface UnifiedStop {
  rentmagicOrderId?: string
  calendarEventId?: string
  calendarTitle?: string
  type: 'PICKUP' | 'DELIVERY' | 'CALENDAR'
  customerName: string
  address: string
  date: string // YYYY-MM-DD
  timeWindowStart?: string // ISO datetime
  timeWindowEnd?: string   // ISO datetime
  flexible?: boolean       // tijdstip nog niet besproken met klant
  items?: OrderItem[]
  tripsRequired?: number
  trailerType?: TrailerType
  couplingAddress?: string // Aanhanger eerst ophalen op dit adres voor bezorging
  durationMin?: number    // Eigen tijdsduur (overschrijft settings.handlingMin voor deze stop)
}

interface ScheduledStop {
  isDepotReturn?: false
  stop: UnifiedStop
  arrive: Date
  depart: Date
  conflict: boolean
}

interface DepotWaypoint {
  isDepotReturn: true
  type: 'kasten-pickup' | 'kasten-return' | 'rental'
  reason: string
  arrive: Date
  depart: Date
}

interface CouplingWaypoint {
  isCoupling: true
  address: string
  arrive: Date
  depart: Date
}

type ScheduleItem = ScheduledStop | DepotWaypoint | CouplingWaypoint

interface VehicleRoute {
  vehicleId: string | null    // gekoppeld voertuig (auto)
  vehicleName: string         // naam bezorger (persoon)
  assignedVehicleName: string // naam van de auto die deze bezorger rijdt
  hasTrailer: boolean
  stops: UnifiedStop[]
  workStart: number
  workEnd: number
}

interface DayData {
  date: Date
  dateStr: string
  stops: UnifiedStop[]
}

interface Settings {
  handlingMin: number
  travelMin: number
  startHour: number
  workdayHours: number
  departureBufferMin: number  // voorbereiding op de zaak vóór eerste vertrek (laden, briefing, etc.)
}

// Raw API types
interface RawOrder {
  id: string
  customerName: string
  address: string
  city?: string
  postalCode?: string
  type: 'PICKUP' | 'DELIVERY'
  deliveryDate?: string
  pickupDate?: string
  timeWindowStart?: string
  timeWindowEnd?: string
  flexible?: boolean
  status?: string
  items?: OrderItem[]
  tripsRequired?: number
  trailerType?: TrailerType
}

interface RawCalEvent {
  id: string
  title: string
  start: string
  end: string
  location?: string
  customerName?: string
  timeWindowStart?: string
  timeWindowEnd?: string
  inferredType?: 'PICKUP' | 'DELIVERY'
  couplingAddress?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Geeft YYYY-MM-DD in lokale tijd (niet UTC) */
function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDay(d: Date): string {
  return d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'short' })
}

function formatShortDay(d: Date): string {
  return d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
}

function addMinutes(d: Date, min: number): Date {
  return new Date(d.getTime() + min * 60000)
}

function calcMinVehicles(count: number, s: Settings): number {
  if (count === 0) return 0
  return Math.ceil((count * (s.handlingMin + s.travelMin)) / (s.workdayHours * 60))
}

function trailerIcon(type: TrailerType): string {
  if (type === 'KOELAANHANGER') return '🧊'
  if (type === 'VRIESAANHANGER') return '❄️'
  if (type === 'KASTENAANHANGER') return '📦🚐'
  if (type === 'CONTAINER') return '🟦'
  if (type === 'REEFER') return '🧊🟦'
  if (type === 'REGULIER') return '🚐'
  return '📦'
}

function trailerLabel(type: TrailerType): string {
  if (type === 'KOELAANHANGER') return 'Koelaanhanger'
  if (type === 'VRIESAANHANGER') return 'Vriesaanhanger'
  if (type === 'KASTENAANHANGER') return 'Kastenaanhanger (eigen)'
  if (type === 'CONTAINER') return 'Container'
  if (type === 'REEFER') return 'Reefer'
  if (type === 'REGULIER') return 'Aanhanger'
  return 'Item'
}

function stopTypeLabel(type: string) {
  if (type === 'PICKUP') return '↩ Retour'
  if (type === 'DELIVERY') return '🚚 Uitlevering'
  return '📅 Agenda'
}

function stopTypeBadge(type: string) {
  if (type === 'PICKUP') return 'bg-orange-100 text-orange-700'
  if (type === 'DELIVERY') return 'bg-green-100 text-green-700'
  return 'bg-purple-100 text-purple-700'
}

function stopTypeBar(type: string) {
  if (type === 'PICKUP') return 'border-l-4 border-orange-400 bg-orange-50'
  if (type === 'DELIVERY') return 'border-l-4 border-green-400 bg-green-50'
  return 'border-l-4 border-purple-400 bg-purple-50'
}

// Huurtrailers die leeg worden afgeleverd/opgehaald — altijd terug naar zaak na elke stop
const RENTAL_TRAILER_TYPES: Set<TrailerType> = new Set([
  'KOELAANHANGER' as TrailerType,
  'VRIESAANHANGER' as TrailerType,
  'CONTAINER' as TrailerType,
  'REEFER' as TrailerType,
  'REGULIER' as TrailerType,
])

// ─── Planning logica ──────────────────────────────────────────────────────────

/**
 * Bereken de dagindeling voor een reeks stops.
 * Respecteert tijdvakken: wacht als het tijdvak nog niet open is.
 * Voegt terugrit naar zaak in na elke huurtrailer stop (voor de volgende stop).
 */
// Opzoektabel voor echte rijtijden: "van|naar" → minuten
type TravelPairs = Record<string, number>

function calcSchedule(
  stops: UnifiedStop[],
  date: Date,
  settings: Settings,
  workStartHour?: number,
  hasTrailer?: boolean,
  travelPairs?: TravelPairs,
  depotAddress?: string,
): ScheduleItem[] {
  const DEPOT_PREP_MIN = 15  // ophalen / afzetten lading of aanhanger
  // Met aanhanger max 90 km/u → ~15% langere reistijd (fallback als geen echte rijtijd beschikbaar)
  const fallbackTravel = hasTrailer ? Math.round(settings.travelMin * 1.15) : settings.travelMin

  /** Echte rijtijd opzoeken; valt terug op fallback als niet beschikbaar */
  function legTravel(from: string, to: string): number {
    if (travelPairs && from && to) {
      const real = travelPairs[`${from}|${to}`]
      if (real !== undefined) return hasTrailer ? Math.ceil(real * 1.15) : real
    }
    return fallbackTravel
  }

  const depot = depotAddress ?? ''
  const base = new Date(date)
  base.setHours(workStartHour ?? settings.startHour, 0, 0, 0)
  // Vertrek niet direct om starttijd: eerst laden/briefing op de zaak
  let current = addMinutes(base, settings.departureBufferMin)
  let currentAddress: string = depot  // huidige locatie als adres
  let atDepot = true  // start altijd op de zaak

  const result: ScheduleItem[] = []

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]
    const prevStop = stops[i - 1]
    const nextStop = stops[i + 1]
    const hasNextStop = !!nextStop

    const needsKasten = stop.trailerType === 'KASTENAANHANGER'
    const prevNeedsKasten = prevStop?.trailerType === 'KASTENAANHANGER'
    const nextNeedsKasten = nextStop?.trailerType === 'KASTENAANHANGER'

    // Kastenaanhanger ophalen: eerste stop in een kasten-reeks
    // Al op de zaak → geen rijdt, alleen koppeltijd. Anders eerst terug naar zaak.
    if (needsKasten && !prevNeedsKasten) {
      const toDepot = atDepot ? 0 : legTravel(currentAddress, depot)
      const depotArrive = addMinutes(current, toDepot)
      const depotDepart = addMinutes(depotArrive, DEPOT_PREP_MIN)
      result.push({ isDepotReturn: true, type: 'kasten-pickup', reason: 'Kastenaanhanger pakken', arrive: depotArrive, depart: depotDepart })
      current = depotDepart
      currentAddress = depot
    }

    // Koppellocatie: eerst naar dit adres om de aanhanger op te halen (alleen bij bezorging)
    if (stop.couplingAddress && stop.type !== 'PICKUP') {
      const t = legTravel(currentAddress, stop.couplingAddress)
      const couplingArrive = addMinutes(current, t)
      const couplingDepart = addMinutes(couplingArrive, 20) // aanhangen
      result.push({ isCoupling: true, address: stop.couplingAddress, arrive: couplingArrive, depart: couplingDepart })
      current = couplingDepart
      currentAddress = stop.couplingAddress
    }

    const t = legTravel(currentAddress, stop.address)
    let arrive = addMinutes(current, t)

    // Als tijdvak nog niet open: wacht
    if (stop.timeWindowStart) {
      const winStart = new Date(stop.timeWindowStart)
      winStart.setFullYear(base.getFullYear(), base.getMonth(), base.getDate())
      if (arrive < winStart) arrive = new Date(winStart)
    }

    const depart = addMinutes(arrive, stop.durationMin ?? settings.handlingMin)

    // Conflict: aankomst na sluiting tijdvak
    let conflict = false
    if (stop.timeWindowEnd) {
      const winEnd = new Date(stop.timeWindowEnd)
      winEnd.setFullYear(base.getFullYear(), base.getMonth(), base.getDate())
      if (arrive > winEnd) conflict = true
    }

    result.push({ stop, arrive, depart, conflict })
    atDepot = false
    currentAddress = stop.address

    // Na een huurtrailer stop: terug naar zaak voor volgende aanhanger
    const isRentalTrailer = stop.trailerType && RENTAL_TRAILER_TYPES.has(stop.trailerType)

    if (needsKasten && (!hasNextStop || !nextNeedsKasten)) {
      // Kastenaanhanger afkoppelen en terugzetten: laatste stop in kasten-reeks
      const depotArrive = addMinutes(depart, legTravel(stop.address, depot))
      const depotDepart = addMinutes(depotArrive, DEPOT_PREP_MIN)
      result.push({ isDepotReturn: true, type: 'kasten-return', reason: 'Kastenaanhanger terugzetten', arrive: depotArrive, depart: depotDepart })
      current = depotDepart
      currentAddress = depot
      atDepot = true
    } else if (isRentalTrailer && hasNextStop) {
      // Huurtrailer: terug naar zaak na elke stop
      const depotArrive = addMinutes(depart, legTravel(stop.address, depot))
      const depotDepart = addMinutes(depotArrive, DEPOT_PREP_MIN)
      const reason = stop.type === 'DELIVERY'
        ? 'Terug naar zaak — nieuwe aanhanger ophalen'
        : 'Terug naar zaak — aanhanger afzetten'
      result.push({ isDepotReturn: true, type: 'rental', reason, arrive: depotArrive, depart: depotDepart })
      current = depotDepart
      currentAddress = depot
      atDepot = true
    } else {
      current = depart
    }
  }

  return result
}

/**
 * Geeft de eindtijd van een route (incl. depot-terugrit na laatste stop).
 * Geeft null als de route geen stops heeft.
 */
function routeEndTime(route: VehicleRoute, date: Date, settings: Settings, travelPairs?: TravelPairs, depotAddress?: string): Date | null {
  if (route.stops.length === 0) return null
  const schedule = calcSchedule(route.stops, date, settings, route.workStart, route.hasTrailer, travelPairs, depotAddress)
  if (schedule.length === 0) return null
  const lastItem = schedule[schedule.length - 1]
  // Als laatste item al een depot-return is, is de eindig al de zaak
  if ('isDepotReturn' in lastItem && lastItem.isDepotReturn) return lastItem.depart
  // Anders: rij nog terug naar zaak
  const fallback = route.hasTrailer ? Math.round(settings.travelMin * 1.15) : settings.travelMin
  const lastAddr = 'stop' in lastItem ? (lastItem as ScheduledStop).stop.address : (depotAddress ?? '')
  const returnTravel = travelPairs?.[`${lastAddr}|${depotAddress ?? ''}`] ?? fallback
  return addMinutes(lastItem.depart, returnTravel)
}

/**
 * Kan deze stop nog bij deze bezorger zonder werktijd te overschrijden of tijdvak-conflict?
 */
function canFitStop(route: VehicleRoute, stop: UnifiedStop, date: Date, settings: Settings, travelPairs?: TravelPairs, depotAddress?: string): boolean {
  // Een lege route accepteert altijd minstens één stop — voorkom dat een lege slot wordt overgeslagen
  if (route.stops.length === 0) return true

  const testStops = [...route.stops, stop]
  const schedule = calcSchedule(testStops, date, settings, route.workStart, route.hasTrailer, travelPairs, depotAddress)
  const fallback = route.hasTrailer ? Math.round(settings.travelMin * 1.15) : settings.travelMin

  // Tijdvak conflict door deze stop?
  const hasConflict = schedule.some(
    (item): item is ScheduledStop => !('isDepotReturn' in item) && !('isCoupling' in item) && (item as ScheduledStop).conflict
  )
  if (hasConflict) return false

  // Werktijd overschreden?
  if (schedule.length > 0) {
    const lastItem = schedule[schedule.length - 1]
    const isAlreadyAtDepot = 'isDepotReturn' in lastItem && lastItem.isDepotReturn
    if (!isAlreadyAtDepot) {
      const lastAddr = 'stop' in lastItem ? (lastItem as ScheduledStop).stop.address : ''
      const returnTravel = travelPairs?.[`${lastAddr}|${depotAddress ?? ''}`] ?? fallback
      const finalReturn = addMinutes(lastItem.depart, returnTravel)
      const workEndTime = new Date(date)
      workEndTime.setHours(route.workEnd, 0, 0, 0)
      if (finalReturn > workEndTime) return false
    }
  }

  return true
}

/**
 * Volgorde waarin voertuigen worden gevuld (fill-first prioriteit).
 * Trefwoorden worden als los woord (case-insensitief) in de naam gematcht.
 * Voertuigen die niet in de lijst staan komen achteraan.
 */
const VEHICLE_FILL_ORDER = ['caddy', 'transporter', 'ranger']

function vehiclePriority(name: string): number {
  const lower = name.toLowerCase()
  const idx = VEHICLE_FILL_ORDER.findIndex((kw) => lower.includes(kw))
  return idx === -1 ? VEHICLE_FILL_ORDER.length : idx
}

function sortVehiclesByFillOrder(vehicles: Vehicle[]): Vehicle[] {
  return [...vehicles].sort((a, b) => vehiclePriority(a.name) - vehiclePriority(b.name))
}

/**
 * Genereer automatisch een verdeling van stops over bezorgers.
 * Strategie: fill-first — bezorger 1 vol tot ~17:00, dan bezorger 2, etc.
 * Stops gesorteerd op tijdvak (vroegst eerst), flexibel achteraan.
 */
function generateAutoPlanning(
  stops: UnifiedStop[],
  vehicles: Vehicle[],
  settings: Settings,
  date: Date,
  travelPairs?: TravelPairs,
  depotAddress?: string,
): VehicleRoute[] {
  if (stops.length === 0) return []

  // Sorteer voertuigen op fill-volgorde: Caddy → Transporter → Ranger → rest
  const sortedVehicles = sortVehiclesByFillOrder(vehicles)

  const defaultWorkEnd = settings.startHour + settings.workdayHours

  // Sorteer: tijdvak eerst (vroegst eerst), daarna geen tijdvak, flexibel helemaal achteraan
  const sorted = [...stops].sort((a, b) => {
    const aT = a.timeWindowStart ? new Date(a.timeWindowStart).getTime() : a.flexible ? 2e15 : 1e15
    const bT = b.timeWindowStart ? new Date(b.timeWindowStart).getTime() : b.flexible ? 2e15 : 1e15
    return aT - bT
  })

  // Altijd alle vehicles tonen als bezorger-slots, minimaal 4
  const numSlots = Math.max(sortedVehicles.length, 4)

  function makeRoute(idx: number): VehicleRoute {
    const v = sortedVehicles[idx]
    return {
      vehicleId: v?.id ?? null,
      vehicleName: `Bezorger ${idx + 1}`,
      assignedVehicleName: v?.name ?? '',
      hasTrailer: v?.hasTrailer ?? false,
      stops: [],
      workStart: settings.startHour,
      workEnd: defaultWorkEnd,
    }
  }

  const routes: VehicleRoute[] = Array.from({ length: numSlots }, (_, i) => makeRoute(i))

  for (const stop of sorted) {
    // Fill-first: probeer routes op volgorde (bezorger 1 eerst vol tot ~17:00, dan bezorger 2, etc.)
    let assigned = false
    for (const route of routes) {
      if (canFitStop(route, stop, date, settings, travelPairs, depotAddress)) {
        route.stops.push(stop)
        assigned = true
        break
      }
    }
    if (!assigned) {
      // Geen enkele route paste — maak een extra bezorger aan
      const newRoute = makeRoute(routes.length)
      newRoute.stops.push(stop)
      routes.push(newRoute)
    }
  }

  // Altijd alle slots teruggeven (ook lege bezorgers)
  return routes
}

// ─── Types voor diff-detectie ────────────────────────────────────────────────

interface SourceStopRef {
  id: string       // rentmagicOrderId of calendarEventId
  date: string     // YYYY-MM-DD
  name: string
}

interface PlanningDiff {
  added: UnifiedStop[]
  removed: SourceStopRef[]
  moved: Array<SourceStopRef & { newDate: string }>
}

/** Geeft de externe ID van een stop (RM of agenda), of null voor handmatige taken */
function stopExternalId(s: UnifiedStop): string | null {
  return s.rentmagicOrderId ?? s.calendarEventId ?? null
}

/** Bouw een lijst van SourceStopRef uit de huidige stops */
function buildSourceRefs(days: DayData[]): SourceStopRef[] {
  const refs: SourceStopRef[] = []
  for (const day of days) {
    for (const stop of day.stops) {
      const id = stopExternalId(stop)
      if (id) refs.push({ id, date: day.dateStr, name: stop.customerName })
    }
  }
  return refs
}

/** Berekent diff tussen verse stops en de opgeslagen bronreferenties.
 *  completedIds: stopKeys van stops die DONE zijn in StopTracking — die tellen niet als verwijderd. */
function computeDiff(freshDays: DayData[], knownRefs: SourceStopRef[], completedIds: Set<string>): PlanningDiff {
  const freshById = new Map<string, { stop: UnifiedStop; date: string }>()
  for (const day of freshDays) {
    for (const stop of day.stops) {
      const id = stopExternalId(stop)
      if (id) freshById.set(id, { stop, date: day.dateStr })
    }
  }
  const knownById = new Map(knownRefs.map((r) => [r.id, r]))

  const added: UnifiedStop[] = []
  const removed: SourceStopRef[] = []
  const moved: Array<SourceStopRef & { newDate: string }> = []

  // Nieuw of verplaatst
  for (const [id, { stop, date }] of freshById) {
    if (!knownById.has(id)) {
      added.push(stop)
    } else {
      const known = knownById.get(id)!
      if (known.date !== date) {
        moved.push({ ...known, newDate: date })
      }
    }
  }
  // Verwijderd — sla DONE stops over (die zijn bezorgd, niet verdwenen)
  for (const [id, ref] of knownById) {
    if (!freshById.has(id) && !completedIds.has(id)) removed.push(ref)
  }

  return { added, removed, moved }
}

/**
 * Merget een opgeslagen routelijst met verse stops.
 * - Stops die nog in de verse data zitten → bijgewerkt met verse info
 * - Stops die verdwenen zijn en DONE zijn → behouden (bezorgd, niet verdwenen)
 * - Stops die verdwenen zijn en niet DONE → verwijderd uit de route
 * - Handmatige taken (geen extern ID) → altijd behouden
 * - Nieuwe stops → worden via auto-planning ingedeeld (niet direct in saved routes)
 */
function mergeRoutesWithFresh(
  savedRoutes: VehicleRoute[],
  freshDays: DayData[],
  completedIds: Set<string>,
): VehicleRoute[] {
  const freshById = new Map<string, UnifiedStop>()
  for (const day of freshDays) {
    for (const stop of day.stops) {
      const id = stopExternalId(stop)
      if (id) freshById.set(id, stop)
    }
  }

  return savedRoutes.map((route) => ({
    ...route,
    stops: route.stops
      .map((stop) => {
        const id = stopExternalId(stop)
        if (!id) return stop               // handmatige taak → altijd bewaren
        const fresh = freshById.get(id)
        if (!fresh) {
          // Niet meer in RentMagic — bewaar als al bezorgd (DONE), anders verwijderen
          return completedIds.has(id) ? stop : null
        }
        return { ...fresh,
          // bewaar handmatige aanpassingen (tijdvak, duur) als ze ingesteld zijn
          timeWindowStart: stop.timeWindowStart ?? fresh.timeWindowStart,
          timeWindowEnd: stop.timeWindowEnd ?? fresh.timeWindowEnd,
          durationMin: stop.durationMin ?? fresh.durationMin,
        }
      })
      .filter((s): s is UnifiedStop => s !== null),
  }))
}

// ─── Week-cache: per weekoffset, 20s TTL (tab-wissel) / 5 min voor andere weken ──

const CACHE_TTL_CURRENT_MS = 5 * 60_000
const CACHE_TTL_OTHER_MS   = 5 * 60_000
const weekCache = new Map<number, { days: DayData[]; vehicles: Vehicle[]; timestamp: number }>()

// ─── Hoofdpagina ──────────────────────────────────────────────────────────────

export default function RitplanningPage() {
  const searchParams = useSearchParams()

  const [settings, setSettings] = useState<Settings>({
    handlingMin: 60,
    travelMin: 45,
    startHour: 8,
    workdayHours: 9,
    departureBufferMin: 15,
  })
  const [showSettings, setShowSettings] = useState(false)
  const [showDrivers, setShowDrivers] = useState(false)
  const [drivers, setDrivers] = useState<{ id: string; name: string; damageFreeKm: number; rewardsEarned: number }[]>([])
  const [newDriverName, setNewDriverName] = useState('')
  const [driverSaving, setDriverSaving] = useState(false)
  const [weekOffset, setWeekOffset] = useState(0)
  const [days, setDays] = useState<DayData[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [diff, setDiff] = useState<PlanningDiff | null>(null)
  const [saving, setSaving] = useState(false)
  const [trackingMap, setTrackingMap] = useState<Record<string, { status: string; startedAt: string | null; completedAt: string | null }>>({})
  // vehicleId → driverName (gekoppeld via tablet voor de geselecteerde dag)
  const [sessionMap, setSessionMap] = useState<Record<string, string>>({})

  // Ref voor de verse stop-data van de huidig geladen week (nodig voor auto-save)
  const freshDaysRef = useRef<DayData[]>([])
  const weekOffsetRef = useRef(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Accumulatie van routes per dag — zodat alle dagen opgeslagen worden, niet alleen de geselecteerde
  const allDayRoutesRef = useRef<Record<string, VehicleRoute[]>>({})
  // Bewerkbare routes voor de geselecteerde dag
  const [editRoutes, setEditRoutes] = useState<VehicleRoute[]>([])
  // Ref zodat loadData altijd de meest recente trackingMap kan lezen zonder dependency
  const trackingMapRef = useRef<Record<string, { status: string }>>({})

  /** Sla alle dagen op naar de DB (routesJson bevat stops van alle dagen per voertuig) */
  const savePlan = useCallback(async (offset: number, allDayRoutes: Record<string, VehicleRoute[]>, freshDays: DayData[]) => {
    if (Object.keys(allDayRoutes).length === 0) return
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const startDate = new Date(today); startDate.setDate(today.getDate() + offset * 7)
    const weekStart = localDateStr(startDate)
    const knownSourceStops = buildSourceRefs(freshDays)

    // Samenvoegen: per voertuig alle stops van alle dagen
    const vehicleMap = new Map<string, VehicleRoute>()
    for (const routes of Object.values(allDayRoutes)) {
      for (const route of routes) {
        const vid = route.vehicleId ?? route.vehicleName
        if (!vehicleMap.has(vid)) vehicleMap.set(vid, { ...route, stops: [] })
        vehicleMap.get(vid)!.stops.push(...route.stops)
      }
    }
    const mergedRoutes = Array.from(vehicleMap.values())

    setSaving(true)
    try {
      await fetch('/api/ritplanning/week-plan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStart, routesJson: mergedRoutes, knownSourceStops }),
      })
    } finally {
      setSaving(false)
    }
  }, [])

  // Auto-save met 2s debounce — sync editRoutes naar allDayRoutesRef, dan opslaan
  useEffect(() => {
    if (editRoutes.length === 0 || !selectedDate) return
    allDayRoutesRef.current = { ...allDayRoutesRef.current, [selectedDate]: editRoutes }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      savePlan(weekOffsetRef.current, allDayRoutesRef.current, freshDaysRef.current)
    }, 2000)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [editRoutes, selectedDate, savePlan])

  // Poll tablet tracking — alleen voor de huidige week (weekOffset === 0)
  useEffect(() => {
    if (weekOffsetRef.current !== 0) return
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const weekStart = localDateStr(today)

    const poll = async () => {
      try {
        const [trackingRes, sessionsRes] = await Promise.all([
          fetch(`/api/tablet/tracking?weekStart=${weekStart}`),
          fetch(`/api/tablet/driver-session?date=${localDateStr(today)}`),
        ])
        const trackingData = await trackingRes.json() as { tracking: { stopKey: string; status: string; startedAt: string | null; completedAt: string | null }[] }
        const sessionsData = await sessionsRes.json() as { sessions: { vehicleId: string | null; vehicleName: string | null; driverName: string }[] }
        const map: Record<string, { status: string; startedAt: string | null; completedAt: string | null }> = {}
        for (const t of (trackingData.tracking ?? [])) map[t.stopKey] = t
        setTrackingMap(map)
        trackingMapRef.current = map
        const smap: Record<string, string> = {}
        for (const s of (sessionsData.sessions ?? [])) {
          const key = s.vehicleId ?? s.vehicleName
          if (key && s.driverName) smap[key] = s.driverName
        }
        setSessionMap(smap)
      } catch { /* ignore */ }
    }
    poll()
    const id = setInterval(poll, 20_000)
    return () => clearInterval(id)
  }, [weekOffset]) // eslint-disable-line react-hooks/exhaustive-deps

  function updateStop(routeIdx: number, stopIdx: number, updates: Partial<UnifiedStop>) {
    setEditRoutes((prev) => prev.map((r, ri) => {
      if (ri !== routeIdx) return r
      const stops = r.stops.map((s, si) => si === stopIdx ? { ...s, ...updates } : s)
      return { ...r, stops }
    }))
  }

  function addCustomStop(routeIdx: number, stop: UnifiedStop) {
    setEditRoutes((prev) => prev.map((r, ri) => {
      if (ri !== routeIdx) return r
      return { ...r, stops: sortStops([...r.stops, stop]) }
    }))
  }

  function removeStop(routeIdx: number, stopIdx: number) {
    setEditRoutes((prev) => prev.map((r, ri) => {
      if (ri !== routeIdx) return r
      return { ...r, stops: r.stops.filter((_, si) => si !== stopIdx) }
    }))
  }

  // Echte rijtijden (Google Maps Distance Matrix) — gedeeld over alle routes
  const [travelPairs, setTravelPairs] = useState<TravelPairs>({})
  const [depotAddress, setDepotAddress] = useState<string>('')

  // Voertuig toevoegen
  const [showAddVehicle, setShowAddVehicle] = useState(false)
  const [newVehicleName, setNewVehicleName] = useState('')
  const [newVehiclePlate, setNewVehiclePlate] = useState('')
  const [newVehicleTrailer, setNewVehicleTrailer] = useState(false)

  useEffect(() => {
    if (searchParams.get('connected') === '1') setSuccessMsg('Google Agenda succesvol gekoppeld!')
    if (searchParams.get('error') === 'google_denied') setError('Google Agenda koppeling geweigerd.')
  }, [searchParams])

  const loadVehicles = useCallback(async (): Promise<Vehicle[]> => {
    const res = await fetch('/api/ritplanning/vehicles')
    const data = await res.json()
    const list = data.vehicles ?? []
    setVehicles(list)
    return list
  }, [])

  /**
   * Haal echte rijtijden op via Google Maps Distance Matrix.
   * addresses = alle stop-adressen voor de geselecteerde dag (depot wordt server-side toegevoegd).
   * Resultaat wordt gecached in travelPairs; bestaande pairs worden samengevoegd.
   */
  const fetchTravelTimes = useCallback(async (addresses: string[]) => {
    const seen = new Set<string>()
    const unique = addresses.filter((a) => { if (!a || seen.has(a)) return false; seen.add(a); return true })
    if (unique.length === 0) return
    try {
      const res = await fetch('/api/ritplanning/travel-times', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses: unique }),
      })
      const data = await res.json() as { depot: string; pairs: TravelPairs }
      if (data.depot) setDepotAddress(data.depot)
      if (data.pairs && Object.keys(data.pairs).length > 0) {
        setTravelPairs((prev) => ({ ...prev, ...data.pairs }))
      }
    } catch {
      // Silently fall back to fixed travelMin
    }
  }, [])

  const checkGoogle = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/ritplanning/calendar?date=' + localDateStr(new Date()))
      const connected = res.status !== 401
      setGoogleConnected(connected)
      return connected
    } catch {
      setGoogleConnected(false)
      return false
    }
  }, [])

  useEffect(() => {
    loadVehicles()
    checkGoogle()
  }, [loadVehicles, checkGoogle])

  // Herbereken routes wanneer settings of voertuigen veranderen
  useEffect(() => {
    if (!selectedDate || days.length === 0) return
    const day = days.find((d) => d.dateStr === selectedDate)
    if (day) setEditRoutes(generateAutoPlanning(day.stops, vehicles, settings, day.date, travelPairs, depotAddress))
  }, [settings, vehicles]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadDrivers() {
    const res = await fetch('/api/drivers')
    const data = await res.json() as { drivers: { id: string; name: string; damageFreeKm: number; rewardsEarned: number }[] }
    setDrivers(data.drivers ?? [])
  }

  async function driverAction(id: string, action: 'damage' | 'claim_reward') {
    await fetch('/api/drivers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    })
    await loadDrivers()
  }

  async function addDriver() {
    if (!newDriverName.trim()) return
    setDriverSaving(true)
    await fetch('/api/drivers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newDriverName.trim() }),
    })
    setNewDriverName('')
    await loadDrivers()
    setDriverSaving(false)
  }

  async function deleteDriver(id: string) {
    await fetch('/api/drivers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    await loadDrivers()
  }

  const loadData = useCallback(async (offset: number) => {
    setLoading(true)
    setError(null)
    try {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      // Startdatum voor deze week
      const startDate = new Date(today)
      startDate.setDate(today.getDate() + offset * 7)

      // Cache-TTL: huidige week kort (tab-wissel), andere weken langer
      const ttl = offset === 0 ? CACHE_TTL_CURRENT_MS : CACHE_TTL_OTHER_MS
      const cached = weekCache.get(offset)
      if (cached && Date.now() - cached.timestamp < ttl) {
        setDays(cached.days)
        setVehicles(cached.vehicles)
        const firstWithStops = cached.days.find((d) => d.stops.length > 0)
        const initialDate = firstWithStops?.dateStr ?? localDateStr(startDate)
        setSelectedDate(initialDate)
        const initialDay = cached.days.find((d) => d.dateStr === initialDate)
        if (initialDay) {
          setEditRoutes(generateAutoPlanning(initialDay.stops, cached.vehicles, settings, initialDay.date, travelPairs, depotAddress))
          const dayAddresses = initialDay.stops.flatMap((s) => [s.address, s.couplingAddress].filter(Boolean) as string[])
          fetchTravelTimes(dayAddresses)
        }
        setLoading(false)
        return
      }

      const [vehicleList, isGoogleOk] = await Promise.all([loadVehicles(), checkGoogle()])

      // Haal orders op voor 7-daags bereik vanaf startDate
      const ordersRes = await fetch(`/api/ritplanning/orders?date=${localDateStr(startDate)}`)
      const ordersData = await ordersRes.json()
      const allOrders: RawOrder[] = ordersData.orders ?? []

      // Bouw 7 dagen vanaf startDate
      const sevenDays = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(startDate)
        d.setDate(startDate.getDate() + i)
        return d
      })

      // Haal kalender op per dag (parallel)
      const calByDay: Record<string, RawCalEvent[]> = {}
      if (isGoogleOk) {
        await Promise.all(
          sevenDays.map(async (d) => {
            const ds = localDateStr(d)
            const res = await fetch(`/api/ritplanning/calendar?date=${ds}`)
            if (res.ok) {
              const { events } = await res.json()
              calByDay[ds] = events ?? []
            }
          }),
        )
      }

      const dayDataList: DayData[] = sevenDays.map((d) => {
        const ds = localDateStr(d)

        const dayOrders: UnifiedStop[] = allOrders
          .filter((o) => {
            const relevant = o.type === 'DELIVERY' ? o.deliveryDate : o.pickupDate
            return relevant?.slice(0, 10) === ds
          })
          .map((o): UnifiedStop => ({
            rentmagicOrderId: o.id,
            type: o.type,
            customerName: o.customerName,
            address: [o.address, o.postalCode, o.city].filter(Boolean).join(', '),
            date: ds,
            timeWindowStart: o.timeWindowStart,
            timeWindowEnd: o.timeWindowEnd,
            flexible: o.flexible,
            items: o.items,
            tripsRequired: o.tripsRequired,
            trailerType: o.trailerType,
          }))

        const dayCalEvents: UnifiedStop[] = (calByDay[ds] ?? []).map((e): UnifiedStop => ({
          calendarEventId: e.id,
          calendarTitle: e.title,
          type: e.inferredType ?? 'CALENDAR',
          customerName: e.customerName ?? e.title,
          address: e.location ?? '',
          date: ds,
          timeWindowStart: e.timeWindowStart,
          timeWindowEnd: e.timeWindowEnd,
          couplingAddress: e.couplingAddress,
        }))

        return { date: d, dateStr: ds, stops: [...dayOrders, ...dayCalEvents] }
      })

      setDays(dayDataList)
      weekCache.set(offset, { days: dayDataList, vehicles: vehicleList, timestamp: Date.now() })

      freshDaysRef.current = dayDataList
      weekOffsetRef.current = offset

      // Laad opgeslagen planning uit DB
      const weekStart = localDateStr(startDate)
      let savedPlan: { routesJson: VehicleRoute[]; knownSourceStops: SourceStopRef[] } | null = null
      try {
        const savedRes = await fetch(`/api/ritplanning/week-plan?weekStart=${weekStart}`)
        const savedData = await savedRes.json()
        savedPlan = savedData.plan ?? null
      } catch { /* negeer — planning wordt opnieuw aangemaakt */ }

      // Herstel allDayRoutesRef vanuit de opgeslagen planning (splits per dag)
      if (savedPlan?.routesJson) {
        const dayRoutes: Record<string, VehicleRoute[]> = {}
        for (const route of savedPlan.routesJson) {
          const stopsByDay: Record<string, UnifiedStop[]> = {}
          for (const stop of route.stops) {
            if (!stopsByDay[stop.date]) stopsByDay[stop.date] = []
            stopsByDay[stop.date].push(stop)
          }
          for (const [d, stops] of Object.entries(stopsByDay)) {
            if (!dayRoutes[d]) dayRoutes[d] = []
            dayRoutes[d].push({ ...route, stops })
          }
        }
        allDayRoutesRef.current = dayRoutes
      } else {
        allDayRoutesRef.current = {}
      }

      // Verzamel IDs van stops die al DONE zijn in StopTracking (bezorgd = niet 'verwijderd' uit RM)
      const completedIds = new Set<string>(
        Object.entries(trackingMapRef.current)
          .filter(([, t]) => t.status === 'DONE')
          .map(([key]) => key)
      )

      // Toon diff als er wijzigingen zijn t.o.v. de opgeslagen planning
      if (savedPlan?.knownSourceStops) {
        const planDiff = computeDiff(dayDataList, savedPlan.knownSourceStops, completedIds)
        if (planDiff.added.length || planDiff.removed.length || planDiff.moved.length) {
          setDiff(planDiff)
        }
      }

      // Selecteer eerste dag met stops, anders eerste dag van de week
      const firstWithStops = dayDataList.find((d) => d.stops.length > 0)
      const initialDate = firstWithStops?.dateStr ?? localDateStr(startDate)
      setSelectedDate(initialDate)

      const initialDay = dayDataList.find((d) => d.dateStr === initialDate)
      if (initialDay) {
        let routes: VehicleRoute[]
        if (savedPlan?.routesJson) {
          // mergeRoutesWithFresh geeft routes met stops van alle dagen — filter naar alleen de initiële dag
          const mergedAll = mergeRoutesWithFresh(savedPlan.routesJson, dayDataList, completedIds)
          const merged = mergedAll.map((r) => ({ ...r, stops: r.stops.filter((s) => s.date === initialDate) }))
          // Auto-plan nieuwe stops die nog niet in de opgeslagen planning zitten
          const assignedIds = new Set(merged.flatMap((r) => r.stops.map(stopExternalId).filter(Boolean)))
          const newStops = initialDay.stops.filter((s) => {
            const id = stopExternalId(s)
            return id && !assignedIds.has(id)
          })
          if (newStops.length > 0) {
            // Voeg nieuwe stops toe aan bestaande routes (fill-first), zonder de volgorde van bestaande stops te wijzigen
            routes = [...merged]
            for (const stop of newStops) {
              let placed = false
              for (const route of routes) {
                if (canFitStop(route, stop, initialDay.date, settings, travelPairs, depotAddress)) {
                  route.stops = sortStops([...route.stops, stop])
                  placed = true
                  break
                }
              }
              if (!placed && routes.length > 0) {
                // Past nergens — zet bij de route met de minste stops
                const lightest = routes.reduce((a, b) => a.stops.length <= b.stops.length ? a : b)
                lightest.stops = sortStops([...lightest.stops, stop])
              }
            }
          } else {
            routes = merged
          }
        } else {
          routes = generateAutoPlanning(initialDay.stops, vehicleList, settings, initialDay.date, travelPairs, depotAddress)
        }
        setEditRoutes(routes)
        const dayAddresses = initialDay.stops.flatMap((s) => [s.address, s.couplingAddress].filter(Boolean) as string[])
        fetchTravelTimes(dayAddresses)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Onbekende fout')
    } finally {
      setLoading(false)
    }
  }, [loadVehicles, checkGoogle]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-load bij eerste render
  useEffect(() => {
    loadData(0)
  }, [loadData]) // eslint-disable-line react-hooks/exhaustive-deps

  async function addVehicle() {
    if (!newVehicleName.trim()) return
    await fetch('/api/ritplanning/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newVehicleName,
        licensePlate: newVehiclePlate || null,
        hasTrailer: newVehicleTrailer,
      }),
    })
    setNewVehicleName('')
    setNewVehiclePlate('')
    setNewVehicleTrailer(false)
    setShowAddVehicle(false)
    const updated = await loadVehicles()
    // Herbereken plan met nieuw voertuig
    const day = days.find((d) => d.dateStr === selectedDate)
    if (day) setEditRoutes(generateAutoPlanning(day.stops, updated, settings, day.date, travelPairs, depotAddress))
  }

  function onSelectDay(ds: string) {
    setSelectedDate(ds)
    const day = days.find((d) => d.dateStr === ds)
    if (!day) return
    // Herstel eerder opgeslagen routes voor deze dag indien aanwezig
    const saved = allDayRoutesRef.current[ds]
    setEditRoutes(saved?.length ? saved : generateAutoPlanning(day.stops, vehicles, settings, day.date, travelPairs, depotAddress))
    const dayAddresses = day.stops.flatMap((s) => [s.address, s.couplingAddress].filter(Boolean) as string[])
    fetchTravelTimes(dayAddresses)
  }

  function sortStops(stops: UnifiedStop[]): UnifiedStop[] {
    return [...stops].sort((a, b) => {
      const aT = a.timeWindowStart ? new Date(a.timeWindowStart).getTime() : a.flexible ? 2e15 : 1e15
      const bT = b.timeWindowStart ? new Date(b.timeWindowStart).getTime() : b.flexible ? 2e15 : 1e15
      return aT - bT
    })
  }

  function moveStop(stop: UnifiedStop, fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return
    setEditRoutes((prev) => {
      const next = prev.map((r) => ({ ...r, stops: [...r.stops] }))
      next[fromIdx].stops = next[fromIdx].stops.filter((s) => s !== stop)
      // Invoegen op de juiste tijdvak-positie in de doelroute
      next[toIdx].stops = sortStops([...next[toIdx].stops, stop])
      return next
    })
  }

  function reorderStop(routeIdx: number, fromPos: number, toPos: number) {
    if (fromPos === toPos) return
    setEditRoutes((prev) => prev.map((r, i) => {
      if (i !== routeIdx) return r
      const stops = [...r.stops]
      const [moved] = stops.splice(fromPos, 1)
      stops.splice(toPos, 0, moved)
      return { ...r, stops }
    }))
  }

  function addRouteSlot() {
    setEditRoutes((prev) => [
      ...prev,
      {
        vehicleId: null,
        vehicleName: `Bezorger ${prev.length + 1}`,
        assignedVehicleName: '',
        hasTrailer: false,
        stops: [],
        workStart: settings.startHour,
        workEnd: settings.startHour + settings.workdayHours,
      },
    ])
  }

  function removeRouteSlot(idx: number) {
    setEditRoutes((prev) => {
      const removed = prev[idx]
      const next = prev.filter((_, i) => i !== idx)
      if (next.length > 0 && removed.stops.length > 0) {
        next[0] = { ...next[0], stops: [...next[0].stops, ...removed.stops] }
      }
      return next
    })
  }

  function updateRoute(idx: number, updates: Partial<Pick<VehicleRoute, 'workStart' | 'workEnd' | 'vehicleName' | 'assignedVehicleName' | 'vehicleId' | 'hasTrailer'>>) {
    setEditRoutes((prev) => prev.map((r, i) => i === idx ? { ...r, ...updates } : r))
  }

  const selectedDay = days.find((d) => d.dateStr === selectedDate) ?? null

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="page-title">Ritplanning</h1>
          <p className="page-sub">7-daags overzicht — automatische indeling per bezorger</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setShowDrivers(!showDrivers); if (!showDrivers) loadDrivers() }}
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2 border rounded"
          >
            👤 Bezorgers
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2 border rounded"
          >
            ⚙ Instellingen
          </button>
          {saving && <span className="text-xs text-gray-400">Opslaan…</span>}
          <button onClick={() => { weekCache.delete(weekOffset); loadData(weekOffset) }} disabled={loading} className="btn-primary px-4 py-2 text-sm">
            {loading ? 'Laden…' : '↻ Laad planning'}
          </button>
        </div>
      </div>

      {/* Week-navigator */}
      {(() => {
        const today = new Date(); today.setHours(0, 0, 0, 0)
        const weekStart = new Date(today); weekStart.setDate(today.getDate() + weekOffset * 7)
        const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6)
        const weekLabel = weekOffset === 0
          ? 'Deze week'
          : weekOffset === 1
          ? 'Volgende week'
          : `Over ${weekOffset} weken`
        const rangeLabel = `${weekStart.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })} – ${weekEnd.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })}`
        const isLoaded = weekCache.has(weekOffset) || days.length > 0
        return (
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => { if (weekOffset > 0) { const o = weekOffset - 1; setWeekOffset(o); loadData(o) } }}
              disabled={weekOffset === 0 || loading}
              className="px-2 py-1.5 border rounded text-sm text-gray-500 hover:text-gray-700 disabled:opacity-30"
            >←</button>
            <div className="flex items-center gap-1">
              {[0, 1, 2, 3, 4].map((o) => {
                const ws = new Date(today); ws.setDate(today.getDate() + o * 7)
                const cached = weekCache.has(o)
                return (
                  <button
                    key={o}
                    onClick={() => { setWeekOffset(o); loadData(o) }}
                    disabled={loading}
                    className={`px-3 py-1.5 rounded text-xs border transition-all ${
                      weekOffset === o
                        ? 'bg-cp-blue text-white border-cp-blue'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-cp-blue hover:text-cp-blue'
                    }`}
                  >
                    {o === 0 ? 'Deze week' : o === 1 ? 'Volgende week' : `+${o}w`}
                    {cached && o !== weekOffset && <span className="ml-1 text-[10px] opacity-60">●</span>}
                  </button>
                )
              })}
            </div>
            <button
              onClick={() => { const o = weekOffset + 1; setWeekOffset(o); loadData(o) }}
              disabled={loading}
              className="px-2 py-1.5 border rounded text-sm text-gray-500 hover:text-gray-700 disabled:opacity-30"
            >→</button>
            <span className="ml-2 text-xs text-gray-400">{rangeLabel}</span>
          </div>
        )
      })()}

      {/* Feedback */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700 flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="underline ml-4">
            Sluiten
          </button>
        </div>
      )}
      {successMsg && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700 flex justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="underline ml-4">
            Sluiten
          </button>
        </div>
      )}

      {/* Diff banner */}
      {diff && (diff.added.length > 0 || diff.removed.length > 0 || diff.moved.length > 0) && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded text-sm">
          <div className="flex justify-between items-start mb-2">
            <span className="font-medium text-amber-800">Wijzigingen t.o.v. opgeslagen planning</span>
            <button onClick={() => setDiff(null)} className="text-amber-600 underline ml-4 shrink-0">Sluiten</button>
          </div>
          {diff.added.length > 0 && (
            <div className="mb-1">
              <span className="text-green-700 font-medium">Nieuw ({diff.added.length}):</span>{' '}
              <span className="text-green-800">{diff.added.map((s) => s.customerName).join(', ')}</span>
            </div>
          )}
          {diff.removed.length > 0 && (
            <div className="mb-1">
              <span className="text-red-700 font-medium">Verwijderd ({diff.removed.length}):</span>{' '}
              <span className="text-red-800">{diff.removed.map((s) => s.name).join(', ')}</span>
            </div>
          )}
          {diff.moved.length > 0 && (
            <div>
              <span className="text-blue-700 font-medium">Verplaatst ({diff.moved.length}):</span>{' '}
              <span className="text-blue-800">{diff.moved.map((s) => `${s.name} (${s.date} → ${s.newDate})`).join(', ')}</span>
            </div>
          )}
        </div>
      )}

      {/* Google koppeling banner */}
      {googleConnected === false && (
        <div className="mb-5 p-4 rounded-lg border-2 border-blue-300 bg-blue-50 flex items-center justify-between">
          <div>
            <div className="font-medium text-cp-dark">Google Agenda nog niet gekoppeld</div>
            <div className="text-sm text-blue-700">Koppel je agenda om afspraken te laden</div>
          </div>
          <a href="/api/auth/google" className="btn-primary px-4 py-2 text-sm">
            Koppel Google Agenda
          </a>
        </div>
      )}

      {/* Bezorgers beheren */}
      {showDrivers && (
        <div className="mb-5 card p-4">
          <h3 className="text-sm font-medium text-cp-dark mb-3">Bezorgers</h3>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={newDriverName}
              onChange={(e) => setNewDriverName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addDriver()}
              placeholder="Naam toevoegen…"
              className="border border-gray-300 rounded px-3 py-1.5 text-sm flex-1"
            />
            <button
              onClick={addDriver}
              disabled={!newDriverName.trim() || driverSaving}
              className="btn-primary px-4 py-1.5 text-sm disabled:opacity-40"
            >
              {driverSaving ? '…' : 'Toevoegen'}
            </button>
          </div>
          {drivers.length === 0 ? (
            <p className="text-xs text-gray-400">Nog geen bezorgers aangemaakt.</p>
          ) : (
            <div className="space-y-2 mt-1">
              {drivers.map((d) => {
                const REWARD_KM = 4000
                const pct = Math.min(100, Math.round((d.damageFreeKm / REWARD_KM) * 100))
                const reached = d.damageFreeKm >= REWARD_KM
                return (
                  <div key={d.id} className={`rounded-lg border px-4 py-3 ${reached ? 'border-yellow-300 bg-yellow-50' : 'border-gray-200 bg-white'}`}>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div>
                        <span className="text-sm font-semibold text-cp-dark">{d.name}</span>
                        {d.rewardsEarned > 0 && <span className="ml-2 text-xs text-gray-400">{d.rewardsEarned}× €100 uitbetaald</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        {reached && (
                          <button
                            onClick={() => driverAction(d.id, 'claim_reward')}
                            className="text-xs bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-bold px-3 py-1 rounded-full"
                          >
                            🏆 €100 uitbetalen
                          </button>
                        )}
                        <button
                          onClick={() => { if (confirm(`Schade melden voor ${d.name}? Dit reset de schadevrije teller naar 0.`)) driverAction(d.id, 'damage') }}
                          className="text-xs text-gray-400 hover:text-red-500 border border-gray-200 hover:border-red-200 px-2 py-1 rounded"
                        >
                          ⚠ Schade
                        </button>
                        <button
                          onClick={() => deleteDriver(d.id)}
                          className="text-gray-400 hover:text-red-500 text-xs w-6 h-6 flex items-center justify-center rounded-full hover:bg-red-50"
                          title="Verwijderen"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>🛡 Schadevrij: {d.damageFreeKm.toLocaleString('nl-NL')} / {REWARD_KM.toLocaleString('nl-NL')} km</span>
                      <span className={reached ? 'text-yellow-600 font-bold' : ''}>{pct}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-2 rounded-full transition-all ${reached ? 'bg-yellow-400' : pct >= 75 ? 'bg-green-400' : 'bg-[#2c80b3]'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Instellingen */}
      {showSettings && (
        <div className="mb-5 card p-4">
          <h3 className="text-sm font-medium text-cp-dark mb-3">Tijdinstellingen</h3>
          <div className="grid grid-cols-5 gap-4">
            {[
              { label: 'Handelingstijd (min)', key: 'handlingMin', min: 15, max: 240 },
              { label: 'Reistijd per stop (min)', key: 'travelMin', min: 10, max: 120 },
              { label: 'Vertrektijd buffer (min)', key: 'departureBufferMin', min: 0, max: 60 },
              { label: 'Starttijd (uur)', key: 'startHour', min: 5, max: 10 },
              { label: 'Werkdag (uur)', key: 'workdayHours', min: 4, max: 12 },
            ].map(({ label, key, min, max }) => (
              <div key={key}>
                <label className="block text-xs text-gray-500 mb-1">{label}</label>
                <input
                  type="number"
                  min={min}
                  max={max}
                  value={settings[key as keyof Settings]}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, [key]: parseInt(e.target.value) || 0 }))
                  }
                  className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full"
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Reistijd is een gemiddelde schatting. Planning wordt direct herberekend bij wijziging.
          </p>
        </div>
      )}

      {days.length === 0 ? (
        <div className="card p-12 text-center text-gray-400">
          <div className="text-4xl mb-3">🗓</div>
          <div className="text-sm">Selecteer een week en klik op &ldquo;Laad planning&rdquo;</div>
        </div>
      ) : (
        <>
          {/* 7-daags overzicht */}
          <div className="grid grid-cols-7 gap-2 mb-5">
            {days.map((day) => {
              const deliveries = day.stops.filter((s) => s.type === 'DELIVERY').length
              const pickups = day.stops.filter((s) => s.type === 'PICKUP').length
              const cal = day.stops.filter((s) => s.type === 'CALENDAR').length
              const total = day.stops.length
              const minV = calcMinVehicles(total, settings)
              const isSelected = selectedDate === day.dateStr
              const isToday = day.dateStr === localDateStr(new Date())

              return (
                <button
                  key={day.dateStr}
                  onClick={() => onSelectDay(day.dateStr)}
                  className={`card p-3 text-left transition-all hover:shadow-md ${isSelected ? 'ring-2 ring-cp-blue' : ''}`}
                >
                  <div
                    className={`text-xs font-semibold mb-2 ${isToday ? 'text-cp-blue' : 'text-cp-dark'}`}
                  >
                    {formatShortDay(day.date)}
                    {isToday && <span className="ml-1">●</span>}
                  </div>
                  {total === 0 ? (
                    <div className="text-xs text-gray-300">Geen ritten</div>
                  ) : (
                    <>
                      <div className="text-2xl font-bold text-cp-dark leading-none">{total}</div>
                      <div className="text-xs text-gray-400 mb-2">
                        stop{total !== 1 ? 's' : ''}
                      </div>
                      <div className="space-y-0.5 text-xs">
                        {deliveries > 0 && (
                          <div className="text-green-700">🚚 {deliveries}× uitlevering</div>
                        )}
                        {pickups > 0 && (
                          <div className="text-orange-700">↩ {pickups}× retour</div>
                        )}
                        {cal > 0 && (
                          <div className="text-purple-700">📅 {cal}× agenda</div>
                        )}
                      </div>
                      <div className="mt-2 text-xs font-medium text-cp-blue">
                        {minV} bezorger{minV !== 1 ? 's' : ''}
                      </div>
                    </>
                  )}
                </button>
              )
            })}
          </div>

          {/* Dag detail */}
          {selectedDay && (
            <DayDetail
              day={selectedDay}
              routes={editRoutes}
              settings={settings}
              vehicles={vehicles}
              travelPairs={travelPairs}
              depotAddress={depotAddress}
              trackingMap={trackingMap}
              sessionMap={sessionMap}
              showAddVehicle={showAddVehicle}
              newVehicleName={newVehicleName}
              newVehiclePlate={newVehiclePlate}
              newVehicleTrailer={newVehicleTrailer}
              onSetShowAddVehicle={setShowAddVehicle}
              onSetNewVehicleName={setNewVehicleName}
              onSetNewVehiclePlate={setNewVehiclePlate}
              onSetNewVehicleTrailer={setNewVehicleTrailer}
              onAddVehicle={addVehicle}
              onMoveStop={moveStop}
              onReorderStop={reorderStop}
              onAddRoute={addRouteSlot}
              onRemoveRoute={removeRouteSlot}
              onUpdateRoute={updateRoute}
              onUpdateStop={updateStop}
              onAddCustomStop={addCustomStop}
              onRemoveStop={removeStop}
            />
          )}
        </>
      )}
    </div>
  )
}

// ─── Dag detail ───────────────────────────────────────────────────────────────

function DayDetail({
  day,
  routes,
  settings,
  vehicles,
  travelPairs,
  depotAddress,
  trackingMap,
  sessionMap,
  showAddVehicle,
  newVehicleName,
  newVehiclePlate,
  newVehicleTrailer,
  onSetShowAddVehicle,
  onSetNewVehicleName,
  onSetNewVehiclePlate,
  onSetNewVehicleTrailer,
  onAddVehicle,
  onMoveStop,
  onReorderStop,
  onAddRoute,
  onRemoveRoute,
  onUpdateRoute,
  onUpdateStop,
  onAddCustomStop,
  onRemoveStop,
}: {
  day: DayData
  routes: VehicleRoute[]
  settings: Settings
  vehicles: Vehicle[]
  travelPairs: TravelPairs
  depotAddress: string
  showAddVehicle: boolean
  newVehicleName: string
  newVehiclePlate: string
  newVehicleTrailer: boolean
  onSetShowAddVehicle: (v: boolean) => void
  onSetNewVehicleName: (v: string) => void
  onSetNewVehiclePlate: (v: string) => void
  onSetNewVehicleTrailer: (v: boolean) => void
  trackingMap: Record<string, { status: string; startedAt: string | null; completedAt: string | null }>
  sessionMap: Record<string, string>
  onAddVehicle: () => void
  onMoveStop: (stop: UnifiedStop, fromIdx: number, toIdx: number) => void
  onReorderStop: (routeIdx: number, fromPos: number, toPos: number) => void
  onAddRoute: () => void
  onRemoveRoute: (idx: number) => void
  onUpdateRoute: (idx: number, updates: Partial<Pick<VehicleRoute, 'workStart' | 'workEnd' | 'vehicleName' | 'assignedVehicleName' | 'vehicleId' | 'hasTrailer'>>) => void
  onUpdateStop: (routeIdx: number, stopIdx: number, updates: Partial<UnifiedStop>) => void
  onAddCustomStop: (routeIdx: number, stop: UnifiedStop) => void
  onRemoveStop: (routeIdx: number, stopIdx: number) => void
}) {
  const totalStops = day.stops.length
  const minV = calcMinVehicles(totalStops, settings)

  return (
    <div className="card">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-cp-dark capitalize">{formatDay(day.date)}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {totalStops} stops — minimaal {minV} bezorger{minV !== 1 ? 's' : ''} nodig
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Bezorgerbeheer */}
            <div className="flex items-center gap-2">
              {vehicles.map((v) => (
                <span
                  key={v.id}
                  className="text-xs px-2 py-1 bg-gray-100 rounded text-gray-600"
                  title={v.licensePlate ?? ''}
                >
                  {v.hasTrailer ? '🚛' : '🚐'} {v.name}
                </span>
              ))}
              <button
                onClick={() => onSetShowAddVehicle(!showAddVehicle)}
                className="text-xs px-2.5 py-1.5 rounded border border-dashed border-gray-300 hover:border-cp-blue hover:text-cp-blue"
              >
                + Bezorger
              </button>
              <button
                onClick={onAddRoute}
                className="text-xs px-2.5 py-1.5 rounded border border-gray-300 hover:border-cp-blue hover:text-cp-blue"
              >
                + Extra bezorger
              </button>
            </div>
          </div>
        </div>

        {/* Bezorger toevoegen form */}
        {showAddVehicle && (
          <div className="mt-3 flex items-end gap-3 p-3 bg-gray-50 rounded-lg">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Naam *</label>
              <input
                value={newVehicleName}
                onChange={(e) => onSetNewVehicleName(e.target.value)}
                placeholder="Bezorger 1"
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-32"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Kenteken</label>
              <input
                value={newVehiclePlate}
                onChange={(e) => onSetNewVehiclePlate(e.target.value)}
                placeholder="AB-12-CD"
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-28"
              />
            </div>
            <label className="flex items-center gap-1.5 text-sm text-gray-700 pb-1.5">
              <input
                type="checkbox"
                checked={newVehicleTrailer}
                onChange={(e) => onSetNewVehicleTrailer(e.target.checked)}
              />
              Aanhanger
            </label>
            <button
              onClick={onAddVehicle}
              disabled={!newVehicleName.trim()}
              className="btn-primary text-xs px-3 py-1.5"
            >
              Toevoegen
            </button>
            <button
              onClick={() => onSetShowAddVehicle(false)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Annuleren
            </button>
          </div>
        )}
      </div>

      {/* Lege dag */}
      {totalStops === 0 ? (
        <div className="p-12 text-center text-gray-400 text-sm">
          Geen orders of afspraken op deze dag
        </div>
      ) : routes.length === 0 ? (
        <div className="p-8 text-center text-gray-400 text-sm">
          Voeg een voertuig toe om de planning te bekijken
        </div>
      ) : (
        /* Vehicle route lanes */
        <div className="divide-y divide-gray-100">
          {routes.map((route, routeIdx) => (
            <VehicleRouteCard
              key={`${route.vehicleId ?? route.vehicleName}-${routeIdx}`}
              route={route}
              routeIdx={routeIdx}
              allRoutes={routes}
              allVehicles={vehicles}
              date={day.date}
              settings={settings}
              travelPairs={travelPairs}
              depotAddress={depotAddress}
              trackingMap={trackingMap}
              sessionMap={sessionMap}
              onMoveStop={onMoveStop}
              onReorderStop={(from, to) => onReorderStop(routeIdx, from, to)}
              onRemove={() => onRemoveRoute(routeIdx)}
              onUpdateRoute={(updates) => onUpdateRoute(routeIdx, updates)}
              onUpdateStop={(stopIdx, updates) => onUpdateStop(routeIdx, stopIdx, updates)}
              onAddCustomStop={(stop) => onAddCustomStop(routeIdx, stop)}
              onRemoveStop={(stopIdx) => onRemoveStop(routeIdx, stopIdx)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Voertuig rit kaart ───────────────────────────────────────────────────────

function VehicleRouteCard({
  route,
  routeIdx,
  allRoutes,
  allVehicles,
  date,
  settings,
  travelPairs,
  depotAddress,
  trackingMap,
  sessionMap,
  onMoveStop,
  onReorderStop,
  onRemove,
  onUpdateRoute,
  onUpdateStop,
  onAddCustomStop,
  onRemoveStop,
}: {
  route: VehicleRoute
  routeIdx: number
  allRoutes: VehicleRoute[]
  allVehicles: Vehicle[]
  date: Date
  settings: Settings
  travelPairs: TravelPairs
  depotAddress: string
  trackingMap: Record<string, { status: string; startedAt: string | null; completedAt: string | null }>
  sessionMap: Record<string, string>
  onMoveStop: (stop: UnifiedStop, fromIdx: number, toIdx: number) => void
  onReorderStop: (fromPos: number, toPos: number) => void
  onRemove: () => void
  onUpdateRoute: (updates: Partial<Pick<VehicleRoute, 'workStart' | 'workEnd' | 'vehicleName' | 'assignedVehicleName' | 'vehicleId' | 'hasTrailer'>>) => void
  onUpdateStop: (stopIdx: number, updates: Partial<UnifiedStop>) => void
  onAddCustomStop: (stop: UnifiedStop) => void
  onRemoveStop: (stopIdx: number) => void
}) {
  const [editingTimeFor, setEditingTimeFor] = useState<number | null>(null)
  const [showAddTask, setShowAddTask] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskAddress, setTaskAddress] = useState('')
  const [taskMode, setTaskMode] = useState<'window' | 'duration'>('window')
  const [taskTimeStart, setTaskTimeStart] = useState('')
  const [taskTimeEnd, setTaskTimeEnd] = useState('')
  const [taskDuration, setTaskDuration] = useState('20')

  function submitCustomTask() {
    if (!taskTitle.trim()) return
    const ds = localDateStr(date)
    const isDuration = taskMode === 'duration'
    const stop: UnifiedStop = {
      type: 'CALENDAR',
      customerName: taskTitle.trim(),
      calendarTitle: taskTitle.trim(),
      address: taskAddress.trim(),
      date: ds,
      timeWindowStart: !isDuration && taskTimeStart ? `${ds}T${taskTimeStart}:00` : undefined,
      timeWindowEnd: !isDuration && taskTimeEnd ? `${ds}T${taskTimeEnd}:00` : undefined,
      durationMin: isDuration ? (parseInt(taskDuration) || 20) : undefined,
    }
    onAddCustomStop(stop)
    setTaskTitle('')
    setTaskAddress('')
    setTaskTimeStart('')
    setTaskTimeEnd('')
    setTaskDuration('20')
    setTaskMode('window')
    setShowAddTask(false)
  }
  const [timeInputStart, setTimeInputStart] = useState('')
  const [timeInputEnd, setTimeInputEnd] = useState('')

  const dateStr = localDateStr(date)
  const vehicleId = route.vehicleId ?? route.vehicleName
  const coupledDriver = sessionMap[vehicleId] ?? null

  // Bereken welke stops over hun geplande tijd lopen (voor waarschuwing op planningspagina)
  const overdueStopKeys = useMemo(() => {
    const now = Date.now()
    const overdue = new Set<string>()
    route.stops.forEach((stop, idx) => {
      const key = deriveStopKey(stop, vehicleId, dateStr, idx)
      const t = trackingMap[key]
      if (t?.status === 'IN_PROGRESS' && t.startedAt) {
        const elapsed = now - new Date(t.startedAt).getTime()
        const planned = (stop.durationMin ?? settings.handlingMin) * 60_000
        if (elapsed > planned) overdue.add(key)
      }
    })
    return overdue
  }, [trackingMap, route.stops, vehicleId, dateStr, settings.handlingMin])

  function openTimeEdit(stopIdx: number, stop: UnifiedStop) {
    setEditingTimeFor(stopIdx)
    setTimeInputStart(stop.timeWindowStart ? stop.timeWindowStart.slice(11, 16) : '')
    setTimeInputEnd(stop.timeWindowEnd ? stop.timeWindowEnd.slice(11, 16) : '')
  }

  function saveTime(stopIdx: number) {
    const start = timeInputStart ? `${dateStr}T${timeInputStart}:00` : undefined
    const end = timeInputEnd ? `${dateStr}T${timeInputEnd}:00` : undefined
    onUpdateStop(stopIdx, { timeWindowStart: start, timeWindowEnd: end, flexible: false })
    setEditingTimeFor(null)
  }

  function clearTime(stopIdx: number) {
    onUpdateStop(stopIdx, { timeWindowStart: undefined, timeWindowEnd: undefined, flexible: false })
    setEditingTimeFor(null)
  }

  const schedule = calcSchedule(route.stops, date, settings, route.workStart, route.hasTrailer, travelPairs, depotAddress)
  const stopItems = schedule.filter((s): s is ScheduledStop => !('isDepotReturn' in s) && !('isCoupling' in s))
  const hasConflict = stopItems.some((s) => s.conflict)
  const startTime = schedule.length > 0 ? schedule[0].arrive : null
  const endTime = schedule.length > 0 ? schedule[schedule.length - 1].depart : null
  const totalMin =
    startTime && endTime
      ? Math.round((endTime.getTime() - startTime.getTime()) / 60000)
      : 0

  // Controleer of de bezorger buiten zijn werktijd uitloopt
  const lastScheduleItem = schedule.length > 0 ? schedule[schedule.length - 1] : null
  const lastIsDepot = !!lastScheduleItem && 'isDepotReturn' in lastScheduleItem && lastScheduleItem.isDepotReturn
  const workEndDate = new Date(date)
  workEndDate.setHours(route.workEnd, 0, 0, 0)
  // Als de laatste schedulepost al een depot-terugrit is, is de bezorger al thuis — geen extra reistijd nodig
  const returnEndTime = endTime
    ? (lastIsDepot ? endTime : addMinutes(endTime, settings.travelMin))
    : null
  const overTime = returnEndTime ? returnEndTime > workEndDate : false

  return (
    <div className="p-4 border-b border-gray-100 last:border-b-0">
      {/* Bezorger header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Bezorgernaam (persoon) */}
          <input
            value={route.vehicleName}
            onChange={(e) => onUpdateRoute({ vehicleName: e.target.value })}
            className="text-sm font-semibold text-cp-dark bg-transparent border-b border-transparent hover:border-gray-300 focus:border-cp-blue outline-none px-0.5 w-28"
            placeholder="Bezorger"
          />
          {/* Gekoppelde chauffeur vanuit tablet */}
          {coupledDriver && (
            <span className="inline-flex items-center gap-1 text-xs bg-green-50 border border-green-200 text-green-700 rounded-full px-2.5 py-0.5 font-medium">
              <span>👤</span> {coupledDriver}
            </span>
          )}
          {/* Auto-selector */}
          <select
            value={route.vehicleId ?? ''}
            onChange={(e) => {
              const v = allVehicles.find((v) => v.id === e.target.value)
              onUpdateRoute({
                vehicleId: v?.id ?? null,
                assignedVehicleName: v?.name ?? '',
                hasTrailer: v?.hasTrailer ?? false,
              })
            }}
            className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-600"
          >
            <option value="">— geen auto —</option>
            {allVehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.hasTrailer ? '🚛' : '🚐'} {v.name}
              </option>
            ))}
          </select>
          {hasConflict && (
            <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
              ⚠ Tijdvak conflict
            </span>
          )}
          {overTime && (
            <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
              ⚠ Loopt over werktijd
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          {/* Werktijden per bezorger */}
          <div className="flex items-center gap-1">
            <input
              type="number" min={4} max={12} value={route.workStart}
              onChange={(e) => onUpdateRoute({ workStart: parseInt(e.target.value) || 8 })}
              className="w-10 text-center border border-gray-200 rounded px-1 py-0.5 text-xs"
              title="Starttijd (uur)"
            />
            <span>–</span>
            <input
              type="number" min={10} max={22} value={route.workEnd}
              onChange={(e) => onUpdateRoute({ workEnd: parseInt(e.target.value) || 17 })}
              className="w-10 text-center border border-gray-200 rounded px-1 py-0.5 text-xs"
              title="Eindtijd (uur)"
            />
            <span className="text-gray-300">u</span>
          </div>
          {startTime && endTime && (
            <span className={overTime ? 'text-orange-500' : ''}>
              {formatTime(startTime)} – {formatTime(endTime)}
              {totalMin > 0 && (
                <span className="ml-1 text-gray-300">
                  ({Math.floor(totalMin / 60)}u{totalMin % 60 > 0 ? `${totalMin % 60}m` : ''})
                </span>
              )}
            </span>
          )}
          <span className="text-gray-300">
            {route.stops.length} stop{route.stops.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={onRemove}
            className="text-gray-300 hover:text-red-400"
            title="Verwijder bezorger (stops gaan naar bezorger 1)"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Stops — lineaire tijdlijn van boven naar beneden */}
      {route.stops.length === 0 ? (
        <p className="text-xs text-gray-300 text-center py-2">Geen stops</p>
      ) : (() => {
        let stopNumber = 0
        let stopPosition = -1  // positie in route.stops (voor ↑↓)
        return (
          <div className="px-4 pb-4 space-y-0">
            {/* Vertrekpunt */}
            <div className="flex items-center gap-2 py-2 text-xs text-gray-400">
              <span className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-base">🏭</span>
              <span>Vertrek vanaf zaak</span>
              <span className="font-medium text-gray-500">
                {(() => {
                  const depMin = route.workStart * 60 + settings.departureBufferMin
                  return `${String(Math.floor(depMin / 60)).padStart(2, '0')}:${String(depMin % 60).padStart(2, '0')}`
                })()}
              </span>
            </div>

            {schedule.map((item, idx) => {
              // ── Depot terugrit ──────────────────────────────────────────
              if ('isDepotReturn' in item && item.isDepotReturn) {
                const isKasten = item.type === 'kasten-pickup' || item.type === 'kasten-return'
                const icon = item.type === 'kasten-pickup' ? '📦' : item.type === 'kasten-return' ? '📦' : '🏭'
                const lineColor = isKasten ? 'bg-teal-200' : 'bg-amber-200'
                const cardColor = isKasten
                  ? 'bg-teal-50 border-teal-200 text-teal-700'
                  : 'bg-amber-50 border-amber-200 text-amber-700'
                const timeColor = isKasten ? 'text-teal-400' : 'text-amber-400'
                return (
                  <div key={`depot-${idx}`} className="flex gap-3 items-stretch">
                    <div className="flex flex-col items-center w-7 shrink-0">
                      <div className={`w-0.5 flex-1 ${lineColor}`} />
                      <span className="text-base my-1">{icon}</span>
                      <div className={`w-0.5 flex-1 ${lineColor}`} />
                    </div>
                    <div className={`flex-1 my-1 flex items-center gap-2 border rounded-lg px-3 py-2 text-xs ${cardColor}`}>
                      <span className="font-medium">{item.reason}</span>
                      <span className={`ml-auto shrink-0 ${timeColor}`}>{formatTime(item.arrive)} – {formatTime(item.depart)}</span>
                    </div>
                  </div>
                )
              }

              // ── Koppelwaypoint ──────────────────────────────────────────
              if ('isCoupling' in item && item.isCoupling) {
                return (
                  <div key={`coupling-${idx}`} className="flex gap-3 items-stretch">
                    <div className="flex flex-col items-center w-7 shrink-0">
                      <div className="w-0.5 flex-1 bg-blue-200" />
                      <span className="text-base my-1">🔗</span>
                      <div className="w-0.5 flex-1 bg-blue-200" />
                    </div>
                    <div className="flex-1 my-1 flex flex-col bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
                      <div className="font-medium">Aanhanger ophalen</div>
                      <div className="text-blue-500 mt-0.5">{item.address}</div>
                      <div className="text-blue-400 mt-0.5">{formatTime(item.arrive)} – {formatTime(item.depart)}</div>
                    </div>
                  </div>
                )
              }

              // ── Reguliere stop ──────────────────────────────────────────
              stopNumber++
              stopPosition++
              const sn = stopNumber
              const pos = stopPosition
              const { stop, arrive, depart, conflict } = item as ScheduledStop

              // Bepaal wat er NA deze stop volgt (direct door of terug naar zaak of niets)
              const nextItem = schedule[idx + 1]
              const isLast = !nextItem
              const nextIsDirect = nextItem && !('isDepotReturn' in nextItem) && !('isCoupling' in nextItem)

              const stopKey = deriveStopKey(stop, vehicleId, dateStr, pos)
              const tracking = trackingMap[stopKey]
              const trackStatus = tracking?.status
              const isOverdue = overdueStopKeys.has(stopKey)
              const isDone = trackStatus === 'DONE' || trackStatus === 'SKIPPED'
              const isInProgress = trackStatus === 'IN_PROGRESS'

              const dotColor = isDone
                ? 'bg-gray-400'
                : isInProgress
                ? 'bg-orange-500'
                : stop.type === 'DELIVERY'
                ? 'bg-green-500' : stop.type === 'PICKUP'
                ? 'bg-orange-500' : 'bg-purple-500'

              return (
                <div key={stop.rentmagicOrderId ?? stop.calendarEventId ?? sn} className="flex gap-3 items-stretch">
                  {/* Tijdlijn kolom */}
                  <div className="flex flex-col items-center w-7 shrink-0">
                    <div className="w-0.5 bg-gray-200 flex-none" style={{ height: '0.5rem' }} />
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 ${dotColor}`}>
                      {isDone ? '✓' : sn}
                    </div>
                    {!isLast && <div className="w-0.5 bg-gray-200 flex-1 min-h-[1rem]" />}
                  </div>

                  {/* Stop kaart */}
                  <div className={`flex-1 mb-2 rounded-lg border-l-4 p-3 ${
                    isDone ? 'bg-gray-50 border-gray-300 opacity-60' :
                    isOverdue ? 'bg-red-50 border-red-400' :
                    isInProgress ? 'bg-orange-50 border-orange-400' :
                    stopTypeBar(stop.type)
                  } ${conflict ? 'ring-1 ring-red-300' : ''}`}>
                    {/* Header: type + tijd */}
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 ${stopTypeBadge(stop.type)}`}>
                          {stopTypeLabel(stop.type)}
                        </span>
                        {isInProgress && !isOverdue && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">Bezig</span>
                        )}
                        {isOverdue && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium animate-pulse">⚠ Loopt uit</span>
                        )}
                        {isDone && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Afgerond</span>
                        )}
                      </div>
                      <span className={`text-xs shrink-0 ${conflict ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                        ≈ {formatTime(arrive)} – {formatTime(depart)}
                      </span>
                    </div>

                    {/* Naam + adres */}
                    <div className="text-sm font-semibold text-cp-dark">
                      {stop.type === 'CALENDAR' ? stop.calendarTitle : stop.customerName}
                    </div>
                    {stop.address && (
                      <div className="text-xs text-gray-500 mt-0.5">{stop.address}</div>
                    )}

                    {/* Tijdvak + inline bewerken */}
                    {editingTimeFor === pos ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                        <input
                          type="time"
                          value={timeInputStart}
                          onChange={(e) => setTimeInputStart(e.target.value)}
                          className="border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                          placeholder="Van"
                        />
                        <span className="text-gray-400">–</span>
                        <input
                          type="time"
                          value={timeInputEnd}
                          onChange={(e) => setTimeInputEnd(e.target.value)}
                          className="border border-gray-300 rounded px-1.5 py-0.5 text-xs"
                          placeholder="Tot"
                        />
                        <button
                          onClick={() => saveTime(pos)}
                          disabled={!timeInputStart}
                          className="px-2 py-0.5 bg-cp-blue text-white rounded text-xs disabled:opacity-40"
                        >
                          Ok
                        </button>
                        {stop.timeWindowStart && (
                          <button onClick={() => clearTime(pos)} className="text-gray-400 hover:text-red-400 text-xs">
                            Wis
                          </button>
                        )}
                        <button onClick={() => setEditingTimeFor(null)} className="text-gray-300 hover:text-gray-500 text-xs">
                          Annuleer
                        </button>
                      </div>
                    ) : stop.durationMin ? (
                      <div className="mt-1.5 flex items-center gap-1 text-xs text-gray-500">
                        <span>⏱</span>
                        <span>{stop.durationMin} min — flexibel ingepland</span>
                      </div>
                    ) : stop.timeWindowStart ? (
                      <div className="mt-1.5 flex items-center gap-1">
                        <div className={`text-xs flex items-center gap-1 ${conflict ? 'text-red-500 font-medium' : 'text-blue-500'}`}>
                          <span>🕐</span>
                          <span>{formatTime(new Date(stop.timeWindowStart))}{stop.timeWindowEnd ? ' – ' + formatTime(new Date(stop.timeWindowEnd)) : ''}</span>
                        </div>
                        <button
                          onClick={() => openTimeEdit(pos, stop)}
                          className="ml-1 text-gray-400 hover:text-cp-blue text-xs"
                          title="Tijdvak wijzigen"
                        >✏</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => openTimeEdit(pos, stop)}
                        className="mt-1.5 text-xs px-2 py-0.5 border border-dashed border-gray-300 rounded text-gray-400 hover:border-cp-blue hover:text-cp-blue"
                      >
                        🕐 Stel levertijd in
                      </button>
                    )}

                    {/* Aanhangertype + artikelen */}
                    {(stop.trailerType || (stop.items && stop.items.length > 0)) && (() => {
                      const hasRentalTrailer = stop.trailerType && RENTAL_TRAILER_TYPES.has(stop.trailerType)
                      const hasItems = stop.items?.some((i) => !i.isTrailer)
                      const isCombirit = hasRentalTrailer && hasItems
                      return (
                        <div className="mt-2 pt-2 border-t border-gray-200 space-y-0.5">
                          {stop.trailerType && (
                            <div className={`text-xs flex items-center gap-1.5 ${stop.tripsRequired && stop.tripsRequired > 1 ? 'text-amber-600 font-medium' : 'text-gray-500'}`}>
                              <span>{trailerIcon(stop.trailerType)}</span>
                              <span>{trailerLabel(stop.trailerType)}</span>
                              {isCombirit && (
                                <span className="ml-1 px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-600 font-medium text-[10px]">
                                  combibelading
                                </span>
                              )}
                              {stop.tripsRequired && stop.tripsRequired > 1 && (
                                <span className="ml-1 text-amber-500">⚠ {stop.tripsRequired}× ritten nodig</span>
                              )}
                            </div>
                          )}
                          {stop.items?.map((item, ii) => (
                            <div key={ii} className="text-xs text-gray-400 flex justify-between gap-2 pl-5">
                              <span className="truncate">
                                {!item.isTrailer && <span className="mr-1 text-gray-300">↳</span>}
                                {item.articleName}
                              </span>
                              <span className="shrink-0">×{item.quantity}</span>
                            </div>
                          ))}
                        </div>
                      )
                    })()}

                    {/* Volgorde + verplaatsen + verwijderen */}
                    <div className="mt-2 flex items-center gap-1">
                      <button
                        onClick={() => onReorderStop(pos, pos - 1)}
                        disabled={pos === 0}
                        className="text-xs px-1.5 py-0.5 border border-gray-200 rounded hover:border-cp-blue hover:text-cp-blue disabled:opacity-20 disabled:cursor-not-allowed"
                        title="Hoger in de rit"
                      >↑</button>
                      <button
                        onClick={() => onReorderStop(pos, pos + 1)}
                        disabled={pos === route.stops.length - 1}
                        className="text-xs px-1.5 py-0.5 border border-gray-200 rounded hover:border-cp-blue hover:text-cp-blue disabled:opacity-20 disabled:cursor-not-allowed"
                        title="Lager in de rit"
                      >↓</button>
                      {allRoutes.length > 1 && (
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            const toIdx = parseInt(e.target.value)
                            if (!isNaN(toIdx)) onMoveStop(stop, routeIdx, toIdx)
                          }}
                          className="flex-1 text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white text-gray-400"
                        >
                          <option value="" disabled>Naar bezorger…</option>
                          {allRoutes.map((r, ri) =>
                            ri !== routeIdx ? <option key={ri} value={ri}>{r.vehicleName}</option> : null
                          )}
                        </select>
                      )}
                      <button
                        onClick={() => onRemoveStop(pos)}
                        className="ml-auto text-gray-300 hover:text-red-400 text-xs px-1.5 py-0.5"
                        title="Stop verwijderen"
                      >✕</button>
                    </div>
                  </div>
                </div>
              )

              // Direct-doorrijden connector wordt getoond als de VOLGENDE item een reguliere stop is
              // (geen depot of koppeling) — dit loopt via het nextIsDirect-vlagje in de kaart zelf,
              // maar we tonen het via de tijdlijnlijn (al gedekt door de doorlopende grijze lijn)
              // Extra label "direct doorrijden" alleen als dit nuttige info is
              void nextIsDirect // gebruikt via de lijn-doortrekking
            })}

            {/* Eindpunt */}
            <div className="flex items-center gap-2 pt-1 text-xs text-gray-400">
              <span className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-base">🏁</span>
              <span>
                {returnEndTime
                  ? (lastIsDepot ? `Terug bij zaak ${formatTime(returnEndTime)}` : `Terug bij zaak ~${formatTime(returnEndTime)}`)
                  : 'Einde rit'}
              </span>
            </div>

            {/* Taak toevoegen */}
            {showAddTask ? (
              <div className="mt-3 p-3 bg-gray-50 border border-dashed border-gray-300 rounded-lg space-y-2 text-xs">
                <div className="font-medium text-gray-600">Taak toevoegen aan rit</div>
                <input
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  placeholder="Taaknaam *"
                  className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                  autoFocus
                />
                <input
                  value={taskAddress}
                  onChange={(e) => setTaskAddress(e.target.value)}
                  placeholder="Adres (optioneel)"
                  className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                />
                {/* Tijdtype toggle */}
                <div className="flex rounded border border-gray-200 overflow-hidden w-fit">
                  <button
                    onClick={() => setTaskMode('window')}
                    className={`px-3 py-1 text-xs ${taskMode === 'window' ? 'bg-cp-blue text-white' : 'bg-white text-gray-500 hover:bg-gray-100'}`}
                  >
                    Tijdvak (van – tot)
                  </button>
                  <button
                    onClick={() => setTaskMode('duration')}
                    className={`px-3 py-1 text-xs border-l border-gray-200 ${taskMode === 'duration' ? 'bg-cp-blue text-white' : 'bg-white text-gray-500 hover:bg-gray-100'}`}
                  >
                    Tijdsduur
                  </button>
                </div>
                {taskMode === 'window' ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={taskTimeStart}
                      onChange={(e) => setTaskTimeStart(e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1 text-xs"
                      placeholder="Van"
                    />
                    <span className="text-gray-400">–</span>
                    <input
                      type="time"
                      value={taskTimeEnd}
                      onChange={(e) => setTaskTimeEnd(e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1 text-xs"
                      placeholder="Tot (optioneel)"
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={480}
                      value={taskDuration}
                      onChange={(e) => setTaskDuration(e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1 text-xs w-20"
                    />
                    <span className="text-gray-500">minuten</span>
                    <span className="text-gray-400 italic">— wordt ingepland waar het past</span>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={submitCustomTask}
                    disabled={!taskTitle.trim()}
                    className="px-3 py-1 bg-cp-blue text-white rounded text-xs disabled:opacity-40"
                  >
                    Toevoegen
                  </button>
                  <button
                    onClick={() => setShowAddTask(false)}
                    className="px-3 py-1 text-gray-400 hover:text-gray-600 text-xs"
                  >
                    Annuleren
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddTask(true)}
                className="mt-2 w-full text-xs text-gray-400 hover:text-cp-blue border border-dashed border-gray-200 hover:border-cp-blue rounded py-1.5"
              >
                + Taak toevoegen
              </button>
            )}
          </div>
        )
      })()}
    </div>
  )
}
