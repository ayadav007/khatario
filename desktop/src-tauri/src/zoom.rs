//! Screen size (page zoom) for the Khatario window, like Vyapar's "Screen Zoom/Scale".
//! Khatario's screens are sized for a browser, so the desktop app opens at 80% and lets the user
//! pick 70–130%. The choice is saved in the app's config folder and applied on every start.

use std::{fs, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State, WebviewWindow};

pub const DEFAULT_ZOOM: f64 = 0.8;
pub const MIN_ZOOM: f64 = 0.7;
pub const MAX_ZOOM: f64 = 1.3;
const FILE_NAME: &str = "display.json";

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
struct DisplaySettings {
    zoom: f64,
}

/// Current zoom, shared by the commands.
pub struct ZoomState(pub Mutex<f64>);

/// Keeps a zoom inside 70–130%, rounded to whole percent. Anything unreadable becomes the default.
pub fn clamp_zoom(value: f64) -> f64 {
    if !value.is_finite() {
        return DEFAULT_ZOOM;
    }
    (value.clamp(MIN_ZOOM, MAX_ZOOM) * 100.0).round() / 100.0
}

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(FILE_NAME))
}

/// Saved zoom, or the default when nothing is saved yet.
pub fn load_zoom<R: Runtime>(app: &AppHandle<R>) -> f64 {
    settings_path(app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<DisplaySettings>(&text).ok())
        .map(|s| clamp_zoom(s.zoom))
        .unwrap_or(DEFAULT_ZOOM)
}

fn save_zoom<R: Runtime>(app: &AppHandle<R>, zoom: f64) -> Result<(), String> {
    let path = settings_path(app).ok_or("no config folder")?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string(&DisplaySettings { zoom }).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn desktop_get_zoom(state: State<'_, ZoomState>) -> f64 {
    *state.0.lock().unwrap()
}

/// Sets the window zoom (0.7–1.3), saves it, and returns the value applied.
#[tauri::command]
pub fn desktop_set_zoom<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    state: State<'_, ZoomState>,
    zoom: f64,
) -> Result<f64, String> {
    let zoom = clamp_zoom(zoom);
    window.set_zoom(zoom).map_err(|e| e.to_string())?;
    *state.0.lock().unwrap() = zoom;
    save_zoom(&app, zoom)?;
    Ok(zoom)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_zoom_in_range() {
        assert_eq!(clamp_zoom(0.8), 0.8);
        assert_eq!(clamp_zoom(0.2), MIN_ZOOM);
        assert_eq!(clamp_zoom(3.0), MAX_ZOOM);
        assert_eq!(clamp_zoom(0.876), 0.88);
        assert_eq!(clamp_zoom(f64::NAN), DEFAULT_ZOOM);
    }
}
