//! Khatario for Windows.
//!
//! One window that loads the hosted Khatario web app (staging or production, set by the `main`
//! window url in tauri.conf.json). All business logic stays on the server; this shell adds the
//! things a browser tab cannot: an installed app with one running copy, remembered window size,
//! signed auto-update, and links to other sites opening in the default browser.
//!
//! The remote page may call only the commands listed in capabilities/remote-site.json
//! (screen size, printing — see printing.rs), and only from the Khatario sites.

mod page_print;
mod printing;
mod zoom;

use std::sync::Mutex;

use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, Url, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

const MAIN_WINDOW: &str = "main";

/// Lets the web app know it runs inside the desktop app (client: window.__KHATARIO_DESKTOP__,
/// server: the khatario_client cookie). Runs before the page's own scripts on every load.
fn desktop_marker_script(version: &str) -> String {
    format!(
        r#"(function () {{
  window.__KHATARIO_DESKTOP__ = Object.freeze({{ platform: 'windows', version: '{version}' }});
  try {{ document.cookie = 'khatario_client=desktop-{version}; path=/; max-age=31536000; SameSite=Lax; Secure'; }} catch (e) {{}}
}})();"#
    )
}

/// Pages that stay inside the app window: the Khatario host itself and the payment gateway
/// checkout. Everything else (WhatsApp links, help pages, maps) opens in the default browser.
fn stays_in_app(target: &Url, home: &Url) -> bool {
    match target.scheme() {
        "https" | "http" => {}
        "about" | "blob" | "data" | "tauri" => return true,
        _ => return false,
    }
    let host = target.host_str().unwrap_or_default();
    let home_host = home.host_str().unwrap_or_default();
    host == home_host || host == "razorpay.com" || host.ends_with(".razorpay.com")
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Checks the signed update feed once at start-up and offers to install a newer version.
async fn offer_update(app: AppHandle) -> tauri_plugin_updater::Result<()> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };
    let prompt_app = app.clone();
    let version = update.version.clone();
    let install = tauri::async_runtime::spawn_blocking(move || {
        prompt_app
            .dialog()
            .message(format!(
                "Khatario {version} is ready. Install it now? Khatario will close and reopen."
            ))
            .title("Update available")
            .kind(MessageDialogKind::Info)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Install now".into(),
                "Later".into(),
            ))
            .blocking_show()
    })
    .await
    .unwrap_or(false);

    if install {
        update.download_and_install(|_, _| {}, || {}).await?;
        app.restart();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Opening Khatario again focuses the running window instead of starting a second copy.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app)
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            zoom::desktop_get_zoom,
            zoom::desktop_set_zoom,
            printing::desktop_list_printers,
            printing::desktop_print_windows,
            printing::desktop_print_network,
            printing::desktop_probe_network,
            printing::desktop_scan_network,
            printing::desktop_network_printer_status,
            page_print::desktop_print_page,
            printing::desktop_list_serial_ports,
            printing::desktop_print_serial
        ])
        .setup(|app| {
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == MAIN_WINDOW)
                .cloned()
                .expect("tauri.conf.json must define the main window");
            let home = match &config.url {
                tauri::WebviewUrl::External(url) => url.clone(),
                _ => panic!("the main window url must be the hosted Khatario address"),
            };

            let opener = app.handle().clone();
            let popup_opener = app.handle().clone();
            let popup_home = home.clone();
            let version = app.package_info().version.to_string();
            let saved_zoom = zoom::load_zoom(app.handle());
            app.manage(zoom::ZoomState(Mutex::new(saved_zoom)));
            let window = WebviewWindowBuilder::from_config(app.handle(), &config)?
                .initialization_script(desktop_marker_script(&version))
                .on_navigation(move |url| {
                    if stays_in_app(url, &home) {
                        return true;
                    }
                    let _ = opener.opener().open_url(url.as_str(), None::<&str>);
                    false
                })
                // Khatario pop-ups (PDF bills, print previews) open in an app window with the
                // WebView's own Print button; pop-ups to other sites go to the default browser.
                .on_new_window(move |url, _features| {
                    if stays_in_app(&url, &popup_home) {
                        return NewWindowResponse::Allow;
                    }
                    let _ = popup_opener.opener().open_url(url.as_str(), None::<&str>);
                    NewWindowResponse::Deny
                })
                .build()?;
            // Khatario's screens are sized for a browser; open smaller, like a desktop app.
            window.set_zoom(saved_zoom)?;

            let updater_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = offer_update(updater_app).await {
                    eprintln!("Khatario update check failed: {error}");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Khatario");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn keeps_khatario_and_checkout_in_the_window() {
        let home = url("https://staging.khatario.com");
        assert!(stays_in_app(&url("https://staging.khatario.com/invoices/new"), &home));
        assert!(stays_in_app(&url("https://api.razorpay.com/v1/checkout"), &home));
        assert!(stays_in_app(&url("about:blank"), &home));
    }

    #[test]
    fn sends_other_sites_to_the_browser() {
        let home = url("https://staging.khatario.com");
        assert!(!stays_in_app(&url("https://khatario.com/"), &home));
        assert!(!stays_in_app(&url("https://wa.me/919800000000"), &home));
        assert!(!stays_in_app(&url("https://evil-razorpay.com/"), &home));
        assert!(!stays_in_app(&url("mailto:help@khatario.com"), &home));
    }

    #[test]
    fn marks_the_page_as_desktop() {
        let script = desktop_marker_script("0.1.0");
        assert!(script.contains("__KHATARIO_DESKTOP__"));
        assert!(script.contains("khatario_client=desktop-0.1.0"));
    }
}
