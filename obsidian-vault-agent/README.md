# Vault Agent (Local) — an offline agent for your Obsidian vault

A zero-build Obsidian plugin that reads **all** of your notes and helps with **design ideas** and **organisation** — without sending anything to Mistral or any other API. Every computation happens inside Obsidian, on your machine.

## What it does

| Command | What you get |
| --- | --- |
| **Vault Agent: Full scan** | Writes `Agent Reports/Dashboard.md`, a dated health scan, an organization report, and an ideas & themes report into your vault, then opens the dashboard |
| **Vault Agent: Suggest links** | Notes that are semantically similar but not yet linked, as checkboxes |
| **Vault Agent: Apply checked suggestions in this note** | Tick `- [x]` boxes in the suggestions note, run this command, and real `[[wiki links]]` are appended to both notes under a `## Related` section |
| **Vault Agent: Ideas & themes** | Clusters your notes into themes (TF-IDF + cosine similarity + union-find clustering) and extracts idea lines (`idea:`, `what if`, `maybe`, `TODO`, `could`, ...) from every note |
| **Vault Agent: Organization suggestions** | Suggested MOCs per theme, folder moves, tag consolidation (case variants, single-use tags) |
| **Vault Agent: Ask the vault (local)** | Type a question → keyword search over all notes → an extractive answer note quoting the best-matching sentences with `[[links]]` to sources |
| **Vault Agent: Open dashboard** | Re-opens `Agent Reports/Dashboard.md` (hubs, stats, links to reports) |

Health scan also reports: **orphans** (notes with no links in or out), **broken links**, **stub notes**, **near-duplicates**, and **tag hygiene**.

## Install (no build step)

1. Copy these three files into a new folder in your vault:
   ```
   <your-vault>/.obsidian/plugins/vault-agent/
     manifest.json
     main.js
     styles.css
   ```
   `main.js` is fully self-contained (the analysis engine is embedded in it), so there is no second JS file to copy — this is what makes the plugin load reliably on desktop and mobile.
2. Restart Obsidian (or Settings → Community plugins → reload), then Settings → Community plugins → turn **Vault Agent (Local)** on.
3. Open the command palette and run **Vault Agent: Full scan**.

Requires Obsidian 1.4+. Works on desktop and mobile. No dependencies, no `npm install`, no build.

### "Failed to load plugin" troubleshooting

- Make sure the folder `.obsidian/plugins/vault-agent/` contains **all three** files, especially `manifest.json` and `main.js`, and that you restarted Obsidian after copying.
- Turn off **Restricted mode** (Settings → Community plugins) if it is on.
- To see the exact error: press Ctrl/Cmd+Shift+I → Console tab, then reload the plugin. If the console shows a module error mentioning `engine` or `require`, you are running an older copy from before the plugin became single-file — re-copy the current `main.js`.
- On very old Obsidian versions (< 1.4) the plugin is rejected with a version message instead — update Obsidian.
- `file name cannot contain any of the following \\ / : * ? " < > |` means a report filename contained an illegal character — fixed in current `main.js` (all generated names are sanitized, including timestamps, which previously contained `:`). Re-copy the latest `main.js`.

## Privacy guarantee

- The plugin contains **no network code at all**: no `fetch`, no `XMLHttpRequest`, no sockets, no `http`/`https` requires, no URLs, no API keys. You can verify this yourself:
  ```
  grep -nE "fetch|XMLHttpRequest|WebSocket|https?://" .obsidian/plugins/vault-agent/main.js
  ```
  The test suite (`npm test`) enforces this automatically.
- All analysis (parsing, TF-IDF, graph, clustering, search) runs in the Obsidian process on your device. Nothing is uploaded, synced to a server, or logged anywhere.
- If you ever want a local LLM on top (e.g. Ollama running on your own machine), that stays on-device too — but this plugin ships without any LLM by design.

## How it works

- `main.js` — single self-contained file = analysis engine + Obsidian wrapper (why: Obsidian only guarantees loading the single `main.js` entry point; multi-file plugins with relative `require()` fail on mobile and some desktop builds, which shows up as "failed to load plugin"). The engine is pure and dependency-free (also unit-tested in Node via an `obsidian` stub):
  - parses frontmatter, `[[wiki links]]`, `#tags`, headings, code-fence-stripped text
  - builds the link graph (outlinks, backlinks, orphans, broken links)
  - TF-IDF vectors per note (smoothed idf, L2-normalized), cosine similarity
  - link suggestions (similar + not already linked), near-duplicate detection
  - theme clustering via union-find over similar pairs, labeled by top shared terms
  - idea extraction with strong/weak marker weighting
  - extractive local "answers": rank notes by query similarity, quote the best sentence from each
- Obsidian wrapper (same file): ribbon icon, commands, settings tab, report writing, checkbox-apply of suggested links.
- `test/fixture-vault/` — a 15-note demo vault; `npm run demo` prints the generated reports so you can see the output format before installing. `test/plugin.test.js` smoke-loads the plugin against a mock Obsidian API and verifies all commands register.

## Settings

Report folder, link/theme/duplicate thresholds (sliders), stub word count, excluded folders. The report folder is always excluded from scans so reports don't analyze themselves.

## Development

```
npm test      # 15 unit tests incl. a privacy test that fails if network code appears
npm run demo  # run the engine against the fixture vault and print reports
```
