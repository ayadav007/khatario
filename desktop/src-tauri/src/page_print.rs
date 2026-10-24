//! Silent A4 / A5 printing: a Khatario print page (`/print/document?src=…`, which draws the bill's
//! HTML) is loaded in a hidden window and printed with WebView2's own print engine straight to a
//! chosen Windows printer — no dialog, like Tally / Vyapar "print on save".
//!
//! The page tells us it is ready by setting its title to `khatario-print-ready` (fonts and images
//! loaded) or `khatario-print-failed`. Only the Khatario host's /print/document page can be printed.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc;
use std::time::Duration;

use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

const READY_TITLE: &str = "khatario-print-ready";
const FAILED_TITLE: &str = "khatario-print-failed";
const LOAD_TIMEOUT: Duration = Duration::from_secs(30);
const PRINT_TIMEOUT: Duration = Duration::from_secs(120);

static NEXT_JOB: AtomicU32 = AtomicU32::new(1);

/// The print page URL on the app's own Khatario host; anything else is refused.
pub fn print_page_url(home: &Url, path: &str) -> Result<Url, String> {
    if !path.starts_with("/print/document?") {
        return Err("Only Khatario documents can be printed this way.".into());
    }
    let url = home.join(path).map_err(|_| "The document address is not valid.".to_string())?;
    if url.host_str() != home.host_str() || url.scheme() != "https" {
        return Err("Only Khatario documents can be printed this way.".into());
    }
    Ok(url)
}

fn home_url(app: &AppHandle) -> Result<Url, String> {
    app.config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .and_then(|w| match &w.url {
            WebviewUrl::External(url) => Some(url.clone()),
            _ => None,
        })
        .ok_or_else(|| "The app is not set up for printing.".to_string())
}

#[cfg(windows)]
fn print_with_webview2(
    platform: tauri::webview::PlatformWebview,
    printer: String,
    copies: u32,
    landscape: bool,
    done: mpsc::Sender<Result<(), String>>,
) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2PrintSettings2, ICoreWebView2_16, COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE,
        COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT, COREWEBVIEW2_PRINT_STATUS_PRINTER_UNAVAILABLE,
        COREWEBVIEW2_PRINT_STATUS_SUCCEEDED,
    };
    use webview2_com::PrintCompletedHandler;
    use windows::core::{Interface, HSTRING};

    let started = (|| -> windows::core::Result<()> {
        unsafe {
            let webview: ICoreWebView2_16 = platform.controller().CoreWebView2()?.cast()?;
            let env: ICoreWebView2Environment6 = platform.environment().cast()?;
            let settings = env.CreatePrintSettings()?;
            settings.SetShouldPrintHeaderAndFooter(false)?;
            settings.SetShouldPrintBackgrounds(true)?;
            settings.SetOrientation(if landscape {
                COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE
            } else {
                COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT
            })?;
            let settings2: ICoreWebView2PrintSettings2 = settings.cast()?;
            settings2.SetPrinterName(&HSTRING::from(printer.as_str()))?;
            settings2.SetCopies(copies.clamp(1, 10) as i32)?;
            let reply = done.clone();
            let printer_name = printer.clone();
            webview.Print(
                &settings,
                &PrintCompletedHandler::create(Box::new(move |result, status| {
                    let outcome = if result.is_err() {
                        Err(format!("Windows could not print to \"{printer_name}\"."))
                    } else if status == COREWEBVIEW2_PRINT_STATUS_SUCCEEDED {
                        Ok(())
                    } else if status == COREWEBVIEW2_PRINT_STATUS_PRINTER_UNAVAILABLE {
                        Err(format!("\"{printer_name}\" is not available. Check it is on and connected."))
                    } else {
                        Err(format!("Printing to \"{printer_name}\" failed."))
                    };
                    let _ = reply.send(outcome);
                    Ok(())
                })),
            )?;
        }
        Ok(())
    })();
    if let Err(error) = started {
        let _ = done.send(Err(format!("This Windows version cannot print silently ({error}). Update Microsoft Edge WebView2.")));
    }
}

#[cfg(not(windows))]
fn print_with_webview2(
    _platform: tauri::webview::PlatformWebview,
    _printer: String,
    _copies: u32,
    _landscape: bool,
    done: mpsc::Sender<Result<(), String>>,
) {
    let _ = done.send(Err("Silent printing is only available on Windows.".into()));
}

/// Prints a Khatario print page to a Windows printer without a dialog.
#[tauri::command]
pub async fn desktop_print_page(
    app: AppHandle,
    path: String,
    printer: String,
    copies: Option<u32>,
    landscape: Option<bool>,
) -> Result<(), String> {
    let url = print_page_url(&home_url(&app)?, &path)?;
    let installed = tauri::async_runtime::spawn_blocking(crate::printing::installed_printer_names)
        .await
        .map_err(|_| "Printing was interrupted.".to_string())??;
    if !installed.iter().any(|p| p == &printer) {
        return Err(format!("\"{printer}\" is no longer installed on this computer."));
    }

    let label = format!("print-job-{}", NEXT_JOB.fetch_add(1, Ordering::Relaxed));
    let (loaded_tx, loaded_rx) = mpsc::channel::<bool>();
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url))
        .title("Khatario print")
        .visible(false)
        .skip_taskbar(true)
        .inner_size(900.0, 1200.0)
        .on_document_title_changed(move |_, title| {
            if title == READY_TITLE {
                let _ = loaded_tx.send(true);
            } else if title == FAILED_TITLE {
                let _ = loaded_tx.send(false);
            }
        })
        .build()
        .map_err(|e| format!("Could not prepare the print: {e}"))?;

    let result = async {
        let loaded = tauri::async_runtime::spawn_blocking(move || loaded_rx.recv_timeout(LOAD_TIMEOUT))
            .await
            .map_err(|_| "Printing was interrupted.".to_string())?;
        match loaded {
            Ok(true) => {}
            Ok(false) => return Err("The document could not be loaded. Check you are signed in, then try again.".to_string()),
            Err(_) => return Err("The document took too long to load. Check the internet connection.".to_string()),
        }
        let (done_tx, done_rx) = mpsc::channel::<Result<(), String>>();
        let copies = copies.unwrap_or(1);
        let landscape = landscape.unwrap_or(false);
        let target = printer.clone();
        window
            .with_webview(move |platform| print_with_webview2(platform, target, copies, landscape, done_tx))
            .map_err(|e| format!("Could not start printing: {e}"))?;
        tauri::async_runtime::spawn_blocking(move || done_rx.recv_timeout(PRINT_TIMEOUT))
            .await
            .map_err(|_| "Printing was interrupted.".to_string())?
            .map_err(|_| format!("\"{printer}\" did not finish printing. Check the printer queue."))?
    }
    .await;

    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.close();
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prints_only_the_khatario_print_page() {
        let home = Url::parse("https://staging.khatario.com/login").unwrap();
        let ok = print_page_url(&home, "/print/document?src=%2Fapi%2Finvoices%2Fabc%2Fpreview").unwrap();
        assert_eq!(ok.host_str(), Some("staging.khatario.com"));
        assert!(print_page_url(&home, "/invoices/abc").is_err());
        assert!(print_page_url(&home, "//evil.example/print/document?src=x").is_err());
        assert!(print_page_url(&home, "https://evil.example/print/document?src=x").is_err());
    }
}
