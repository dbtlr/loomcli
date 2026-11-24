//! Ports the scripts suite of `completion.test.ts`: each script read as text, the installed Zsh
//! file against the printed one, the printed bytes against the conformance corpus, and every script
//! sourced by the real shell that is installed, for every portable name, to prove that sourcing
//! runs nothing. The pseudo-terminal suites of `completion-shells.test.ts` are not ported (see the
//! test map).

#![cfg(feature = "completion")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod completion_support;

use std::fs;
use std::path::Path;
use std::process::Command as Process;

use completion_support::TempDir;
use loomcli_plugins::completion::test_support::{
    bash_script, fish_script, identifier, powershell_script, zsh_installed_script, zsh_script,
};
use regex::Regex;

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).unwrap()
}

/// A function that makes a script for an application name.
type Script = fn(&str) -> String;

/// One script's shell, and the command line a bare shell sources a script file with.
struct ScriptShell {
    flags: &'static [&'static str],
    script: Script,
    shell: &'static str,
    source: &'static str,
    title: &'static str,
}

const SCRIPTS: [ScriptShell; 5] = [
    ScriptShell {
        flags: &["--noprofile", "--norc"],
        script: bash_script,
        shell: "bash",
        source: "source",
        title: "Bash",
    },
    ScriptShell {
        flags: &["-f"],
        script: zsh_script,
        shell: "zsh",
        source: "autoload -U compinit; compinit -u -D; source",
        title: "Zsh",
    },
    // The installed file starts the completion system itself when compdef is not defined.
    ScriptShell {
        flags: &["-f"],
        script: zsh_installed_script,
        shell: "zsh",
        source: "source",
        title: "installed Zsh",
    },
    ScriptShell {
        flags: &["--no-config"],
        script: fish_script,
        shell: "fish",
        source: "source",
        title: "Fish",
    },
    ScriptShell {
        flags: &["-NoProfile", "-NonInteractive"],
        script: powershell_script,
        shell: "pwsh",
        source: ".",
        title: "PowerShell",
    },
];

/// The environment a shell the test starts runs in: nothing of the test's own beyond `PATH`, so no
/// shell reads or writes the developer's home.
fn sealed(process: &mut Process, home: &Path) {
    process.env_clear();
    process.env("FISH_UNIT_TESTS_RUNNING", "1");
    process.env("HOME", home);
    process.env("PATH", std::env::var_os("PATH").unwrap_or_default());
    process.env("XDG_CACHE_HOME", home.join(".cache"));
    process.env("XDG_CONFIG_HOME", home.join(".config"));
    process.env("XDG_DATA_HOME", home.join(".local/share"));
    process.env("XDG_STATE_HOME", home.join(".local/state"));
}

/// Whether the shell runs here. A missing shell skips its case, unless `LOOM_REQUIRE_SHELLS` is
/// set, when it fails the case, as it fails the conformance suites.
fn shell_runs(shell: &str) -> bool {
    let home = TempDir::new("loom-shell-home");
    let mut probe = Process::new(shell);
    probe.args(["-c", "true"]);
    sealed(&mut probe, &home.path);
    if probe.output().is_ok() {
        return true;
    }
    assert!(
        std::env::var_os("LOOM_REQUIRE_SHELLS").is_none(),
        "LOOM_REQUIRE_SHELLS is set, but {shell} not installed."
    );
    false
}

/// What sourcing a script left.
struct Sourced {
    pwned: bool,
    status: Option<i32>,
    stdout: String,
    stderr: String,
}

/// Sources the script text from a file in a fresh directory, then runs `after`, and reports the
/// run and whether a `pwned` file appeared.
fn source_script(entry: &ScriptShell, text: &str, after: &str) -> Sourced {
    let directory = TempDir::new("loom-completion");
    // PowerShell dot-sources only a file named .ps1 and hands any other to the desktop's opener.
    let file = directory.path.join(if entry.shell == "pwsh" {
        "script.ps1"
    } else {
        "script"
    });
    fs::write(&file, text).unwrap();
    let mut process = Process::new(entry.shell);
    process
        .args(entry.flags)
        .arg("-c")
        .arg(format!("{} '{}'{after}", entry.source, file.display()))
        .current_dir(&directory.path);
    sealed(&mut process, &directory.path);
    let output = process.output().unwrap();
    Sourced {
        pwned: directory.path.join("pwned").exists(),
        status: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    }
}

#[test]
fn the_printed_scripts_match_shared_expectations_outside_listed_differences() {
    use conformance_harness::compare::Part;
    use conformance_harness::runner::assert_part;

    let corpus = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../conformance/expected");
    let scripts: [(&str, Script); 4] = [
        ("bash", bash_script),
        ("zsh", zsh_script),
        ("fish", fish_script),
        ("powershell", powershell_script),
    ];
    for (shell, script) in scripts {
        let id = format!("jsonkit-completion-script-{shell}");
        let expected = fs::read_to_string(corpus.join(&id).join("stdout")).unwrap();
        assert_part(&id, Part::Stdout, &script("jsonkit"), &expected);
    }
}

#[test]
fn each_script_evaluates_nothing() {
    for entry in &SCRIPTS {
        let text = (entry.script)("kit");
        assert!(!re(r"\beval\b").is_match(&text), "{}", entry.title);
        assert!(!re(r"compgen\s+-[WfdG]").is_match(&text), "{}", entry.title);
        assert!(!text.contains("_activeHelp_"), "{}", entry.title);
    }
}

