# W1 Taro build foundation

Date: 2026-09-26\
Branch: `taro/w1-build`\
Base: `2d413f1`; merged `taro/main` at `5359577` in merge commit `aa32d4b`.

## Formal build

Taro 4.2.1 compiled 20 webpack entry points. Final package totals below are from `reports/package-sizes.json`; the cap is 1,900,000 bytes per package.

| Package | Bytes | Remaining to cap |
| --- | ---: | ---: |
| main | 1,868,488 | 31,512 |
| quiz | 75,266 | 1,824,734 |
| study | 381,251 | 1,518,749 |
| features | 661,703 | 1,238,297 |
| content | 1,619,451 | 280,549 |
| grammar-foundation | 668,448 | 1,231,552 |
| grammar-advanced | 547,372 | 1,352,628 |
| grammar-pages | 240,490 | 1,659,510 |
| **Total** | **6,062,469** | — |

The package gate passes: all 8 packages are under the cap; duplicated `frontend/src/lib/` and `ts-fsrs` modules: 0; repeated page-component module bytes: 66,888 B of the 100,000 B allowance; `wechat-miniprogram/src/shared/web.js` modules: 0. The `web.js` check is a hard failure. The full duplicate-module list is in `reports/package-gates.json`.

The 10 largest modules assigned to main in webpack stats are:

| Module | Bytes |
| --- | ---: |
| `taro-spike-2/node_modules/ts-fsrs/dist/index.mjs` | 60,657 |
| `taro-spike-2/node_modules/@tarojs/plugin-framework-react/dist/runtime.js` | 40,901 |
| `taro-spike-2/node_modules/@tarojs/react/dist/react.esm.js` | 34,644 |
| `frontend/src/lib/grammar-title-furigana.ts` | 33,342 |
| `taro-spike-2/node_modules/@tarojs/plugin-platform-weapp/dist/runtime.js` | 27,737 |
| `frontend/src/lib/speech.ts` | 20,385 |
| `taro-spike-2/node_modules/tslib/tslib.es6.mjs` | 17,648 |
| `taro-spike-2/node_modules/@tarojs/plugin-html/dist/runtime.js` | 14,818 |
| `frontend/src/lib/token-dictionary.ts` | 12,208 |
| `frontend/src/lib/share-canvas.ts` | 10,022 |

These are webpack module source sizes; package asset bytes in `package-sizes.json` are the authoritative package measurements. Main grew 7,581 B after adding 20 SVG variants for 10 icons that were missing from the WeChat icon adapter. The final build has no missing-icon warnings. Webpack still emits its 244 KiB per-asset advisory and `NoAsyncChunksWarning`; neither represents a package-gate failure.

## Async content and WASM

The Taro loader has the same load/ready/readyForKanji/primeWebLoaders order as the native loader: hydrate `content-store` first; `ready()` loads the shared content and both grammar roots; `readyForKanji()` then loads the two kanji datasets and primes the four frontend loaders. A failed load removes its promise from the in-flight map so a later call can retry. All 10 literal `require.async` calls resolve from `common.js` to existing files: 8 existing content targets and 2 JLPT grammar targets. `npm test` runs that path check and the package gate.

The 1,509,579 B grammar source is split by JLPT level: N5/N4/N3 has 409 entries and is 667,905 B; N2/N1 has 360 entries and is 546,833 B. The six compile-probe modules are `GrammarFoundationPage`, `Library`, `ImmersiveGrammar`, `FavoritesPage`, `GrammarDetail`, and `ConfusionPage`; all appear in webpack stats.

WASM source: 659,730 B; Brotli q11 output: 278,641 B; saved: 381,089 B. Node decompression restored a byte-identical 659,730 B buffer, and `WebAssembly.compile` passed. This confirms the asset, not its Developer Tools runtime loading path.

## Removing native `web.js`

After merging W3, webpack stats showed the `web.js` issuer chain as `WordStudy route → frontend entitlements shim → wechat-miniprogram runtime/entitlements.js → core/study-core.js → shared/web.js` (module source size 1,009,912 B). In this checkout, the import of native `shared/content.js` was already redirected to the Taro loader, so that was not the `web.js` edge recorded in stats. The Taro config now redirects the native entitlement runtime to `src/platform/entitlements.weapp.cjs`, which reads the same `entitlement_cache` key through frontend `database/db-utils` and uses the shared pure normalizer; W4-owned native login/payment files were not changed. The Taro database runtime imports the Taro content loader directly, whose `primeWebLoaders()` calls the four frontend source loaders after content-store hydration.

## Checks

| Command | Result |
| --- | --- |
| `frontend: npm run check` | Pass |
| `frontend: npm test` | 112 files passed, 2 skipped; 793 tests passed, 26 skipped |
| `wechat-miniprogram: npm test` | All 30 scripts passed after refreshing shared/data generated files |
| `taro-spike-2: npm test` | Pass; 10 async paths, all package gates pass |
| `taro-spike-2: npm run build:weapp` | Pass; 20 webpack entry points; no unresolved Lucide exports |

The first parallel frontend test run hit the default 5-second timeout in one sync-merge test while the mini-program suite was also running. Running the full frontend suite alone passed with the standard timeout.

## Developer Tools and iPhone acceptance pending

The project compiled, but Developer Tools runtime and iPhone preview checks were not possible in this turn. The assigned port is 9421; `cli open --project /private/tmp/shushugo-w1/taro-spike-2 --port 9421` exited 255 with:

> ✖ IDE server has started on http://127.0.0.1:49985 and must be restarted on port 9421 first

The visible IDE window remained on `/private/tmp/shushugo-release-prep`; it was not switched or closed, and port 49985 was not used. No preview QR was generated. Therefore database open, quiz flow, WordStudy flow, and actual iPhone WASM loading are still unverified and require a W1 Developer Tools instance bound to 9421, followed by opening the iPhone preview QR on device.
