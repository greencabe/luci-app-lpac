# Known limitations

- lpac 2.3.0 disables curl TLS peer and hostname verification. Profile
  download, discovery, and network notification processing are excluded.
- Some tarball-built lpac packages report `v0.0.0-unknown` because their build
  cannot derive a Git version. This is a dependency packaging issue; it does
  not indicate that the eUICC operations failed.
- Notification sequence zero is valid, but lpac currently reports false success
  for explicit process/remove/dump operations on sequence zero. The UI displays
  it and disables removal.
- The UI only offers profile deletion when the reported state is disabled.
  Direct RPC calls bypass that browser guard and rely on the eUICC policy to
  reject deletion of an enabled profile.
- A timed-out descendant lpac process may continue holding the inherited lock.
  Recovery can require terminating that stale process or rebooting the router.
- Direct CLI tools and other managers can race the LuCI backend unless they use
  `/var/run/luci-lpac.lock`.
- BusyBox `flock` uses exit status 1 for lock contention and also propagates a
  child exit status of 1. The packaged lpac 2.3.0 normally reports failures
  through JSON and exits with 255, but a future or alternate lpac that exits 1
  before producing JSON could be reported as `busy`.
- Vendor-specific UCI options are preserved but are not exposed by the generic
  Settings page.
