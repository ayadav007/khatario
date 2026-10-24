fn main() {
    // App commands the hosted Khatario site may call (screen size, printing) (allowed in capabilities/remote-site.json).
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "desktop_get_zoom",
                "desktop_set_zoom",
                "desktop_list_printers",
                "desktop_print_windows",
                "desktop_print_network",
                "desktop_probe_network",
                "desktop_scan_network",
                "desktop_network_printer_status",
                "desktop_print_page",
                "desktop_list_serial_ports",
                "desktop_print_serial",
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}
