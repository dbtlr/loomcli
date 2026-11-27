//! Ports the output folder case of `service-lines.test.ts`.

#![cfg(all(feature = "service", feature = "verbose"))]
#![allow(clippy::unwrap_used)]

mod service_support;

use service_support::{OutputFolderWatch, Scenario, run, sandbox};

#[tokio::test]
async fn install_creates_the_output_folder_before_manager_calls_without_logging_the_folder() {
    let box_ = sandbox();
    let folder = OutputFolderWatch::new(box_.home.join("logs/nested"));
    let mut scenario = Scenario::default().output("logs/nested/console.log");
    scenario.output_folder_watch = Some(folder.clone());

    let installed = run(&box_, &["-v", "service", "install"], &scenario).await;

    assert_eq!(installed.status, 0, "{}", installed.stderr);
    assert_eq!(*folder.at_manager_calls.lock().unwrap(), [true, true, true]);
    let path = folder.path.to_str().unwrap();
    assert!(!installed.stderr.contains(path), "{}", installed.stderr);
    assert!(
        folder.log_events.lock().unwrap().iter().all(|event| event
            .fields
            .get("path")
            .and_then(serde_json::Value::as_str)
            != Some(path))
    );
}
