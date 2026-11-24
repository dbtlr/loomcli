//! Ports `completion-install.test.ts`, part four: PowerShell, whose profile the plugin asks the
//! fixture `pwsh` for.

#![cfg(feature = "completion")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod completion_support;

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use completion_support::install::{
    Sandbox, Scenario, answer_of, base64, fake_pwsh, lines, names_in, powershell_line, printed, run,
};

fn chmod(path: &Path, mode: u32) {
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
}

fn profile_sentence(reason: &str) -> String {
    format!("jsonkit cannot find the profile of pwsh, because {reason}")
}

const COULD_NOT_START: &str = "pwsh could not start. Install pwsh, or name the shell you use.";

#[tokio::test]
async fn writes_the_line_into_the_profile_powershell_reports_holding_non_ascii_characters() {
    let b = Sandbox::new();
    let profile = b.home.join("Документы/PowerShell/Profile.ps1");
    let bin = b.root.join("bin");
    let (_, fake) = fake_pwsh(&bin, &answer_of(&profile.to_string_lossy()), 0, false);
    let script = b.script("pwsh");
    let result = run(
        &b,
        &["completion", "install", "pwsh"],
        Scenario::new().pwsh_env(&b, &bin).program(fake),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [
            format!(
                "Installed the pwsh completion script in {}.",
                script.display()
            ),
            format!("Added a line to {} that loads it.", profile.display()),
            "Open a new shell to use it.".to_owned(),
        ]
    );
    assert_eq!(
        fs::read_to_string(&profile).unwrap(),
        format!("{}\n", powershell_line(&script))
    );
    assert_eq!(
        fs::read_to_string(&script).unwrap(),
        printed(&b, "powershell").await
    );
    assert_eq!(
        fs::read_to_string(b.root.join("pwsh.log")).unwrap(),
        format!(
            "{}\n-NoLogo\n-NoProfile\n-NonInteractive\n-Command\n[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($PROFILE))\n",
            fs::canonicalize(&b.home).unwrap().display()
        )
    );
}

#[tokio::test]
async fn fails_when_the_fixture_cannot_start_exits_1_or_answers_a_relative_path_and_writes_nothing()
{
    // Each case: the fixture, and the sentence the failure states.
    for case in 0..3 {
        let b = Sandbox::new();
        let bin = b.root.join("bin");
        let (program, fake, sentence) = match case {
            0 => {
                let (program, fake) = fake_pwsh(&bin, "x", 0, false);
                chmod(&program, 0o644);
                (program, fake, profile_sentence(COULD_NOT_START))
            }
            1 => {
                let (program, fake) = fake_pwsh(&bin, "x", 1, false);
                (
                    program,
                    fake,
                    profile_sentence(
                        "pwsh exited with code 1. Install pwsh, or name the shell you use.",
                    ),
                )
            }
            _ => {
                let answer = answer_of("profile.ps1");
                let (program, fake) = fake_pwsh(&bin, &answer, 0, false);
                (
                    program,
                    fake,
                    profile_sentence(&format!(
                        "pwsh reported {answer}. Check that pwsh -NoProfile -Command $PROFILE prints the path of your profile."
                    )),
                )
            }
        };
        assert!(program.exists());
        let result = run(
            &b,
            &["completion", "install", "pwsh"],
            Scenario::new().pwsh_env(&b, &bin).program(fake),
        )
        .await;
        assert_eq!(result.status, 1, "{case}");
        assert_eq!(lines(&result.stderr), [sentence], "{case}");
        assert!(names_in(&b.data).is_empty(), "{case}");
        assert!(names_in(&b.state).is_empty(), "{case}");
    }
}

#[tokio::test]
async fn fails_when_the_fixture_answers_malformed_base64_and_writes_nothing() {
    for case in 0..4 {
        let b = Sandbox::new();
        // A profile path under the home whose UTF-8 length leaves the remainder named after
        // division by 3.
        let sized = |remainder: usize| {
            let base = b.home.join(".ps1");
            let padding = (remainder + 3 - (base.to_string_lossy().len() % 3)) % 3;
            b.home.join(format!("{}.ps1", "p".repeat(padding + 3)))
        };
        let text = match case {
            0 => answer_of(&sized(1).to_string_lossy()).replace("==", ""),
            1 => format!("{}====", answer_of(&sized(0).to_string_lossy())),
            2 => {
                let mut bytes = format!("{}/", b.home.display()).into_bytes();
                bytes.extend_from_slice(&[0xff, 0x70]);
                base64(&bytes)
            }
            _ => format!(
                "{} RemoteSigned",
                answer_of(&b.home.join("profile.ps1").to_string_lossy())
            ),
        };
        let bin = b.root.join("bin");
        let (_, fake) = fake_pwsh(&bin, &text, 0, false);
        let result = run(
            &b,
            &["completion", "install", "pwsh"],
            Scenario::new().pwsh_env(&b, &bin).program(fake),
        )
        .await;
        assert_eq!(result.status, 1, "{case}");
        assert_eq!(
            lines(&result.stderr),
            [profile_sentence(&format!(
                "pwsh reported {text}. Check that pwsh -NoProfile -Command $PROFILE prints the path of your profile."
            ))],
            "{case}"
        );
        assert!(names_in(&b.data).is_empty(), "{case}");
        assert!(names_in(&b.home).is_empty(), "{case}");
    }
}

