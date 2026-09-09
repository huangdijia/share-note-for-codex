# Security reminders

- API credentials go only to the exact approved API origin. Page GETs never carry them, including after redirects.
- Project files cannot add trusted service origins or credential sources.
- The URL fragment is the note decryption key. Base URLs in local records deliberately omit it.
- API credentials remain in the private user-data directory. Per-note fragment keys are plaintext in `.openai/share-note.keys.json`; `.openai/.gitignore` excludes that file, but cannot protect a key that was already committed or copied.
- User attachments are not encrypted by the Share Note body codec and are blocked in this release.
- Markdown inline HTML is escaped; explicit HTML and fetched page content are allow-list sanitized. Only bundled, scoped article CSS is injected after sanitization; arbitrary user styles remain disallowed. Encryption and content hashes cover the entire styled fragment.
- API credentials and note keys are stored as plaintext in separate private local files. There is no master password or encryption at rest.
- Any process or user that can read the user-data directory can recover API credentials; any process or user that can read the project key file can recover that project's note keys. POSIX secret-file permissions are `0600`; Windows relies on the current user's data-directory and checkout ACLs.
- Local locking prevents same-client state corruption. It is not cross-client atomic concurrency or server-side exactly-once behavior.
- Enterprise failure never triggers fallback to the public service.
- Online compatibility is only established after doctor and authorized target-instance tests; packaged mock results are not live-service evidence.
- Manual browser setup uses the system browser and hidden terminal input. Explicit Codex browser setup returns the exact pending authorization URL for the in-app browser and permits reading only that approved page token. The URL/UID and token may enter agent tool context; never claim zero session exposure. Neither mode bypasses human verification or reads logs, traffic, history, or the clipboard. Codex completion accepts the token through a child-process environment or explicit non-echoing `--key-tty` input and validates a project-bound session before saving; no token goes in request files or CLI results.
