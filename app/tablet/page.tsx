'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type StopStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'SKIPPED'
type TrailerType = 'KOELAANHANGER' | 'VRIESAANHANGER' | 'CONTAINER' | 'REEFER' | 'KASTENAANHANGER' | 'REGULIER' | 'ITEM'
type TabView = 'ritten' | 'leaderboard'

interface StopTracking { status: StopStatus; startedAt: string | null; completedAt: string | null }

interface TabletStop {
  stopKey: string
  rentmagicOrderId?: string
  calendarEventId?: string
  calendarTitle?: string
  customerName: string
  address: string
  date: string
  timeWindowStart?: string
  timeWindowEnd?: string
  durationMin?: number
  type: string
  trailerType?: TrailerType
  couplingAddress?: string
  tracking: StopTracking | null
}

interface TabletRoute {
  vehicleId: string | null
  vehicleName: string
  assignedVehicleName: string
  hasTrailer: boolean
  workStart: number
  workEnd: number
  stops: TabletStop[]
  totalKm?: number  // Berekend door planner via Google Maps
}

interface LeaderboardEntry {
  driverName: string
  totalKm: number
  totalStops: number
  days: number
  lastDate: string
  damageFreeKm: number
  rewardsEarned: number
  rewardKm: number
  rewardEur: number
}

interface Settings {
  handlingMin: number; travelMin: number; startHour: number
  workdayHours: number; departureBufferMin: number
}

type TravelPairs = Record<string, number>

interface ScheduledStop { isDepotReturn?: false; isCoupling?: false; stop: TabletStop; arrive: Date; depart: Date; conflict: boolean }
interface DepotWaypoint { isDepotReturn: true; type: 'kasten-pickup' | 'kasten-return' | 'rental'; reason: string; arrive: Date; depart: Date }
interface CouplingWaypoint { isCoupling: true; address: string; arrive: Date; depart: Date }
type ScheduleItem = ScheduledStop | DepotWaypoint | CouplingWaypoint

// ─── Schedule helpers ─────────────────────────────────────────────────────────

const RENTAL_TRAILER_TYPES = new Set<TrailerType>(['KOELAANHANGER', 'VRIESAANHANGER', 'CONTAINER', 'REEFER', 'REGULIER'])

function addMinutes(d: Date, min: number): Date { return new Date(d.getTime() + min * 60000) }

function calcSchedule(stops: TabletStop[], date: Date, settings: Settings, workStartHour?: number, hasTrailer?: boolean, travelPairs?: TravelPairs, depotAddress?: string): ScheduleItem[] {
  const DEPOT_PREP_MIN = 15
  const fallbackTravel = hasTrailer ? Math.round(settings.travelMin * 1.15) : settings.travelMin
  function legTravel(from: string, to: string): number {
    if (travelPairs && from && to) { const real = travelPairs[`${from}|${to}`]; if (real !== undefined) return hasTrailer ? Math.ceil(real * 1.15) : real }
    return fallbackTravel
  }
  const depot = depotAddress ?? ''
  const base = new Date(date); base.setHours(workStartHour ?? settings.startHour, 0, 0, 0)
  let current = addMinutes(base, settings.departureBufferMin)
  let currentAddress = depot; let atDepot = true
  const result: ScheduleItem[] = []
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]; const prevStop = stops[i - 1]; const nextStop = stops[i + 1]; const hasNextStop = !!nextStop
    const needsKasten = stop.trailerType === 'KASTENAANHANGER'
    const prevNeedsKasten = prevStop?.trailerType === 'KASTENAANHANGER'
    const nextNeedsKasten = nextStop?.trailerType === 'KASTENAANHANGER'
    if (needsKasten && !prevNeedsKasten) {
      const toDepot = atDepot ? 0 : legTravel(currentAddress, depot)
      const depotArrive = addMinutes(current, toDepot); const depotDepart = addMinutes(depotArrive, DEPOT_PREP_MIN)
      result.push({ isDepotReturn: true, type: 'kasten-pickup', reason: 'Kastenaanhanger pakken', arrive: depotArrive, depart: depotDepart })
      current = depotDepart; currentAddress = depot
    }
    if (stop.couplingAddress && stop.type !== 'PICKUP') {
      const t = legTravel(currentAddress, stop.couplingAddress)
      const couplingArrive = addMinutes(current, t); const couplingDepart = addMinutes(couplingArrive, 20)
      result.push({ isCoupling: true, address: stop.couplingAddress, arrive: couplingArrive, depart: couplingDepart })
      current = couplingDepart; currentAddress = stop.couplingAddress
    }
    const t = legTravel(currentAddress, stop.address); let arrive = addMinutes(current, t)
    if (stop.timeWindowStart) { const winStart = new Date(stop.timeWindowStart); winStart.setFullYear(base.getFullYear(), base.getMonth(), base.getDate()); if (arrive < winStart) arrive = new Date(winStart) }
    const depart = addMinutes(arrive, stop.durationMin ?? settings.handlingMin)
    let conflict = false
    if (stop.timeWindowEnd) { const winEnd = new Date(stop.timeWindowEnd); winEnd.setFullYear(base.getFullYear(), base.getMonth(), base.getDate()); if (arrive > winEnd) conflict = true }
    result.push({ stop, arrive, depart, conflict }); atDepot = false; currentAddress = stop.address
    const isRentalTrailer = stop.trailerType && RENTAL_TRAILER_TYPES.has(stop.trailerType)
    if (needsKasten && (!hasNextStop || !nextNeedsKasten)) {
      const depotArrive = addMinutes(depart, legTravel(stop.address, depot)); const depotDepart = addMinutes(depotArrive, DEPOT_PREP_MIN)
      result.push({ isDepotReturn: true, type: 'kasten-return', reason: 'Kastenaanhanger terugzetten', arrive: depotArrive, depart: depotDepart })
      current = depotDepart; currentAddress = depot; atDepot = true
    } else if (isRentalTrailer && hasNextStop) {
      const depotArrive = addMinutes(depart, legTravel(stop.address, depot)); const depotDepart = addMinutes(depotArrive, DEPOT_PREP_MIN)
      result.push({ isDepotReturn: true, type: 'rental', reason: stop.type === 'DELIVERY' ? 'Terug naar zaak — nieuwe aanhanger ophalen' : 'Terug naar zaak — aanhanger afzetten', arrive: depotArrive, depart: depotDepart })
      current = depotDepart; currentAddress = depot; atDepot = true
    } else { current = depart }
  }
  return result
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: Settings = { handlingMin: 60, travelMin: 45, startHour: 8, workdayHours: 9, departureBufferMin: 15 }

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtTime(d: Date): string { return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) }
function fmtIso(iso?: string | null): string { if (!iso) return ''; return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) }
function elapsedMin(startedAt: string | null): number { if (!startedAt) return 0; return Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000) }
function stopTypeBadge(type: string) { if (type === 'PICKUP') return 'bg-orange-100 text-orange-700'; if (type === 'DELIVERY') return 'bg-green-100 text-green-700'; return 'bg-purple-100 text-purple-700' }
function stopTypeLabel(type: string) { if (type === 'PICKUP') return '↩ Retour'; if (type === 'DELIVERY') return '🚚 Uitlevering'; return '📅 Agenda' }

