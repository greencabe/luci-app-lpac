# Security policy

Please use GitHub private vulnerability reporting for security issues. Do not
include live eSIM activation codes, confirmation codes, EIDs, ICCIDs, raw APDU
traces, HTTP debug payloads, or provider credentials in a public report.

## Security boundaries

The browser can invoke only typed `luci.lpac` methods. The backend validates
arguments and UCI data, executes fixed binaries with argv arrays, normalizes
lpac output, and serializes LuCI eUICC operations with
`/var/run/luci-lpac.lock`. The backend requires that lock to be a regular
root-owned mode-0600 file and refuses unsafe lock-path objects.

Direct CLI tools and other managers do not automatically participate in this
lock. They must use the same lock voluntarily if run concurrently.

Network operations are excluded because lpac 2.3.0 disables curl peer and
hostname verification. Local notification removal does not notify the provider
and must not be confused with notification processing.

The application does not manage modem, SIM-power, or network-interface
lifecycle. Profile changes can interrupt mobile connectivity.
