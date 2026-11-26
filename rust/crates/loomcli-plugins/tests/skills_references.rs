//! The command-reference selection diagnostics and the generated Markdown.

#![cfg(feature = "skills")]
#![allow(clippy::unwrap_used)]

use loomcli_core::{
    Application, Arg, Command, Context, DeclarationError, Group, Passthrough, Stdin,
};
use loomcli_plugins::skills::extension::{SKILL_COMMAND, SkillCommandFacts};
use loomcli_plugins::skills::{Skill, SkillFile, Skills, command_references, skills};

fn notes() -> Skill {
    Skill::new("notes", [SkillFile::new("SKILL.md", "# Notes")])
}

fn action() -> Command {
    Command::new("set")
        .description("Set.")
        .action(|_: Context| async { Ok(()) })
}

fn graph_app(
    settings: Skills,
) -> Application<loomcli_core::NoInputs, loomcli_core::NoResult, Group> {
    Application::new("notes")
        .plugins((settings,))
        .command(Command::new("config").command(action()))
        .command(Command::new("config-set").action(|_: Context| async { Ok(()) }))
}

#[test]
fn a_name_collision_corrects_a_selecting_skill_and_a_direct_caller() {
    let install = graph_app(skills(vec![notes()]).select_commands("notes", [[] as [&str; 0]]));
    let failure = install.inspect().unwrap_err();
    assert_eq!(
        failure.sentence(),
        "Skill \"notes\" selects Commands \"config set\" and \"config-set\", which both give the file references/commands/notes-config-set.md.",
    );
    assert_eq!(
        failure.correction(),
        ["Rename one of them, hide one, or select one of them alone."]
    );
    assert_eq!(
        failure.rule().unwrap().identity(),
        "@loomcli/plugins/skills/reference-name-taken"
    );
    let graph = graph_app(skills(vec![])).inspect().unwrap();
    let failure = command_references(&graph, [[] as [&str; 0]], true).unwrap_err();
    let failure = failure.downcast_failure::<DeclarationError>().unwrap();
    assert_eq!(
        failure.sentence(),
        "Commands \"config set\" and \"config-set\" both give the file notes-config-set.md."
    );
    assert_eq!(failure.correction(), ["Rename one of them, or hide one."]);

    let hidden = Application::new("notes")
        .plugins((skills(vec![notes()]).select_commands("notes", [[] as [&str; 0]]),))
        .command(Command::new("config").command(action()))
        .command(
            Command::new("config-set")
                .hidden()
                .action(|_: Context| async { Ok(()) }),
        );
    let graph = hidden.inspect().unwrap();
    let references = command_references(&graph, [[] as [&str; 0]], true).unwrap();
    assert_eq!(
        references
            .iter()
            .filter(|file| file.name == "notes-config-set.md")
            .count(),
        1
    );
    assert!(
        command_references(&graph, [["config-set"]], true)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn the_root_index_collision_corrects_a_selecting_skill_and_a_direct_caller() {
    let install = Application::new("index")
        .plugins((skills(vec![notes()]).select_commands("notes", [[] as [&str; 0]]),))
        .command(action());
    let failure = install.inspect().unwrap_err();
    assert_eq!(
        failure.sentence(),
        "Skill \"notes\" selects the root of index, whose file references/commands/index.md is the name of the index.",
    );
    assert_eq!(
        failure.correction(),
        ["Select the root's Commands by their own paths, such as [\"get\"], in place of []."]
    );

    let graph = Application::new("index")
        .command(action())
        .inspect()
        .unwrap();
    let failure = command_references(&graph, [[] as [&str; 0]], true).unwrap_err();
    let failure = failure.downcast_failure::<DeclarationError>().unwrap();
    assert_eq!(
        failure.sentence(),
        "The root of index gives the file index.md, which is the name of the index."
    );
    assert_eq!(failure.correction(), ["Rename the application."]);
}

#[test]
fn a_selection_names_only_canonical_commands() {
    let install = Application::new("notes")
        .plugins((skills(vec![notes()]).select_commands("notes", [["config", "show"]]),))
        .command(Command::new("config").command(action()));
    let failure = install.inspect().unwrap_err();
    assert_eq!(
        failure.sentence(),
        "Skill \"notes\" selects the path [\"config\", \"show\"], which names no Command."
    );
    let graph = graph_app(skills(vec![])).inspect().unwrap();
    let error = command_references(&graph, [["config", "show"]], true).unwrap_err();
    let direct = error.downcast_failure::<DeclarationError>().unwrap();
    assert_eq!(
        direct.sentence(),
        "The path [\"config\", \"show\"] names no Command."
    );
    assert_eq!(direct.correction(), failure.correction());
}

#[test]
fn references_share_graph_order_and_can_include_the_commands_guidance() {
    let graph = Application::new("notes")
        .version("1.2.3")
        .plugins((skills(vec![notes()]),))
        .command(
            Command::new("zeta")
                .description("# Zeta [one]")
                .extend([SKILL_COMMAND.value(SkillCommandFacts::new("\r\n**Keep** the id.\r\n"))])
                .action(|_: Context| async { Ok(()) }),
        )
        .command(
            Command::new("alpha")
                .description("Alpha.")
                .action(|_: Context| async { Ok(()) }),
        )
        .inspect()
        .unwrap();
    let files = command_references(&graph, [["alpha"], ["zeta"], ["alpha"]], true).unwrap();
    assert_eq!(
        files
            .iter()
            .map(|file| file.name.as_str())
            .collect::<Vec<_>>(),
        ["index.md", "notes-zeta.md", "notes-alpha.md"]
    );
    assert_eq!(
        files[0].content,
        "---\napplication: \"notes\"\nversion: \"1.2.3\"\n---\n\n# notes commands\n\n- [notes zeta](notes-zeta.md): # Zeta \\[one]\n- [notes alpha](notes-alpha.md): Alpha.\n"
    );
    assert_eq!(
        files[1].content,
        concat!(
            "# notes zeta\n\n\\# Zeta \\[one]\n\n## Usage\n\n",
            "\x60\x60\x60text\nnotes zeta [options]\n\x60\x60\x60\n\n## Guidance\n\n**Keep** the id.\n",
        )
    );
    let without = command_references(&graph, [["zeta"]], false).unwrap();
    assert!(!without[1].content.contains("## Guidance"));
}

#[test]
fn a_terminal_need_appears_between_aliases_and_deprecation() {
    let graph = Application::new("p8")
        .command(
            Command::new("get")
                .deprecated("Use open.")
                .description("Edit a note.")
                .alias("e")
                .needs_terminal()
                .action(|_: Context| async { Ok(()) }),
        )
        .inspect()
        .unwrap();
    let files = command_references(&graph, [["get"]], true).unwrap();
    assert_eq!(
        files[0].content,
        concat!(
            "---\napplication: \"p8\"\nversion: \"0.0.0\"\n---\n\n# p8 commands\n\n",
            "- [p8 get](p8-get.md): Edit a note. (alias: e, needs a terminal, deprecated)\n",
        ),
    );
    assert_eq!(
        files[1].content,
        concat!(
            "# p8 get\n\nAlias: e\n\nNeeds a terminal: stdin and stderr, outside CI.\n\n",
            "Deprecated: Use open.\n\nEdit a note.\n\n## Usage\n\n```text\np8 get [options]\n```\n",
        ),
    );
}

#[test]
fn a_passthrough_row_takes_the_place_of_the_child_name_escape() {
    let graph = Application::new("index-tools")
        .command(
            Command::new("get")
                .argument(
                    "path",
                    Arg::string().default("a.json").description("# The file."),
                )
                .passthrough(Passthrough::new().description("Arguments for the reader."))
                .command(Command::new("child").action(|_: Context| async { Ok(()) }))
                .action(|_: Context| async { Ok(()) }),
        )
        .inspect()
        .unwrap();
    let files = command_references(&graph, [["get"]], true).unwrap();
    assert_eq!(
        files[1].content,
        concat!(
            "# index-tools get\n\n## Usage\n\n```text\n",
            "index-tools get [path] [options] [-- <args>...]\n",
            "index-tools get <command> [options]\n```\n\n## Arguments\n\n",
            "- `path`: # The file.  (default: a.json)\n",
            "- `-- <args>...`: Arguments for the reader.\n",
        ),
    );
}

#[test]
fn optional_stdin_follows_arguments_without_prefixing_usage() {
    let graph = Application::new("p8")
        .command(
            Command::new("get")
                .argument("path", Arg::string())
                .stdin(Stdin::new().description("- The text."))
                .action(|_: Context| async { Ok(()) }),
        )
        .inspect()
        .unwrap();
    let files = command_references(&graph, [["get"]], true).unwrap();
    assert_eq!(
        files[1].content,
        concat!(
            "# p8 get\n\n## Usage\n\n```text\np8 get [path] [options]\n```\n\n",
            "## Arguments\n\n- `path`\n\n## Input\n\n\\- The text.\n\n",
            "Optional. Reads piped or redirected stdin. Terminal input is not accepted.\n\n",
            "Example: \\<producer> | p8 get\n",
        ),
    );
}
