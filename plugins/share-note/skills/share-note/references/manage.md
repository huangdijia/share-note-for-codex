# Update, list, and delete

## Update

Create a fresh preview with `projectRoot`, matching `sourcePath` and the target `recordId`, then pass `projectRoot`, `recordId`, `previewId`, `expectedContentHash`, and an authorization object bound to action `update`, the preview's profile and `projectBindingHash`, that record ID, exact hash, and the preview's encryption/image modes. Existing encrypted updates may omit `imageMode` for compatibility.

An update preview without `theme` retains the record theme, not the project default. Old records without theme metadata retain their unthemed body; only an explicit built-in `theme` migrates them. The update must target the exact preview record. Older preview metadata must be regenerated.

The client locks the local record, checks profile/API origin/web origin/identity binding, reads and compares the current remote baseline, preserves the remote filename and key, and generates fresh IVs. If the original is absent, changed, or the server returns another URL, it does not report an in-place update.

Local Markdown raster images are embedded inside encrypted bodies by default. For an existing themed record, explicitly request `encryption: "public"` and `imageMode: "upload"` on preview and authorization to publish a public body referencing separately uploaded images. Public records preserve this mode on later updates. The source still uses local image paths; the client replaces them with verified service asset URLs during the authorized write. Update rechecks the source and image dependencies against the fresh preview before writing. If an image changed or its path resolves to a different file, regenerate the preview and inspect it before updating.

## List

List requires `projectRoot` and accepts optional `query`. It returns `scope: project`, fragment-free base URLs, and that project's pending-operation count for crash recovery. It does not enumerate remote account notes.

## Delete

Delete requires `projectRoot`; authorization must be bound to action `delete` and the exact project `recordId`. The client first verifies that the page matches the record, submits once, then performs bounded credential-free GET checks. `success: true` does not prove deletion. The source file, project audit record, and project note key are always preserved.

Public conversion preserves the existing page URL. Public read-back does not decrypt; `decrypted: false` is expected for that mode, and success still requires matching title and article content. Public page links have no fragment key. Public reads and deletes must work without loading an obsolete note key, while previously stored keys remain untouched.
