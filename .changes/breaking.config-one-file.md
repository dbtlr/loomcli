- Change `@loomcli/plugins/config` to read one configuration file per run, never merged: the file `--config` names, or else the first found of the application's `file` in the working directory and then in the home directory, `USERPROFILE` on Windows and `HOME` elsewhere. A broken file in the working directory warns and the lookup goes on to the home directory. See the [core reference](docs/core.md#configuration).
- Remove the `files` setting of `config()`, the key-by-key answers across several files, and the user file derived from the application name under `XDG_CONFIG_HOME`, `HOME/.config`, or `APPDATA`.
- Add the `file` setting to `config()`: the configuration file's name or relative path, `.<app>.json` by default. Its extension chooses the parser: `.toml` reads as TOML through `smol-toml` (TOML 1.0, with the TOML 1.1 additions it accepts), `.yaml` and `.yml` as YAML 1.2 under the core schema, and every other name as JSON. `file` is a file pattern whose extension may be `*`, which tries `toml`, `yaml`, `yml`, then `json`, or a brace list such as `{toml,json}`, tried in the order listed. When several candidates are present in one directory, the first answers and one warning names the others. A TOML date or time fills an option as the file wrote it, and a TOML integer beyond the safe range fills its exact digits.
- Add the `short` setting to `config()`, so an application can give `--config` a short spelling such as `-c`. `config()` judges it under `checkShortSetting`, as `format()` does.
- Add the declaration rules `@loomcli/plugins/config/file-path`, which `config()` throws for a `file` that is not a relative path, and `@loomcli/plugins/config/file-pattern`, which it throws for glob syntax outside a whole extension of `*` or a brace list, and for a brace list that names an extension the plugin cannot read. They replace `@loomcli/plugins/config/files`.
- Add `yaml` and `smol-toml` as runtime dependencies of `@loomcli/plugins`. The configuration plugin loads each only after it reads the text of a file of that kind, so a run that reads a JSON file loads neither.

### Migration

**Affected surface.** An application that calls `config({ files: [...] })` from `@loomcli/plugins/config`, and an operator whose settings live in the derived user file, `~/.config/<app>/config.json`, `$XDG_CONFIG_HOME/<app>/config.json`, or `%APPDATA%\<app>\config.json`. An application that calls `config()` with no settings compiles unchanged and now reads `.<app>.json` in the working directory and then in the home directory.

**Why.** A run now reads one file, so the list of project files and the derived user file are gone. The home directory serves the per-operator case with the same file name the working directory uses.

**Before and after.**

Before, the application listed its project files:

```ts
config({ files: ['.textstat.json'] });
```

After, it names its one file, which may let the operator choose a format:

```ts
config({ file: '.textstat.{toml,json}', short: 'c' });
```

Before, an operator kept per-user settings in `~/.config/textstat/config.json` or `%APPDATA%\textstat\config.json`. After, the same JSON lives in `~/.textstat.json`, or in the home directory under the name the application's `file` gives, such as `~/.textstat.toml` written as TOML.

**Steps.**

1. Replace `config({ files: [...] })` with `config({ file })`, naming the file the application looks for. An application that listed several files keeps the one its operators use, or names a pattern such as `.textstat.{toml,json}`.
2. Move each operator's settings from `~/.config/<app>/config.json`, `$XDG_CONFIG_HOME/<app>/config.json`, or `%APPDATA%\<app>\config.json` to `.<app>.json`, or to the application's `file`, in the home directory.
3. Merge any settings an operator kept in two files into one file, because a run no longer combines files key by key.

**Validation.** Run `tsc --noEmit` on the application. It reports no error at the `config()` call. Then run the application in a project directory with a bound option unset, and confirm that it reads the value from the project file, and from the home file when the project directory holds none.
