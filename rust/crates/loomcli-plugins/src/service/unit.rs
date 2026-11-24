//! The unit files the plugin writes: a systemd user unit on Linux and a launchd property list on
//! macOS. Each is the contract's text with its values substituted, ending in one newline.

/// What a unit file holds: its label, the words it runs, its working directory, and its
/// description.
pub(super) struct UnitValues<'a> {
    pub(super) label: &'a str,
    pub(super) words: &'a [String],
    pub(super) home: &'a str,
    pub(super) description: &'a str,
}

/// A value systemd expands no specifier in: every `%` doubled.
fn without_specifiers(value: &str) -> String {
    value.replace('%', "%%")
}

/// One `ExecStart` word, wrapped in `"` with `\`, `"`, and `$` escaped and `%` doubled.
fn exec_word(word: &str) -> String {
    let escaped = word
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('$', "$$");
    format!("\"{}\"", without_specifiers(&escaped))
}

/// The systemd user unit that runs the words from the home folder and always restarts them.
pub(super) fn systemd_unit(values: &UnitValues<'_>) -> String {
    let words: Vec<String> = values.words.iter().map(|word| exec_word(word)).collect();
    [
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
        String::new(),
        "[Install]".to_owned(),
        "WantedBy=default.target".to_owned(),
        String::new(),
    ]
    .join("\n")
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
        "</dict>".to_owned(),
        "</plist>".to_owned(),
        String::new(),
    ]);
    lines.join("\n")
}
