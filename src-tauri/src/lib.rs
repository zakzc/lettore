use std::{net::TcpListener, sync::Mutex};

use serde::Serialize;
use tauri::{Manager, RunEvent, State};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

#[derive(Clone, Serialize)]
struct SidecarInfo {
    port: u16,
    token: String,
}

struct Sidecar {
    info: SidecarInfo,
    child: Mutex<Option<CommandChild>>,
}

#[tauri::command]
fn sidecar_info(sidecar: State<Sidecar>) -> SidecarInfo {
    sidecar.info.clone()
}

fn start_sidecar(app: &tauri::AppHandle) -> Result<Sidecar, Box<dyn std::error::Error>> {
    let port = TcpListener::bind("127.0.0.1:0")?.local_addr()?.port();
    let token = uuid::Uuid::new_v4().to_string();
    let (_rx, child) = app
        .shell()
        .sidecar("lettore-sidecar")?
        .args(["--port", &port.to_string(), "--token", &token])
        .spawn()?;
    Ok(Sidecar {
        info: SidecarInfo { port, token },
        child: Mutex::new(Some(child)),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(start_sidecar(app.handle())?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![sidecar_info])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                // Dropping stdin makes the sidecar exit on its own; kill is a backstop.
                if let Some(child) = app
                    .state::<Sidecar>()
                    .child
                    .lock()
                    .ok()
                    .and_then(|mut c| c.take())
                {
                    let _ = child.kill();
                }
            }
        });
}
