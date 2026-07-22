# luci-app-lpac working contract

## Goal

Prepare a deliberately staged native LuCI application based on
`fix/profile-download-hardening-extra`. Downloads support pasted activation
codes, manual parameters, and separate camera/file QR inputs. Pending provider
notifications remain processable with explicit partial/unknown outcome
handling. Every download pauses in the same live lpac session for an explicit
provider-metadata decision before PrepareDownload. SM-DS profile discovery,
direct discovered-order download, and profile icons are intentionally deferred.
The bundled lpac package carries exactly nine patches: the original five plus
`0030`, `0031`, `0050`, and `0060`.

## Sources of truth

1. Current lpac CLI behavior and source code.
2. Current OpenWrt LuCI/rpcd conventions and reviewer feedback on PR #8836.
3. Reproducible tests and observations from the target router.
4. `luci-app-lpac-manager` only as a behavioral reference; do not copy its shell
   wrapper or AGPL-derived UI into this Apache-2.0 application.
5. `memory.md` is historical context, not verified truth.

## Required outcomes

- Audit all frontend RPC calls, backend argument construction, ACLs, menu data,
  configuration handling, locking, timeout behavior, and secret handling.
- Accept valid LPA activation strings copied from common apps, including harmless
  surrounding invisible Unicode formatting characters.
- Present separate, explicit QR actions for camera capture and image-file choice.
- Decode QR images locally in the browser; never upload the image to the router.
- Keep activation and confirmation secrets out of logs, status objects, command
  output, notifications, and confirmation dialogs.
- Make Downloads survive normal UI refresh/re-entry where technically possible,
  report terminal state accurately, and prevent concurrent eUICC operations.
- Persist only non-secret verification state across reloads when a download
  outcome is uncertain; never persist activation, matching, or confirmation
  credentials. Require successful checks of both Profiles and Notifications
  before allowing a retry.
- Keep status requests single-flight so polling and lost-response recovery cannot
  apply stale responses out of order.
- Do not attribute a globally discovered running job to a form unless its start
  response returned that job identifier. After a lost response, preserve the
  form and require Profiles/Notifications verification before any retry.
- Bound raw input before normalization and test real supervisor, process-group,
  signal, and inherited-lock behavior in CI without contacting an eSIM provider.
- Keep SM-DS discovery, direct discovered-order download, and profile icons
  absent from the staged frontend, backend, ACLs, and package claims.
- Require every download path to enter one live lpac preview session and receive
  an explicit one-shot decision before PrepareDownload. Missing metadata must
  still stop for confirmation; a lost owner response must never authorize
  installation.
- Process provider notifications one sequence at a time, including sequence zero.
  Stop a batch on the first failure and distinguish retrieval failure, unknown
  provider outcome, and successful delivery followed by local removal failure.
- Clearly disclose that bundled lpac v2.3.0 inherits disabled curl peer and
  hostname verification. Do not claim that this staged branch fixes TLS or
  provider-response allocation bounds.
- Treat the default SM-DP+ address as persistent eUICC state, not a LuCI/UCI
  setting. Expose its nonempty typed update only in Overview, require a second
  old/new confirmation, and claim success only after exact `get_info` readback.
- Inventory lpac applets explicitly. Destructive chip purge and raw notification
  dump/replay are intentionally out of scope for a general LuCI management UI;
  do not expose them merely to claim every diagnostic applet is present.
- Keep only patches `0001`, `0002`, `0010`, `0015`, `0020`, `0030`, `0031`,
  `0050`, and `0060`; defer `0040`, `0041`, `0070`, and `0071` and all tests
  that depend solely on them.
- Add regression coverage for every retained behavior and run LuCI lint, ucode
  tests, host patch-contract tests, package builds, and proportionate router
  validation.

## Router safety boundary

Target: `root@192.168.1.1`.

- Read-only inspection is allowed.
- Do not delete, enable, disable, rename, or otherwise mutate existing eSIM
  profiles or notifications.
- Do not reset/restart/reconfigure the modem, ModemManager, netifd, interfaces,
  firewall, routing, DNS, Wi-Fi, Dropbear, or the router.
- Do not install/upgrade/remove packages or write configuration unless the user
  gives fresh, specific approval after reviewing the proposed artifact.
- The previously authorized disposable Speedtest download has already completed
  successfully through both camera and file QR paths. Do not perform another
  download, SM-DS discovery, preview session, provider notification processing,
  notification removal, or other live mutation without fresh specific approval.

## Repository rules

- Preserve unrelated work and do not rewrite history.
- Do not commit, push, modify the GitHub PR, or publish an artifact without the
  user's explicit instruction after the final report.
- Compile OpenWrt packages only in GitHub Actions. Local work is limited to
  syntax, lint, unit/integration tests, and host builds used to validate the lpac
  patch series; never run a local OpenWrt package build.
- Prefer typed rpcd/ucode methods and fixed argv arrays. Never interpolate user
  input into shell source.
- Keep this application hardware-neutral; modem recovery belongs elsewhere.
- Treat provider/network responses as untrusted and expose only allowlisted
  status/error data.

## Verification gate

Work is not ready until the source is clean under `git diff --check`, JSON and JS
syntax checks pass, official LuCI ESLint/POT checks pass, backend/frontend tests
pass on supported ucode variants, package builds succeed, and router observations
match the claimed behavior. Record any untested backend or unresolved risk in the
handoff instead of guessing.
