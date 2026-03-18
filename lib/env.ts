/**
 * Server-side environment variable validatie.
 * Geïmporteerd door lib/db.ts en lib/rentmagic/client.ts zodat
 * ontbrekende variabelen direct bij opstart zichtbaar zijn, niet pas
 * bij de eerste API-aanroep.
 */

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `[env] Vereiste environment variable "${name}" ontbreekt. ` +
      `Voeg deze toe aan je Vercel project settings (Settings → Environment Variables).`
    )
  }
  return value
}

export function validateServerEnv() {
  requireEnv('DATABASE_URL')
  requireEnv('RENTMAGIC_BASE_URL')
  requireEnv('RENTMAGIC_API_KEY')
}

// Exporteer getters zodat andere modules de waarden kunnen gebruiken
// zonder ze opnieuw uit process.env te lezen.
export const env = {
  get DATABASE_URL() { return requireEnv('DATABASE_URL') },
  get RENTMAGIC_BASE_URL() { return requireEnv('RENTMAGIC_BASE_URL') },
  get RENTMAGIC_API_KEY() { return requireEnv('RENTMAGIC_API_KEY') },
  get IMPORT_TTL_HOURS() { return parseInt(process.env.IMPORT_TTL_HOURS ?? '2', 10) },
}
