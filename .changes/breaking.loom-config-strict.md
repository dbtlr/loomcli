- Change `loom` to read `loom.config.json` strictly, so a CI run never passes on conventions the package did not choose. A file the lookup finds that cannot be read, does not parse, or does not hold a JSON object, and a value the file's schema rejects, such as `"paths": { "changes": "" }`, now fail `build`, `init`, `changelog check`, `changelog write`, and `changelog notes` with code 2, where the command warned or dropped the value and ran on conventions. Before, `loom changelog check` over a broken file that names its fragment folder warned, checked the conventional `.changes/` instead, and exited 0, printing `Checked 0 fragments.` when that folder held none. Now it fails: `loom: Configuration file loom.config.json is not valid JSON at line 3, column 5. Correct its syntax, or remove it.` A missing file, an unknown key, and a run under `--no-config` behave as before. The [configuration file](docs/toolchain/build.md#the-configuration-file) reference states the rules.

### Migration

**Affected surface.** No compile error: the bin fails at run time. The surface is a package whose `loom.config.json`, or the file `--config` names, holds a value the schema rejects: a `paths` or `postInstall` that is not an object, a `paths` value that is not a nonempty string, a `postInstall.command` that is not a non-empty list of strings, or a `postInstall.message` that is not a string. A `loom.config.json` the lookup finds that cannot be read, does not parse, or does not hold a JSON object is affected too. `loom init` scaffolding a new application under a package whose file is such a file is affected too.

**Why.** A command that ran on conventions after a warning, or after dropping a value, read or wrote paths the package did not name, and a CI guard passed with nothing checked.

**Before and after.**

Before, a `loom.config.json` whose fragment folder is an empty string, which `loom` dropped while it read `.changes/`:

```json
{ "paths": { "changes": "" } }
```

After, name the folder, or remove the key to use `.changes/`:

```json
{ "paths": { "changes": "changes" } }
```

**Steps.**

1. Run `loom changelog check` in each package that keeps a `loom.config.json`.
2. For each failure, correct the value or the syntax it names, or remove the key or the file to use the convention.
3. Where `loom init` scaffolds a new application under such a package, correct that package's file, or run `loom init --no-config`.

**Validation.** Run `loom changelog check` and `loom build` in each package. Each exits 0, and `changelog check` counts the fragments in the folder the file names.
