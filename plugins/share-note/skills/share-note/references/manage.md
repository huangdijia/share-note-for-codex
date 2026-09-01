# Update, list, and delete

## Update

Create a fresh preview, then pass `recordId`, `previewId`, `expectedContentHash`, `workspaceRoot`, and an authorization object bound to action `update`, that record ID, exact hash, and `encrypted` mode.

The client locks the local record, checks profile/API origin/web origin/identity binding, reads and compares the current remote baseline, preserves the remote filename and key, and generates fresh IVs. If the original is absent, changed, or the server returns another URL, it does not report an in-place update.

## List

List accepts optional `profile` and `query`. It returns `scope: local`, redacted base URLs, and a pending-operation count for crash recovery. It does not enumerate remote account notes.

## Delete

Delete authorization must be bound to action `delete` and the exact `recordId`. The client first verifies that the page matches the record, submits once, then performs bounded credential-free GET checks. `success: true` does not prove deletion. The source file and local audit record are always preserved.
