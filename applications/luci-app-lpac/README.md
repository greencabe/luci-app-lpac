# luci-app-lpac

`luci-app-lpac` is a clean-room LuCI frontend for the official OpenWrt
[`lpac`](https://github.com/openwrt/packages/tree/master/utils/lpac) package.
It uses `/usr/bin/lpac` and `/etc/config/lpac` as provided by that package and
does not bundle a second lpac build, modem manager, or hardware-specific
wrapper.

## Initial scope

- Show the installed lpac version, compiled drivers, and eUICC information.
- List, enable, disable, rename, and delete profiles.
- Download a profile with a complete LPA activation code, a locally decoded QR
  image, or the non-interactive manual parameters supported by upstream lpac.
- List and remove pending eUICC notifications.
- Configure the official AT, uqmi, MBIM, and PC/SC backends through validated
  RPC methods.

The Download view mirrors `lpac profile download`: it accepts the complete LPA
string, supports browser-local QR image decoding, and exposes the
non-interactive upstream SM-DP+, matching-ID, IMEI, and confirmation-code
parameters. The QR image is not uploaded to the router. The resulting network
operation uses the HTTP backend configured for the installed lpac package.
LuCI does not replace,
override, or independently verify that package's TLS transport. In particular,
the bundled lpac v2.3.0 build explicitly disables curl peer and hostname
verification in
[driver/http/curl.c](https://github.com/estkme-group/lpac/blob/v2.3.0/driver/http/curl.c#L90-L91).
This transport behavior is inherited rather than introduced by the LuCI page.
Separately, [estkme-group/lpac#444](https://github.com/estkme-group/lpac/pull/444)
hardens handling of untrusted server responses.

Removing a pending notification only deletes its record from the eUICC. It
does not contact the provider or undo the profile operation, and discarding an
unprocessed record can leave the provider state out of sync. Network
notification processing and its bulk Process action remain outside the current
application scope. The packaged bulk implementation can complete only part of
a batch before an error and does not guarantee the grouping and ordering
required by SGP.22.

Notification sequence `0` is valid and is displayed, but its explicit Remove
action is disabled. The packaged lpac 2.3.0 reports false success without
removing that sequence. Upstream fixed this after 2.3.0 in
[estkme-group/lpac#429](https://github.com/estkme-group/lpac/pull/429), but the
fix is not yet present in the OpenWrt package; see also
[estkme-group/lpac#430](https://github.com/estkme-group/lpac/issues/430).

lpac 2.3.0 may report `v0.0.0-unknown` because its generated version header
collides with an applet header and release tarballs lack Git metadata. This is
a dependency build issue rather than evidence that an eUICC operation failed.
Upstream corrected version handling after 2.3.0 in
[estkme-group/lpac#310](https://github.com/estkme-group/lpac/pull/310).

## Compatibility

This release branch requires the bundled `lpac >= 2.3.0.438-r2`. OpenWrt
25.12 requires a compatible backport or custom package, while the stock 24.10
lpac is too old. The application itself is architecture-independent.

When driver discovery succeeds, Settings offers the reported AT, uqmi, MBIM,
or PC/SC backends. Safe AT and MBIM device paths below `/dev` are accepted.
The release branch also manages the upstream MBIM slot-mapping bypass. It is
enabled by default for compatibility and can be disabled for multi-slot
devices that require normal slot selection.
The active uqmi backend remains restricted to `/dev/cdc-wdmN`; the bundled
package fixes client setup so the configured control-device path is honored.

## Architecture

The browser calls a small typed `luci.lpac` rpcd/ucode facade. The facade:

- validates every argument and never accepts a raw command line;
- serializes access to the eUICC with a non-blocking file lock;
- delegates one-shot operations to rpcd `file.exec` using argv arrays;
- runs the longer profile download in an isolated uloop worker and exposes
  only a short-lived numeric status identifier;
- validates the official UCI settings before every execution;
- invokes the packaged `/usr/bin/lpac` entrypoint with positional argv;
- parses lpac newline-delimited JSON and returns a normalized response;
- does not return raw APDU, HTTP, activation-code, or confirmation-code data.

The download worker redirects lpac stdout and stderr before execution. Current
ucode releases support direct file-descriptor redirection. On legacy releases
without that API, the worker uses a constant shell `exec "$@"` redirection
shim; request values remain separate positional arguments and are never
interpolated into the shell program.

OpenWrt configures rpcd command execution with a 30-second timeout. The
one-shot RPC methods retain that limit. Profile download instead runs in a
bounded worker with a ten-minute ceiling and is polled through typed RPC; the
application does not change the system-wide rpcd timeout.

eUICC operations are launched through BusyBox `flock` on the same lock file
used by configuration writes. Before either use, the backend creates or repairs
the lock as a regular root-owned mode-0600 file and rejects non-regular or
non-root-owned paths. The lock descriptor is inherited by the packaged lpac
shim and compiled child process, so the eUICC remains serialized even if rpcd
times out or stops collecting an oversized command response. This locking
layer does not perform modem, interface, or network orchestration.

Serialization applies to calls made through this application. Direct CLI calls
or other managers must voluntarily use `/var/run/luci-lpac.lock` to avoid racing
the LuCI backend.

This favors safety over cancellation: after an rpcd timeout, a descendant lpac
process may continue holding the lock until it exits. Subsequent operations can
therefore remain busy if a modem driver is permanently hung; recovery then
requires terminating the stale process or rebooting the router.

The application does not reset modems or network interfaces. Some hardware
requires a SIM power cycle or reconnect after enabling or disabling a profile;
that lifecycle remains the responsibility of the modem/network stack.

The profile refresh flag is an ES10c request indicating that terminal refresh
is required; it is not a modem reboot. On a tested Fibocom L850-GL, enabling it
allowed ModemManager to perform a logical SIM reprobe and restore the cellular
connection in about eleven seconds without USB re-enumeration. Other eUICCs
may reject the flag, so the choice remains explicit rather than universal.

The Profiles view only offers deletion for a profile reported as disabled.
Direct RPC calls bypass that browser state check; the backend relies on the
eUICC to reject deletion of an enabled profile and normalizes the resulting
lpac error.

Settings writes update only the official options managed by this application,
including the merged upstream MBIM skip-slot-mapping option on this release
branch.
Additional package- or vendor-specific UCI options in the named sections are
left intact.

## Testing

The package targets the LuCI `master` branch. Before submission, run:

```sh
npx eslint applications/luci-app-lpac
applications/luci-app-lpac/tests/run-tests.sh
node applications/luci-app-lpac/tests/frontend.js
git diff --check
./build/i18n-scan.pl applications/luci-app-lpac \
  > applications/luci-app-lpac/po/templates/lpac.pot
make package/luci-app-lpac/clean package/luci-app-lpac/compile V=s
```

Real-device testing is required for every APDU backend that is claimed in a
pull request. Automated download tests must use synthetic activation values
and must not contact a provider or consume a live activation code.

Read and write validation was performed on OpenWrt 25.12.5 with a Fibocom
L850-GL and a modem-specific lpac 2.3.0-r2 package. This validates that
combination only and does not claim support for every modem, eUICC, backend, or
firmware.
