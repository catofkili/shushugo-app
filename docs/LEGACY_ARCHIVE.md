# Legacy Archive

The old vocabulary web/Python project has been archived on the `legacy-learning-app` branch.

That branch is kept only for historical reference. It is not the active app, should not be used for packaging, and should not receive new product work.

The ShuShuGo iOS app lives at the repository root in:

- `frontend/`
- `frontend/ios/`
- `cloudflare-sync/`
- `scripts/`
- `docs/`

Do not infer the active product line from the default branch name. As of 2026-09-11, the complete product line is `feat/fsrs-sync-accounts`; local and remote `main` still point to the 2026-07-31 baseline and are 39 commits behind it. `main` must not be used for development, packaging, or release until those commits have been reviewed and integrated. Always verify `git branch --show-current`, `git status --short --branch`, and the branch divergence before building.
