//! A fault at an author's call reports at the author's line, ported from the reference's
//! `declaration-faults.test.ts` ("an author's faulty call throws while its module is imported,
//! with a stack at the line"). Rust's panic report names the location, so this binary holds the
//! one test that installs a panic hook.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::{Arc, Mutex};

use loomcli_core::{Command, Opt};

#[test]
fn a_faulty_call_panics_at_the_authors_line() {
    let seen: Arc<Mutex<Option<(String, u32)>>> = Arc::new(Mutex::new(None));
    let record = Arc::clone(&seen);
    std::panic::set_hook(Box::new(move |info| {
        if let Some(location) = info.location()
            && let Ok(mut seen) = record.lock()
        {
            *seen = Some((location.file().to_owned(), location.line()));
        }
    }));
    let line = line!() + 4;
    let result = std::panic::catch_unwind(|| {
        let _ = Command::new("list")
            .option("verbose", Opt::boolean().short('v'))
            .option("version", Opt::boolean().short('v'));
    });
    let _ = std::panic::take_hook();
    assert!(result.is_err());
    let seen = seen.lock().expect("the hook ran").clone();
    assert_eq!(seen, Some((file!().to_owned(), line)));
}
