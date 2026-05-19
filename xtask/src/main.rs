use clap::{Parser, Subcommand};
use std::process::Command;

#[derive(Parser)]
#[command(name = "xtask", about = "Metronome build orchestrator")]
struct Args {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Compile Rust → WASM → wasm-opt → public/wasm/
    Build,
    /// Alias for build
    BuildWasm,
    /// Spawn Vite dev server + watch rust/src/ for changes
    Dev,
}

fn main() {
    let args = Args::parse();
    match args.cmd {
        Cmd::Build | Cmd::BuildWasm => {
            build_wasm();
        }
        Cmd::Dev => {
            run_dev();
        }
    }
}

fn build_wasm() {
    eprintln!("[xtask] Step 1: cargo build --target wasm32-unknown-unknown");
    let status = Command::new(env!("CARGO"))
        .args([
            "build",
            "--release",
            "--target",
            "wasm32-unknown-unknown",
            "--manifest-path",
            "rust/Cargo.toml",
        ])
        .status()
        .expect("failed to run cargo build");
    if !status.success() {
        eprintln!("[xtask] cargo build failed with {:?}", status.code());
        std::process::exit(1);
    }

    // Note: We use #[no_mangle] pub extern "C" fn exports only (D-08) — no wasm-bindgen
    // annotations in the hot path. The wasm-bindgen-cli step is skipped because the binary
    // has no #[wasm_bindgen] markers and the CLI would fail. The AudioWorklet loads the
    // raw WASM via WebAssembly.compile() and calls exports directly (D-07).
    // The _bg.wasm naming convention is kept for consistency with the project plan.

    eprintln!("[xtask] Step 2: copy cargo WASM output → rust/pkg/ (skipping wasm-bindgen-cli: no #[wasm_bindgen] annotations)");
    std::fs::create_dir_all("rust/pkg").expect("failed to create rust/pkg/");
    std::fs::copy(
        "target/wasm32-unknown-unknown/release/metronome_engine.wasm",
        "rust/pkg/metronome_engine_bg.wasm",
    )
    .expect("failed to copy WASM binary to rust/pkg/");

    eprintln!("[xtask] Step 3: wasm-opt -O3 (optional — skipped if not installed)");
    let opt_result = Command::new("wasm-opt")
        .args([
            "-O3",
            "rust/pkg/metronome_engine_bg.wasm",
            "-o",
            "rust/pkg/metronome_engine_bg.wasm",
        ])
        .status();
    match opt_result {
        Ok(status) if status.success() => {
            eprintln!("[xtask] wasm-opt applied");
        }
        Ok(status) => {
            eprintln!(
                "[xtask] WARNING: wasm-opt exited with {:?} — continuing without optimization",
                status.code()
            );
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            eprintln!(
                "[xtask] WARNING: wasm-opt not found — skipping optimization (install binaryen for production builds)"
            );
        }
        Err(e) => {
            eprintln!("[xtask] WARNING: wasm-opt error: {e} — continuing without optimization");
        }
    }

    eprintln!("[xtask] Step 4: copy rust/pkg/metronome_engine_bg.wasm → public/wasm/");
    std::fs::create_dir_all("public/wasm").expect("failed to create public/wasm/");
    std::fs::copy(
        "rust/pkg/metronome_engine_bg.wasm",
        "public/wasm/metronome_engine_bg.wasm",
    )
    .expect("failed to copy WASM binary to public/wasm/");

    eprintln!("[xtask] Build complete: public/wasm/metronome_engine_bg.wasm");
}

fn run_dev() {
    // Initial build before starting watch
    build_wasm();

    eprintln!("[xtask] Spawning Vite dev server (npm run dev)…");
    let _vite = Command::new("npm")
        .args(["run", "dev"])
        .spawn()
        .expect("failed to spawn npm run dev");

    eprintln!("[xtask] Watching rust/src/ for changes…");
    let cwd = std::env::current_dir().expect("cannot get cwd");
    let mut build_cmd = Command::new(env!("CARGO"));
    build_cmd.args(["xtask", "build"]).current_dir(cwd);

    xtask_watch::Watch::default()
        .watch_path("rust/src")
        .run(build_cmd)
        .expect("watch failed");
}
