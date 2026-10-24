//! Project tasks, run with `cargo xtask <command>`:
//!
//! - `build`              compile the rules engine to WebAssembly and copy it into `module/wasm/`
//! - `package`            build, then write `dist/character-genesis.zip` and `dist/module.json`
//! - `install [DATA_DIR]` build, then copy `module/` into `<DATA_DIR>/modules/character-genesis`
//!                        (defaults to the local Foundry data folder)
//! - `serve [PORT]`       static file server for the browser harness in `dev/` (default 30777)

use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

const MODULE_ID: &str = "character-genesis";
const WASM_NAME: &str = "genesis_rules.wasm";

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().expect("workspace root").to_path_buf()
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("build") => build().map(|_| ()),
        Some("package") => package(),
        Some("install") => install(args.get(1).map(PathBuf::from)),
        Some("serve") => serve(args.get(1).and_then(|p| p.parse().ok()).unwrap_or(30777)),
        _ => {
            eprintln!("usage: cargo xtask <build | package | install [DATA_DIR] | serve [PORT]>");
            return ExitCode::from(2);
        }
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

/// Compile `genesis-rules` for wasm32 and copy the artifact into the module folder.
fn build() -> Result<PathBuf> {
    let root = root();
    let status = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()))
        .current_dir(&root)
        .args(["build", "--package", "genesis-rules", "--release", "--target", "wasm32-unknown-unknown"])
        .status()?;
    if !status.success() {
        return Err("cargo build for wasm32-unknown-unknown failed (is the target installed? \
                    `rustup target add wasm32-unknown-unknown`)"
            .into());
    }
    let built = root.join("target/wasm32-unknown-unknown/release").join(WASM_NAME);
    let dest_dir = root.join("module/wasm");
    fs::create_dir_all(&dest_dir)?;
    let dest = dest_dir.join(WASM_NAME);
    fs::copy(&built, &dest)?;
    println!("wasm  {} ({} KiB)", rel(&dest), fs::metadata(&dest)?.len() / 1024);
    Ok(dest)
}

fn module_version(module_dir: &Path) -> Result<String> {
    let manifest: serde_json::Value = serde_json::from_str(&fs::read_to_string(module_dir.join("module.json"))?)?;
    Ok(manifest["version"].as_str().unwrap_or("0.0.0").to_string())
}

/// Zip the module folder so it can be uploaded to a hosted Foundry server.
fn package() -> Result {
    build()?;
    let root = root();
    let module_dir = root.join("module");
    let dist = root.join("dist");
    fs::create_dir_all(&dist)?;
    let zip_path = dist.join(format!("{MODULE_ID}.zip"));
    let mut zip = zip::ZipWriter::new(fs::File::create(&zip_path)?);
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut files = Vec::new();
    collect_files(&module_dir, &mut files)?;
    files.sort();
    for file in &files {
        let name = file.strip_prefix(&module_dir)?.to_string_lossy().replace('\\', "/");
        zip.start_file(name, options)?;
        zip.write_all(&fs::read(file)?)?;
    }
    zip.finish()?;
    fs::copy(module_dir.join("module.json"), dist.join("module.json"))?;
    println!(
        "zip   {} ({} files, v{})",
        rel(&zip_path),
        files.len(),
        module_version(&module_dir)?
    );
    Ok(())
}

fn collect_files(dir: &Path, out: &mut Vec<PathBuf>) -> Result {
    for entry in fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            collect_files(&path, out)?;
        } else {
            out.push(path);
        }
    }
    Ok(())
}

/// Copy the module into a Foundry user-data folder (for a locally hosted server).
fn install(data_dir: Option<PathBuf>) -> Result {
    build()?;
    let data_dir = match data_dir {
        Some(d) => d,
        None => {
            let local = std::env::var("LOCALAPPDATA").map_err(|_| "pass the Foundry Data folder explicitly")?;
            PathBuf::from(local).join("FoundryVTT/Data")
        }
    };
    let modules = data_dir.join("modules");
    if !modules.is_dir() {
        return Err(format!("{} is not a Foundry Data folder (no modules/ directory)", data_dir.display()).into());
    }
    let dest = modules.join(MODULE_ID);
    if dest.exists() {
        fs::remove_dir_all(&dest)?;
    }
    let src = root().join("module");
    let mut files = Vec::new();
    collect_files(&src, &mut files)?;
    for file in &files {
        let target = dest.join(file.strip_prefix(&src)?);
        fs::create_dir_all(target.parent().unwrap())?;
        fs::copy(file, &target)?;
    }
    println!("installed {} files to {}", files.len(), dest.display());
    Ok(())
}

/* -------------------------------------------- */
/*  Dev server                                  */
/* -------------------------------------------- */

fn serve(port: u16) -> Result {
    build()?;
    let root = root();
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    println!("serving {} at http://localhost:{port}/dev/harness.html", root.display());
    for stream in listener.incoming().flatten() {
        let root = root.clone();
        std::thread::spawn(move || {
            if let Err(e) = handle(stream, &root) {
                eprintln!("request failed: {e}");
            }
        });
    }
    Ok(())
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "webm" => "video/webm",
        "mp4" => "video/mp4",
        _ => "text/plain; charset=utf-8",
    }
}

fn handle(mut stream: TcpStream, root: &Path) -> Result {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    // Drain headers; this server never reads bodies.
    let mut line = String::new();
    while reader.read_line(&mut line)? > 2 {
        line.clear();
    }

    let raw_path = request_line.split_whitespace().nth(1).unwrap_or("/");
    let path = raw_path.split(['?', '#']).next().unwrap_or("/");
    let decoded = path.replace("%20", " ");
    let relative = decoded.trim_start_matches('/');
    if relative.is_empty() {
        // Relative imports in the harness need the /dev/ base path.
        write!(stream, "HTTP/1.1 302 Found\r\nLocation: /dev/harness.html\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")?;
        return Ok(());
    }
    // Foundry serves the module at modules/character-genesis/; the harness page lives under dev/.
    let module_prefix = format!("modules/{MODULE_ID}/");
    let in_module = relative.strip_prefix(&module_prefix)
        .or_else(|| relative.strip_prefix("dev/").and_then(|r| r.strip_prefix(&module_prefix)));
    let mapped = match in_module {
        Some(rest) => format!("module/{rest}"),
        None => relative.to_string(),
    };
    let candidate = root.join(&mapped);

    // Refuse anything that escapes the project root.
    let resolved = candidate.canonicalize().ok().filter(|p| p.starts_with(root.canonicalize().unwrap()));
    let (status, body, ctype) = match resolved {
        Some(p) if p.is_file() => {
            let mut buf = Vec::new();
            fs::File::open(&p)?.read_to_end(&mut buf)?;
            ("200 OK", buf, content_type(&p))
        }
        _ => ("404 Not Found", b"not found".to_vec(), "text/plain"),
    };
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    )?;
    stream.write_all(&body)?;
    Ok(())
}

fn rel(p: &Path) -> String {
    p.strip_prefix(root()).unwrap_or(p).display().to_string()
}
