# Security reminders

- API credentials go only to the exact approved API origin. Page GETs never carry them, including after redirects.
- Project files cannot add trusted service origins or credential sources.
- The URL fragment is the note decryption key. Base URLs in local records deliberately omit it.
- User attachments are not encrypted by the Share Note body codec and are blocked in this release.
- Markdown inline HTML is escaped; explicit HTML and fetched page content are allow-list sanitized.
- API credentials and note keys are stored as plaintext in private local files. There is no master password or encryption at rest.
- Any process or user that can read the user-data directory can recover those secrets. POSIX permissions are `0700` for directories and `0600` for files; Windows relies on the current user's data-directory ACL.
- Local locking prevents same-client state corruption. It is not cross-client atomic concurrency or server-side exactly-once behavior.
- Enterprise failure never triggers fallback to the public service.
- Online compatibility is only established after doctor and authorized target-instance tests; packaged mock results are not live-service evidence.
- Browser-assisted setup opens only a pending record's exact API origin through the system browser. It never bypasses human verification or reads browser DOM, logs, traffic, redirects, or the clipboard; terminal completion is the sole local key-import path.