#[tokio::test]
async fn reads_an_answer_that_ends_with_a_carriage_return_and_a_line_feed() {
    let b = Sandbox::new();
    let profile = b.home.join("profile.ps1");
    let bin = b.root.join("bin");
    let (_, fake) = fake_pwsh(&bin, &answer_of(&profile.to_string_lossy()), 0, true);
    let result = run(
        &b,
        &["completion", "install", "pwsh"],
        Scenario::new().pwsh_env(&b, &bin).program(fake),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        fs::read_to_string(&profile).unwrap(),
        format!("{}\n", powershell_line(&b.script("pwsh")))
    );
}

#[tokio::test]
async fn refuses_an_answer_that_ends_with_a_carriage_return_and_no_line_feed() {
    let b = Sandbox::new();
    let text = answer_of(&b.home.join("profile.ps1").to_string_lossy());
    let bin = b.root.join("bin");
    let (_, mut fake) = fake_pwsh(&bin, &text, 0, false);
    fake.bare_cr = true;
    let result = run(
        &b,
        &["completion", "install", "pwsh"],
        Scenario::new().pwsh_env(&b, &bin).program(fake),
    )
    .await;
    assert_eq!(result.status, 1);
    assert_eq!(
        lines(&result.stderr),
        [profile_sentence(&format!(
            "pwsh reported {text}\\u000d. Check that pwsh -NoProfile -Command $PROFILE prints the path of your profile."
        ))]
    );
    assert!(names_in(&b.data).is_empty());
    assert!(names_in(&b.home).is_empty());
}

#[tokio::test]
async fn ends_the_query_and_the_run_when_the_run_is_aborted_while_powershell_answers() {
    let b = Sandbox::new();
    let bin = b.root.join("bin");
    let marker = b.root.join("abort");
    let (_, mut fake) = fake_pwsh(&bin, "x", 0, false);
    fake.abort_marker = Some(marker.clone());
    let result = run(
        &b,
        &["completion", "install", "pwsh"],
        Scenario::new()
            .pwsh_env(&b, &bin)
            .program(fake)
            .abort_marker(&marker),
    )
    .await;
    assert_eq!(result.status, 130, "{}", result.stderr);
    assert!(
        !result.stderr.contains("exited with code"),
        "{}",
        result.stderr
    );
    assert!(names_in(&b.data).is_empty());
}

#[tokio::test]
async fn runs_the_pwsh_of_a_later_path_entry_when_an_earlier_one_holds_none_cannot_run_it_or_cannot_be_searched()
 {
    for case in 0..3 {
        let b = Sandbox::new();
        let profile = b.home.join("profile.ps1");
        let earlier = b.root.join("earlier");
        match case {
            0 => fs::create_dir(&earlier).unwrap(),
            1 => {
                let (program, _) = fake_pwsh(&earlier, "x", 0, false);
                chmod(&program, 0o644);
            }
            _ => {
                fs::create_dir(&earlier).unwrap();
                chmod(&earlier, 0o000);
            }
        }
        let bin = b.root.join("bin");
        let (_, fake) = fake_pwsh(&bin, &answer_of(&profile.to_string_lossy()), 0, false);
        let scenario = Scenario::new()
            .pwsh_env(&b, &bin)
            .env("PATH", &format!("{}:{}", earlier.display(), bin.display()))
            .program(fake);
        let result = run(&b, &["completion", "install", "pwsh"], scenario).await;
        chmod(&earlier, 0o755);
        assert_eq!(result.status, 0, "{case}: {}", result.stderr);
        assert_eq!(
            fs::read_to_string(&profile).unwrap(),
            format!("{}\n", powershell_line(&b.script("pwsh"))),
            "{case}"
        );
    }
}

#[tokio::test]
async fn never_runs_a_fixture_pwsh_in_the_working_directory_or_under_a_relative_path_entry() {
    for case in 0..2 {
        let b = Sandbox::new();
        // The absolute entry is an empty folder, so a real pwsh on the runner is never found. The
        // process and its host run from the home folder, where PowerShell's query runs too. An empty
        // PATH entry names the working directory, and a relative one a folder under it.
        let empty = b.root.join("empty");
        fs::create_dir(&empty).unwrap();
        let (path, folder) = if case == 0 {
            (format!("{}:", empty.display()), b.home.clone())
        } else {
            (format!("bin:{}", empty.display()), b.home.join("bin"))
        };
        let (_, fake) = fake_pwsh(
            &folder,
            &answer_of(&b.home.join("profile.ps1").to_string_lossy()),
            0,
            false,
        );
        let log = b.root.join("pwsh.log");
        let result = run(
            &b,
            &["completion", "install", "pwsh"],
            Scenario::new()
                .cwd(&b.home)
                .env("PATH", &path)
                .env("PWSH_LOG", &log.to_string_lossy())
                .program(fake),
        )
        .await;
        assert_eq!(result.status, 1, "{case}");
        assert_eq!(
            lines(&result.stderr),
            [profile_sentence(COULD_NOT_START)],
            "{case}"
        );
        assert!(!log.exists(), "{case}");
    }
}
