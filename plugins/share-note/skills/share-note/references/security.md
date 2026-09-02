# Security reminders

- API credentials go only to the exact approved API origin. Page GETs never carry them, including after redirects.
- Project files cannot add trusted service origins or credential sources.
- The URL fragment is the note decryption key. Base URLs in local records deliberately omit it.
- User attachments are not encrypted by the Share Note body codec and are blocked in this release.
- Markdown inline HTML is escaped; explicit HTML and fetched page content are allow-list sanitized.
- The encrypted local vault uses scrypt and AES-256-GCM on Windows, Linux, and macOS. It never calls Keychain or another OS credential manager.
- The vault master password is process-scoped and never saved. Missing/wrong passwords and tampered ciphertext fail closed; losing it is unrecoverable.
- Private file permissions reduce accidental exposure but are not isolation from every process running as the same OS user. On Windows, the user-data ACL replaces POSIX mode semantics.
- Local locking prevents same-client state corruption. It is not cross-client atomic concurrency or server-side exactly-once behavior.
- Enterprise failure never triggers fallback to the public service.
- Online compatibility is only established after doctor and authorized target-instance tests; packaged mock results are not live-service evidence.
