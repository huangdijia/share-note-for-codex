# Security reminders

- API credentials go only to the exact approved API origin. Page GETs never carry them, including after redirects.
- Project files cannot add trusted service origins or credential sources.
- The URL fragment is the note decryption key. Base URLs in local records deliberately omit it.
- API credentials remain in the private user-data directory. Per-note fragment keys are plaintext in `.openai/share-note.keys.json`; `.openai/.gitignore` excludes that file, but cannot protect a key that was already committed or copied.
- Validated local PNG, JPEG, GIF and WebP images are embedded inside encrypted bodies by default. Explicit public updates upload images separately; their URLs and bytes are public without a note key. Project/allowed-root checks, a combined source-and-image size limit, and preview dependency hashes apply. Remote images, SVG, raw HTML image embeds and active embeds remain blocked.
- Markdown inline HTML is escaped; explicit HTML and fetched page content are allow-list sanitized. Only bundled, scoped article CSS is injected after sanitization; arbitrary user styles remain disallowed. Encryption and content hashes cover the entire styled fragment.
- API credentials and note keys are stored as plaintext in separate private local files. There is no master password or encryption at rest.
- Any process or user that can read the user-data directory can recover API credentials; any process or user that can read the project key file can recover that project's note keys. POSIX secret-file permissions are `0600`; Windows relies on the current user's data-directory and checkout ACLs.
- Local locking prevents same-client state corruption. It is not cross-client atomic concurrency or server-side exactly-once behavior.
- Enterprise failure never triggers fallback to the public service.
- Online compatibility is only established after doctor and authorized target-instance tests; packaged mock results are not live-service evidence.
- Manual browser setup uses the system browser and hidden terminal input. Explicit Codex browser setup returns the exact pending authorization URL for the in-app browser and permits reading only that approved page token. The URL/UID and token may enter agent tool context; never claim zero session exposure. Neither mode bypasses human verification or reads logs, traffic, history, or the clipboard. Codex completion accepts the token through a child-process environment or explicit non-echoing `--key-tty` input and validates a project-bound session before saving; no token goes in request files or CLI results.

- Public mode is authorized per preview/update, never by silently changing profile defaults. Uploaded image URLs must be validated against the configured web origin and supported asset path; API credentials never accompany image downloads. Uploaded image leftovers are reported, not deleted through the HTML-only delete endpoint.
