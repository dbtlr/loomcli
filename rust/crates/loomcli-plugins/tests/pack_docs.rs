//! Every example block of the reference's `docs/plugins/pack-views.md`, rendered through
//! `Application::run` on the mock process with exact bytes, with color off and with color on.

#![cfg(all(
    feature = "table",
    feature = "records",
    feature = "list",
    feature = "heading",
    feature = "rule",
    feature = "prose",
    feature = "box"
))]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod pack_support;

use loomcli_core::style::Alignment;
use loomcli_plugins::boxed::{BoxConfig, boxed};
use loomcli_plugins::heading::{HeadingConfig, HeadingLevel, heading};
use loomcli_plugins::list::{ListConfig, list};
use loomcli_plugins::prose::prose;
use loomcli_plugins::records::{RecordsConfig, records};
use loomcli_plugins::rule::rule;
use loomcli_plugins::table::{Column, TableConfig, table};
use pack_support::{ViewRun, lines, render_each};
use serde::Serialize;
use serde_json::{Value, json};

/// Dim, as the theme's bright black writes it.
fn dim(text: &str) -> String {
    format!("\u{1b}[90m{text}\u{1b}[39m")
}

/// Primary, as the theme's cyan writes it.
fn primary(text: &str) -> String {
    format!("\u{1b}[36m{text}\u{1b}[39m")
}

fn colored(widths: &[Option<u16>]) -> ViewRun {
    ViewRun::new(widths).color(true).theme()
}

#[derive(Clone, Serialize)]
struct Count {
    count: u32,
    source: &'static str,
}

fn counts() -> Vec<Count> {
    vec![
        Count {
            count: 6,
            source: "one.txt",
        },
        Count {
            count: 2,
            source: "two words.txt",
        },
        Count {
            count: 8,
            source: "total",
        },
    ]
}

fn count_table() -> loomcli_core::View<[Count]> {
    table(vec![
        Column::new("count").header("COUNT").align(Alignment::Right),
        Column::new("source").header("SOURCE"),
    ])
}

#[tokio::test]
async fn the_table_example_prints_its_columns() {
    let plain = render_each(&ViewRun::new(&[Some(80)]), |out| async move {
        out.render(&counts(), &count_table()).await
    })
    .await;
    assert_eq!(
        plain,
        lines(&[
            "COUNT  SOURCE",
            "    6  one.txt",
            "    2  two words.txt",
            "    8  total"
        ])
    );
    let styled = render_each(&colored(&[Some(80)]), |out| async move {
        out.render(&counts(), &count_table()).await
    })
    .await;
    assert_eq!(
        styled,
        lines(&[
            &format!("{}  {}", dim("COUNT"), dim("SOURCE")),
            &format!("    {}  {}", primary("6"), primary("one.txt")),
            &format!("    {}  {}", primary("2"), primary("two words.txt")),
            &format!("    {}  {}", primary("8"), primary("total")),
        ])
    );
}

#[derive(Clone, Serialize)]
struct Task {
    name: &'static str,
    note: &'static str,
}

fn tasks() -> Vec<Task> {
    vec![
        Task {
            name: "build",
            note: "compiles every package and bundles the examples",
        },
        Task {
            name: "check",
            note: "runs the formatter, the linter, and the type checker",
        },
    ]
}

fn task_table() -> loomcli_core::View<[Task]> {
    table(vec![
        Column::new("name").header("NAME"),
        Column::new("note").header("NOTE"),
    ])
}

#[tokio::test]
async fn the_wrapped_table_example_at_30_columns() {
    let plain = render_each(&ViewRun::new(&[Some(30)]), |out| async move {
        out.render(&tasks(), &task_table()).await
    })
    .await;
    assert_eq!(
        plain,
        lines(&[
            "NAME   NOTE",
            "build  compiles every package",
            "       and bundles the",
            "       examples",
            "check  runs the formatter, the",
            "       linter, and the type",
            "       checker",
        ])
    );
    let styled = render_each(&colored(&[Some(30)]), |out| async move {
        out.render(&tasks(), &task_table()).await
    })
    .await;
    assert_eq!(
        styled,
        lines(&[
            &format!("{} {}  {}", dim("NAME"), "", dim("NOTE")),
            &format!(
                "{}  {}",
                primary("build"),
                primary("compiles every package")
            ),
            &format!("       {}", primary("and bundles the")),
            &format!("       {}", primary("examples")),
            &format!(
                "{}  {}",
                primary("check"),
                primary("runs the formatter, the")
            ),
            &format!("       {}", primary("linter, and the type")),
            &format!("       {}", primary("checker")),
        ])
    );
}

#[derive(Clone, Serialize)]
struct Member {
    key: &'static str,
    kind: &'static str,
}

