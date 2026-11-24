//! The first-party control marks, ported from the reference's `control-marks.test.ts` for the
//! plugins this package owns (`version`, `color`, `verbose`, plus `background` and `interaction`).
//! The `help`, `manifest`, `config`, and `format` rows belong to those plugins' packages.

#![cfg(all(
    feature = "version",
    feature = "color",
    feature = "verbose",
    feature = "background",
    feature = "interaction"
))]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;

use loomcli_core::{Application, Command, Context, Opt};
use loomcli_plugins::background::background;
use loomcli_plugins::color::color;
use loomcli_plugins::interaction::interaction;
use loomcli_plugins::verbose::verbose;
use loomcli_plugins::version::version;

/// Each option the graph holds, by name, with whether it is a control.
fn controls() -> BTreeMap<String, bool> {
    let read = Command::new("read")
        .option("field", Opt::string().description("The field to read."))
        .action(|ctx: Context| async move { ctx.out.print("value").await });
    let graph = Application::new("kit")
        .plugins((version(), color(), verbose(), background(), interaction()))
        .version("1.0.0")
        .global_option("file", Opt::string().description("The document."))
        .command(read)
        .action(|_: Context| async move { Ok(()) })
        .inspect()
        .unwrap();
    let read = graph
        .root
        .children
        .iter()
        .find(|child| child.name.as_deref() == Some("read"))
        .unwrap();
    graph
        .globals
        .iter()
        .chain(graph.root.options.iter())
        .chain(read.options.iter())
        .map(|option| {
            (
                option.name().to_owned(),
                serde_json::to_value(&**option).unwrap()["control"] == true,
            )
        })
        .collect()
}

#[test]
fn the_first_party_plugins_mark_their_options_as_controls_and_a_work_option_reads_false() {
    let controls = controls();
    for name in [
        "color",
        "quiet",
        "verbose",
        "version",
        "background",
        "input",
    ] {
        assert_eq!(controls.get(name), Some(&true), "{name}");
    }
    for name in ["field", "file"] {
        assert_eq!(controls.get(name), Some(&false), "{name}");
    }
}
