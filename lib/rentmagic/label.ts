import { auditLog } from '@/lib/utils/audit'

const BASE_URL = process.env.RENTMAGIC_BASE_URL?.replace(/\/$/, '') ?? ''

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (process.env.RENTMAGIC_BEARER_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.RENTMAGIC_BEARER_TOKEN}`
  } else if (process.env.RENTMAGIC_API_KEY) {
    headers['X-API-Key'] = process.env.RENTMAGIC_API_KEY
  }
  return headers
}

/**
 * Patch alleen het CUST_Label veld van een factuur.
 * Gebruikt als standalone retry voor PARTIAL_SUCCESS gevallen.
 */
export async function patchInvoiceLabel(
  invoiceId: string,
  transactionId: string
): Promise<boolean> {
  const body = { CustomFields: { CUST_Label: 'Betaald' } }

  try {
    const res = await fetch(`${BASE_URL}/api/v2/invoices/${invoiceId}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(body),
    })

    const response = await res.clone().json().catch(() => ({ _raw: 'non-json' }))

    await auditLog({
      action: 'PATCH_INVOICE_LABEL_RETRY',
      entityType: 'Invoice',
      entityId: invoiceId,
      payload: { transactionId, body },
      response,
      success: res.ok,
      errorMsg: res.ok ? undefined : `HTTP ${res.status}`,
    })

    return res.ok
  } catch (err) {
    await auditLog({
      action: 'PATCH_INVOICE_LABEL_RETRY',
      entityType: 'Invoice',
      entityId: invoiceId,
      payload: { transactionId, body },
      response: null,
      success: false,
      errorMsg: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}
