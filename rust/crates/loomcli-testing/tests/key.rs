//! The reference's `key.test.ts`: the key table's terminal encodings.

use loomcli_testing::key;

#[test]
fn the_key_table_publishes_terminal_encodings() {
    let table = [
        (key::BACKSPACE, "\u{7f}"),
        (key::DELETE, "\u{1b}[3~"),
        (key::DOWN, "\u{1b}[B"),
        (key::END, "\u{1b}[F"),
        (key::ENTER, "\r"),
        (key::ESCAPE, "\u{1b}"),
        (key::HOME, "\u{1b}[H"),
        (key::LEFT, "\u{1b}[D"),
        (key::RIGHT, "\u{1b}[C"),
        (key::SPACE, " "),
        (key::TAB, "\t"),
        (key::UP, "\u{1b}[A"),
    ];
    for (member, bytes) in table {
        assert_eq!(member, bytes);
    }
    assert_eq!(key::ctrl('a'), "\u{1}");
    assert_eq!(key::ctrl('z'), "\u{1a}");
    assert_eq!(key::alt('b'), "\u{1b}b");
}
