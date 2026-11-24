//! The two forms in which an application name enters a completion script, so the name reaches the
//! shell as data and never as source: a function identifier and a single-quoted string, in Bash and
//! Zsh, Fish, or PowerShell quoting. Each script takes the Application's name, which core's
//! portable name rule already keeps to the POSIX portable filename set, starting with neither `-`
//! nor `.`, so no newline, quote, or leading `-` reaches a script.

/// The name as the suffix of a shell function identifier. ASCII letters and digits stay, and every
/// other code point, `_` included, is written as `_`, its lowercase hexadecimal digits, and `_`, so
/// `git-lfs` gives `git_2d_lfs` and no two names give one identifier.
#[must_use]
pub fn identifier(name: &str) -> String {
    name.chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_string()
            } else {
                format!("_{:x}_", u32::from(character))
            }
        })
        .collect()
}

/// The name as a Bash or Zsh single-quoted string, each `'` written as `'\''`.
#[must_use]
pub fn posix_quoted(name: &str) -> String {
    format!("'{}'", name.replace('\'', "'\\''"))
}

/// The name as a Fish single-quoted string, which reads `\\` and `\'` as escapes.
#[must_use]
pub fn fish_quoted(name: &str) -> String {
    format!("'{}'", name.replace('\\', "\\\\").replace('\'', "\\'"))
}

/// Whether PowerShell's single quotes end at the character: `'` or U+2018 through U+201B.
fn ends_powershell_quotes(character: char) -> bool {
    character == '\'' || ('\u{2018}'..='\u{201b}').contains(&character)
}

/// The text as a PowerShell single-quoted string, each of its single quotes written twice, which
/// PowerShell reads as that one character. Nothing else in single quotes is special to it.
#[must_use]
pub fn powershell_quoted(text: &str) -> String {
    let mut quoted = String::with_capacity(text.len() + 2);
    quoted.push('\'');
    for character in text.chars() {
        quoted.push(character);
        if ends_powershell_quotes(character) {
            quoted.push(character);
        }
    }
    quoted.push('\'');
    quoted
}
