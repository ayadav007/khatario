# Khatario for Windows

A Tauri 2 app that opens the hosted Khatario site in a window of its own. Business logic stays on the
server; the app is a small compiled Rust program (release builds are stripped and link-time optimised).

- **Site:** `https://staging.khatario.com` (`src-tauri/tauri.conf.json`), `https://khatario.com` with
  `tauri.production.conf.json`.
- **Desktop detection:** every page gets `window.__KHATARIO_DESKTOP__` and a
  `khatario_client=desktop-<version>` cookie (`lib/desktop/platform.ts` in the web app). The marketing
  home page sends the desktop app straight to the app, as it does for the Android app.
- **Who can use it:** the same plans as the website (`web_access`); Free stays phone-only.
- **Links:** Khatario and Razorpay checkout stay in the window; other sites open in the default browser.
- **Native access:** none for the remote site yet (phase 2 adds printing commands with a narrow capability).
- **One copy:** opening Khatario again focuses the running window. Window size and position are remembered.
- **Updates:** checked at start-up from `<site>/desktop/updates/latest.json`; updates must be signed with
  the updater key (public key in `tauri.conf.json`).

## Build

Windows builds run on GitHub Actions: **Actions → Desktop (Windows) → Run workflow**, choose staging or
production. Download the artifact: the installer, its `.sig`, and `latest.json`.

Repository secrets needed once:

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | contents of `%USERPROFILE%\.tauri\khatario-desktop.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | contents of `%USERPROFILE%\.tauri\khatario-desktop.key.password` |

Keep both files somewhere safe (a password manager). Losing the key means installed apps can no longer
update themselves; anyone holding it can push updates to every installed copy.

To publish an update, copy the installer and `latest.json` to the server so they are served at
`<site>/desktop/updates/` (see `docs/SERVER_INFRASTRUCTURE.md` before changing nginx), then bump
`version` in `tauri.conf.json` and `Cargo.toml` for the next release.

Local builds need Rust and the Visual Studio C++ build tools (`cargo install tauri-cli`, then
`cargo tauri build`). On a PC where Windows App Control blocks locally built programs, use the workflow.

Icons in `src-tauri/icons` come from `public/icons/icon-512.png` (`cargo tauri icon`).
