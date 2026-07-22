# luci-app-lpac bundled packages

Each ZIP contains the native `luci-app-lpac` frontend and a matching lpac
compatibility package for one OpenWrt release and package architecture.

## Build matrix

- OpenWrt 24.10.7: IPK packages
- OpenWrt 25.12.5: APK packages
- Architectures: `aarch64_generic`, `aarch64_cortex-a53`,
  `aarch64_cortex-a72`, `arm_cortex-a7_neon-vfpv4`, `mipsel_24kc`, and
  `x86_64`

The Linksys EA6350 v3 uses the `arm_cortex-a7_neon-vfpv4` bundle. The
`mipsel_24kc` and `x86_64` builds do not support every MIPS little-endian or
32-bit x86 device; verify `opkg print-architecture` or `apk --print-arch`
before installation.

## lpac compatibility build

The binary is built from the official lpac v2.3.0 archive with:

1. OpenWrt's uqmi backend patch.
2. A downstream fix for the uqmi patch's duplicated, hard-coded client setup
   command so `LPAC_QMI_DEV` is honored.
3. The version-handling refactor merged in upstream pull request 310.
4. The environment boolean parser fix merged in upstream pull request 308.
5. The MBIM UICC compatibility changes merged from upstream pull request 438
   as commit `79fcec9d89a247f1a1995f7b4560ea819bfe654f`.
6. Notification sequence zero handling from upstream pull request 429.
7. A strict decimal `uint32_t` notification-sequence parser that rejects
   signs, truncation, overflow, whitespace, and trailing data.
8. A fail-closed interactive preview gate. `lpac profile download -p` always
   pauses for a decision before PrepareDownload, including when provider
   metadata is absent.
9. Provider-status string hardening from upstream pull request 444 / commit
   `3ff35594ec15062a3ed10c3da1c26eb0a13390b8`.

SM-DS discovery, direct discovered-order download, curl TLS verification, and
provider-response memory bounds are intentionally deferred from this staged
nine-patch set.

The downstream package version is `2.3.0.444-r1`; `lpac version` reports the
upstream source version `2.3.0`. These upstream fixes were merged after the
v2.3.0 tag, so this bundle backports them until lpac publishes a newer
release. The ZIPs remain unofficial downstream OpenWrt packages.

All `2.3.0.438-rN` artifacts are superseded. The `2.3.0.444-r1` package keeps
the corrected UCI boolean handling, so numeric settings such as `proxy=1` and
`skip_slot_mapping=1` take effect as configured. Multi-slot users should
verify whether slot mapping should remain enabled or disabled for their
hardware.

MBIM skip-slot-mapping is enabled by default in this bundle. Disable it on a
multi-slot device or any device that requires normal slot discovery:

```sh
uci set lpac.mbim.skip_slot_mapping='0'
uci commit lpac
```

While the bypass is enabled, the configured MBIM UIM slot is ignored and a
multi-slot modem may expose a different eUICC than expected.
The default APDU backend for a new installation is `mbim`; it can be changed
from LuCI Settings or `/etc/config/lpac`.
The slot-mapping bypass can be changed at
`Modem → eSIM Manager → Settings → MBIM backend` or through UCI.

## HTTP and TLS transport

The Download and notification Process views invoke the packaged lpac network
operations and inherit its configured HTTP transport. LuCI does not replace or
independently verify that transport. This staged build retains v2.3.0's curl
behavior, which disables certificate-chain and hostname verification. Use
network-facing operations only with a trusted provider source and network. QR
images are decoded locally in the browser and are not uploaded to the router.

Install only the ZIP matching both your OpenWrt major release and package
architecture. Each ZIP contains `INSTALL.txt` and `SHA256SUMS`. Installation
requires access to the matching official OpenWrt feeds for runtime
dependencies such as LuCI, `ucode-mod-uloop`, libcurl, libmbim, and uqmi.
