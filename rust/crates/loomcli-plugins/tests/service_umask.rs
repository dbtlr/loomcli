//! Ports the umask case of `service.test.ts`: under umask 002 the unit and the plist are written
//! with mode 644, because launchd refuses a plist its group or others can write. The umask is
//! process-wide, so both runs share one test in a process of their own.

#![cfg(feature = "service")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod service_support;

use std::fs;
use std::os::unix::fs::PermissionsExt;

use rustix::fs::Mode;
use rustix::process::umask;
use service_support::{Scenario, not_loaded, run, sandbox};

#[tokio::test]
async fn under_umask_002_the_unit_and_the_plist_are_written_with_mode_644() {
    let linux = sandbox();
    let previous = umask(Mode::from_raw_mode(0o002));
    let result = run(&linux, &["service", "install"], &Scenario::default()).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    let darwin = sandbox();
    let result = run(
        &darwin,
        &["service", "install"],
        &Scenario::darwin().answers(not_loaded()),
    )
    .await;
    umask(previous);
    assert_eq!(result.status, 0, "{}", result.stderr);
    for path in [
        linux.systemd_path("com.acme.notes"),
        darwin.launchd_path("com.acme.notes"),
    ] {
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o644, "{}", path.display());
    }
}
