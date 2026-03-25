/**
 * Bepaalt een stabiele sleutel voor een stop, gebruikt door zowel de tablet als de planningspagina.
 * - RM-order of kalender-event → hun eigen ID
 * - Handmatige taak → positie-gebaseerde sleutel (fragiel bij herordening, maar acceptabel)
 */
export function deriveStopKey(stop: {
  rentmagicOrderId?: string | null
  calendarEventId?: string | null
}, vehicleId: string, date: string, idx: number): string {
  if (stop.rentmagicOrderId) return stop.rentmagicOrderId
  if (stop.calendarEventId) return stop.calendarEventId
  return `manual:${vehicleId}:${date}:${idx}`
}
