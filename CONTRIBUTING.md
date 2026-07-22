# Contributing

Contributions and review reports are welcome. Keep changes focused on the
native LuCI application under `applications/luci-app-lpac`.

## Before submitting a change

Run:

```sh
applications/luci-app-lpac/tests/run-tests.sh
node applications/luci-app-lpac/tests/frontend.js
node --check applications/luci-app-lpac/htdocs/luci-static/resources/lpac.js
git diff --check
```

The CI validation job additionally runs the official LuCI ESLint configuration,
parses menu and ACL JSON, compiles the ucode backend, and verifies that the POT
template is reproducible. The SDK workflow must build only `luci-app-lpac`.

## Design rules

- Never accept a raw command, executable path, shell fragment, or environment
  variable from the browser.
- Keep all process arguments as separate argv elements.
- Keep the asynchronous download launcher constant and pass request values only
  through positional argv. Never interpolate them into the shell program text
  or add a general-purpose command interface.
- Keep long downloads under `uloop.process()` supervision in a dedicated
  `setsid` process group. Do not reintroduce `uloop.task()`, `fs.dup2()` feature
  branches, or a timeout that kills only the wrapper PID.
- Preserve the inheritable shared-lock descriptor for every download descendant.
  Timeout handling must signal the entire process group and wait for its process
  callback before reporting terminal state.
- Do not expose raw lpac stdout, stderr, APDU data, activation codes, or HTTP
  payloads through RPC.
- Never write live activation codes, confirmation codes, matching IDs, or
  secret-bearing lpac download argv to application logs or test fixtures.
- Keep download status recoverable without storing credentials. The current-job
  query may return only an opaque identifier and sanitized state. Preview
  metadata and decisions require a random tab-scoped token returned only by the
  direct start response; document and test that in-memory state does not survive
  an rpcd restart.
- Keep all download paths on `lpac profile download -p` and require one explicit
  fail-closed decision in that same live session before PrepareDownload. Missing
  metadata, malformed output, EOF, timeout, and a lost owner must never imply
  installation approval.
- Keep QR file choice and camera capture as separate controls. The normal file
  picker must not carry a capture hint; the camera control may use
  `capture="environment"`, with both paths decoding locally through the same
  bounded image pipeline.
- Normalize only harmless whitespace and Unicode formatting marks surrounding
  an activation code. Continue rejecting such marks inside its fields so that
  normalization cannot silently alter a credential.
- Do not add modem resets, network restarts, or hardware-specific patches to
  this application.
- Network methods must mirror documented lpac arguments, inherit the configured
  HTTP transport without silently changing its verification policy, and state
  that boundary accurately in user-facing documentation. Local QR decoding does
  not compensate for lpac v2.3.0 disabling TLS peer and hostname verification.
- Process provider notifications one canonical uint32 sequence at a time. Stop
  Process all at the first failure and never automatically retry an unknown
  provider outcome or a record delivered before local removal failed.
- Treat the default SM-DP+ address as persistent eUICC state: require explicit
  old/new confirmation and fresh exact readback before reporting success.
- Keep SM-DS discovery, direct discovered-order download, and profile icons out
  of this staged branch until their deferred patches and tests are reintroduced.
- Preserve the license and source provenance of third-party frontend assets.
- Preserve granular read/write rpcd ACLs.
- Add tests for every backend validation or normalization change.
- Test process startup failure, process-group timeout, descendant cleanup,
  inherited-lock release, unknown-outcome mapping, page re-entry, an ambiguous
  start response, external-job monitoring, and transient status failures. A
  job discovered after a lost response must not be attributed to that form
  without a backend nonce; preserve the form and require outcome verification.
  Tests must also prove that no child output or request credential reaches RPC
  results.
- Exercise the actual QR decoder with bounded image fixtures and test both file
  and camera inputs; a decoder stub alone is not regression coverage for the
  image pipeline.
- Use synthetic download parameters or an explicitly public, non-secret test
  profile in automated tests. Never consume a private or single-use activation
  code, and never contact an SM-DP+ service from CI.

## Translations

Only update `po/templates/lpac.pot` in this review repository. An eventual LuCI
contribution must use OpenWrt Weblate for translated `.po` files.

## Commits and DCO

Use a component-prefixed lowercase subject, a meaningful body, and
`git commit -s`. LuCI prefers a first-and-last name and its pull request
template permits a nickname. In either case, use an identity you can certify
and a reachable non-noreply email linked to the GitHub account opening the pull
request.
