# FD CODE release readiness

This checklist complements [the release runbook](./release.md). It records the
distribution-specific decisions that must be verified before publishing FD CODE.

## Platform and artifact matrix

| Platform | Architectures | Desktop artifact                                 |
| -------- | ------------- | ------------------------------------------------ |
| macOS    | arm64, x64    | `FD-CODE-<version>-<arch>.dmg` and update `.zip` |
| Windows  | x64, arm64    | `FD-CODE-<version>-<arch>.exe` (NSIS)            |
| Linux    | x64, arm64    | `FD-CODE-<version>-<arch>.AppImage` and `.deb`   |

CLI archives retain the compatibility name
`t3-<version>-<node-platform>-<arch>.tar.gz` (`.zip` on Windows), but contain the
`fd-code` executable. Windows desktop releases embed the same-architecture Linux
archive for WSL.

## Build and validation

Install with the Node version declared in `package.json`, then use:

```bash
vp install
vp run build:desktop
node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 --build-version <version>
node scripts/build-desktop-artifact.ts --platform win --target nsis --arch x64 --build-version <version> --wsl-runtime <linux-cli-archive>
```

Run the focused release checks before the full CI matrix:

```bash
vp test run scripts/build-desktop-artifact.test.ts
vp test run apps/desktop/scripts/smoke-test-lib.test.mjs apps/desktop/src/wsl/DesktopWslEnvironment.test.ts
node apps/desktop/scripts/smoke-test-macos-dmg.mjs --dmg <artifact> --expect-arch <arch>
node apps/desktop/scripts/smoke-test-windows-installer.mjs --installer <artifact>
```

The macOS smoke must run on macOS. The Windows smoke must run on native Windows;
`.github/workflows/windows-desktop-smoke.yml` builds an unsigned x64 NSIS
installer, installs it below an isolated temporary profile, verifies renderer and
backend readiness plus restart persistence, checks clean process shutdown, and
silently uninstalls it. Cross-compilation is not native validation.

Run the repository typecheck, provider suites, OpenCode recovery tests, and the
General/Laya/Brain/ARTsie tests described by CI before release. Report skipped and
environment-blocked checks separately from passes.

## Signing and notarization

Local and pull-request smoke artifacts are unsigned. Public artifacts require:

- macOS: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`,
  `APPLE_API_ISSUER`, and `MACOS_PROVISIONING_PROFILE`;
- Windows: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`,
  `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`,
  `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`, and
  `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`.

Do not describe an unsigned smoke artifact as release-ready. Verify macOS
notarization and stapling and Windows signatures in the release workflow before
publication.

## Authentication

- **Codex CLI:** FD CODE can reuse an existing official `codex login`. Managed
  ChatGPT login uses the existing OAuth authorization-code flow with PKCE, state,
  nonce, callback validation, refresh-token rotation, disconnect, and named
  account selection. Credentials remain in the server credential store.
- **Claude Code:** FD CODE discovers the official Claude executable and reuses its
  authentication. If logged out, run `claude auth login` on the environment's
  machine. Named instances may set a separate `CLAUDE_CONFIG_DIR`; the default
  profile is not moved or replaced.

Fixture tests do not prove a live interactive login. Never inspect credentials,
log out an existing profile, or make a paid request as part of release validation.
For packaged desktop checks, confirm status refresh and logged-out guidance using
an isolated profile; perform a live OAuth sign-in only with an explicitly
authorized test account.

## Recovery and limitations

OpenCode v2 reconnects interrupted event streams, rejects stale events from a
superseded stream, and reconciles completed or missing sessions. See
[OpenCode recovery](./opencode-recovery.md) for the operational behavior.

Internal compatibility identifiers are intentionally retained: desktop app ID
`com.t3tools.t3code`, renderer schemes `t3code` and `t3code-dev`, Electron profile
`t3code-v2`, credential/keychain ownership, and archive stems. Changing them would
split application data, protocol ownership, credentials, or update continuity and
requires an explicit migration decision.

The staged package still carries `https://t3.codes` and `T3 Tools` metadata. Treat
the final publisher/homepage values as a maintainer release decision rather than
silently claiming another product's identity. The updater uses
`T3CODE_DESKTOP_UPDATE_REPOSITORY` when set and otherwise `GITHUB_REPOSITORY`; a
release job must set the intended FD CODE repository and must never point at a
different product's releases.

## Manual pre-release checks

1. Confirm the version, channel, commit, repository slug, artifact names, sizes,
   and SHA-256 entries.
2. Run native install, launch, renderer/backend readiness, restart persistence,
   shutdown, and uninstall checks on each required operating system.
3. Confirm installer display name, executable name, publisher, protocol handlers,
   profile location, and coexistence with an official T3 Code installation.
4. Verify signatures, macOS notarization/stapling, updater metadata, and download
   URLs without publishing.
5. Exercise Codex and Claude status refresh with isolated profiles. Record live
   interactive authentication as untested unless it was actually completed.
6. Review the release diff for credentials, personal data, generated artifacts,
   caches, and changes to persisted identifiers.
