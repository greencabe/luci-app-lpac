# luci-app-lpac

[![Validate](https://github.com/greencabe/luci-app-lpac/actions/workflows/validate.yml/badge.svg)](https://github.com/greencabe/luci-app-lpac/actions/workflows/validate.yml)
[![Build](https://github.com/greencabe/luci-app-lpac/actions/workflows/build.yml/badge.svg)](https://github.com/greencabe/luci-app-lpac/actions/workflows/build.yml)

Native LuCI frontend for OpenWrt's `lpac` eSIM manager. The application uses
the packaged `/usr/bin/lpac` entrypoint and `/etc/config/lpac`; it does not
bundle lpac, modem firmware, hardware patches, or network orchestration.

The source is kept in the exact layout intended for a future OpenWrt LuCI
contribution:

```text
applications/luci-app-lpac/
```

See the [application README](applications/luci-app-lpac/README.md) for the RPC
architecture, locking model, supported operations, and security boundaries.

## Current scope

- Read eUICC information and compiled lpac drivers.
- List, enable, disable, rename, and delete profiles.
- List and explicitly remove local eUICC notifications.
- Configure validated official AT, uqmi, MBIM, and PC/SC settings.
- Serialize LuCI eUICC operations through a root-owned runtime lock.

Profile download, SM-DS discovery, notification processing, modem resets, and
network-interface control are intentionally out of scope. lpac 2.3.0 disables
curl peer and hostname verification, so network operations are not exposed in
the web interface.

## Compatibility

| OpenWrt | Package format | lpac requirement | Status |
| --- | --- | --- | --- |
| Snapshot/master | APK | Official `lpac >= 2.3.0-r2` | CI target |
| 25.12.x | APK | Backported or custom `lpac >= 2.3.0-r2` | Tested on 25.12.5 |
| 24.10.x | IPK | Stock lpac is too old | Not supported by stock feeds |

The application is architecture-independent. The OpenWrt release and package
format must still match the router. A patched L850-GL lpac backend was used for
one real-device validation, but no hardware-specific code is included here.

## Review artifacts

GitHub Actions builds the LuCI application only. It does not compile or upload
lpac. Download the artifact matching the router release, then install the
unsigned review package locally, for example:

```sh
scp luci-app-lpac-*.apk root@router:/tmp/
ssh root@router apk add --allow-untrusted /tmp/luci-app-lpac-*.apk
```

Before installation, confirm that the package manager records a compatible
lpac version:

```sh
apk info -a lpac
# or on opkg-based releases
opkg status lpac
```

## Development

The repository runs source validation, 38 mocked rpcd/ucode checks, frontend
DOM-attribute regression tests, and SDK
builds for OpenWrt 25.12.5 and snapshot. See [CONTRIBUTING.md](CONTRIBUTING.md)
for local commands and DCO requirements.

Do not post activation codes, confirmation codes, EIDs, ICCIDs, raw APDU logs,
or HTTP debug payloads in public issues.

## Upstream status

This repository is a review staging area, not an OpenWrt fork. A future pull
request must be prepared as a clean commit in a fork of `openwrt/luci`, target
`master`, pass LuCI FormalityCheck, and use an accepted DCO identity.

## License

Apache License 2.0. See [LICENSE](LICENSE).
