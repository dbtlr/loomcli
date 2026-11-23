# notes note list

Alias: ls

List the notes, newest first.

## Usage

```text
notes note list [options]
```

## Options

- `--tag <tag>`: Show only notes with this tag.  (env: NOTES_TAG)
- `--untagged`: Show only notes with no tag.
- `--limit <limit>`: Show at most this many notes.  (default: 20)
- `--format <format>`: Select the output format, table by default. One of: table, json, jsonl.
- `--fields <fields>`: Select top-level fields of json and jsonl output, as a comma list.  (repeatable)

Use at most one of --tag and --untagged.

## Result

Kind: `rows`. Views: `table` (default), `json`, `jsonl`.

## Guidance

Read each row with `--format json`, and pass its `id` to the Command that changes a note.

## Details

Each row holds `id`, `tag`, and `text`.

## Examples

- `notes note list --tag home --limit 5`: The five newest notes tagged home.

## Failures

- `store-locked` (exit 75): Another run holds the note file.
