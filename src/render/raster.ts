// Header checks constrain data URLs to inert raster formats and bounded dimensions.
// These are format checks, not an image decoder or a scan of pixel content.
export function rasterMime(bytes: Buffer): string | undefined {
  let mime: string | undefined
  let width = 0
  let height = 0
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    mime = 'image/png'
    width = bytes.readUInt32BE(16)
    height = bytes.readUInt32BE(20)
  } else if (bytes.length >= 14 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) {
    mime = 'image/gif'
    width = bytes.readUInt16LE(6)
    height = bytes.readUInt16LE(8)
  } else if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; offset + 4 <= bytes.length;) {
      if (bytes[offset] !== 0xff) break
      const marker = bytes[offset + 1]!
      if (marker === 0xff) { offset += 1; continue }
      if (marker === 0xda || marker === 0xd9) break
      const size = bytes.readUInt16BE(offset + 2)
      if (size < 2 || offset + size + 2 > bytes.length) break
      if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 8) {
        mime = 'image/jpeg'
        height = bytes.readUInt16BE(offset + 5)
        width = bytes.readUInt16BE(offset + 7)
        break
      }
      offset += size + 2
    }
  } else if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length) {
    const type = bytes.toString('ascii', 12, 16)
    if (type === 'VP8X') {
      mime = 'image/webp'
      width = bytes.readUIntLE(24, 3) + 1
      height = bytes.readUIntLE(27, 3) + 1
    } else if (type === 'VP8 ' && bytes.subarray(23, 26).equals(Buffer.from('9d012a', 'hex'))) {
      mime = 'image/webp'
      width = bytes.readUInt16LE(26) & 0x3fff
      height = bytes.readUInt16LE(28) & 0x3fff
    } else if (type === 'VP8L' && bytes[20] === 0x2f) {
      mime = 'image/webp'
      const bits = bytes.readUInt32LE(21)
      width = (bits & 0x3fff) + 1
      height = ((bits >>> 14) & 0x3fff) + 1
    }
  }
  return width > 0 && height > 0 && width <= 32768 && height <= 32768 && width * height <= 100_000_000 ? mime : undefined
}

export function isSafeRasterDataUri(value: string): boolean {
  if (value.length > 70 * 1024 * 1024) return false
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match || match[2]!.length % 4 !== 0) return false
  const bytes = Buffer.from(match[2]!, 'base64')
  return bytes.toString('base64') === match[2] && rasterMime(bytes) === match[1]
}
