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
- Do not expose raw lpac stdout, stderr, APDU data, activation codes, or HTTP
  payloads through RPC.
- Do not add modem resets, network restarts, or hardware-specific patches to
  this application.
- Do not add network lpac operations while its HTTP backend does not verify TLS
  peers and hostnames.
- Preserve granular read/write rpcd ACLs.
- Add tests for every backend validation or normalization change.

## Translations

Only update `po/templates/lpac.pot` in this review repository. An eventual LuCI
contribution must use OpenWrt Weblate for translated `.po` files.

## Commits and DCO

Use a component-prefixed lowercase subject, a meaningful body, and
`git commit -s`. OpenWrt LuCI requires a truthful first-and-last name and a
non-noreply email linked to the GitHub account opening the pull request.
