export const PROTOCOL_PROFILE = {
  id: 'note-sx-client-1.5.5',
  headerVersion: '1.5.5',
  writeCodec: 'aes-gcm-random-ivs-v1.5',
  chunkSizeUtf16: 2_000,
  auth: 'sha256(nonce + apiKey)',
  routes: {
    doctor: '/v1/file/check-files',
    create: '/v1/file/create-note',
    delete: '/v1/file/delete'
  }
} as const

export type ProtocolProfile = typeof PROTOCOL_PROFILE

export interface NoteTemplate {
  filename?: string
  title?: string
  description?: string
  width: string
  elements: Array<{
    element: string
    classes: string[]
    style: string
  }>
  encrypted: boolean
  content: string
  mathJax: boolean
}

export interface CreateNoteRequest {
  filename?: string
  filetype: 'html'
  hash: string
  template: NoteTemplate
}

export interface DeleteNoteRequest {
  filename: string
  filetype: 'html'
}
