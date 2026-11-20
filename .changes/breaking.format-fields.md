- Add `--fields` to every Command the formatter gives `--format`. It keeps the named top-level keys of the json and jsonl output the formatter itself appended, in the order named, for a value, an array, and rows as they stream: `notes list --format jsonl --fields title,id`. An author-declared json or jsonl view is excluded, even without a map; its author shapes the data themselves. It repeats, takes a comma list, and is a control option, so it is on the help page and off MCP tool inputs. A field the output does not hold, a value that is not an object, or a view the formatter did not append fails with exit 2 and a sentence that says what to supply. The refusal under another view names only the formatter's views the Command has, and in an invocation by name each `--fields` failure names the options by their declared names, `fields` and `format`. See [Selecting fields](docs/plugins/format.md#selecting-fields).
- Add `transform` to `MiddlewareContext` and export `ResultTransform` from `@loomcli/core`. A middleware assigns one function per run before the dispatch boundary, and core applies it to a value result once, and to each row of a rows result before the selected view renders: as it arrives under a row view, or when the collected rows render under a whole view. `middlewareContext` from `@loomcli/testing` keeps the last transform assigned. See [Middleware](docs/core/middleware.md).

### Migration

**Affected surface.** No compile error: the application fails every run with the hook-collision error. The surface is an application that installs `format()` and declares its own option named `fields` on a Command that declares a result, or on a group, or a global option or another plugin's option named `fields`, or an option that claims the spelling `--fields` through `aliases` or `visibleAliases`. A positional argument named `fields` on a Command that receives `--fields` also collides: core rejects it with `@loomcli/core/name-shared-across-kinds`.

**Why.** The formatter now declares `--fields` beside `--format`, and a second declaration of one name on a Command is the hook-collision build error, as it is for `format`. An argument and an option also cannot share the declared name `fields`.

**Before and after.**

Before, a Command's own option, which now collides:

```ts
new Command('list')
  .option('fields', { type: 'string' })
  .rows<Note>({ views: { table: notesTable } })
  .action(listNotes);
```

After, the option renamed, or removed in favor of the formatter's `--fields` under `--format json` or `--format jsonl`:

```ts
new Command('list')
  .option('columns', { type: 'string' })
  .rows<Note>({ views: { table: notesTable } })
  .action(listNotes);
```

For a positional argument, rename `.argument('fields', ...)` to `.argument('columns', ...)` and change action code from `args.fields` to `args.columns`.

**Steps.**

1. Search the application for options named `fields`: `.option('fields'` and `.globalOption('fields'`, and plugins whose `options` name `fields`. Also search for `.argument('fields'`, and for `aliases` or `visibleAliases` that include `fields`.
2. Rename each one, or remove it where the formatter's `--fields` already does its job. For a renamed argument, update action code reading `args.fields` to read the new name. For an alias, remove or rename the alias; the option and its readers stay as they are.
3. Update the application's scripts and documentation that pass the old spelling.

**Validation.** Run the application's `inspect()` or `--help` on each Command that declares a result; a collision fails with `@loomcli/core/option-declared-twice` naming `fields`, or with `@loomcli/core/name-shared-across-kinds` for an argument. Run the application's test command.
