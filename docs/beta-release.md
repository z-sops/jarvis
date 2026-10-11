# Orbit 0.1.0-beta.1 — build candidate

This is a testing build candidate, not a completed-project acceptance or public release.
The existing app ID, product name and user-data behavior remain unchanged. Use a
disposable Windows test account/profile; this build is not isolated from an existing
Orbit installation. Back up your existing Home before upgrading. Uninstall preserves
application data. Installation does not automatically launch Orbit.

## Build on an approved Windows x64 host

Use the current draft branch with its own installed Windows dependencies. Do not copy
Linux node_modules or borrow Electron from an unrelated project.

```powershell
Set-Location 'G:\jarvis-containment-check'
powershell -NoProfile -File '.\scripts\beta-build.ps1'
```

The script refuses missing installed Electron/builder; it does not install packages.
Electron-builder can download vendor NSIS/signing tools when they are not cached; run
only after those build-tool downloads are approved. No GitHub release is published.
Expected artifact: `dist/Orbit-Beta-Setup-0.1.0-beta.1-x64.exe`, plus its displayed
SHA256. A checksum is an integrity identifier, not Authenticode signing proof.
Signing certificate provisioning and actual Windows installation/uninstallation remain
release gates. Do not disable Windows protection to bypass unsigned-binary warnings.

Source checks run before packaging; the ASAR check afterwards verifies first-party
bytes, required dependency entries, excluded secrets/profiles and the real unpacked
Docker helper. SDK transitives and platform-specific native dependencies require actual
packaged runtime acceptance; entry presence alone is not proof of functionality.
Docker Desktop, an approved native runtime image, NeuralOps and provider credentials
are separate prerequisites. They are not bundled, installed or billed by this build.

## Known limitations for testers

- New scoped live discussions, mediated remote acts and nested leaders have backend
  and offline regression evidence. Complete dedicated UI integration remains pending.
- Live provider discussions, deployed remote authentication/delivery and meaningful
  real-project planning/review need final E2E acceptance.
- Kimi/Qwen/DeepSeek strict-budget generation is blocked without a verified exact
  pre-count adapter. Catalog/text/usage support is partial.
- Storage quotas cover known managed writes, not all OS/Docker/external writes.
  Physical power loss, full-disk behavior and production key lifecycle remain gates.
- Supported native private-state recovery does not imply arbitrary plugin portability.
- Installer signing, actual Windows setup/upgrade/uninstall and complete project E2E
  have not been verified by Linux Electron or archive fixtures.

The release reviewer must record revision, installer SHA256/signature status, Windows
version, fresh-profile install/boot, existing-data preservation, native prerequisites,
complete-project E2E and known issues before approving distribution. Do not merge or
publish solely because an installer was generated.