#[test]
fn the_powershell_script_registers_a_native_completer_and_runs_no_string_as_a_command() {
    let text = powershell_script("kit");
    assert!(
        !re(r"(?i)Invoke-Expression|\biex\b|ScriptBlock\]::Create|NewScriptBlock").is_match(&text)
    );
    assert!(re(r"(?m)^Register-ArgumentCompleter -Native -CommandName 'kit' ").is_match(&text));
}

#[test]
fn the_powershell_script_starts_an_application_with_an_argument_list_off_windows_and_calls_ampersand_on_windows()
 {
    let text = powershell_script("kit");
    assert!(
        text.contains("$Unix = $PSVersionTable.PSEdition -eq 'Core' -and ($IsLinux -or $IsMacOS)")
    );
    assert!(
        re(r"if \(\$Unix\) \{\n\s+\$Resolved = Get-Command -Name \$Pattern -CommandType Application ")
            .is_match(&text)
    );
    let begin = text.rfind("if ($Unix) {").unwrap();
    let end = text.find("$Out = @(& $Resolved").unwrap();
    let unix = &text[begin..end];
    assert!(unix.contains("$Start.ArgumentList.Add($Word)"));
    assert!(unix.contains("$Start.UseShellExecute = $false"));
    assert!(unix.contains("$Start.RedirectStandardError = $true"));
    assert!(unix.contains("$Process.StandardError.ReadToEndAsync()"));
    assert!(re(r"\} else \{\n[\s\S]*__kit_legacy").is_match(unix));
    assert_eq!(text.matches("& $Resolved").count(), 1);
}

#[test]
fn the_powershell_script_inserts_a_space_after_a_sole_word_unless_directive_2_is_set() {
    let text = powershell_script("kit");
    assert!(
        re(r#"\$Space = " "\n\s+if \(\(\$Directive -band \$ShellCompDirectiveNoSpace\) -ne 0 \) \{\n[^}]*\$Space = ""\n"#)
            .is_match(&text)
    );
    assert!(re(r"if \(\$Values\.Count -eq 1\) \{\n\s+\$After = \$Space\n").is_match(&text));
    assert!(
        text.contains("__kit_result (($_.Name | __kit_quote) + $After) $_.Name 'ParameterValue'")
    );
}

#[test]
fn the_powershell_script_holds_the_name_only_in_its_registration_single_quoted() {
    // Each name holds a character the identifier encodes, so only the registration spells it.
    for name in ["git-lfs", "a.b_c"] {
        let text = powershell_script(name);
        assert_eq!(text.split(name).count(), 2, "{name}");
        assert!(text.contains(&format!("-CommandName '{name}' ")));
    }
}

#[test]
fn the_installed_zsh_file_differs_from_the_printed_script_in_its_autoload_check_and_compinit_guard_alone()
 {
    let guard = [
        "# Start the completion system when no compdef is defined, and register nothing without it.",
        "(( $+functions[compdef] )) || { autoload -Uz compinit && compinit -i }",
        "(( $+functions[compdef] )) || return 0",
    ];
    let printed = zsh_script("git-lfs");
    assert!(printed.contains("\"_git-lfs\""));
    let expected = printed
        .replacen(
            "#compdef git-lfs\n",
            &format!("#compdef git-lfs\n{}\n", guard.join("\n")),
            1,
        )
        .replace("_git-lfs", "_loom_git_2d_lfs");
    assert_eq!(zsh_installed_script("git-lfs"), expected);
}

#[test]
fn the_bash_script_escapes_every_tilde_in_a_word_it_inserts_which_printf_q_may_leave_bare() {
    if !shell_runs("bash") {
        return;
    }
    let result = source_script(
        &SCRIPTS[0],
        &bash_script("kit"),
        r#"; for word in "~root" "a b" "a~b" "a=~root" "~~"; do __kit_quote "$word"; printf '%s\n' "$quoted"; done"#,
    );
    assert_eq!((result.status, result.stderr.as_str()), (Some(0), ""));
    assert_eq!(result.stdout, "\\~root\na\\ b\na\\~b\na=\\~root\n\\~\\~\n");
}

#[test]
fn the_zsh_script_for_describe_files_or_arguments_defines_none_of_the_completion_system_functions()
{
    for name in ["describe", "files", "arguments"] {
        let text = zsh_script(name);
        assert!(
            !re(r"(?m)^_(?:describe|files|arguments)\s*\(\)").is_match(&text),
            "{name}"
        );
        assert!(
            re(&format!(r"(?m)^_loom_{name}\(\)$")).is_match(&text),
            "{name}"
        );
        assert!(
            text.contains(&format!("compdef _loom_{name} '{name}'")),
            "{name}"
        );
    }
}

/// Portable names, including ones that match a Zsh completion system function's suffix.
const PORTABLE_NAMES: [&str; 7] = [
    "kit",
    "git-lfs",
    "a.b_c",
    "9",
    "describe",
    "files",
    "arguments",
];

#[test]
fn each_script_sources_without_running_anything_for_every_portable_name() {
    for entry in &SCRIPTS {
        if !shell_runs(entry.shell) {
            continue;
        }
        for name in PORTABLE_NAMES {
            let result = source_script(entry, &(entry.script)(name), "");
            assert_eq!(result.stderr, "", "{} {name}", entry.title);
            assert_eq!(result.status, Some(0), "{} {name}", entry.title);
            assert!(!result.pwned, "{} {name}", entry.title);
        }
    }
}

#[test]
fn identifiers_of_the_portable_names_hold_only_letters_digits_and_underscores() {
    for name in PORTABLE_NAMES {
        assert!(
            identifier(name)
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_')
        );
    }
}
