// Prevents additional console window on Windows in release, DO NOT REMOVE!!
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    talentscreen_apply_lib::run()
}
