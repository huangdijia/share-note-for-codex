# Security reminders

- API credentials go only to the exact approved API origin. Page GETs never carry them, including after redirects.
- Project files cannot add trusted service origins or credential sources.
- The URL fragment is the note decryption key. Base URLs in local records deliberately omit it.
- API credentials remain in the private user-data directory. Per-note fragment keys are plaintext in `.openai/share-note.keys.json`; `.openai/.gitignore` excludes that file, but cannot protect a key that was already committed or copied.
- User attachments are not encrypted by the Share Note body codec and are blocked in this release.
- Markdown inline HTML is escaped; explicit HTML and fetched page content are allow-list sanitized.
- API credentials and note keys are stored as plaintext in separate private local files. There is no master password or encryption at rest.
- Any process or user that can read the user-data directory can recover API credentials; any process or user that can read the project key file can recover that project's note keys. POSIX secret-file permissions are `0600`; Windows relies on the current user's data-directory and checkout ACLs.
- Local locking prevents same-client state corruption. It is not cross-client atomic concurrency or server-side exactly-once behavior.
- Enterprise failure never triggers fallback to the public service.
- Online compatibility is only established after doctor and authorized target-instance tests; packaged mock results are not live-service evidence.
- Browser-assisted setup opens only a pending record's exact API origin through the system browser. It never bypasses human verification or reads browser DOM, logs, traffic, redirects, or the clipboard; terminal completion is the sole local key-import path.
