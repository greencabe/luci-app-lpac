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
3. The environment boolean parser fix merged in upstream pull request 308.
4. The version fix already merged in upstream lpac pull request 310.
5. The MBIM UICC compatibility changes merged from upstream pull request 438
   as commit `79fcec9d89a247f1a1995f7b4560ea819bfe654f`.

The downstream package version is `2.3.0.438-r2`; `lpac version` reports the
upstream source version `2.3.0`. These upstream fixes were merged after the
v2.3.0 tag, so this bundle backports them until lpac publishes a newer
release. The ZIPs remain unofficial downstream OpenWrt packages.

Discard any earlier `2.3.0.438-r1` CI artifact. It was never published as a
release and inherited the v2.3.0 parser bug that treated numeric UCI boolean
values such as `proxy=1` and `skip_slot_mapping=1` as false. In `r2`, those
settings take effect as configured; multi-slot users should verify whether
slot mapping should remain enabled or disabled for their hardware.

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

The Download view invokes the packaged `lpac profile download` operation and
inherits its configured HTTP transport. LuCI does not replace or independently
verify that transport. This bundled lpac v2.3.0 build disables curl peer and
hostname verification, so users should assess that behavior before submitting
activation or confirmation credentials. QR images are decoded locally in the
browser and are not uploaded to the router. SM-DS discovery and network
notification processing are not exposed by this LuCI release.

Install only the ZIP matching both your OpenWrt major release and package
architecture. Each ZIP contains `INSTALL.txt` and `SHA256SUMS`. Installation
requires access to the matching official OpenWrt feeds for runtime
dependencies such as LuCI, `ucode-mod-uloop`, libcurl, libmbim, and uqmi.
