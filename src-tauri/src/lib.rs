use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, State};
use std::net::TcpStream;
use std::time::Duration;


struct AutomationChild {
    process: Child,
}
struct AutomationProcess(Mutex<Option<AutomationChild>>);
fn automation_server_running() -> bool {
    TcpStream::connect_timeout(
        &"127.0.0.1:8765".parse().unwrap(),
        Duration::from_millis(500),
    )
    .is_ok()
} 

fn find_sidecar_launch_target(app: &tauri::AppHandle) -> Result<(Command, Option<PathBuf>), String> {
    let binary_names = if cfg!(target_os = "windows") {
        vec!["talentscreen-automation.exe", "automation.exe", "main.exe"]
    } else {
        vec!["talentscreen-automation", "automation", "main"]
    };

    let mut base_dirs: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        base_dirs.push(res.clone());
        base_dirs.push(res.join("resources"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            base_dirs.push(parent.to_path_buf());
            base_dirs.push(parent.join("resources"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        base_dirs.push(cwd.clone());
        base_dirs.push(cwd.join("resources"));
    }

    let mut sub_binary_paths: Vec<PathBuf> = Vec::new();
    for b in &binary_names {
        sub_binary_paths.push(Path::new("_up_").join("automation-sidecar").join("bin").join(b));
        sub_binary_paths.push(Path::new("_up_").join("automation-sidecar").join(b));
        sub_binary_paths.push(Path::new("automation-sidecar").join("bin").join(b));
        sub_binary_paths.push(Path::new("automation-sidecar").join(b));
        sub_binary_paths.push(Path::new("resources").join("_up_").join("automation-sidecar").join("bin").join(b));
        sub_binary_paths.push(Path::new("resources").join("_up_").join("automation-sidecar").join(b));
        sub_binary_paths.push(Path::new("resources").join("automation-sidecar").join("bin").join(b));
        sub_binary_paths.push(Path::new("resources").join("automation-sidecar").join(b));
        sub_binary_paths.push(Path::new("resources").join("bin").join(b));
        sub_binary_paths.push(Path::new("resources").join(b));
        sub_binary_paths.push(Path::new("bin").join(b));
        sub_binary_paths.push(PathBuf::from(b));
    }

    let mut checked_locations: Vec<String> = Vec::new();
    let mut found_binary: Option<PathBuf> = None;

    for base in &base_dirs {
        for sub in &sub_binary_paths {
            let candidate = base.join(sub);
            if candidate.is_file() {
                found_binary = Some(candidate);
                break;
            } else {
                checked_locations.push(candidate.display().to_string());
            }
        }
        if found_binary.is_some() {
            break;
        }
    }

    let (command, executable_path) = if let Some(bin_path) = found_binary {
        (Command::new(&bin_path), bin_path)
    } else {
        let sub_script_paths = [
            Path::new("_up_").join("automation-sidecar").join("main.py"),
            Path::new("automation-sidecar").join("main.py"),
            Path::new("resources").join("_up_").join("automation-sidecar").join("main.py"),
            Path::new("resources").join("automation-sidecar").join("main.py"),
            Path::new("resources").join("main.py"),
            PathBuf::from("main.py"),
        ];
        let mut found_script: Option<PathBuf> = None;
        for base in &base_dirs {
            for sub in &sub_script_paths {
                let candidate = base.join(sub);
                if candidate.is_file() {
                    found_script = Some(candidate);
                    break;
                } else {
                    checked_locations.push(candidate.display().to_string());
                }
            }
            if found_script.is_some() {
                break;
            }
        }

        if let Some(script_path) = found_script {
            let py_exe = if cfg!(target_os = "windows") {
                if Command::new("python").arg("--version").stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok() {
                    "python"
                } else if Command::new("py").arg("--version").stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok() {
                    "py"
                } else {
                    "python"
                }
            } else {
                if Command::new("python3").arg("--version").stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok() {
                    "python3"
                } else if Command::new("python").arg("--version").stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok() {
                    "python"
                } else {
                    "python3"
                }
            };

            let mut py_cmd = Command::new(py_exe);
            py_cmd.arg(&script_path);
            (py_cmd, script_path)
        } else {
            let formatted_list = checked_locations.join("\n- ");
            let primary_binary = binary_names[0];
            return Err(format!(
                "packaged automation engine executable ({primary_binary}) or script (main.py) was not found.\nChecked locations:\n- {formatted_list}"
            ));
        }
    };

    let sub_browser_paths = [
        Path::new("_up_").join("automation-sidecar").join("browsers"),
        Path::new("automation-sidecar").join("browsers"),
        Path::new("resources").join("_up_").join("automation-sidecar").join("browsers"),
        Path::new("resources").join("automation-sidecar").join("browsers"),
        Path::new("resources").join("browsers"),
        PathBuf::from("browsers"),
    ];
    let mut found_browsers: Option<PathBuf> = None;

    for base in &base_dirs {
        for sub in &sub_browser_paths {
            let candidate = base.join(sub);
            if candidate.is_dir() {
                found_browsers = Some(candidate);
                break;
            }
        }
        if found_browsers.is_some() {
            break;
        }
    }

    if found_browsers.is_none() {
        if let Some(p) = executable_path.parent() {
            let checks = [
                p.join("browsers"),
                p.join("..").join("browsers"),
                p.join("..").join("..").join("browsers"),
                p.join("..").join("..").join("..").join("browsers"),
            ];
            for candidate in checks {
                if candidate.is_dir() {
                    found_browsers = Some(candidate);
                    break;
                }
            }
        }
    }

    Ok((command, found_browsers))
}

#[tauri::command]
fn start_automation_sidecar(app: tauri::AppHandle, state: State<'_, AutomationProcess>) -> Result<(), String> {
    // Lock mutex FIRST — serialises concurrent calls so only one sidecar is ever
    // spawned, even while the process is still starting and port 8765 is not yet open.
    let mut child = state.0.lock().map_err(|_| "automation process lock failed")?;

    // If we already have a registered child that is still alive, reuse it.
    if let Some(running) = child.as_mut() {
        match running.process.try_wait() {
            Ok(None) => return Ok(()), // Still running — nothing to do.
            _ => { *child = None; }   // Exited or error — clear stale entry.
        }
    }

    // Short-circuit if another process (e.g. previous session) already holds port 8765.
    if automation_server_running() {
        println!("Automation server already running on port 8765.");
        return Ok(());
    }

    

    let (mut command, active_browser_dir) = find_sidecar_launch_target(&app)?;

    let session_dir = if let Ok(appdata) = std::env::var("APPDATA") {
        std::path::PathBuf::from(appdata).join(".talentscreen_resume")
    } else if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        std::path::PathBuf::from(home).join(".talentscreen_resume")
    } else {
        std::env::temp_dir().join(".talentscreen_resume")
    };
    std::fs::create_dir_all(&session_dir).map_err(|e| e.to_string())?;

    // Redirect sidecar output to a log file so crash reasons are visible.
    let log_path = session_dir.join("sidecar.log");
    let log_file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path)
        .ok();
    let (stdout_stdio, stderr_stdio) = if let Some(f) = log_file {
        let f2 = f.try_clone().unwrap_or_else(|_| {
            OpenOptions::new().write(true).open(&log_path).unwrap()
        });
        (Stdio::from(f), Stdio::from(f2))
    } else {
        (Stdio::null(), Stdio::null())
    };



    if let Some(ref browser_dir) = active_browser_dir {
        command.env("PLAYWRIGHT_BROWSERS_PATH", browser_dir);
    }

    let mut spawned = command
        .env("TALENTSCREEN_SESSION_DIR", &session_dir)
        .stdin(Stdio::piped())
        .stdout(stdout_stdio)
        .stderr(stderr_stdio)
        .spawn()
        .map_err(|e| format!("could not start automation sidecar: {e}"))?;

    // Wait briefly and check for an immediate crash (reduced to 500 ms).
    std::thread::sleep(std::time::Duration::from_millis(500));
    match spawned.try_wait() {
        Ok(Some(status)) => {
            // Process already exited — read the log for the real error.
            let log_contents = std::fs::read_to_string(&log_path)
                .unwrap_or_default();
            let snippet = log_contents
                .lines()
                .rev()
                .take(10)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join(" | ");
            return Err(format!(
                "automation sidecar exited immediately (code {:?}). browsers_path={} log={}",
                status.code(),
                active_browser_dir.as_ref().map(|p| p.display().to_string()).unwrap_or_else(|| "None".into()),
                if snippet.is_empty() { "(empty)".into() } else { snippet }
            ));
        }
        Ok(None) => {} // Still running — good.
        Err(e) => return Err(format!("could not check sidecar status: {e}")),
    }

    *child = Some(AutomationChild { process: spawned });
    Ok(())
}

#[tauri::command]
fn stop_automation_sidecar(state: State<'_, AutomationProcess>) -> Result<(), String> {
    if let Some(mut running) = state.0.lock().map_err(|_| "automation process lock failed")?.take() {
        running.process.kill().map_err(|e| e.to_string())?;
        let _ = running.process.wait();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AutomationProcess(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![start_automation_sidecar, stop_automation_sidecar])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let state = window.state::<AutomationProcess>();
                if let Ok(mut guard) = state.0.lock() {
                    if let Some(mut running) = guard.take() {
                        let _ = running.process.kill();
                        let _ = running.process.wait();
                    }
                };
            }
        })
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running TalentScreen Apply");
}
