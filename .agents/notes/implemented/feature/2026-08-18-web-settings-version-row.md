# Agent Note: Web Settings General section version row

Status: implemented

English | [中文](2026-08-18-web-settings-version-row.zh.md)

## Problem

The Web GUI had no version display. An operator who syncs, rebuilds, and restarts (`dsh web` from a checkout, or an installed `dsh`) could not tell from the page which build was serving it — the only ground truth was shell access to `dsh --version`. Showing one is not a client-only edit: each client package builds as its own bundle and cross-plugin value imports are a build error (the client bundle purity gate), so a display needs a host→browser channel plus a service face for the row to read.

## Decision

Mirror the LAN-trust fence pattern end to end for one more host fact:

- `dsh-web-app`'s runtime glue splices a second inline script into the served page's `<head>` beside the trust fence: `window.__DSH_WEB_VERSION__` carries the bundle's own `package.json` version (`src/index.ts` reads it with the same checked-in-manifest idiom as `apps/cli/src/bin.ts`). The dsh family releases in lockstep, so that string is the serving `dsh` release — the same value `dsh --version` prints. The head splice is one shared helper used by both injections.
- `dsh-client-connection` owns the global name (`src/web-version.ts`, sibling of `web-trust.ts`, exported from both faces) and the browser client mirrors it at boot as `ConnectionHandle.webVersion` — cross-plugin collaboration goes through the service, never a value import.
- `dsh-client-ui-settings-general` — owner of settings copy that belongs to no single feature — registers a read-only **版本 / Version** row into the General section's `settings.general.item` slot (id `version`, order 30, after Permission/Language/Appearance/Composer). Registration is gated on the mirror existing, the same posture as the loopback-only document action: a context the Web host did not serve (component harnesses, non-browser tests) shows no row at all.

## Alternatives considered

- **Bake the version into client bundles at build time.** Rejected: every client package is a separately versioned bundle, so each would display its own package version instead of the serving release, and the shell and client rows ride two different build pipelines to feed one string.
- **Extend `__DSH_WEB_TRUST__` with a version field.** Rejected: the trust fence is a security contract with authority-matching semantics; the product version is display metadata with different readers and lifetimes.
- **Add a version field to the boot graph (`WebBootGraph`).** Rejected: that wire exists to drive module arrival; product metadata would ride loading machinery and need a new client accessor for one string.
- **A sidebar-foot line, always visible.** Deferred by operator choice: the Settings General row was preferred; the slot plumbing for a foot seat is not built.

## Consequences

- Settings → 通用设置 ends with a read-only version row whose value equals `dsh --version` for the serving process; both read a checked-in `package.json` the same way.
- The value is the release string, not a commit: a checkout that rebuilds after merging code changes without a release bump still shows the last bumped version. That is honest to the lockstep release train and matches every `dsh --version` answer from the same tree.
- `window.__DSH_WEB_VERSION__` joins the page's injected-global surface (`__DSH_BOOT__`, `__DSH_WEB_TRUST__`); it is public display data, not a trust input.
- The browser-e2e golden for the settings dialog gains the row with its value normalized to `{{version}}` (anchored on the row's own label), so goldens do not churn per release.