// ─── Component ────────────────────────────────────────────────────────────────

export default function TabletPage() {
  const [date, setDate] = useState(todayStr)
  const [routes, setRoutes] = useState<TabletRoute[]>([])
  const [weekStart, setWeekStart] = useState('')
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const [tabView, setTabView] = useState<TabView>('ritten')

  // Per-route chauffeursnamen: vehicleId → naam
  const [routeDriverNames, setRouteDriverNames] = useState<Record<string, string>>({})
  const [drivers, setDrivers] = useState<{ id: string; name: string }[]>([])
  const [showDriverPicker, setShowDriverPicker] = useState<string | null>(null) // vehicleId waarvoor picker open is
  const clearedDriversRef = useRef<Set<string>>(new Set()) // vids waar chauffeur bewust gewist is
  const loadedDateRef = useRef<string>('')                 // bijhouden voor welke datum de state geladen is
  const [recentNames, setRecentNames] = useState<string[]>([])

  const [testMode, setTestMode] = useState(true) // TODO: terugzetten naar false na testen

  // Dag afsluiten
  const [showCloseDay, setShowCloseDay] = useState(false)
  const [kmInput, setKmInput] = useState('')
  const [driverNameForClose, setDriverNameForClose] = useState('')
  const [dayClosing, setDayClosing] = useState(false)
  const [dayClosed, setDayClosed] = useState(false)

  // Leaderboard
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [leaderboardLoading, setLeaderboardLoading] = useState(false)
  const [showSpelregels, setShowSpelregels] = useState(false)

  const load = useCallback(async () => {
    // Bij datumwissel: reset gewiste namen zodat DB-waarden van nieuwe datum gewoon hersteld worden
    if (loadedDateRef.current !== date) {
      clearedDriversRef.current.clear()
      loadedDateRef.current = date
    }
    try {
      const [routesRes, sessionsRes] = await Promise.all([
        fetch(`/api/tablet/routes?date=${date}`),
        fetch(`/api/tablet/driver-session?date=${date}`),
      ])
      const routesData = await routesRes.json() as { routes: TabletRoute[]; weekStart: string }
      const sessionsData = await sessionsRes.json() as { sessions: { vehicleId: string | null; vehicleName: string | null; driverName: string }[] }
      const newRoutes: TabletRoute[] = routesData.routes ?? []
      setRoutes(newRoutes)
      setWeekStart(routesData.weekStart ?? '')
      setLastRefresh(new Date())
      setSelectedVehicle((prev) =>
        prev && newRoutes.some((r) => (r.vehicleId ?? r.vehicleName) === prev)
          ? prev
          : newRoutes[0]?.vehicleId ?? newRoutes[0]?.vehicleName ?? null
      )
      // Herstel chauffeurskoppelingen voor deze datum vanuit DB
      // Volledig vervangen (geen merge) zodat namen van andere dagen niet blijven hangen
      const nameMap: Record<string, string> = {}
      for (const s of sessionsData.sessions ?? []) {
        const key = s.vehicleId ?? s.vehicleName
        if (key && s.driverName && !clearedDriversRef.current.has(key)) nameMap[key] = s.driverName
      }
      setRouteDriverNames(nameMap)
    } finally {
      setLoading(false)
    }
  }, [date])

  // Laad bezorgers + recente namen bij opstarten
  useEffect(() => {
    fetch('/api/drivers').then((r) => r.json()).then((d) => setDrivers(d.drivers ?? [])).catch(() => {})
    fetch(`/api/tablet/driver-session?date=${todayStr()}`)
      .then((r) => r.json())
      .then((d) => setRecentNames(d.recentNames ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => { load(); const id = setInterval(load, 30_000); return () => clearInterval(id) }, [load])
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 60_000); return () => clearInterval(id) }, [])

  async function loadLeaderboard() {
    setLeaderboardLoading(true)
    try {
      const res = await fetch('/api/tablet/leaderboard')
      const data = await res.json()
      setLeaderboard(data.leaderboard ?? [])
    } finally {
      setLeaderboardLoading(false)
    }
  }

  function openCloseDay() {
    const vid = selectedVehicle ?? ''
    setDriverNameForClose(routeDriverNames[vid] ?? '')
    setKmInput('')
    setShowCloseDay(true)
  }

  async function closeDay() {
    if (!driverNameForClose.trim()) return
    setDayClosing(true)
    const activeRoute = routes.find((r) => (r.vehicleId ?? r.vehicleName) === selectedVehicle)
    const stopsCompleted = activeRoute?.stops.filter((s) => s.tracking?.status === 'DONE').length ?? 0
    await fetch('/api/tablet/driver-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date,
        driverName: driverNameForClose.trim(),
        vehicleName: activeRoute?.assignedVehicleName ?? null,
        vehicleId: activeRoute?.vehicleId ?? null,
        kmDriven: activeRoute?.totalKm ?? (kmInput ? parseInt(kmInput) : null),
        stopsCompleted,
      }),
    })
    // Sla naam op voor dit voertuig
    if (selectedVehicle) setRouteDriverNames((prev) => ({ ...prev, [selectedVehicle]: driverNameForClose.trim() }))
    setDayClosing(false)
    setShowCloseDay(false)
    setDayClosed(true)
    // Voeg naam toe aan recente namen
    setRecentNames((prev) => [driverNameForClose.trim(), ...prev.filter((n) => n !== driverNameForClose.trim())].slice(0, 20))
  }

  async function updateStatus(stop: TabletStop, vehicleId: string, status: StopStatus) {
    setPendingKey(stop.stopKey)
    try {
      await fetch(`/api/tablet/stops/${encodeURIComponent(stop.stopKey)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStart, vehicleId, status }),
      })
      await load()
    } finally {
      setPendingKey(null)
    }
  }

  const activeRoute = routes.find((r) => (r.vehicleId ?? r.vehicleName) === selectedVehicle) ?? null

  const schedule = useMemo(() => {
    if (!activeRoute) return []
    const dateObj = new Date(date + 'T12:00:00')
    return calcSchedule(activeRoute.stops, dateObj, DEFAULT_SETTINGS, activeRoute.workStart, activeRoute.hasTrailer)
  }, [activeRoute, date])

  const allStopsDone = !!activeRoute && activeRoute.stops.length > 0 && activeRoute.stops.every((s) => s.tracking?.status === 'DONE' || s.tracking?.status === 'SKIPPED')

  const isToday = date === todayStr() || testMode

  // Alleen de echte stops (geen depot/koppeling) in volgorde, voor de volgorde-check
  const scheduledStops = useMemo(
    () => schedule.filter((item): item is ScheduledStop => !('isDepotReturn' in item) && !('isCoupling' in item)),
    [schedule]
  )

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen bg-gray-50 text-[#083046] text-xl font-medium">Laden…</div>
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col" style={{ fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div className="bg-[#083046] px-5 py-3 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-white font-bold text-xl tracking-tight">PinguinPlanner</div>
            <div className="text-blue-200 text-xs mt-0.5">
              {new Date(date + 'T12:00:00').toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
          </div>
          <input
            type="date" value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-white/10 border border-white/20 text-white text-sm rounded px-3 py-1.5 ml-1"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTestMode((v) => !v)}
            className={`text-xs px-2 py-1 rounded border transition-all ${testMode ? 'bg-orange-500 border-orange-400 text-white' : 'border-white/20 text-white/40 hover:text-white/70'}`}
            title="Testmodus: afvinken ook op andere datums"
          >
            {testMode ? 'TEST AAN' : 'TEST'}
          </button>
          <div className="flex items-center gap-1.5 text-xs text-blue-200">
            <span className="w-2 h-2 rounded-full bg-[#01b902] animate-pulse inline-block" />
            {lastRefresh && fmtIso(lastRefresh.toISOString())}
          </div>
        </div>
      </div>

      {/* Tab navigatie */}
      <div className="flex bg-white border-b border-gray-200">
        <button
          onClick={() => setTabView('ritten')}
          className={`flex-1 py-3 text-sm font-semibold transition-colors border-b-2 ${tabView === 'ritten' ? 'border-[#2c80b3] text-[#2c80b3]' : 'border-transparent text-gray-500 hover:text-[#083046]'}`}
        >
          🐧 Mijn ritten
        </button>
        <button
          onClick={() => { setTabView('leaderboard'); loadLeaderboard() }}
          className={`flex-1 py-3 text-sm font-semibold transition-colors border-b-2 ${tabView === 'leaderboard' ? 'border-[#2c80b3] text-[#2c80b3]' : 'border-transparent text-gray-500 hover:text-[#083046]'}`}
        >
          🏆 Leaderboard
        </button>
      </div>

      {/* ── Leaderboard tab ── */}
      {tabView === 'leaderboard' && (
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ background: 'linear-gradient(160deg, #0d0820 0%, #1a0a35 50%, #0a1628 100%)' }}>
          <style>{`
            @keyframes shimmer { 0%{background-position:200% center} 100%{background-position:-200% center} }
            @keyframes jackpot-pulse { 0%,100%{box-shadow:0 0 20px 4px #f59e0b88} 50%{box-shadow:0 0 40px 16px #f59e0bcc} }
            @keyframes bar-shimmer { 0%{background-position:-200px 0} 100%{background-position:200px 0} }
            @keyframes coin-float-1 { 0%,100%{transform:translateY(0px) rotate(-15deg)} 50%{transform:translateY(-8px) rotate(10deg)} }
            @keyframes coin-float-2 { 0%,100%{transform:translateY(0px) rotate(20deg)} 50%{transform:translateY(-12px) rotate(-5deg)} }
            @keyframes coin-float-3 { 0%,100%{transform:translateY(0px) rotate(-5deg)} 50%{transform:translateY(-6px) rotate(25deg)} }
            @keyframes coin-float-4 { 0%,100%{transform:translateY(0px) rotate(30deg)} 50%{transform:translateY(-10px) rotate(-20deg)} }
            @keyframes euro-glow { 0%,100%{text-shadow:0 0 20px #f59e0b,0 0 40px #f59e0b} 50%{text-shadow:0 0 40px #fde68a,0 0 80px #f59e0b,0 0 120px #d97706} }
            .shimmer-text { background: linear-gradient(90deg, #f59e0b, #fde68a, #f59e0b, #fde68a); background-size: 200% auto; -webkit-background-clip: text; -webkit-text-fill-color: transparent; animation: shimmer 2s linear infinite; }
            .jackpot-card { animation: jackpot-pulse 1.5s ease-in-out infinite; }
            .bar-shine { background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent); background-size: 200px 100%; animation: bar-shimmer 1.8s linear infinite; }
            .coin-1 { animation: coin-float-1 2.1s ease-in-out infinite; }
            .coin-2 { animation: coin-float-2 1.8s ease-in-out infinite; }
            .coin-3 { animation: coin-float-3 2.4s ease-in-out infinite; }
            .coin-4 { animation: coin-float-4 1.6s ease-in-out infinite; }
            .euro-glow { animation: euro-glow 1.5s ease-in-out infinite; }
          `}</style>

          {/* Header met prijsbord */}
          <div className="px-5 pt-8 pb-6 text-center">
            <div className="text-3xl font-black text-white tracking-widest mb-5 uppercase" style={{ letterSpacing: '0.2em' }}>🐧 PinguinPlanner Challenge</div>

            {/* Altijd zichtbaar prijsbord */}
            <div className="relative inline-flex items-center justify-center mx-auto mb-3">
              {/* Munten rondom */}
              <span className="coin-1 absolute text-3xl" style={{ left: '-18px',  top: '-18px' }}>🪙</span>
              <span className="coin-2 absolute text-2xl" style={{ left: '10px',   top: '-28px' }}>🪙</span>
              <span className="coin-3 absolute text-3xl" style={{ right: '-14px', top: '-22px' }}>🪙</span>
              <span className="coin-4 absolute text-2xl" style={{ right: '8px',   top: '-30px' }}>🪙</span>
              <span className="coin-2 absolute text-2xl" style={{ left: '-20px',  bottom: '-16px' }}>🪙</span>
              <span className="coin-1 absolute text-3xl" style={{ right: '-18px', bottom: '-20px' }}>🪙</span>
              <span className="coin-3 absolute text-2xl" style={{ left: '30px',   bottom: '-26px' }}>🪙</span>
              <span className="coin-4 absolute text-xl"  style={{ right: '35px',  bottom: '-24px' }}>🪙</span>

              {/* Bord */}
              <div className="jackpot-card relative px-10 py-4 rounded-3xl text-center"
                style={{
                  background: 'linear-gradient(135deg, #2d1200, #7c3a00, #5c2a00, #3d1800)',
                  border: '3px solid #d97706',
                  boxShadow: '0 0 0 1.5px #f59e0b, inset 0 1px 0 rgba(255,220,100,0.25), 0 8px 32px #f59e0b44',
                }}>
                <div className="euro-glow font-black text-yellow-300 leading-none"
                  style={{ fontSize: '3.5rem', fontFamily: 'Georgia, serif', textShadow: '0 2px 8px rgba(0,0,0,0.9), 0 0 30px #f59e0b' }}>
                  €{leaderboard[0]?.rewardEur ?? 100}
                </div>
                <div className="shimmer-text text-sm font-black tracking-[0.3em] uppercase mt-1">beloning</div>
              </div>
            </div>

            <p className="text-xs mt-8" style={{ color: '#7c6fa0' }}>
              Rijd <span className="text-purple-300 font-bold">{(leaderboard[0]?.rewardKm ?? 4000).toLocaleString('nl-NL')} km</span> schadevrij en win!
            </p>

            {/* Spelregels */}
            <button
              onClick={() => setShowSpelregels((v) => !v)}
              className="mt-4 text-xs px-4 py-2 rounded-full border transition-all"
              style={{ borderColor: '#3d2f6a', color: '#a78bfa', background: showSpelregels ? '#1e1340' : 'transparent' }}
            >
              {showSpelregels ? '▲ Spelregels verbergen' : '▼ Spelregels bekijken'}
            </button>

            {showSpelregels && (
              <div className="mt-4 mx-auto max-w-sm text-left rounded-2xl px-5 py-4 text-sm space-y-3"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #2a1f50' }}>
                <div className="text-purple-300 font-bold text-base mb-1">Spelregels</div>
                <div className="flex gap-3 items-start">
                  <span className="text-xl shrink-0">🎯</span>
                  <p style={{ color: '#c4b5fd' }}>Rijd <strong className="text-white">{(leaderboard[0]?.rewardKm ?? 4000).toLocaleString('nl-NL')} km</strong> schadevrij en ontvang <strong className="text-yellow-300">€{leaderboard[0]?.rewardEur ?? 100}</strong>. Je kunt dit <strong className="text-white">onbeperkt</strong> herhalen!</p>
                </div>
                <div className="flex gap-3 items-start">
                  <span className="text-xl shrink-0">🎁</span>
                  <p style={{ color: '#c4b5fd' }}>Bij je eerste keer krijg je een <strong className="text-white">welkomstbonus van 100 km</strong> cadeau.</p>
                </div>
                <div className="flex gap-3 items-start">
                  <span className="text-xl shrink-0">⚠️</span>
                  <p style={{ color: '#c4b5fd' }}><strong className="text-orange-300">Schade gemeld?</strong> Je behoudt je schadevrije km tot een maximum van <strong className="text-white">500 km</strong> (mits je die al gereden hebt).</p>
                </div>
                <div className="flex gap-3 items-start">
                  <span className="text-xl shrink-0">💥</span>
                  <p style={{ color: '#c4b5fd' }}><strong className="text-red-400">Schade niet gemeld?</strong> Je teller wordt gereset naar <strong className="text-white">0 km</strong>.</p>
                </div>
              </div>
            )}
          </div>

          {leaderboardLoading ? (
            <div className="text-center py-12" style={{ color: '#7c3aed' }}>Laden…</div>
          ) : leaderboard.length === 0 ? (
            <div className="text-center py-12 text-gray-500">Nog geen data</div>
          ) : (
            <div className="px-4 pb-8 space-y-3 max-w-lg mx-auto">
              {leaderboard.map((entry, i) => {
                const pct = Math.min(100, (entry.damageFreeKm / entry.rewardKm) * 100)
                const reached = entry.damageFreeKm >= entry.rewardKm
                const barColor = reached
                  ? 'linear-gradient(90deg, #f59e0b, #fde68a, #f59e0b)'
                  : pct >= 75
                  ? 'linear-gradient(90deg, #ef4444, #f97316, #eab308)'
                  : pct >= 40
                  ? 'linear-gradient(90deg, #7c3aed, #2563eb)'
                  : 'linear-gradient(90deg, #374151, #4b5563)'
                const cardBg = reached
                  ? 'linear-gradient(135deg, #1c1200, #2d1f00)'
                  : 'linear-gradient(135deg, #0f0f1a, #171728)'
                const cardBorder = reached ? '#f59e0b' : '#1e1e3a'

                return (
                  <div
                    key={entry.driverName}
                    className={reached ? 'jackpot-card rounded-2xl p-4' : 'rounded-2xl p-4'}
                    style={{ background: cardBg, border: `1.5px solid ${cardBorder}` }}
                  >
                    {/* Gewonnen banner */}
                    {reached && (
                      <div className="text-center mb-3">
                        <span className="shimmer-text text-base font-black tracking-widest">🎉 BELONING VERDIEND! 🎉</span>
                      </div>
                    )}

                    <div className="flex items-center gap-3 mb-3">
                      {/* Status badge */}
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl shrink-0 ${reached ? 'bg-yellow-400' : 'bg-gray-800'}`}
                        style={reached ? { boxShadow: '0 0 14px #f59e0b88' } : {}}>
                        {reached ? '🏆' : '🛡'}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="font-black text-lg text-white leading-tight">{entry.driverName}</div>
                        <div className="text-xs mt-0.5" style={{ color: '#6b7280' }}>
                          {entry.totalKm.toLocaleString('nl-NL')} km totaal · {entry.totalStops} stops
                          {entry.rewardsEarned > 0 && <span className="ml-1 text-yellow-600">· {entry.rewardsEarned}× gewonnen</span>}
                        </div>
                      </div>

                      {/* Km counter */}
                      <div className="text-right shrink-0">
                        <div className={`text-2xl font-black ${reached ? 'text-yellow-400' : 'text-white'}`}>{entry.damageFreeKm.toLocaleString('nl-NL')}</div>
                        <div className="text-xs" style={{ color: '#6b7280' }}>/ {entry.rewardKm.toLocaleString('nl-NL')} km</div>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="font-bold" style={{ color: reached ? '#f59e0b' : pct >= 75 ? '#f97316' : '#a78bfa' }}>
                          {reached ? '🏆' : pct >= 75 ? '🔥' : pct >= 40 ? '⚡' : '🛡'}{' '}
                          {entry.damageFreeKm.toLocaleString('nl-NL')} km
                        </span>
                        <span className="font-black text-base" style={{ color: reached ? '#f59e0b' : pct >= 75 ? '#f97316' : '#6b7280' }}>
                          {Math.round(pct)}%
                        </span>
                      </div>
                      <div className="w-full rounded-full h-7 overflow-hidden relative" style={{ background: '#0d0d1f', border: '1px solid #2a2a4a' }}>
                        <div className="h-7 rounded-full relative overflow-hidden transition-all duration-700"
                          style={{ width: `${Math.max(pct, 3)}%`, background: barColor }}>
                          <div className="bar-shine absolute inset-0" />
                        </div>
                        {/* Milestone ticks */}
                        {[25, 50, 75].map((tick) => (
                          <div key={tick} className="absolute top-0 bottom-0 w-0.5" style={{ left: `${tick}%`, background: 'rgba(255,255,255,0.12)' }} />
                        ))}
                        {/* Finish lijn */}
                        <div className="absolute top-0 bottom-0 right-0 w-1 rounded-r-full" style={{ background: reached ? '#f59e0b' : '#3a3a6a' }} />
                      </div>
                      <div className="flex justify-between text-xs mt-1 px-0.5" style={{ color: '#374151' }}>
                        <span>0</span><span>{(entry.rewardKm * 0.25 / 1000).toFixed(0)}k</span><span>{(entry.rewardKm * 0.5 / 1000).toFixed(0)}k</span><span>{(entry.rewardKm * 0.75 / 1000).toFixed(0)}k</span><span>{(entry.rewardKm / 1000).toFixed(0)}k</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Ritten tab ── */}
      {tabView === 'ritten' && (
        routes.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2">
            <span className="text-4xl">📋</span>
            <span className="text-lg font-medium">Geen ritten gepland voor deze dag</span>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">

            {/* Vehicle tabs */}
            <div className="flex border-b border-gray-200 bg-white shadow-sm overflow-x-auto">
              {routes.map((r) => {
                const vid = r.vehicleId ?? r.vehicleName
                const done = r.stops.filter((s) => s.tracking?.status === 'DONE' || s.tracking?.status === 'SKIPPED').length
                const total = r.stops.length
                const active = vid === selectedVehicle
                return (
                  <button
                    key={vid}
                    onClick={() => setSelectedVehicle(vid)}
                    className={`flex-1 min-w-[130px] py-3 px-3 text-center transition-all border-b-2 ${active ? 'border-[#2c80b3] text-[#083046] bg-[#e8f3fa]' : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-[#083046]'}`}
                  >
                    <div className="font-semibold text-sm">{r.vehicleName}</div>
                    {r.assignedVehicleName && <div className={`text-xs mt-0.5 ${active ? 'text-[#2c80b3]' : 'text-gray-400'}`}>🚐 {r.assignedVehicleName}</div>}
                    <div className={`text-xs mt-0.5 font-medium ${done === total && total > 0 ? 'text-[#01b902]' : active ? 'text-[#2c80b3]' : 'text-gray-400'}`}>{done}/{total} stops</div>
                  </button>
                )
              })}
            </div>

            {activeRoute && (
              <div className="flex-1 overflow-y-auto">
                {/* Chauffeur / auto banner */}
                {(() => {
                  const vid = activeRoute.vehicleId ?? activeRoute.vehicleName
                  const driverName = routeDriverNames[vid] ?? ''
                  return (
                    <>
                      <div className="bg-[#083046] text-white px-5 py-3 flex flex-wrap items-center gap-3 text-sm">
                        {activeRoute.assignedVehicleName && (
                          <div className="flex items-center gap-2">
                            <span className="text-blue-300">{activeRoute.hasTrailer ? '🚛' : '🚐'}</span>
                            <span className="font-medium">{activeRoute.assignedVehicleName}</span>
                            {activeRoute.hasTrailer && <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full">met aanhanger</span>}
                          </div>
                        )}
                        <button
                          onClick={() => setShowDriverPicker(showDriverPicker === vid ? null : vid)}
                          className="ml-auto flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg px-3 py-1.5 transition-colors"
                        >
                          <span className="text-blue-300 text-xs">👤</span>
                          <span className={`text-sm ${driverName ? 'text-white font-medium' : 'text-white/50'}`}>
                            {driverName || 'Chauffeur selecteren…'}
                          </span>
                          <span className="text-white/40 text-xs ml-1">▾</span>
                        </button>
                        <div className="text-blue-300 text-xs">Dienst {String(activeRoute.workStart).padStart(2, '0')}:00 – {String(activeRoute.workEnd).padStart(2, '0')}:00</div>
                      </div>

                      {/* Chauffeur picker */}
                      {showDriverPicker === vid && (
                        <div className="bg-white border-b border-gray-200 px-4 py-4">
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Selecteer chauffeur</div>
                          {drivers.length === 0 ? (
                            <p className="text-sm text-gray-400">Geen bezorgers aangemaakt. Voeg ze toe via de ritplanning.</p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {drivers.map((d) => (
                                <button
                                  key={d.id}
                                  onClick={() => {
                                    clearedDriversRef.current.delete(vid)
                                    setRouteDriverNames((prev) => ({ ...prev, [vid]: d.name }))
                                    setShowDriverPicker(null)
                                    // Sla koppeling op in DB zodat het een refresh overleeft
                                    void fetch('/api/tablet/driver-session', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        date,
                                        driverName: d.name,
                                        vehicleName: activeRoute.assignedVehicleName ?? null,
                                        vehicleId: vid,
                                        stopsCompleted: 0,
                                      }),
                                    })
                                  }}
                                  className={`px-4 py-2.5 rounded-xl border-2 font-medium text-sm transition-colors ${driverName === d.name ? 'bg-[#083046] border-[#083046] text-white' : 'border-gray-200 text-[#083046] hover:border-[#2c80b3] hover:bg-[#e8f3fa]'}`}
                                >
                                  {driverName === d.name && <span className="mr-1.5">✓</span>}
                                  {d.name}
                                </button>
                              ))}
                              {driverName && (
                                <button
                                  onClick={() => {
                                    clearedDriversRef.current.add(vid)
                                    setRouteDriverNames((prev) => { const next = { ...prev }; delete next[vid]; return next })
                                    setShowDriverPicker(null)
                                  }}
                                  className="px-4 py-2.5 rounded-xl border-2 border-dashed border-gray-200 text-gray-400 text-sm hover:border-red-200 hover:text-red-400 transition-colors"
                                >
                                  ✕ Wissen
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )
                })()}

                {/* Dag afsluiten banner */}
                {allStopsDone && !dayClosed && !showCloseDay && (
                  <div className="mx-4 mt-4 p-4 bg-[#01b902]/10 border-2 border-[#01b902] rounded-xl flex items-center justify-between">
                    <div>
                      <div className="font-bold text-[#083046]">Alle stops afgerond! 🎉</div>
                      <div className="text-sm text-gray-500">Sluit de dag af om je kilometers te registreren.</div>
                    </div>
                    <button onClick={openCloseDay} className="px-5 py-2.5 bg-[#01b902] hover:bg-green-600 text-white font-bold rounded-xl text-sm shadow-sm">
                      Dag afsluiten
                    </button>
                  </div>
                )}
                {dayClosed && (
                  <div className="mx-4 mt-4 p-4 bg-green-50 border border-green-200 rounded-xl text-center text-green-700 font-medium">
                    ✓ Dag afgesloten — goed gedaan!
                  </div>
                )}

                {/* Dag afsluiten modal */}
                {showCloseDay && (
                  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6">
                    <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">
                      <h2 className="text-xl font-bold text-[#083046] mb-1">Dag afsluiten</h2>
                      <p className="text-sm text-gray-500 mb-5">Selecteer de chauffeur om de dag af te sluiten.</p>

                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Chauffeur</label>
                      {drivers.length === 0 ? (
                        <input
                          type="text"
                          value={driverNameForClose}
                          onChange={(e) => setDriverNameForClose(e.target.value)}
                          placeholder="Naam chauffeur…"
                          autoFocus
                          className="w-full border-2 border-gray-200 focus:border-[#2c80b3] rounded-xl px-4 py-3 text-base text-[#083046] outline-none mb-4"
                        />
                      ) : (
                        <div className="flex flex-wrap gap-2 mb-4">
                          {drivers.map((d) => (
                            <button
                              key={d.id}
                              onClick={() => setDriverNameForClose(d.name)}
                              className={`px-4 py-2.5 rounded-xl border-2 font-medium text-sm transition-colors ${driverNameForClose === d.name ? 'bg-[#083046] border-[#083046] text-white' : 'border-gray-200 text-[#083046] hover:border-[#2c80b3] hover:bg-[#e8f3fa]'}`}
                            >
                              {driverNameForClose === d.name && <span className="mr-1.5">✓</span>}
                              {d.name}
                            </button>
                          ))}
                        </div>
                      )}

                      {(() => {
                        const activeRoute = routes.find((r) => (r.vehicleId ?? r.vehicleName) === selectedVehicle)
                        const km = activeRoute?.totalKm
                        return km !== undefined ? (
                          <div className="mb-6 rounded-xl bg-[#083046]/5 border border-[#083046]/10 px-4 py-3 flex items-center justify-between">
                            <span className="text-sm text-gray-500">Gereden kilometers (berekend)</span>
                            <span className="text-2xl font-bold text-[#083046]">{km} km</span>
                          </div>
                        ) : (
                          <div className="mb-6">
                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Gereden kilometers</label>
                            <input
                              type="number"
                              min="0"
                              value={kmInput}
                              onChange={(e) => setKmInput(e.target.value)}
                              placeholder="bv. 85"
                              className="w-full border-2 border-gray-200 focus:border-[#2c80b3] rounded-xl px-4 py-3 text-base text-[#083046] outline-none"
                            />
                          </div>
                        )
                      })()}

                      <div className="flex gap-3">
                        <button onClick={() => setShowCloseDay(false)} className="flex-1 py-3 rounded-xl border-2 border-gray-200 text-gray-500 font-medium">Annuleer</button>
                        <button onClick={closeDay} disabled={dayClosing || !driverNameForClose.trim()} className="flex-1 py-3 rounded-xl bg-[#01b902] hover:bg-green-600 text-white font-bold disabled:opacity-50">
                          {dayClosing ? 'Opslaan…' : 'Opslaan ✓'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Timeline */}
                <div className="p-4 max-w-2xl mx-auto">
                  <div className="flex items-center gap-3 py-3 text-sm text-gray-500">
                    <span className="w-10 h-10 rounded-full bg-[#083046] text-white flex items-center justify-center text-lg shrink-0">🏭</span>
                    <div>
                      <div className="font-medium text-[#083046]">Vertrek vanaf zaak</div>
                      <div className="text-xs text-gray-400">
                        {(() => { const m = activeRoute.workStart * 60 + DEFAULT_SETTINGS.departureBufferMin; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` })()}
                      </div>
                    </div>
                  </div>

                  {(() => {
                    let stopNumber = 0
                    return schedule.map((item, idx) => {
                      if ('isDepotReturn' in item && item.isDepotReturn) {
                        const isKasten = item.type === 'kasten-pickup' || item.type === 'kasten-return'
                        return (
                          <div key={`depot-${idx}`} className="flex gap-3 items-stretch">
                            <div className="flex flex-col items-center w-10 shrink-0">
                              <div className={`w-0.5 flex-1 ${isKasten ? 'bg-teal-200' : 'bg-amber-200'}`} />
                              <span className="text-xl my-1">🚛</span>
                              <div className={`w-0.5 flex-1 ${isKasten ? 'bg-teal-200' : 'bg-amber-200'}`} />
                            </div>
                            <div className={`flex-1 my-2 flex items-center gap-3 border rounded-xl px-4 py-3 text-sm ${isKasten ? 'bg-teal-50 border-teal-200 text-teal-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                              <span className="font-semibold">{item.reason}</span>
                              <span className="ml-auto text-xs shrink-0 opacity-70">{fmtTime(item.arrive)} – {fmtTime(item.depart)}</span>
                            </div>
                          </div>
                        )
                      }
                      if ('isCoupling' in item && item.isCoupling) {
                        return (
                          <div key={`coupling-${idx}`} className="flex gap-3 items-stretch">
                            <div className="flex flex-col items-center w-10 shrink-0">
                              <div className="w-0.5 flex-1 bg-blue-200" />
                              <span className="text-xl my-1">🔗</span>
                              <div className="w-0.5 flex-1 bg-blue-200" />
                            </div>
                            <div className="flex-1 my-2 border rounded-xl px-4 py-3 text-sm bg-blue-50 border-blue-200 text-blue-800">
                              <div className="font-semibold">Aanhanger ophalen</div>
                              <div className="text-xs text-blue-600 mt-0.5">{item.address}</div>
                              <div className="text-xs text-blue-400 mt-0.5">{fmtTime(item.arrive)} – {fmtTime(item.depart)}</div>
                            </div>
                          </div>
                        )
                      }
                      stopNumber++
                      const sn = stopNumber
                      const schedStop = item as ScheduledStop
                      const stop = schedStop.stop
                      const status = stop.tracking?.status ?? 'PENDING'
                      const vid = activeRoute.vehicleId ?? activeRoute.vehicleName
                      const isPending = status === 'PENDING'
                      const isInProgress = status === 'IN_PROGRESS'
                      const isDone = status === 'DONE' || status === 'SKIPPED'
                      const elapsed = isInProgress ? elapsedMin(stop.tracking?.startedAt ?? null) : 0
                      const isLast = idx === schedule.length - 1
                      // Volgorde: alle vorige stops moeten DONE/SKIPPED zijn
                      const stopIdx = sn - 1
                      const previousAllDone = scheduledStops.slice(0, stopIdx).every(
                        (s) => s.stop.tracking?.status === 'DONE' || s.stop.tracking?.status === 'SKIPPED'
                      )
                      return (
                        <div key={stop.stopKey} className="flex gap-3 items-stretch">
                          <div className="flex flex-col items-center w-10 shrink-0">
                            <div className="w-0.5 bg-gray-200 flex-none h-2" />
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0 ${isDone ? 'bg-[#01b902]' : isInProgress ? 'bg-orange-500' : 'bg-[#2c80b3]'}`}>
                              {isDone ? '✓' : sn}
                            </div>
                            {!isLast && <div className="w-0.5 bg-gray-200 flex-1 min-h-[1rem]" />}
                          </div>
                          <div className={`flex-1 mb-3 rounded-xl border-l-4 shadow-sm overflow-hidden ${isDone ? 'bg-gray-50 border-gray-300 opacity-60' : isInProgress ? 'bg-orange-50 border-orange-400' : schedStop.conflict ? 'bg-red-50 border-red-400' : stop.type === 'DELIVERY' ? 'bg-white border-[#01b902]' : stop.type === 'PICKUP' ? 'bg-white border-orange-400' : 'bg-white border-purple-400'}`}>
                            <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stopTypeBadge(stop.type)}`}>{stopTypeLabel(stop.type)}</span>
                                  {isInProgress && <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">Bezig — {elapsed} min</span>}
                                  {isDone && <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Afgerond</span>}
                                  {schedStop.conflict && !isDone && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">⚠ Tijdvak overschreden</span>}
                                </div>
                                <div className={`text-base font-bold leading-tight ${isDone ? 'text-gray-400 line-through' : 'text-[#083046]'}`}>
                                  {stop.type === 'CALENDAR' ? stop.calendarTitle : stop.customerName}
                                </div>
                                {stop.address && <div className="text-sm text-gray-500 mt-0.5">{stop.address}</div>}
                              </div>
                              <div className="text-right shrink-0">
                                <div className="text-sm font-semibold text-[#083046]">
                                  {stop.timeWindowStart ? fmtIso(stop.timeWindowStart) : `≈ ${fmtTime(schedStop.arrive)}`}
                                  {stop.timeWindowEnd ? ` – ${fmtIso(stop.timeWindowEnd)}` : ` – ${fmtTime(schedStop.depart)}`}
                                </div>
                                <div className="text-xs text-gray-400">{stop.timeWindowStart ? 'tijdvak' : 'gepland'}</div>
                              </div>
                            </div>
                            {isDone && isToday && (
                              <div className="px-4 pb-3 pt-1">
                                <button onClick={() => updateStatus(stop, vid, 'PENDING')} disabled={pendingKey === stop.stopKey} className="w-full py-2.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-400 hover:text-gray-600 font-medium text-sm transition-all disabled:opacity-50">
                                  {pendingKey === stop.stopKey ? '…' : '↩ Ongedaan maken'}
                                </button>
                              </div>
                            )}
                            {!isDone && isToday && (
                              <div className="px-4 pb-4 pt-1 flex gap-2">
                                {isPending && previousAllDone && (
                                  <button onClick={() => updateStatus(stop, vid, 'IN_PROGRESS')} disabled={pendingKey === stop.stopKey} className="flex-1 py-3 rounded-lg bg-[#2c80b3] hover:bg-[#236994] active:scale-[0.98] text-white font-semibold text-base transition-all disabled:opacity-50 shadow-sm">
                                    {pendingKey === stop.stopKey ? '…' : 'Start rit'}
                                  </button>
                                )}
                                {isPending && !previousAllDone && (
                                  <div className="flex-1 py-3 rounded-lg bg-gray-100 text-gray-400 font-medium text-sm text-center">
                                    Wacht op vorige rit
                                  </div>
                                )}
                                {isInProgress && (
                                  <button onClick={() => updateStatus(stop, vid, 'DONE')} disabled={pendingKey === stop.stopKey} className="flex-1 py-3 rounded-lg bg-[#01b902] hover:bg-green-600 active:scale-[0.98] text-white font-semibold text-base transition-all disabled:opacity-50 shadow-sm">
                                    {pendingKey === stop.stopKey ? '…' : 'Rit afgerond ✓'}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })
                  })()}

                  <div className="flex items-center gap-3 py-3 text-sm text-gray-400 mt-2">
                    <span className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-lg shrink-0">🏁</span>
                    <div className="font-medium">Einde dienst — terug naar zaak</div>
                  </div>

                  {!allStopsDone && !dayClosed && (
                    <div className="mt-4 pb-6">
                      <button onClick={openCloseDay} className="w-full py-3 rounded-xl border-2 border-gray-200 text-gray-400 hover:border-[#2c80b3] hover:text-[#2c80b3] font-medium text-sm transition-colors">
                        Dag afsluiten
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      )}
    </div>
  )
}
