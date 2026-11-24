//! One pass over a source.

use loomcli_core::Content;

/// The metric one invocation counts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Metric {
    /// The source's size in bytes.
    Bytes,
    /// Runs of non-whitespace characters after UTF-8 decoding.
    Words,
    /// The LF characters.
    Lines,
}

impl Metric {
    /// The metric a validated `--metric` value names; the validator admits these three alone.
    #[must_use]
    pub fn named(name: &str) -> Self {
        match name {
            "words" => Self::Words,
            "lines" => Self::Lines,
            _ => Self::Bytes,
        }
    }
}

/// The counts one pass produces: the byte size the threshold reads, and the selected metric.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SourceCounts {
    /// The source's size in bytes.
    pub bytes: u64,
    /// The selected metric's count.
    pub counted: u64,
}

/// JavaScript's `\s`: the characters that close a word. It differs from Rust's whitespace in two
/// places, U+FEFF (whitespace here) and U+0085 (not whitespace here).
fn is_space(character: char) -> bool {
    match character {
        '\u{85}' => false,
        '\u{FEFF}' => true,
        other => other.is_whitespace(),
    }
}

/// The words in decoded text: the starts of runs of non-whitespace characters.
fn count_words(text: &str) -> u64 {
    let mut in_word = false;
    let mut words = 0;
    for character in text.chars() {
        if is_space(character) {
            in_word = false;
        } else {
            if !in_word {
                words += 1;
            }
            in_word = true;
        }
    }
    words
}

/// Counts bytes from the raw bytes, never decoding them. The text metrics decode with the
/// replacement character for an invalid sequence, as the reference's decoder does.
#[must_use]
pub fn count_bytes_of(bytes: &[u8], metric: Metric) -> SourceCounts {
    let size = bytes.len() as u64;
    let counted = match metric {
        Metric::Bytes => size,
        Metric::Lines => bytes.iter().filter(|byte| **byte == b'\n').count() as u64,
        Metric::Words => count_words(&String::from_utf8_lossy(bytes)),
    };
    SourceCounts {
        bytes: size,
        counted,
    }
}

/// Reads the source and counts it. A read failure is the error the source raised.
pub async fn count_source(
    source: &Content,
    metric: Metric,
) -> Result<SourceCounts, loomcli_core::Error> {
    let bytes = source.bytes().await?;
    Ok(count_bytes_of(&bytes, metric))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes_count_the_size_and_lines_count_line_feeds() {
        assert_eq!(
            count_bytes_of("héllo\n".as_bytes(), Metric::Bytes).counted,
            7
        );
        assert_eq!(count_bytes_of(b"a\nb\nc", Metric::Lines).counted, 2);
    }

    #[test]
    fn words_split_on_javascript_whitespace() {
        let counts = count_bytes_of("a\u{a0}b\u{feff}c\u{85}d  ".as_bytes(), Metric::Words);
        assert_eq!(counts.counted, 3);
        assert_eq!(count_bytes_of(b"  \n\t ", Metric::Words).counted, 0);
    }

    #[test]
    fn an_invalid_sequence_reads_as_one_word_character() {
        assert_eq!(count_bytes_of(b"ab \xff\xfe cd", Metric::Words).counted, 3);
    }
}
