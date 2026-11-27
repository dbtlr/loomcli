//! The structured changes first-party plugins record through their context's log.

use std::path::{Path, PathBuf};

use loomcli_core::{Log, LogFields};
use serde::Serialize;

use crate::messages;

pub(crate) fn file_written(log: &Log, path: &Path) {
    log.info(
        messages::FILE_WRITTEN,
        LogFields::new().field("path", path.to_string_lossy()),
    );
}

pub(crate) fn file_removed(log: &Log, path: &Path) {
    log.info(
        messages::FILE_REMOVED,
        LogFields::new().field("path", path.to_string_lossy()),
    );
}

pub(crate) fn record_leftovers(log: Option<&Log>, removed: Vec<PathBuf>) {
    if let Some(log) = log {
        for path in removed {
            file_removed(log, &path);
        }
    }
}

pub(crate) fn program_run(log: &Log, program: &str, arguments: &[impl Serialize], code: i32) {
    log.info(
        messages::PROGRAM_RUN,
        LogFields::new()
            .field("arguments", arguments)
            .field("code", code)
            .field("program", program),
    );
}

#[cfg(any(feature = "self-update", test))]
pub(crate) fn binary_replaced(log: &Log, path: &Path, from: &str, to: &str) {
    log.info(
        messages::BINARY_REPLACED,
        LogFields::new()
            .field("from", from)
            .field("path", path.to_string_lossy())
            .field("to", to),
    );
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use std::sync::{Arc, Mutex};

    use loomcli_core::{Activation, Application, Context, LogLevel, Next, Opt, Plugin, RunOptions};
    use loomcli_testing::{MockFields, mock_process};
    use serde_json::json;

    use super::*;

    #[tokio::test]
    async fn each_change_records_its_fields_under_the_raising_plugin() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let observer = Plugin::new("fixture/observer").on_log({
            let seen = Arc::clone(&seen);
            move |event, _| seen.lock().unwrap().push(event.clone())
        });
        let raiser = Plugin::new("fixture/raiser").middleware(
            Activation::Always,
            |ctx, next: Next| async move {
                file_written(
                    &ctx.log,
                    Path::new("/state/notes/installation/completion.bash.json"),
                );
                file_removed(
                    &ctx.log,
                    Path::new("/share/bash-completion/completions/notes"),
                );
                program_run(&ctx.log, "systemctl", &["--user", "daemon-reload"], 0);
                binary_replaced(&ctx.log, Path::new("/bin/notes"), "1.5.0", "1.5.1");
                next.run().await.map(|_| ())
            },
        );
        let app = Application::new("app")
            .plugins([observer, raiser])
            .global_option("verbose", Opt::count().short('v').verbose())
            .action(|_: Context| async { Ok(()) });
        let mock = mock_process(MockFields::new().argv(["-v"]));
        assert_eq!(
            app.run(RunOptions::new().process(mock.clone())).await.get(),
            0
        );
        assert_eq!(
            mock.stderr_text(),
            concat!(
                "› File written. path=/state/notes/installation/completion.bash.json\n",
                "› File removed. path=/share/bash-completion/completions/notes\n",
                "› Program run. arguments=[\"--user\",\"daemon-reload\"] code=0 program=systemctl\n",
                "› Binary replaced. from=1.5.0 path=/bin/notes to=1.5.1\n",
            )
        );
        let seen = seen.lock().unwrap();
        let expected = [
            (
                "File written.",
                json!({"path": "/state/notes/installation/completion.bash.json"}),
            ),
            (
                "File removed.",
                json!({"path": "/share/bash-completion/completions/notes"}),
            ),
            (
                "Program run.",
                json!({"arguments": ["--user", "daemon-reload"], "code": 0, "program": "systemctl"}),
            ),
            (
                "Binary replaced.",
                json!({"from": "1.5.0", "path": "/bin/notes", "to": "1.5.1"}),
            ),
        ];
        assert_eq!(seen.len(), expected.len());
        for (event, (message, fields)) in seen.iter().zip(expected) {
            assert_eq!(event.message, message);
            assert_eq!(event.fields, *fields.as_object().unwrap());
            assert_eq!(event.level, LogLevel::Info);
            assert_eq!(event.plugin.as_deref(), Some("fixture/raiser"));
        }
    }
}
