export type OperationStatus =
  | 'configured'
  | 'healthy'
  | 'previewed'
  | 'verified'
  | 'submitted_unverified'
  | 'unknown'
  | 'failed'
  | 'blocked'
  | 'already_absent'

export interface BaseResult {
  ok: boolean
  action: string
  status: OperationStatus
  warnings: string[]
}