#[tokio::test]
async fn the_records_example_prints_each_record_and_the_count() {
    let members = || {
        vec![
            Member {
                key: "user",
                kind: "object with 3 keys",
            },
            Member {
                key: "tags",
                kind: "array with 2 items",
            },
        ]
    };
    let plain = render_each(&ViewRun::new(&[Some(80)]), move |out| async move {
        out.render(members(), &records(RecordsConfig::new("key")))
            .await
    })
    .await;
    assert_eq!(
        plain,
        lines(&[
            "key   user",
            "kind  object with 3 keys",
            "",
            "key   tags",
            "kind  array with 2 items",
            "",
            "2 records"
        ])
    );
    let styled = render_each(&colored(&[Some(80)]), move |out| async move {
        out.render(members(), &records(RecordsConfig::new("key")))
            .await
    })
    .await;
    // `highlight` is core's own token, which the fixture theme leaves at its default.
    assert!(styled.contains(&format!(
        "{}  {}",
        dim("kind"),
        primary("object with 3 keys")
    )));
    assert!(styled.ends_with(&format!("\n{}\n", dim("2 records"))));
}

#[tokio::test]
async fn the_wrapped_records_example_at_30_columns() {
    let rows = || {
        vec![Member {
            key: "tags",
            kind: "array of 12 strings, none empty or longer than 40 characters",
        }]
    };
    let plain = render_each(&ViewRun::new(&[Some(30)]), move |out| async move {
        out.render(rows(), &records(RecordsConfig::new("key")))
            .await
    })
    .await;
    assert_eq!(
        plain,
        lines(&[
            "key   tags",
            "kind  array of 12 strings,",
            "      none empty or longer",
            "      than 40 characters",
            "",
            "1 record",
        ])
    );
    let styled = render_each(&colored(&[Some(30)]), move |out| async move {
        out.render(rows(), &records(RecordsConfig::new("key")))
            .await
    })
    .await;
    assert!(styled.contains(&format!(
        "{}  {}\n      {}\n      {}\n",
        dim("kind"),
        primary("array of 12 strings,"),
        primary("none empty or longer"),
        primary("than 40 characters"),
    )));
}

#[derive(Clone, Serialize)]
struct Service {
    name: &'static str,
    parts: Vec<Service>,
}

fn service(name: &'static str, parts: Vec<Service>) -> Service {
    Service { name, parts }
}

fn services() -> Vec<Service> {
    vec![
        service("api-gateway", vec![]),
        service(
            "billing",
            vec![service("invoices", vec![]), service("refunds", vec![])],
        ),
        service("search", vec![]),
    ]
}

fn service_list() -> loomcli_core::View<[Service]> {
    list(
        ListConfig::new()
            .children(|service: &Service| service.parts.as_slice())
            .format(|service: &Service, _, _| service.name.to_owned()),
    )
}

#[tokio::test]
async fn the_list_example_nests_its_parts() {
    let plain = render_each(&ViewRun::new(&[Some(80)]), |out| async move {
        out.render(&services(), &service_list()).await
    })
    .await;
    assert_eq!(
        plain,
        lines(&[
            "● api-gateway",
            "● billing",
            "  ● invoices",
            "  ● refunds",
            "● search"
        ])
    );
    let styled = render_each(&colored(&[Some(80)]), |out| async move {
        out.render(&services(), &service_list()).await
    })
    .await;
    assert_eq!(
        styled,
        lines(&[
            &format!("{} api-gateway", dim("●")),
            &format!("{} billing", dim("●")),
            &format!("  {} invoices", dim("●")),
            &format!("  {} refunds", dim("●")),
            &format!("{} search", dim("●")),
        ])
    );
}

#[tokio::test]
async fn the_wrapped_list_example_at_30_columns() {
    let items = || vec!["refunds, whose retry policy lands with this deploy".to_owned()];
    let plain = render_each(&ViewRun::new(&[Some(30)]), move |out| async move {
        out.render(&items(), &list(ListConfig::new())).await
    })
    .await;
    assert_eq!(
        plain,
        lines(&["● refunds, whose retry policy", "  lands with this deploy"])
    );
    let styled = render_each(&colored(&[Some(30)]), move |out| async move {
        out.render(&items(), &list(ListConfig::new())).await
    })
    .await;
    assert_eq!(
        styled,
        lines(&[
            &format!("{} {}", dim("●"), primary("refunds, whose retry policy")),
            &format!("  {}", primary("lands with this deploy")),
        ])
    );
}

