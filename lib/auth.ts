export const COOKIE_NAME = 'session'
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 7 // 7 dagen

/**
 * Bereken het verwachte sessie-token als HMAC(APP_PASSWORD, SESSION_SECRET).
 * Deterministisch: geen sessie-store nodig. Werkt in Edge én Node runtime.
 */
export async function computeSessionToken(): Promise<string> {
  const password = process.env.APP_PASSWORD ?? ''
  const secret = process.env.SESSION_SECRET ?? ''
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(password))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
