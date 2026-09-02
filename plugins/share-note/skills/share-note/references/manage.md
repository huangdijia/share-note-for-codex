# Update, list, and delete

## Update

Create a fresh preview, then pass `projectRoot`, `recordId`, `previewId`, `expectedContentHash`, and an authorization object bound to action `update`, the preview's profile and `projectBindingHash`, that record ID, exact hash, and `encrypted` mode.

The client locks the local record, checks profile/API origin/web origin/identity binding, reads and compares the current remote baseline, preserves the remote filename and key, and generates fresh IVs. If the original is absent, changed, or the server returns another URL, it does not report an in-place update.

## List

List requires `projectRoot` and accepts optional `query`. It returns `scope: project`, fragment-free base URLs, and that project's pending-operation count for crash recovery. It does not enumerate remote account notes.

## Delete

Delete requires `projectRoot`; authorization must be bound to action `delete` and the exact project `recordId`. The client first verifies that the page matches the record, submits once, then performs bounded credential-free GET checks. `success: true` does not prove deletion. The source file, project audit record, and project note key are always preserved.
