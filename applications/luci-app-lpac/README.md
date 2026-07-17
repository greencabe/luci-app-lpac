# luci-app-lpac

`luci-app-lpac` is a clean-room LuCI frontend for the official OpenWrt
[`lpac`](https://github.com/openwrt/packages/tree/master/utils/lpac) package.
It uses `/usr/bin/lpac` and `/etc/config/lpac` as provided by that package and
does not bundle a second lpac build, modem manager, or hardware-specific
wrapper.

## Initial scope

- Show the installed lpac version, compiled drivers, and eUICC information.
- List, enable, disable, rename, and delete profiles.
- List and remove pending eUICC notifications.
- Configure the official AT, uqmi, MBIM, and PC/SC backends through validated
  RPC methods.

Network operations such as profile download, discovery, and notification
processing are intentionally deferred until the packaged lpac verifies TLS
peers and hostnames. Exposing those operations in a web UI before then would
not be safe. lpac 2.3.0 explicitly disables curl peer and hostname
verification in
[driver/http/curl.c](https://github.com/estkme-group/lpac/blob/v2.3.0/driver/http/curl.c#L90-L91).
Separately,
[estkme-group/lpac#444](https://github.com/estkme-group/lpac/pull/444)
tracks hardening of untrusted server-response handling.

Removing a pending notification only deletes its record from the eUICC. It
does not contact the provider or undo the profile operation, and discarding an
unprocessed record can leave the provider state out of sync. A bulk Process
action is intentionally absent while lpac TLS verification is disabled. The
packaged bulk implementation can also complete only part of a batch before an
error and does not guarantee the grouping and ordering required by SGP.22.

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
- delegates asynchronously to rpcd `file.exec` using an argv array;
- validates the official UCI settings before every execution;
- executes only the packaged `/usr/bin/lpac` entrypoint;
- parses lpac newline-delimited JSON and returns a normalized response;
- does not return raw APDU, HTTP, activation-code, or confirmation-code data.

OpenWrt configures rpcd command execution with a 30-second timeout. The
initial RPC methods are therefore limited to one-shot local eUICC operations;
the application does not change this system-wide timeout.

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
pull request.

Read and write validation was performed on OpenWrt 25.12.5 with a Fibocom
L850-GL and a modem-specific lpac 2.3.0-r2 package. This validates that
combination only and does not claim support for every modem, eUICC, backend, or
firmware.
