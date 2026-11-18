fn main() {
    let attributes = tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "list_printers",
            "default_printer",
            "print_receipt_raw",
            "open_exports_folder",
        ]),
    );
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
