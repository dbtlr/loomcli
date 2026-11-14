- Change `loom pr check` to refuse a release PR whose `CHANGELOG.md` narrative holds the bytes and characters a `--narrative` file refuses: bytes that are not valid UTF-8, a carriage return, a control character other than tab and line feed, a bidirectional control or mark, or the zero-width space U+200B. A narrative edited by hand in the release PR after the cut no longer carries a terminal escape or a hidden reordering onto `main` and the release page. The check reads the narrative from the bytes of `CHANGELOG.md`, and the failure names `CHANGELOG.md`, the line within it, and the first such character by its code point, such as `CHANGELOG.md: line 6 holds the carriage return U+000D. Save the narrative with LF line endings.`, as [the PR guard reference](docs/maintaining/pr-guards.md) describes. The compiled entries below the narrative come from fragments, which are already checked, and a release section without a narrative is checked as before.

### Migration

**Affected surface.** No compile error: `loom pr check` fails when it checks the release PR. The surface is a release PR whose `CHANGELOG.md` section holds a narrative, edited after the cut, with a carriage return, bytes that are not UTF-8, or one of the refused characters.

**Why.** The release plan copies the release section onto the GitHub Release page, so a terminal escape, a carriage return, or an invisible bidirectional control edited into the narrative reached every reader of `CHANGELOG.md` and of the release page, though `loom release cut --narrative` already refused the same file.

**Before and after.**

Before, a release PR whose narrative line ended with a carriage return passed:

```sh
pnpm loom pr check --base origin/main --title "chore(release): Release v0.4.8 - Improve output"   # exit 0
```

After, the same check fails with exit 1:

```text
CHANGELOG.md: line 6 holds the carriage return U+000D. Save the narrative with LF line endings.
```

**Steps.**

1. Run `pnpm loom pr check` with the release PR's base and title, and read the failure it prints.
2. For a carriage return, save `CHANGELOG.md` with LF line endings through your editor's line-ending setting.
3. For invalid UTF-8, save `CHANGELOG.md` as UTF-8.
4. For any other character, delete it at the line the failure names, and commit the change to the release branch.

**Validation.** Run `pnpm loom pr check` with the release PR's base and title, and check that it prints `PR checks passed.` and exits 0.
