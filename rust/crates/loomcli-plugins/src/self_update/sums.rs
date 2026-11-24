//! A release's `SHA256SUMS`, as `sha256sum` writes it: one line per file, its digest, a space and a
//! space or `*`, and the file name.

/// What `SHA256SUMS` says about one asset.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Listing {
    /// The one digest it lists for the asset, as 64 lowercase hexadecimal digits.
    Digest(String),
    /// No line names the asset.
    Missing,
    /// Two lines name the asset with different digests.
    Conflict,
}

/// The digest and file name of one line, or `None` for a line in another shape. The name holds no
/// carriage return or line or paragraph separator, which the reference's `.` does not match.
fn sum_line(line: &str) -> Option<(&str, &str)> {
    let digest = line.get(..64)?;
    if !digest
        .bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return None;
    }
    let rest = line.get(64..)?;
    let file = rest
        .strip_prefix("  ")
        .or_else(|| rest.strip_prefix(" *"))?;
    let ends_a_line = |character: char| matches!(character, '\r' | '\u{2028}' | '\u{2029}');
    (!file.is_empty() && !file.contains(ends_a_line)).then_some((digest, file))
}

/// The asset's digest from `SHA256SUMS`, matching its file name exactly and ignoring every other
/// line.
pub(crate) fn listing_of(sums: &str, asset: &str) -> Listing {
    let mut digests: Vec<&str> = Vec::new();
    for line in sums.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if let Some((digest, file)) = sum_line(line)
            && file == asset
            && !digests.contains(&digest)
        {
            digests.push(digest);
        }
    }
    match digests.as_slice() {
        [] => Listing::Missing,
        [digest] => Listing::Digest((*digest).to_owned()),
        _ => Listing::Conflict,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIGEST: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const OTHER: &str = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

    #[test]
    fn a_line_names_its_asset_exactly_in_text_or_binary_mode() {
        let sums = format!("{DIGEST}  notes-linux-x64\r\n{OTHER} *notes-linux-arm64\n");
        assert_eq!(
            listing_of(&sums, "notes-linux-x64"),
            Listing::Digest(DIGEST.to_owned())
        );
        assert_eq!(
            listing_of(&sums, "notes-linux-arm64"),
            Listing::Digest(OTHER.to_owned())
        );
        assert_eq!(listing_of(&sums, "notes-linux"), Listing::Missing);
    }

    #[test]
    fn the_same_digest_twice_is_one_listing_and_two_digests_conflict() {
        let same = format!("{DIGEST}  notes\n{DIGEST} *notes\n");
        assert_eq!(
            listing_of(&same, "notes"),
            Listing::Digest(DIGEST.to_owned())
        );
        let two = format!("{DIGEST}  notes\n{OTHER}  notes\n");
        assert_eq!(listing_of(&two, "notes"), Listing::Conflict);
    }

    #[test]
    fn a_line_in_another_shape_is_passed_over() {
        let upper = DIGEST.to_uppercase();
        for line in [
            format!("{upper}  notes"),
            format!("{DIGEST} notes"),
            format!("{DIGEST}\tnotes"),
            format!("{DIGEST}  no\rtes"),
            format!("{}  notes", &DIGEST[1..]),
        ] {
            assert_eq!(listing_of(&line, "notes"), Listing::Missing, "{line}");
        }
    }
}
