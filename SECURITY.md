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

The start response gives only the initiating tab a random one-shot decision
token. Owner polling may receive bounded normalized provider metadata; public
current-job polling receives only an opaque identifier and sanitized phase.
A job found after a lost start response cannot acquire approval authority, so
the browser preserves the form and requires the operator to verify Profiles and
Notifications before retrying.

The download supervisor discards stderr and reads bounded lpac NDJSON stdout
through anonymous pipes. It exposes only allowlisted preview fields, never raw
records. A constant positional shell launcher runs in a dedicated process
group; request values remain separate argv entries and are never interpolated
into shell source. The shared lock descriptor is inherited by the group, and
the watchdog targets the whole process group before reporting a sanitized
terminal state.

All downloads use `lpac profile download -p`. The backend waits for the explicit
preview record and accepts one authenticated decision before PrepareDownload.
Missing metadata still requires confirmation. Invalid, oversized, truncated, or
out-of-order output fails closed, and a lost tab never implies approval.

QR image selection and decoding happen locally in the browser; the image is
not uploaded to the router. File choice and camera capture are separate actions,
and only the camera action carries a capture hint. Declared file type (when
available), byte size, pixel count, decoded format, and activation-code fields
are bounded before the RPC call.

The download uses the HTTP backend configured for the installed lpac package.
LuCI does not replace, override, or independently verify its TLS behavior. The
bundled lpac v2.3.0 build disables curl peer and hostname verification. Profile
download and provider-notification processing therefore require a trusted
provider source and network. Notification batches run one record at a time and
stop on the first failure; unknown outcomes are not automatically retried.
Local Remove never contacts the provider. SM-DS discovery remains unavailable.

Changing the default SM-DP+ address writes persistent eUICC state. The UI uses
a typed fixed-argv RPC, requires an old/new confirmation, and claims success
only after a fresh `chip info` response exactly matches the requested address.
Profile icons are neither returned by the backend nor rendered by the browser.

The application does not manage modem, SIM-power, or network-interface
lifecycle. Profile changes can interrupt mobile connectivity.
