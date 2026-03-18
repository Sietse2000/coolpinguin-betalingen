import { db } from '@/lib/db'

interface AuditParams {
  action: string
  entityType: string
  entityId: string
  payload?: unknown
  response?: unknown
  success: boolean
  errorMsg?: string
}

export async function auditLog(params: AuditParams): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        payload: params.payload ? (params.payload as object) : undefined,
        response: params.response ? (params.response as object) : undefined,
        success: params.success,
        errorMsg: params.errorMsg,
      },
    })
  } catch (err) {
    // Audit logging mag nooit de main flow blokkeren
    console.error('[AuditLog] Kon niet schrijven:', err)
  }
}
