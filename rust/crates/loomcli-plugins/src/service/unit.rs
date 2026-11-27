//! The unit files the plugin writes: a systemd user unit on Linux and a launchd property list on
//! macOS. Each is the contract's text with its values substituted, ending in one newline.

use std::num::NonZeroU64;

const MILLISECONDS_PER_SECOND: u64 = 1_000;

/// The resolved values for either manager's unit file.
pub(super) struct UnitValues<'a> {
    pub(super) label: &'a str,
    pub(super) words: &'a [String],
    pub(super) home: &'a str,
    pub(super) description: &'a str,
    pub(super) environment: &'a [(String, String)],
    pub(super) output: Option<&'a str>,
    pub(super) stop_timeout: Option<NonZeroU64>,
}

/// A value systemd expands no specifier in: every `%` doubled.
fn without_specifiers(value: &str) -> String {
    value.replace('%', "%%")
}

/// One quoted systemd item with its backslashes, quotes, and specifiers escaped.
fn systemd_word(word: &str) -> String {
    let escaped = word.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{}\"", without_specifiers(&escaped))
}

/// `ExecStart` also expands dollar signs.
fn exec_word(word: &str) -> String {
    systemd_word(&word.replace('$', "$$"))
}

/// An environment assignment uses C-style whitespace escapes and literal dollar signs.
fn environment_line(name: &str, value: &str) -> String {
    let assignment = systemd_word(&format!("{name}={value}"))
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t");
    format!("Environment={assignment}")
}

/// The systemd user unit that runs the words from the home folder and always restarts them.
pub(super) fn systemd_unit(values: &UnitValues<'_>) -> String {
    let words: Vec<String> = values.words.iter().map(|word| exec_word(word)).collect();
    let mut lines = vec![
        "[Unit]".to_owned(),
        format!("Description={}", without_specifiers(values.description)),
        "StartLimitIntervalSec=0".to_owned(),
        String::new(),
        "[Service]".to_owned(),
        format!("ExecStart={}", words.join(" ")),
        format!("WorkingDirectory={}", without_specifiers(values.home)),
        "Restart=always".to_owned(),
        "RestartSec=10".to_owned(),
        "SuccessExitStatus=130 143".to_owned(),
    ];
    lines.extend(
        values
            .environment
            .iter()
            .map(|(name, value)| environment_line(name, value)),
    );
    if let Some(output) = values.output {
        // `append:` takes the rest of the line as a path and preserves quotes and backslashes.
        let path = without_specifiers(output);
        lines.push(format!("StandardOutput=append:{path}"));
        lines.push(format!("StandardError=append:{path}"));
    }
    if let Some(timeout) = values.stop_timeout {
        lines.push(format!("TimeoutStopSec={timeout}ms"));
    }
    lines.extend([
        String::new(),
        "[Install]".to_owned(),
        "WantedBy=default.target".to_owned(),
        String::new(),
    ]);
    lines.join("\n")
}

/// A property list value with `&`, `<`, `>`, `"`, and `'` written as XML entities.
fn xml_text(value: &str) -> String {
    let mut text = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '"' => text.push_str("&quot;"),
            '&' => text.push_str("&amp;"),
            '\'' => text.push_str("&apos;"),
            '<' => text.push_str("&lt;"),
            '>' => text.push_str("&gt;"),
            other => text.push(other),
        }
    }
    text
}

/// The launchd user agent that runs the words from the home folder and keeps them alive.
pub(super) fn launchd_plist(values: &UnitValues<'_>) -> String {
    let mut lines = vec![
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>".to_owned(),
        "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">".to_owned(),
        "<plist version=\"1.0\">".to_owned(),
        "<dict>".to_owned(),
        "  <key>Label</key>".to_owned(),
        format!("  <string>{}</string>", xml_text(values.label)),
        "  <key>ProgramArguments</key>".to_owned(),
        "  <array>".to_owned(),
    ];
    lines.extend(
        values
            .words
            .iter()
            .map(|word| format!("    <string>{}</string>", xml_text(word))),
    );
    lines.extend([
        "  </array>".to_owned(),
        "  <key>WorkingDirectory</key>".to_owned(),
        format!("  <string>{}</string>", xml_text(values.home)),
        "  <key>RunAtLoad</key>".to_owned(),
        "  <true/>".to_owned(),
        "  <key>KeepAlive</key>".to_owned(),
        "  <true/>".to_owned(),
        "  <key>ThrottleInterval</key>".to_owned(),
        "  <integer>10</integer>".to_owned(),
    ]);
    if !values.environment.is_empty() {
        lines.push("  <key>EnvironmentVariables</key>".to_owned());
        lines.push("  <dict>".to_owned());
        for (name, value) in values.environment {
            lines.push(format!("    <key>{}</key>", xml_text(name)));
            // An XML parser normalizes a literal carriage return to a line feed.
            let value = xml_text(value).replace('\r', "&#13;");
            lines.push(format!("    <string>{value}</string>"));
        }
        lines.push("  </dict>".to_owned());
    }
    if let Some(output) = values.output {
        let path = format!("  <string>{}</string>", xml_text(output));
        lines.extend([
            "  <key>StandardOutPath</key>".to_owned(),
            path.clone(),
            "  <key>StandardErrorPath</key>".to_owned(),
            path,
        ]);
    }
    if let Some(timeout) = values.stop_timeout {
        let seconds = timeout.get().div_ceil(MILLISECONDS_PER_SECOND);
        lines.push("  <key>ExitTimeOut</key>".to_owned());
        lines.push(format!("  <integer>{seconds}</integer>"));
    }
    lines.extend(["</dict>".to_owned(), "</plist>".to_owned(), String::new()]);
    lines.join("\n")
}
