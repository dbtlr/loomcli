- Change `loom changelog check`, `loom changelog write`, and `loom changelog notes` for a prerelease to refuse a fragment holding bytes that are not valid UTF-8, a carriage return, a control character other than tab and line feed, a bidirectional control or mark (U+202A through U+202E, U+2066 through U+2069, U+200E, U+200F, U+061C), or the zero-width space U+200B, so `write` no longer copies a fragment's terminal escape or hidden reordering into `CHANGELOG.md`, nor `notes` onto a release page. The failure names the fragment, the line, and the first such character by its code point, such as `.changes/fix.md: line 1 holds the carriage return U+000D. Save the fragment with LF line endings.`, as [the package changelog](docs/toolchain/changelog.md) describes.

### Migration

**Affected surface.** No compile error: the commands fail when they read the fragment. Fragments in a package's `.changes/` folder, or the folder `paths.changes` names, that `loom changelog check`, `loom changelog write`, or `loom changelog notes` reads, when a fragment has CRLF line endings, is saved in an encoding other than UTF-8, or holds one of the refused characters.

**Why.** `write` copies a fragment's prose verbatim into the changelog and `notes` onto a release page, so a terminal escape, a carriage return, or an invisible bidirectional control in a fragment reached every reader of both.

**Before and after.**

Before, a fragment saved with CRLF line endings passed:

```sh
printf -- '- Fix output.\r\n' > .changes/fix.md
loom changelog check   # Checked 1 fragment.
```

After, the same fragment fails with exit 1:

```text
.changes/fix.md: line 1 holds the carriage return U+000D. Save the fragment with LF line endings.
```

**Steps.**

1. Run `loom changelog check` and read each failure it prints.
2. For a carriage return, save the fragment with LF line endings through your editor's line-ending setting. A repository whose checkout converts line endings can keep fragments at LF with `.changes/*.md text eol=lf` in `.gitattributes`.
3. For invalid UTF-8, save the fragment as UTF-8.
4. For any other character, delete it at the line the failure names.

**Validation.** Run `loom changelog check` and check that it prints `Checked <count> fragments.` and exits 0.
