import { ShareNoteError } from '../errors.js'

const MAXIMUM_HIDDEN_INPUT_CHARACTERS = 16_384

export async function readHiddenInput(
  prompt: string,
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stderr
): Promise<string> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    throw new ShareNoteError(
      'secure_store_unavailable',
      'Hidden setup input requires an interactive local terminal'
    )
  }
  output.write(prompt)
  const wasRaw = input.isRaw === true
  return new Promise<string>((resolve, reject) => {
    let value = ''
    let settled = false

    const cleanup = (): void => {
      input.off('data', onData)
      input.setRawMode?.(wasRaw)
      input.pause()
      output.write('\n')
    }
    const finish = (result?: string, error?: ShareNoteError): void => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(result ?? '')
    }
    const onData = (chunk: string | Buffer): void => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\r' || character === '\n') {
          finish(value)
          return
        }
        if (character === '\u0003' || character === '\u0004') {
          finish(undefined, new ShareNoteError('invalid_request', 'Hidden setup input was cancelled'))
          return
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1)
          continue
        }
        value += character
        if (value.length > MAXIMUM_HIDDEN_INPUT_CHARACTERS) {
          value = ''
          finish(undefined, new ShareNoteError('invalid_request', 'Hidden setup input is too long'))
          return
        }
      }
    }

    input.setRawMode(true)
    input.resume()
    input.on('data', onData)
  })
}