#[tokio::test]
async fn the_heading_example_underlines_level_1_alone() {
    let draw = |out: loomcli_core::Out| async move {
        out.render("Deployment summary", &heading(HeadingConfig::new()))
            .await?;
        out.render(
            "Services",
            &heading(HeadingConfig::new().level(HeadingLevel::Two)),
        )
        .await
    };
    let plain = render_each(&ViewRun::new(&[Some(80)]), draw).await;
    assert_eq!(
        plain,
        lines(&["Deployment summary", "──────────────────", "Services"])
    );
    let styled = render_each(&colored(&[Some(80)]), draw).await;
    assert_eq!(
        styled,
        lines(&[
            &dim("Deployment summary"),
            &dim("──────────────────"),
            &dim("Services")
        ])
    );
}

#[tokio::test]
async fn the_rule_example_at_60_columns() {
    let draw = |out: loomcli_core::Out| async move {
        out.render("Checks", &rule()).await?;
        out.render("", &rule()).await
    };
    let plain = render_each(&ViewRun::new(&[Some(60)]), draw).await;
    assert_eq!(
        plain,
        lines(&[&format!("── Checks {}", "─".repeat(50)), &"─".repeat(60)])
    );
    let styled = render_each(&colored(&[Some(60)]), draw).await;
    assert_eq!(
        styled,
        lines(&[
            &format!(
                "{}Checks{}",
                dim("── "),
                dim(&format!(" {}", "─".repeat(50)))
            ),
            &dim(&"─".repeat(60)),
        ])
    );
}

const SUMMARY: &str =
    "Three services rolled out to the staging cluster. One health check is still warming up.";

#[tokio::test]
async fn the_prose_example_at_34_columns() {
    let draw = |out: loomcli_core::Out| async move { out.render(SUMMARY, &prose()).await };
    let expected = lines(&[
        "Three services rolled out to the",
        "staging cluster. One health check",
        "is still warming up.",
    ]);
    assert_eq!(
        render_each(&ViewRun::new(&[Some(34)]), draw).await,
        expected
    );
    // Prose adds no styling, so color changes no byte.
    assert_eq!(render_each(&colored(&[Some(34)]), draw).await, expected);
}

#[derive(Clone, Serialize)]
struct Pool {
    pool: &'static str,
    instances: u32,
    status: &'static str,
}

fn pools() -> Vec<Pool> {
    vec![
        Pool {
            pool: "blue",
            instances: 4,
            status: "ready",
        },
        Pool {
            pool: "green",
            instances: 4,
            status: "warming",
        },
    ]
}

#[tokio::test]
async fn the_box_example_frames_text_and_a_table() {
    let draw = |out: loomcli_core::Out| async move {
        out.render(
            "All three services passed their health checks.",
            &boxed(BoxConfig::new().title("Totals")),
        )
        .await?;
        let framed = boxed(
            BoxConfig::new()
                .title("Pools")
                .content(table(TableConfig::new())),
        );
        out.render(&pools(), &framed).await
    };
    let plain = render_each(&ViewRun::new(&[Some(80)]), draw).await;
    assert_eq!(
        plain,
        lines(&[
            "╭─ Totals ───────────────────────────────────────╮",
            "│ All three services passed their health checks. │",
            "╰────────────────────────────────────────────────╯",
            "╭─ Pools ───────────────────╮",
            "│ pool   instances  status  │",
            "│ blue   4          ready   │",
            "│ green  4          warming │",
            "╰───────────────────────────╯",
        ])
    );
    let styled = render_each(&colored(&[Some(80)]), draw).await;
    let side = dim("│");
    let bold_title = |title: &str| format!("\u{1b}[36;1m{title}\u{1b}[90;22m");
    assert_eq!(
        styled,
        lines(&[
            &format!(
                "\u{1b}[90m╭─ {} {}╮\u{1b}[39m",
                bold_title("Totals"),
                "─".repeat(39)
            ),
            &format!(
                "{side} {} {side}",
                "All three services passed their health checks."
            ),
            &dim(&format!("╰{}╯", "─".repeat(48))),
            &format!(
                "\u{1b}[90m╭─ {} {}╮\u{1b}[39m",
                bold_title("Pools"),
                "─".repeat(19)
            ),
            &format!(
                "{side} {}   {}  {}  {side}",
                dim("pool"),
                dim("instances"),
                dim("status")
            ),
            &format!(
                "{side} {}   {}          {}   {side}",
                primary("blue"),
                primary("4"),
                primary("ready")
            ),
            &format!(
                "{side} {}  {}          {} {side}",
                primary("green"),
                primary("4"),
                primary("warming")
            ),
            &dim(&format!("╰{}╯", "─".repeat(27))),
        ])
    );
}

#[test]
fn a_bare_key_is_a_column() {
    let view = table::<Value>(vec!["source".into(), Column::new("count")]);
    let output = view
        .render(
            &[json!({ "source": "a", "count": 1 })],
            &pack_support::measured(None),
        )
        .unwrap();
    assert_eq!(pack_support::plain(&output), "source  count\na       1\n");
}
