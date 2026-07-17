# Bundled lpac package

This directory is a downstream OpenWrt package definition used only by the
bundled GitHub releases of `luci-app-lpac`. It downloads the authoritative
lpac `v2.3.0` source archive instead of vendoring a modified source tree.

The package version is `2.3.0.438-r2` so it cannot be confused with the
official OpenWrt `2.3.0-rN` package. The runtime `lpac version` output remains
the upstream project version `2.3.0`.

Patch provenance:

1. OpenWrt's uqmi backend patch from `openwrt/packages`.
2. A small downstream correction that makes the uqmi backend use the
   configured `LPAC_QMI_DEV` when allocating its client ID instead of
   constructing a duplicated command fixed to `/dev/cdc-wdm0`.
3. The environment helper fix merged upstream as lpac pull request 308. This
   is required because v2.3.0 otherwise interprets numeric UCI boolean values
   such as `1` as false.
4. The version handling fix merged upstream as lpac pull request 310.
5. The MBIM compatibility work merged as lpac pull request 438 / commit
   `79fcec9d89a247f1a1995f7b4560ea819bfe654f`.

The compatibility bundle enables the MBIM slot-mapping bypass by default.
It also selects the MBIM APDU backend by default for new installations.
LuCI exposes the bypass at
`Modem → eSIM Manager → Settings → MBIM backend`.
Set `lpac.mbim.skip_slot_mapping=0` on devices that require lpac to query and
change the MBIM Device Slot Mapping. While the bypass is enabled,
`LPAC_APDU_MBIM_UIM_SLOT` is ignored and a multi-slot modem may expose a
different eUICC than expected. The package does not include modem reset
scripts, ModemManager integration, or the legacy shell management interface.

lpac 2.3.0 still disables curl peer and hostname verification. The bundled
LuCI application therefore keeps network notification processing and other
network-facing operations unavailable.
