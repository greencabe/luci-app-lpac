# luci-app-lpac

[![Validate](https://github.com/As-tsaqib/luci-app-lpac/actions/workflows/validate.yml/badge.svg)](https://github.com/As-tsaqib/luci-app-lpac/actions/workflows/validate.yml)
[![Build](https://github.com/As-tsaqib/luci-app-lpac/actions/workflows/build.yml/badge.svg)](https://github.com/As-tsaqib/luci-app-lpac/actions/workflows/build.yml)

Native LuCI frontend for OpenWrt's `lpac` eSIM manager. The application uses
the packaged `/usr/bin/lpac` entrypoint and `/etc/config/lpac`.

The `main` branch keeps the exact application layout intended for the OpenWrt
LuCI contribution. This release branch additionally carries an auditable
OpenWrt package definition for an unofficial patched lpac v2.3.0 build:

```text
applications/luci-app-lpac/
packages/lpac/
```

See the [application README](applications/luci-app-lpac/README.md) for the RPC
architecture, locking model, supported operations, and security boundaries.

## Current scope

- Read eUICC information and compiled lpac drivers.
- List, enable, disable, rename, and delete profiles.
- Download profiles from a complete LPA activation code, a QR image decoded
  locally in the browser, or the non-interactive manual parameters supported
  by lpac.
- List and explicitly remove local eUICC notifications.
- Configure validated official AT, uqmi, MBIM, and PC/SC settings.
- Serialize LuCI eUICC operations through a root-owned runtime lock.

SM-DS discovery, network notification processing, modem resets, and
network-interface control remain out of scope. Profile download deliberately
mirrors the packaged `lpac profile download` interface and inherits the HTTP
and TLS behavior of the installed lpac transport; LuCI neither replaces nor
independently verifies that transport.

## Compatibility

| OpenWrt | Format | Bundled lpac | Status |
| --- | --- | --- | --- |
| 25.12.5 | APK | `2.3.0.438-r2` | Release target |
| 24.10.7 | IPK | `2.3.0.438-r2` | Release target |

Release ZIPs are provided for `aarch64_generic`, `aarch64_cortex-a53`,
`aarch64_cortex-a72`, `arm_cortex-a7_neon-vfpv4`, `mipsel_24kc`, and
`x86_64`. The LuCI package itself is architecture-independent, while the lpac
binary must match the router package architecture. The Linksys EA6350 v3 uses
`arm_cortex-a7_neon-vfpv4`.

## Bundled release artifacts

Each ZIP follows the same per-architecture distribution pattern as
`luci-app-engsel` and contains exactly one patched lpac package, one
`luci-app-lpac` package, `SHA256SUMS`, and `INSTALL.txt`. Select the ZIP that
matches both the OpenWrt release and package architecture.

```sh
# OpenWrt 24.10.7
opkg install ./lpac_*.ipk ./luci-app-lpac_*.ipk

# OpenWrt 25.12.5
apk add --allow-untrusted ./lpac-*.apk ./luci-app-lpac-*.apk
```

The compatibility package enables MBIM skip-slot-mapping by default. Disable
it at `Modem → eSIM Manager → Settings → MBIM backend`, or through UCI on
hardware that requires normal slot discovery:

```sh
uci set lpac.mbim.skip_slot_mapping='0'
uci commit lpac
```

The lpac package is built from the official v2.3.0 archive with OpenWrt's
uqmi backend plus its configured-device correction, the merged upstream
environment parser fix from pull request 308, the version fix from pull
request 310, and the MBIM compatibility changes merged in pull request 438. See
[packages/lpac/README.md](packages/lpac/README.md) for provenance and scope.
The release-branch LuCI package requires `lpac >=2.3.0.438-r2`, ensuring that
the Settings checkbox is paired with a wrapper that exports the upstream MBIM
slot-mapping option and a binary that correctly parses UCI boolean values.

## Development

The repository runs source validation, mocked rpcd/ucode checks, frontend
regression tests, and SDK builds for OpenWrt 25.12.5 and snapshot. See
[CONTRIBUTING.md](CONTRIBUTING.md) for local commands and DCO requirements.

Do not post activation codes, confirmation codes, EIDs, ICCIDs, raw APDU logs,
or HTTP debug payloads in public issues.

## Upstream status

The bundled package workflow is downstream release infrastructure and is not
part of the OpenWrt LuCI contribution. Upstream changes remain isolated in a
clean `openwrt/luci` branch, target `master`, with DCO-compliant commits.

## License

The LuCI application is licensed under Apache-2.0; see [LICENSE](LICENSE).
Bundled lpac binaries retain the upstream AGPL/LGPL and component licenses
shipped by [estkme-group/lpac](https://github.com/estkme-group/lpac). The
OpenWrt uqmi patch retains its MIT source notice.
