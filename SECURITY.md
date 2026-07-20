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

The Download view accepts credentials through typed RPC and invokes the
installed `lpac profile download` implementation. The LuCI facade does not put
activation or confirmation codes in its logs, status record, or RPC result.
The values nevertheless exist in browser and RPC memory and necessarily become
arguments of the privileged lpac process, where privileged local process
inspection can observe them while the operation runs.

The worker discards lpac stdout and stderr. Legacy ucode releases without
file-descriptor duplication use a constant positional shell redirection shim;
request values are argv entries and are not interpolated into that script.

QR image selection and decoding happen locally in the browser; the image is
not uploaded to the router. Declared file type (when available), byte size,
pixel count, decoded format, and activation-code fields are bounded before the
RPC call.

The download uses the HTTP backend configured for the installed lpac package.
LuCI does not replace, override, or independently verify its TLS behavior. The
bundled lpac v2.3.0 build disables curl peer and hostname verification. Network
notification processing and SM-DS discovery remain unavailable. Local
notification removal does not notify the provider and must not be confused
with notification processing.

The application does not manage modem, SIM-power, or network-interface
lifecycle. Profile changes can interrupt mobile connectivity.
