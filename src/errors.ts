export type ErrorCode =
  | 'invalid_request'
  | 'configuration_missing'
  | 'credential_missing'
  | 'secure_store_unavailable'
  | 'source_blocked'
  | 'content_blocked'
  | 'network_error'
  | 'authentication_failed'
  | 'protocol_error'
  | 'verification_failed'
  | 'conflict'
  | 'not_found'

export class ShareNoteError extends Error {
  readonly code: ErrorCode
  readonly details?: Record<string, string | number | boolean>

  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, string | number | boolean>,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'ShareNoteError'
    this.code = code
    if (details) this.details = details
  }
}

export function toSafeError(error: unknown): {
  code: ErrorCode
  message: string
  details?: Record<string, string | number | boolean>
} {
  if (error instanceof ShareNoteError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {})
    }
  }
  return {
    code: 'protocol_error',
    message: error instanceof Error ? error.message : 'Unexpected Share Note client error'
  }
}
