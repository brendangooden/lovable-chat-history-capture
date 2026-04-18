# Lovable Chat History Capture

Export a [Lovable](https://lovable.dev) project's chat history — user prompts, AI replies, file-edit metadata, and image attachments — into a local `chat-history/` directory you can commit to git.

Runs two ways:

1. **Locally** via the Bun CLI (`bun run export`).
2. As a **GitHub Action** so a daily cron job keeps `chat-history/` up to date in your repo.

Unofficial. Reads Lovable's public Firestore backend using your account's refresh token.

## What it captures

```
chat-history/
├── raw/                 # one JSON per user/AI message (decoded Firestore doc)
├── edits/               # per-turn edit metadata (file_path, action, commit_sha) — no file bodies
├── attachments/         # image binaries referenced by user messages
├── timeline.md          # chronological user + AI transcript, diffable in git
└── index.json           # manifest used for incremental sync
```

Incremental — only docs whose Firestore `updateTime` changed are re-downloaded.

## One-time: extract your Firebase creds

1. Open <https://lovable.dev> in Chrome / Edge / Firefox and make sure you're logged in.
2. Open DevTools → **Application** → **IndexedDB** → `firebaseLocalStorageDb` → `firebaseLocalStorage`.
3. Find the entry with key like `firebase:authUser:AIzaSy…:[DEFAULT]`.
4. Grab two values:
   - **API key** — the `AIzaSy…` segment in the key name.
   - **Refresh token** — inside the value JSON: `stsTokenManager.refreshToken`.
5. Grab your **project UUID** from the URL of the Lovable project you want to export: `lovable.dev/projects/<uuid>`.
6. Grab the **Firestore GCP project** that hosts Lovable's data: open DevTools → **Network** tab, reload the Lovable page, look at any request to `firestore.googleapis.com`. The URL contains `/projects/<firestore-project-id>/databases/(default)/...` — copy that id.

> ⚠️ The refresh token grants read access to your entire Lovable account. Treat it like a password.

## Local CLI usage

Requires [Bun](https://bun.sh) ≥ 1.1.

```bash
git clone https://github.com/brendangooden/loveable-chat-history-capture
cd loveable-chat-history-capture
bun install

cp .env.example .env
# fill in LOVABLE_FIREBASE_API_KEY, LOVABLE_REFRESH_TOKEN,
#         LOVABLE_PROJECT_ID, LOVABLE_FIRESTORE_PROJECT

bun run export
```

Output lands in `./chat-history/`. Re-run any time — only changed docs are fetched.

### CLI flags

```
lovable-chat-export [options]

  --project-id <id>          Lovable project UUID (or env LOVABLE_PROJECT_ID)
  --out <dir>                Output directory (default ./chat-history)
  --since <iso>              Only sync docs updated at/after this ISO timestamp
  --firestore-project <id>   Override Firestore project
  --lovable-api-base <url>   Override Lovable API base URL
  --env-file <path>          Load env vars from this file (default ./.env if present)
  -h, --help                 Show help
```

## GitHub Action usage

### Option A — run it in your own repo

Add repo secrets `LOVABLE_FIREBASE_API_KEY`, `LOVABLE_REFRESH_TOKEN`, `LOVABLE_PROJECT_ID`, `LOVABLE_FIRESTORE_PROJECT`, then create `.github/workflows/chat-history.yml`:

```yaml
name: Chat history sync

on:
  schedule:
    - cron: "0 6 * * *"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: brendangooden/loveable-chat-history-capture@v1
        with:
          api_key: ${{ secrets.LOVABLE_FIREBASE_API_KEY }}
          refresh_token: ${{ secrets.LOVABLE_REFRESH_TOKEN }}
          project_id: ${{ secrets.LOVABLE_PROJECT_ID }}
          firestore_project: ${{ secrets.LOVABLE_FIRESTORE_PROJECT }}
          output_dir: chat-history
      - name: Commit & push
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add chat-history
          git diff --cached --quiet && exit 0
          git commit -m "chat-history: sync $(date -u +%Y-%m-%d)"
          git push
```

### Action inputs

| input               | required | default                                | purpose                                               |
| ------------------- | -------- | -------------------------------------- | ----------------------------------------------------- |
| `api_key`           | yes      | —                                      | Firebase Web API key                                  |
| `refresh_token`     | yes      | —                                      | Refresh token from browser IndexedDB                  |
| `project_id`        | yes      | —                                      | Lovable project UUID                                  |
| `output_dir`        | no       | `chat-history`                         | Where to write output inside the workspace            |
| `firestore_project` | yes      | —                                      | Firestore GCP project hosting Lovable data            |
| `lovable_api_base`  | no       | `https://api.lovable.dev`              | Override Lovable API base (signs attachment URLs)     |
| `since`             | no       | —                                      | Only sync docs updated at/after this ISO timestamp    |
| `bun_version`       | no       | `1.1.38`                               | Bun runtime version                                   |

### Option B — fork this repo

This repo ships `.github/workflows/chat-history.yml` which does the same on a daily cron for its own checkout. Fork, set the four secrets (`LOVABLE_FIREBASE_API_KEY`, `LOVABLE_REFRESH_TOKEN`, `LOVABLE_PROJECT_ID`, `LOVABLE_FIRESTORE_PROJECT`), done.

## Multiple projects

The tool syncs one project per run. For multiple, use a matrix in your own workflow:

```yaml
strategy:
  matrix:
    project: ["uuid-1", "uuid-2"]
steps:
  - uses: brendangooden/loveable-chat-history-capture@v1
    with:
      api_key: ${{ secrets.LOVABLE_FIREBASE_API_KEY }}
      refresh_token: ${{ secrets.LOVABLE_REFRESH_TOKEN }}
      project_id: ${{ matrix.project }}
      output_dir: chat-history/${{ matrix.project }}
```

## Refresh-token rotation

Google sometimes rotates refresh tokens when you exchange them.

- **Local**: the CLI writes the new token back into your `.env` automatically.
- **Action**: GitHub Actions can't self-update a secret. The run prints a warning; if a subsequent run fails with an auth error, re-extract the token from your browser and update `LOVABLE_REFRESH_TOKEN`.

In practice this is rare — most refresh exchanges return the same token.

## Security notes

- `.env` is gitignored. Never commit it.
- The refresh token = full read access to your Lovable account. Store it only in `.env` (local) or repo secrets (Action).
- This tool only reads. It never writes to Firestore or Lovable.
- Firebase API key is public by design (it's embedded in Lovable's frontend); the refresh token is the actual credential.

## Why not use the WebChannel trace in `research/`?

`research/request_response_firebase.txt` captures Lovable's real-time `Listen/channel` traffic. Useful for reverse-engineering the schema, but session-bound and can't be replayed. This tool uses the stable Firestore REST API instead.

## License

MIT — see [LICENSE](LICENSE).
