# Packaging Rules

Use `scripts/package-preview.sh` when sending Master Nihongo to other people for review.

The script locates the project root by looking upward for the Master Nihongo markers (`frontend/package.json`, `cloudflare-sync/wrangler.jsonc`, and `frontend/src`). If needed, override this with:

```bash
PROJECT_DIR=/path/to/master-nihongo-ios /path/to/package-preview.sh
```

The preview package is allowlisted. It includes only:

- iOS app shell and frontend source
- Cloudflare Worker source and migrations
- selected project docs
- package manifests and build scripts
- bundled learning database needed by the app

It intentionally excludes:

- `.git`, `.claude`, `.vscode`
- `node_modules`, `dist`, `.wrangler`
- `.env.local` and secrets
- old archive notes
- unrelated sibling projects and local experiments

Learning corpus files are owned by this repository. The preview package includes `frontend/public/nihongo.db` and the seed JSON files from `frontend/src/data/`; it does not read from old sibling projects.

For database boundaries, see `docs/DATABASES.md`.

Do not zip the whole `Documents` folder for external review.
