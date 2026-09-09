# Install Share Note with Codex

Use this guide when the user asks to install Share Note. This is an agent-readable installation workflow; the user can request it in natural language without running the commands themselves. Reply in the user's language.

## 1. Check prerequisites and existing state

Run:

```sh
node --version
codex plugin add --help
codex plugin marketplace add --help
codex plugin marketplace list --json
codex plugin list --marketplace personal --json
```

Require Node.js 20 or later and a Codex CLI that supports these plugin commands. For GitHub installation, also check `git --version`. If a prerequisite is unavailable, report the specific blocker; do not claim installation succeeded or automatically upgrade the user's tools.

The repository's `.agents/plugins/marketplace.json` declares marketplace `personal` and plugin `share-note`, so the installation selector is `share-note@personal`.

Inspect existing marketplace sources and installed plugin sources before changing anything. If the matching plugin is already installed and enabled from the intended source, skip installation and verify it. A local marketplace may already point directly to this repository's `plugins/share-note` directory; that counts as a matching plugin source.

If a different marketplace named `personal` exists and does not supply this plugin from the intended source, report the name collision and ask how the user wants to resolve it. Do not remove or overwrite another marketplace. An unreadable listing or a failed command is not evidence that no marketplace or plugin exists. If the plugin is installed but disabled, report that state and use the installed Codex version's supported enable flow rather than reinstalling blindly.

## 2. Register the source and install

For a GitHub installation, register the repository if it is not already configured:

```sh
codex plugin marketplace add https://github.com/huangdijia/share-note-for-codex.git --json
```

If the user requested the current local checkout instead, use its absolute repository path as the source:

```sh
codex plugin marketplace add "/absolute/path/to/share-note-for-codex" --json
```

Replace the placeholder with the actual path. Choose one source, not both. Check the registration result before continuing, and stop on an error or unexpected marketplace identity.

Install the plugin if needed:

```sh
codex plugin add share-note@personal --json
```

The repository includes `plugins/share-note/skills/share-note/scripts/share-note.mjs`. Install the bundled plugin as-is; do not run `npm install`, rebuild the checkout, or copy only the Skill into a global skills directory. If the bundle is missing, report an incomplete distribution. Installing the plugin does not require Share Note credentials or project binding.

## 3. Verify and report

Read back the state:

```sh
codex plugin marketplace list --json
codex plugin list --marketplace personal --json
```

Confirm `share-note@personal` appears in `installed`, with `installed: true` and `enabled: true`, and its source matches the requested repository or local plugin path. Merely appearing in the available catalog does not mean it is installed. Report the installed version and any unresolved state; do not infer success solely from the add command's exit code.

Tell the user to start a new Codex conversation to discover the Skill. They can then say “请帮我绑定 Share Note” or “Help me set up Share Note” to begin the Skill's setup workflow. Installation alone does not authorize account binding or publishing a document.

This guide uses the plugin management commands exposed by the local Codex CLI. For general plugin behavior, see the [official OpenAI plugin documentation](https://developers.openai.com/codex/plugins). Command availability can vary by Codex version; use local `--help` to diagnose a mismatch rather than inventing flags.
