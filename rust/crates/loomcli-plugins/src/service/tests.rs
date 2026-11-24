//! Ports `service-parts.test.ts`: the unit files' quoting, the manager readers, the status members
//! and their order, and the text view's padding and escaping. These pieces are private, so they are
//! read here; the Commands that use them are driven through the public surface by
//! `tests/service_*.rs`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use loomcli_core::nowrap;
use loomcli_testing::{ViewValues, view_context};

use super::backend::Reading;
use super::launchd::read_printed;
use super::status::{ServiceDetail, ServiceState, ServiceStatus, Subject, status_text};
use super::systemd::read_shown;
use super::unit::{UnitValues, launchd_plist, systemd_unit};

/// The state, whether it runs, and its pid.
type Expected = (&'static str, bool, Option<u64>);

fn words() -> Vec<String> {
    [
        "/bin/notes",
        "a\\b",
        "say \"hi\"",
        "$HOME",
        "%h",
        "it's <b>&",
    ]
    .iter()
    .map(|word| (*word).to_owned())
    .collect()
}

fn values(words: &[String]) -> UnitValues<'_> {
    UnitValues {
        label: "com.acme.notes",
        words,
        home: "/home/me 50%",
        description: "Notes 100% & <sync>",
    }
}

#[test]
fn systemd_wraps_each_exec_start_word_in_quotes_escapes_backslash_quote_and_dollar_and_doubles_percent_in_every_value()
 {
    let words = words();
    let unit = systemd_unit(&values(&words));
    assert_eq!(
        unit.split('\n').nth(1),
        Some("Description=Notes 100%% & <sync>")
    );
    assert!(unit.contains(
        "ExecStart=\"/bin/notes\" \"a\\\\b\" \"say \\\"hi\\\"\" \"$$HOME\" \"%%h\" \"it's <b>&\"\n"
    ));
    assert!(unit.contains("\nWorkingDirectory=/home/me 50%%\n"));
    assert!(unit.ends_with("WantedBy=default.target\n"));
    assert!(!unit.ends_with("\n\n"));
}

#[test]
fn a_property_list_escapes_ampersand_angle_quote_and_apostrophe_as_xml_entities_in_every_value() {
    let words = words();
    let plist = launchd_plist(&values(&words));
    assert!(plist.contains("    <string>a\\b</string>\n"));
    assert!(plist.contains("    <string>say &quot;hi&quot;</string>\n"));
    assert!(plist.contains("    <string>it&apos;s &lt;b&gt;&amp;</string>\n"));
    assert!(plist.contains("    <string>%h</string>\n"));
    assert!(plist.contains("  <string>/home/me 50%</string>\n"));
    assert!(plist.ends_with("</plist>\n"));
}

#[test]
fn systemctl_show_reads_its_state() {
    let cases: [(&str, bool, Expected); 7] = [
        (
            "ActiveState=active\nMainPID=4120\n",
            true,
            ("active", true, Some(4120)),
        ),
        (
            "ActiveState=active\nMainPID=0\n",
            true,
            ("active", false, None),
        ),
        (
            "MainPID=12\nActiveState=activating\n",
            true,
            ("activating", false, Some(12)),
        ),
        (
            "ActiveState=inactive\nMainPID=0\n",
            false,
            ("not installed", false, None),
        ),
        (
            "ActiveState=inactive\nMainPID=0\n",
            true,
            ("inactive", false, None),
        ),
        (
            "ActiveState=failed\nMainPID=0\n",
            false,
            ("failed", false, None),
        ),
        (
            "ActiveState=active\nMainPID=31\n",
            false,
            ("active", true, Some(31)),
        ),
    ];
    for (stdout, installed, (state, running, pid)) in cases {
        assert_eq!(
            read_shown(stdout, installed),
            (state.to_owned(), running, pid),
            "{stdout:?} {installed}"
        );
    }
}

