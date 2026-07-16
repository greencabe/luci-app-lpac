# Compatibility notes

## OpenWrt packages

`luci-app-lpac` requires `lpac >= 2.3.0-r2`. OpenWrt snapshot currently meets
that requirement. OpenWrt 25.12 stock feeds currently provide 2.3.0-r1 and
require a compatible backport or custom package. OpenWrt 24.10 provides an
older lpac release and is not a stock-supported target.

## APDU backends

When `lpac driver list` succeeds, the UI offers reported drivers and retains a
currently configured supported value. If discovery fails because the active
backend is unavailable, the fixed supported enum is offered for recovery and
clearly marked as unverified.

- AT and MBIM accept safe absolute paths below `/dev`, including paths such as
  `/dev/ttyS0` and `/dev/serial/by-id/...`.
- The active downstream uqmi backend remains restricted to `/dev/cdc-wdmN`
  because its OpenWrt integration currently constructs a shell command.
- PC/SC selection does not invent reader settings not present in the official
  OpenWrt UCI schema.

## Tested device

Read-only runtime validation was completed on OpenWrt 25.12.5 with a Fibocom
L850-GL and a modem-specific lpac 2.3.0-r2 package. Chip information, 13
profiles, and 54 notifications were read repeatedly in 0-1 seconds without
leaving lpac processes or disconnecting the ModemManager network interface.

This validates that combination only. It does not claim generic support for
every modem, eUICC, APDU backend, or firmware.
