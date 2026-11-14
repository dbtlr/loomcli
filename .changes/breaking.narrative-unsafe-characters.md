- Change `loom changelog write --narrative FILE` to refuse a narrative file holding the bytes and characters a fragment refuses: bytes that are not valid UTF-8, a carriage return, a control character other than tab and line feed, a bidirectional control or mark, or the zero-width space U+200B. `write` no longer copies a narrative's terminal escape or hidden reordering into `CHANGELOG.md`, nor `notes` onto a release page. The failure names the file as `--narrative` gave it, the line, and the first such character by its code point, such as `narrative.md: line 1 holds the carriage return U+000D. Save the narrative with LF line endings.`, as [the package changelog](docs/toolchain/changelog.md) describes.

### Migration

**Affected surface.** No compile error: `loom changelog write` fails when it reads the narrative. The surface is a file passed to `loom changelog write --narrative`, for a stable or a prerelease cut, that has CRLF line endings, is saved in an encoding other than UTF-8, or holds one of the refused characters.

**Why.** `write` copies the narrative's prose verbatim into the changelog, and `notes` copies the release section onto a release page, so a terminal escape, a carriage return, or an invisible bidirectional control in a narrative reached every reader of both.

**Before and after.**

Before, a narrative saved with CRLF line endings was copied into `CHANGELOG.md`:

```sh
printf 'This release fixes output.\r\n' > narrative.md
loom changelog write --narrative narrative.md   # exit 0, with the carriage return in CHANGELOG.md
```

After, the same cut fails with exit 1 and changes no file:

```text
narrative.md: line 1 holds the carriage return U+000D. Save the narrative with LF line endings.
```

**Steps.**

1. Run `loom changelog write --dry-run --narrative FILE` and read the failure it prints.
2. For a carriage return, save the narrative with LF line endings through your editor's line-ending setting.
3. For invalid UTF-8, save the narrative as UTF-8.
4. For any other character, delete it at the line the failure names.

**Validation.** Run `loom changelog write --dry-run --narrative FILE` and check that it exits 0 and, for a stable cut, prints the narrative above the entries.
