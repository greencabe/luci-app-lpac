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
- Keep any legacy compatibility shell program constant and pass request values
  only through positional argv; never interpolate them into the program text.
- Do not expose raw lpac stdout, stderr, APDU data, activation codes, or HTTP
  payloads through RPC.
- Never write live activation codes, confirmation codes, matching IDs, or
  secret-bearing lpac download argv to application logs or test fixtures.
- Do not add modem resets, network restarts, or hardware-specific patches to
  this application.
- Network methods must mirror documented lpac arguments, inherit the configured
  HTTP transport without silently changing its verification policy, and state
  that boundary accurately in user-facing documentation.
- Preserve the license and source provenance of third-party frontend assets.
- Preserve granular read/write rpcd ACLs.
- Add tests for every backend validation or normalization change.
- Use synthetic download parameters in automated tests; never consume a live
  provider activation code or contact an SM-DP+ service from CI.

## Translations

Only update `po/templates/lpac.pot` in this review repository. An eventual LuCI
contribution must use OpenWrt Weblate for translated `.po` files.

## Commits and DCO

Use a component-prefixed lowercase subject, a meaningful body, and
`git commit -s`. LuCI prefers a first-and-last name and its pull request
template permits a nickname. In either case, use an identity you can certify
and a reachable non-noreply email linked to the GitHub account opening the pull
request.
