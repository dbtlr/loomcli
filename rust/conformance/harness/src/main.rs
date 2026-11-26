//! The command-line runner for the Rust conformance harness.

use std::env;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use conformance_harness::runner::{
    APPS, Context, KnownDifferences, check_binaries, run_cases, rust_workspace,
};
use conformance_harness::{behind, cases, growth, report};

const USAGE: &str = "usage: conformance-harness [--only <id prefix or group>] [--show <id>] [--bin-dir <dir>] [--json <file>] [--jobs <n>] [--write-behind <file>]\n       conformance-harness --check-growth <base behind.json> --changed <file of changed paths>";

#[derive(Default)]
struct Args {
    only: Option<String>,
    show: Option<String>,
    bin_dir: Option<PathBuf>,
    json: Option<PathBuf>,
    jobs: Option<usize>,
    write_behind: Option<PathBuf>,
    check_growth: Option<PathBuf>,
    changed: Option<PathBuf>,
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
            "--write-behind" => args.write_behind = Some(PathBuf::from(value("--write-behind")?)),
            "--check-growth" => args.check_growth = Some(PathBuf::from(value("--check-growth")?)),
            "--changed" => args.changed = Some(PathBuf::from(value("--changed")?)),
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
    if args.write_behind.is_some() && (args.only.is_some() || args.show.is_some()) {
        return Err("omit --only and --show when writing a behind list".into());
    }
    let checks_growth = args.check_growth.is_some() || args.changed.is_some();
    if checks_growth
        && (args.check_growth.is_none()
            || args.changed.is_none()
            || args.only.is_some()
            || args.show.is_some()
            || args.bin_dir.is_some()
            || args.json.is_some()
            || args.jobs.is_some()
            || args.write_behind.is_some())
    {
        return Err(format!(
            "--check-growth and --changed go together, with no other argument\n{USAGE}"
        ));
    }
    Ok(args)
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

/// Compares the committed behind list with the base branch's and fails on growth the change's
/// paths do not explain. It runs no case.
fn check_growth(rust_dir: &Path, base: &Path, changed: &Path) -> Result<bool, String> {
    let base = behind::load(base)?;
    let head = behind::load(&rust_dir.join("conformance/behind.json"))?;
    let changed: Vec<String> = std::fs::read_to_string(changed)
        .map_err(|e| format!("cannot read {}: {e}", changed.display()))?
        .lines()
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect();
    let unexplained = growth::unexplained(growth::grown(&base, &head), &changed);
    if unexplained.is_empty() {
        println!(
            "behind.json grows for no case whose expected output this change leaves unchanged."
        );
        return Ok(true);
    }
    print!("{}", growth::render(&unexplained));
    Ok(false)
}

fn run() -> Result<bool, String> {
    let args = parse_args(env::args().skip(1))?;
    let rust_dir = rust_workspace()
        .canonicalize()
        .map_err(|e| format!("cannot find the Rust workspace: {e}"))?;
    if let (Some(base), Some(changed)) = (&args.check_growth, &args.changed) {
        return check_growth(&rust_dir, base, changed);
    }
    let conformance_dir = rust_dir.join("../conformance");
    let all = cases::load_cases(&conformance_dir)?;
    let differences = KnownDifferences::load()?;
    for entry in &differences.accepted {
        if !all.iter().any(|case| case.id == entry.id) {
            return Err(format!("accepted.json: unknown case {}", entry.id));
        }
    }
    for id in differences.behind.keys() {
        if !all.iter().any(|case| &case.id == id) {
            return Err(format!("behind.json: unknown case {id}"));
        }
        if differences.accepted.iter().any(|entry| &entry.id == id) {
            return Err(format!(
                "behind.json: {id} is already listed in accepted.json"
            ));
        }
    }
    let selected: Vec<&cases::Case> = match (&args.show, &args.only) {
        (Some(id), _) => all.iter().filter(|c| &c.id == id).collect(),
        (None, Some(only)) => all
            .iter()
            .filter(|c| c.id.starts_with(only.as_str()) || &c.group == only)
            .collect(),
        (None, None) => all.iter().collect(),
    };
    let full = args.only.is_none() && args.show.is_none();
    cases::check_expected_entries(&conformance_dir, &selected, full)?;
    if selected.is_empty() {
        return Err("no case matches the selection".into());
    }
    // Each child runs in its own sandbox folder, so a relative binary path would resolve there.
    let bin_dir = match args.bin_dir.clone() {
        Some(dir) => std::path::absolute(&dir)
            .map_err(|e| format!("cannot resolve --bin-dir {}: {e}", dir.display()))?,
        None => default_bin_dir(&rust_dir),
    };
    let mut needed: Vec<&str> = APPS
        .into_iter()
        .filter(|a| selected.iter().any(|c| c.app == *a))
        .collect();
    needed.dedup();
    check_binaries(&bin_dir, &needed)?;
    let ctx = Context {
        differences,
        scratch_dir: rust_dir.join(".scratch").join("conformance-harness"),
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
    print!("{}", report::render(&results, &ctx.differences.behind));
    if let Some(path) = &args.json {
        let text = serde_json::to_string_pretty(&report::json_summary(&results))
            .map_err(|e| e.to_string())?;
        std::fs::write(path, format!("{text}\n"))
            .map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    }
    if let Some(path) = &args.write_behind {
        behind::write_candidate(path, &results, &ctx.differences.accepted)?;
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
