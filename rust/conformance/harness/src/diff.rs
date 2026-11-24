//! Unified diffs with control characters made visible, for `--show`.

/// Makes control characters visible: ESC as `\x1b`, tab as `\t`, carriage return as `\r`, and
/// every other control byte as `\xNN`. Line feeds are kept; the caller splits on them.
pub fn visible(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '\n' => out.push('\n'),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            c if (c as u32) < 0x20 || c as u32 == 0x7f => {
                out.push_str(&format!("\\x{:02x}", c as u32))
            }
            c => out.push(c),
        }
    }
    out
}

/// Marks a final line that has no line feed, so that line differs from the same text with one.
const NO_NEWLINE: char = '\u{1}';

fn lines_of(text: &str) -> Vec<String> {
    let shown = visible(text);
    let ends_with_newline = shown.is_empty() || shown.ends_with('\n');
    let mut lines: Vec<String> = shown.split('\n').map(str::to_owned).collect();
    if ends_with_newline {
        lines.pop();
    } else if let Some(last) = lines.last_mut() {
        last.push(NO_NEWLINE);
    }
    lines
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Op {
    Keep,
    Del,
    Add,
}

/// Edit script over the lines: common prefix and suffix trimmed, longest common subsequence between.
fn script(a: &[String], b: &[String]) -> Vec<Op> {
    let prefix = a.iter().zip(b).take_while(|(x, y)| x == y).count();
    let suffix = a[prefix..]
        .iter()
        .rev()
        .zip(b[prefix..].iter().rev())
        .take_while(|(x, y)| x == y)
        .count();
    let (am, bm) = (&a[prefix..a.len() - suffix], &b[prefix..b.len() - suffix]);
    let mut ops: Vec<Op> = vec![Op::Keep; prefix];
    if am.len().saturating_mul(bm.len()) > 4_000_000 {
        ops.extend(vec![Op::Del; am.len()]);
        ops.extend(vec![Op::Add; bm.len()]);
    } else {
        let w = bm.len() + 1;
        let mut table = vec![0u32; (am.len() + 1) * w];
        for i in (0..am.len()).rev() {
            for j in (0..bm.len()).rev() {
                table[i * w + j] = if am[i] == bm[j] {
                    table[(i + 1) * w + j + 1] + 1
                } else {
                    table[(i + 1) * w + j].max(table[i * w + j + 1])
                };
            }
        }
        let (mut i, mut j) = (0, 0);
        while i < am.len() || j < bm.len() {
            if i < am.len() && j < bm.len() && am[i] == bm[j] {
                ops.push(Op::Keep);
                i += 1;
                j += 1;
            } else if i < am.len()
                && (j == bm.len() || table[(i + 1) * w + j] >= table[i * w + j + 1])
            {
                ops.push(Op::Del);
                i += 1;
            } else {
                ops.push(Op::Add);
                j += 1;
            }
        }
    }
    ops.extend(vec![Op::Keep; suffix]);
    ops
}

/// A unified diff of `expected` against `actual`, three lines of context, or an empty string when
/// the texts are equal.
pub fn unified_diff(
    expected_label: &str,
    actual_label: &str,
    expected: &str,
    actual: &str,
) -> String {
    if expected == actual {
        return String::new();
    }
    let (a, b) = (lines_of(expected), lines_of(actual));
    let ops = script(&a, &b);
    // Each entry is (op, line text); Keep and Del read from `a`, Add from `b`. Add indexes are
    // positions in `b` only when no prefix shifted them, so recompute them by counting.
    let mut rows: Vec<(Op, &str)> = Vec::new();
    let (mut ai, mut bi) = (0, 0);
    for op in &ops {
        match op {
            Op::Keep => {
                rows.push((Op::Keep, &a[ai]));
                ai += 1;
                bi += 1;
            }
            Op::Del => {
                rows.push((Op::Del, &a[ai]));
                ai += 1;
            }
            Op::Add => {
                rows.push((Op::Add, &b[bi]));
                bi += 1;
            }
        }
    }
    let changed: Vec<usize> = rows
        .iter()
        .enumerate()
        .filter(|(_, (op, _))| *op != Op::Keep)
        .map(|(i, _)| i)
        .collect();
    let mut out = format!("--- {expected_label}\n+++ {actual_label}\n");
    let context = 3;
    let mut k = 0;
    while k < changed.len() {
        let start = changed[k].saturating_sub(context);
        let mut end = changed[k];
        while k + 1 < changed.len() && changed[k + 1] <= end + 2 * context + 1 {
            k += 1;
            end = changed[k];
        }
        let end = (end + context + 1).min(rows.len());
        let line_no = |upto: usize, want: Op| {
            1 + rows[..upto]
                .iter()
                .filter(|(op, _)| *op == Op::Keep || *op == want)
                .count()
        };
        let a_start = line_no(start, Op::Del);
        let b_start = line_no(start, Op::Add);
        let a_len = rows[start..end]
            .iter()
            .filter(|(op, _)| *op != Op::Add)
            .count();
        let b_len = rows[start..end]
            .iter()
            .filter(|(op, _)| *op != Op::Del)
            .count();
        // Unified diffs number an empty range by the line before it.
        let a_start = if a_len == 0 { a_start - 1 } else { a_start };
        let b_start = if b_len == 0 { b_start - 1 } else { b_start };
        out.push_str(&format!("@@ -{a_start},{a_len} +{b_start},{b_len} @@\n"));
        for (op, text) in &rows[start..end] {
            let sign = match op {
                Op::Keep => ' ',
                Op::Del => '-',
                Op::Add => '+',
            };
            match text.strip_suffix(NO_NEWLINE) {
                Some(bare) => {
                    out.push_str(&format!("{sign}{bare}\n\\ No newline at end of file\n"))
                }
                None => out.push_str(&format!("{sign}{text}\n")),
            }
        }
        k += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn control_characters_become_visible() {
        assert_eq!(
            visible("\u{1b}[1mA\u{1b}[0m\t\r\u{7}"),
            "\\x1b[1mA\\x1b[0m\\t\\r\\x07"
        );
    }

    #[test]
    fn equal_texts_give_no_diff() {
        assert_eq!(unified_diff("e", "a", "same\n", "same\n"), "");
    }

    #[test]
    fn a_changed_line_shows_as_minus_then_plus_with_context() {
        let d = unified_diff("expected", "actual", "a\nb\nc\n", "a\nB\nc\n");
        assert_eq!(
            d,
            "--- expected\n+++ actual\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n"
        );
    }

    #[test]
    fn a_missing_final_newline_is_marked() {
        let d = unified_diff("e", "a", "x\n", "x");
        assert!(d.contains("-x\n+x\n\\ No newline at end of file\n"), "{d}");
    }

    #[test]
    fn an_empty_side_diffs_as_pure_additions() {
        let d = unified_diff("e", "a", "", "one\ntwo\n");
        assert_eq!(d, "--- e\n+++ a\n@@ -0,0 +1,2 @@\n+one\n+two\n");
    }
}
