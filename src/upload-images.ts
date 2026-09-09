import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5'
import { createHash } from 'node:crypto'
import type { ProfileConfig } from './config.js'
import type { ShareNoteHttpClient } from './http/client.js'
import type { PreviewMetadata } from './preview.js'
import type { ProjectStore } from './project.js'
import type { OperationRecord } from './state/store.js'
import { readSafeFile } from './source.js'
import { rasterMime } from './render/raster.js'
import { isHostedRasterUrl } from './render/sanitize.js'
import { ShareNoteError } from './errors.js'

export async function uploadPreviewImages(preview: PreviewMetadata, profile: ProfileConfig, project: ProjectStore, client: ShareNoteHttpClient, operation: OperationRecord): Promise<string> {
  const replacements = new Map<string, string>()
  operation.imageUploads = []
  for (const dependency of preview.imageDependencies) {
    const file = await readSafeFile(dependency.path, project.projectRoot, profile.allowedSourceRoots, profile.maxSourceBytes)
    if (file.realPath !== dependency.realPath || file.sourceHash !== dependency.hash) throw new ShareNoteError('content_blocked', 'Image changed before upload')
    const mime = rasterMime(file.buffer)
    if (!mime) throw new ShareNoteError('content_blocked', 'Image is no longer a supported raster')
    const filetype = mime === 'image/jpeg' ? 'jpg' : mime.slice(6)
    const hash = createHash('sha1').update(file.buffer).digest('hex')
    const existing = await client.postJson<{ files?: Array<{ hash?: string; filetype?: string; url?: string }> }>('/v1/file/check-files', { files: [{ hash, filetype }] })
    let url = existing.files?.find((item) => item.hash === hash && item.filetype === filetype)?.url
    const image: NonNullable<OperationRecord['imageUploads']>[number] = { hash, filetype, status: 'pending' }
    operation.imageUploads.push(image)
    await project.writeOperation(operation)
    try {
      if (!url) url = (await client.uploadImage(file.buffer, filetype, hash)).url
      if (!url || !isHostedRasterUrl(url, profile.webBaseUrl) || !url.endsWith(`.${filetype}`)) throw new ShareNoteError('protocol_error', 'Upload returned an unapproved image URL')
      image.url = url
      await project.writeOperation(operation)
      const fetched = await client.getImage(url)
      if (createHash('sha256').update(fetched).digest('hex') !== dependency.hash) throw new ShareNoteError('protocol_error', 'Uploaded image bytes did not match')
      image.status = 'verified'
      await project.writeOperation(operation)
      replacements.set(`data:${mime};base64,${file.buffer.toString('base64')}`, url)
    } catch (error) {
      image.status = 'unknown'
      operation.status = 'unknown'
      operation.diagnostic = 'An image upload or verification was uncertain; no note update was sent. Reconcile the asset ledger before retrying.'
      await project.writeOperation(operation)
      throw error
    }
  }
  const fragment = parseFragment(preview.bodyHtml)
  function replaceImages(node: DefaultTreeAdapterMap['node']): void {
    if ('tagName' in node && node.tagName === 'img') {
      const src = node.attrs.find((attribute) => attribute.name === 'src')
      const replacement = src && replacements.get(src.value)
      if (src && replacement) src.value = replacement
    }
    if ('childNodes' in node) node.childNodes.forEach(replaceImages)
  }
  replaceImages(fragment)
  return serialize(fragment)
}
