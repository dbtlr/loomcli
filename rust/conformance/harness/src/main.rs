//! `cargo run -p conformance-harness -- [--only <id prefix or group>] [--show <id>] [--bin-dir <dir>] [--json <file>] [--jobs <n>]`

use std::env;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use conformance_harness::runner::{APPS, Context, check_binaries, run_cases};
use conformance_harness::{accepted, cases, report};

const USAGE: &str = "usage: conformance-harness [--only <id prefix or group>] [--show <id>] [--bin-dir <dir>] [--json <file>] [--jobs <n>]";

#[derive(Default)]
struct Args {
    only: Option<String>,
    show: Option<String>,
    bin_dir: Option<PathBuf>,
    json: Option<PathBuf>,
    jobs: Option<usize>,
}

fn parse_args(mut raw: impl Iterator<Item = String>) -> Result<Args, String> {
    let mut args = Args::default();
    while let Some(flag) = raw.next() {
        let mut value = |name: &str| {
            raw.next()
                .ok_or_else(|| format!("{name} needs a value\n{USAGE}"))
        };
        match flag.as_str() {
            "--only" => args.only = Some(value("--only")?),
            "--show" => args.show = Some(value("--show")?),
            "--bin-dir" => args.bin_dir = Some(PathBuf::from(value("--bin-dir")?)),
            "--json" => args.json = Some(PathBuf::from(value("--json")?)),
            "--jobs" => {
                args.jobs = Some(
                    value("--jobs")?
                        .parse()
                        .map_err(|_| format!("--jobs needs a number\n{USAGE}"))?,
                );
            }
            other => return Err(format!("unknown argument {other}\n{USAGE}")),
        }
    }
    Ok(args)
}

/// The workspace root: the nearest ancestor of the working directory that holds `conformance/cases`.
fn find_root() -> Result<PathBuf, String> {
    let start = env::current_dir().map_err(|e| e.to_string())?;
    start
        .ancestors()
        .find(|dir| dir.join("conformance").join("cases").is_dir())
        .map(Path::to_path_buf)
        .ok_or_else(|| "run from inside the repository: no conformance/cases folder above the working directory".to_owned())
}

fn default_bin_dir(root: &Path) -> PathBuf {
    match env::var_os("CARGO_TARGET_DIR") {
        Some(dir) => env::current_dir()
            .map(|cwd| cwd.join(&dir))
            .unwrap_or_else(|_| PathBuf::from(dir))
            .join("debug"),
        None => root.join("target").join("debug"),
    }
}

fn run() -> Result<bool, String> {
    let args = parse_args(env::args().skip(1))?;
    let root = find_root()?;
    let conformance_dir = root.join("conformance");
    let all = cases::load_cases(&conformance_dir)?;
    let selected: Vec<&cases::Case> = match (&args.show, &args.only) {
        (Some(id), _) => all.iter().filter(|c| &c.id == id).collect(),
        (None, Some(only)) => all
            .iter()
            .filter(|c| c.id.starts_with(only.as_str()) || &c.group == only)
            .collect(),
        (None, None) => all.iter().collect(),
    };
    if selected.is_empty() {
        return Err("no case matches the selection".into());
    }
    // Each child runs in its own sandbox folder, so a relative binary path would resolve there.
    let bin_dir = match args.bin_dir.clone() {
        Some(dir) => std::path::absolute(&dir)
            .map_err(|e| format!("cannot resolve --bin-dir {}: {e}", dir.display()))?,
        None => default_bin_dir(&root),
    };
    let mut needed: Vec<&str> = APPS
        .into_iter()
        .filter(|a| selected.iter().any(|c| c.app == *a))
        .collect();
    needed.dedup();
    check_binaries(&bin_dir, &needed)?;
    let ctx = Context {
        accepted: accepted::load(&conformance_dir, &root.join("docs").join("deviations.md"))?,
        scratch_dir: root.join(".scratch").join("conformance-harness"),
        bin_dir,
        path_var: env::var("PATH").unwrap_or_default(),
        jobs: args.jobs.unwrap_or_else(|| {
            std::thread::available_parallelism()
                .map_or(4, usize::from)
                .min(8)
        }),
        conformance_dir,
    };
    let results = run_cases(&ctx, &selected);
    if args.show.is_some() {
        for r in &results {
            print!("{}", report::show(r));
        }
    }
    print!("{}", report::render(&results));
    if let Some(path) = &args.json {
        let text = serde_json::to_string_pretty(&report::json_summary(&results))
            .map_err(|e| e.to_string())?;
        std::fs::write(path, format!("{text}\n"))
            .map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    }
    Ok(report::succeeded(&results))
}

fn main() -> ExitCode {
    match run() {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::from(1),
        Err(message) => {
            eprintln!("conformance-harness: {message}");
            ExitCode::from(2)
        }
    }
}
