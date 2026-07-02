# Packaging Rules

Use `scripts/package-preview.sh` when sending Master Nihongo to other people for review.

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
- unrelated projects such as personal homepage, pilgrimage tools, and older Japanese learning experiments

Large static learning corpus files are not tracked by Git. The packaging script adds the local copies of `frontend/public/nihongo.db` and `frontend/src/data/jlpt_words_seed.json` when they exist, so the preview package can still run without putting the corpus in version control.

Do not zip the whole `Documents` folder or the old `japanese-learning-app` folder for external review.