#[test]
fn launchctl_print_reads_its_top_level_one_tab_in() {
    let cases: [(&str, Expected); 4] = [
        (
            "gui/501/com.acme.notes = {\n\tactive count = 1\n\tstate = running\n\tpid = 4120\n}\n",
            ("running", true, Some(4120)),
        ),
        (
            "gui/501/com.acme.notes = {\n\tstate = not running\n\tendpoints = {\n\t\tpid = 5\n\t\tstate = running\n\t}\n}\n",
            ("not running", false, None),
        ),
        (
            "gui/501/com.acme.notes = {\n\tstate = waiting\n\tpid = 77\n}\n",
            ("waiting", true, Some(77)),
        ),
        (
            "gui/501/com.acme.notes = {\n\tpid = 7a\n}\n",
            ("unknown", false, None),
        ),
    ];
    for (stdout, (state, running, pid)) in cases {
        assert_eq!(
            read_printed(stdout),
            (state.to_owned(), running, pid),
            "{stdout:?}"
        );
    }
}

fn state_of(unit: &str, installed: bool, reading: Reading) -> ServiceState {
    ServiceState::of(
        &Subject {
            label: "com.acme.notes",
            unit: std::path::Path::new(unit),
            installed,
        },
        reading,
    )
}

fn reading(state: &str, running: bool, pid: Option<u64>, notes: &[&str]) -> Reading {
    Reading {
        state: state.to_owned(),
        running,
        pid,
        notes: notes.iter().map(|note| (*note).to_owned()).collect(),
    }
}

fn text_of(status: &ServiceStatus) -> String {
    status_text(status, &view_context(ViewValues::new()))
}

#[test]
fn the_text_view_keeps_the_unit_path_whole_for_line_breaking() {
    let unit = "/Users/me/Library/Application Support/com.acme.notes.plist";
    let state = state_of(unit, true, reading("not running", false, None, &[]));
    assert_eq!(
        text_of(&ServiceStatus::of(&state, Vec::new())),
        format!("com.acme.notes: not running\n  unit  {}\n", nowrap(unit))
    );
}

#[test]
fn the_text_view_pads_the_names_to_the_longest_plus_two_prints_author_rows_as_given_and_escapes_manager_words_and_paths()
 {
    let state = state_of(
        "/units/a\nb.service",
        true,
        reading("active", true, Some(9), &["A note."]),
    );
    let status = ServiceStatus::of(&state, vec![ServiceDetail::new("connections", "3")]);
    assert_eq!(
        text_of(&status),
        format!(
            "com.acme.notes: running (pid 9)\n  unit         {}\n  connections  3\n  note         A note.\n",
            nowrap("/units/a\\u000ab.service")
        )
    );
    let unknown = ServiceStatus::of(
        &state_of("/u", false, reading("odd\u{1b}word", false, None, &[])),
        Vec::new(),
    );
    assert_eq!(
        text_of(&unknown),
        format!("com.acme.notes: odd\\u001bword\n  unit  {}\n", nowrap("/u"))
    );
    let running = ServiceStatus::of(
        &state_of("/u", true, reading("running", true, None, &[])),
        Vec::new(),
    );
    assert_eq!(
        text_of(&running),
        format!("com.acme.notes: running\n  unit  {}\n", nowrap("/u"))
    );
}

#[test]
fn the_status_members_keep_the_order_the_type_lists_them_with_no_pid_when_none_is_reported() {
    let with_pid = ServiceStatus::of(
        &state_of("/u", true, reading("active", true, Some(1), &[])),
        Vec::new(),
    );
    let keys: Vec<String> = serde_json::to_value(&with_pid)
        .unwrap()
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    assert_eq!(
        keys,
        [
            "label",
            "unit",
            "installed",
            "running",
            "state",
            "pid",
            "notes",
            "details"
        ]
    );
    let without_pid = ServiceStatus::of(
        &state_of("/u", true, reading("failed", false, None, &[])),
        Vec::new(),
    );
    assert!(
        !serde_json::to_value(&without_pid)
            .unwrap()
            .as_object()
            .unwrap()
            .contains_key("pid")
    );
}
