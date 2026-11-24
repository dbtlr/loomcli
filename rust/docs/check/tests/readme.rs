//! The README's application is the example program, byte for byte.

#[test]
fn the_readme_holds_the_wordlen_example_whole() {
    let readme = include_str!("../../../README.md");
    let program = include_str!("../examples/wordlen.rs");
    let block = format!("```rust,no_run\n{program}```\n");
    assert!(
        readme.contains(&block),
        "README.md's application differs from docs/check/examples/wordlen.rs. Copy the program into the README's rust,no_run block."
    );
}
