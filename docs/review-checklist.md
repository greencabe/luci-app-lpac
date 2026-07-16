# Review checklist

- [ ] All backend tests pass.
- [ ] Official LuCI ESLint passes with no warnings.
- [ ] JavaScript, ucode, menu JSON, and ACL JSON parse successfully.
- [ ] The generated POT matches the committed template.
- [ ] SDK builds produce exactly one `luci-app-lpac` package per target.
- [ ] No lpac package is compiled or uploaded by the workflow.
- [ ] Artifact versions are nonzero and include a commit-derived revision.
- [ ] A first eUICC call after deleting the runtime lock recreates it as a
  regular root-owned mode-0600 file.
- [ ] Read/write ACL behavior is tested with separate LuCI users.
- [ ] Real write operations are tested through a management path independent of
  the cellular profile being changed.
- [ ] Logs and screenshots are redacted before publication.
- [ ] Upstream DCO name and email satisfy LuCI FormalityCheck.
