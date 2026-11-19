---
description: "The completion plugin: shell completion scripts and installing, updating, and removing them."
---

# Completion plugin

This page documents the completion plugin, which prints shell completion scripts and installs, updates, and removes them. An author installs it to give an operator tab completion for the application's Commands and options.

```ts sketch
// @loomcli/plugins/completion
import type { Host, Log, Plugin, TypedInputs } from '@loomcli/core';

export interface RefreshContext {
  readonly path: string; // the binary that replaced this one
  readonly host: Host; // the run's host
  readonly signal: AbortSignal; // the run signal
  readonly log: Log; // the run's log
  readonly name?: string; // the application's name, which finds the installation record; absent, the child always runs
}
export declare function completion(settings?: CompletionSettings): Plugin;
export declare function refreshCompletion(context: RefreshContext): Promise<void>;

export interface CompletionSettings {
  // The completers an input names with `{ values: '<name>' }`, by name.
  readonly values?: Readonly<Record<string, Completer>>;
}
export type Completer = (context: CompleterContext) => CompletionValues | Promise<CompletionValues>;
export interface CompleterContext {
  readonly word: string; // the word being completed, without any lead such as `--opt=` or `-o`
  readonly typed: TypedInputs; // the words the earlier words gave each option and argument, by name
  readonly signal: AbortSignal; // the run signal
  readonly host: Host; // the run's host
}
export type CompletionValue = string | { readonly value: string; readonly description?: string };
export type CompletionValues = Iterable<CompletionValue> & object; // a list or a set; never a bare text
```

```ts sketch
// @loomcli/plugins/completion/extension
import type { Extension, StandardSchemaV1 } from '@loomcli/core';

// Exactly one hint, under exactly one key: each member holds every other hint's key absent.
export type CompletionValueFacts =
  | {
      // File names, as the shell completes them.
      readonly files: true;
      readonly extensions?: undefined;
      readonly directories?: undefined;
      readonly none?: undefined;
      readonly commands?: undefined;
      readonly values?: undefined;
    }
  | {
      // Directories, and files that end in one of these extensions.
      readonly extensions: readonly string[];
      readonly files?: undefined;
      readonly directories?: undefined;
      readonly none?: undefined;
      readonly commands?: undefined;
      readonly values?: undefined;
    }
  | {
      // Directories only.
      readonly directories: true;
      readonly files?: undefined;
      readonly extensions?: undefined;
      readonly none?: undefined;
      readonly commands?: undefined;
      readonly values?: undefined;
    }
  | {
      // No word and no file name.
      readonly none: true;
      readonly files?: undefined;
      readonly extensions?: undefined;
      readonly directories?: undefined;
      readonly commands?: undefined;
      readonly values?: undefined;
    }
  | {
      // The Commands the argument's earlier words have reached: an argument's hint only.
      readonly commands: true;
      readonly files?: undefined;
      readonly extensions?: undefined;
      readonly directories?: undefined;
      readonly none?: undefined;
      readonly values?: undefined;
    }
  | {
      // The values of the named completer in `completion({ values })`.
      readonly values: string;
      readonly files?: undefined;
      readonly extensions?: undefined;
      readonly directories?: undefined;
      readonly none?: undefined;
      readonly commands?: undefined;
    };

// An option's hint: every member but `commands`.
export type CompletionInputFacts = Exclude<CompletionValueFacts, { readonly commands: true }>;

export declare const completionInput: Extension<
  'option',
  StandardSchemaV1<CompletionInputFacts, CompletionInputFacts>
>;
export declare const completionArgument: Extension<
  'argument',
  StandardSchemaV1<CompletionValueFacts, CompletionValueFacts>
>;
```

```ts
import { Command } from '@loomcli/core';
import { completionArgument, completionInput } from '@loomcli/plugins/completion/extension';

export const load = new Command('load')
  .option('config', {
    extensions: [completionInput({ extensions: ['json', 'yaml'] })],
    type: 'string',
  })
  .option('into', { extensions: [completionInput({ directories: true })], type: 'string' })
  .argument('template', { extensions: [completionArgument({ extensions: ['tpl'] })] });
```

```ts
import { Application } from '@loomcli/core';
import { completion, refreshCompletion } from '@loomcli/plugins/completion';
import { help } from '@loomcli/plugins/help';
import { selfUpdate } from '@loomcli/plugins/self-update';

export const jsonkit = new Application('jsonkit', {
  plugins: [help(), completion(), selfUpdate({ afterReplace: refreshCompletion })],
});
```

```text
$ jsonkit completion install
Installed the zsh completion script in /home/me/.local/share/jsonkit/completion/zsh/_loom_jsonkit.
Added a line to /home/me/.zshrc that loads it.
Open a new shell to use it.
$ tail -n 1 ~/.zshrc
fpath=('/home/me/.local/share/jsonkit/completion/zsh' $fpath); if [ -f '/home/me/.local/share/jsonkit/completion/zsh/_loom_jsonkit' ]; then . '/home/me/.local/share/jsonkit/completion/zsh/_loom_jsonkit'; fi # added by jsonkit completion install
$ jsonkit completion uninstall
Removed /home/me/.local/share/jsonkit/completion/zsh/_loom_jsonkit.
Removed the line from /home/me/.zshrc.
```

```sh
# Loading a printed script by hand instead:
source <(jsonkit completion bash)   # in ~/.bashrc
source <(jsonkit completion zsh)    # in ~/.zshrc, after compinit
jsonkit completion fish | source    # in ~/.config/fish/config.fish
jsonkit completion nu | save --force ($nu.data-dir | path join vendor autoload jsonkit.nu)   # in Nushell, once; the folder is the one install writes on Linux, and on macOS under Library/Application Support when XDG_DATA_HOME is unset
jsonkit completion powershell | Out-String | Invoke-Expression   # in $PROFILE
```

```text
$ jsonkit completion __complete -- ke
keys→List the keys at a path.
:4
```

`completion()` is the completion plugin. Its identity is `@loomcli/plugins/completion`, and its one setting, `values`, holds the [named completers](#named-completers); it declares no options and no middleware, and it contributes one [plugin Command](../core/plugin-contract.md#plugin-commands) group, the two [value hint](#value-hints) extensions, and an [`onGraphBuilt`](../core/lifecycle-hooks.md#judging-the-built-graph) hook, which judges the [completer names](#named-completers) on every build. `jsonkit completion install` writes the operator's shell's script to a file and has the shell load it, and `jsonkit completion zsh` prints the script for an operator who loads it another way. From then on, each Tab runs the script, which calls `jsonkit completion __complete` with the words typed so far and inserts what it answers. The script holds no copy of the Command tree, so it never goes stale when the application changes. [ADR-0043](../decisions/0043-shell-completion-follows-cobras-protocol-and-never-evaluates-typed-text.md) records the decision: the scripts and the answer follow [Cobra](https://github.com/spf13/cobra)'s, and nothing typed is ever evaluated. [ADR-0078](../decisions/0078-the-completion-plugin-installs-a-script-and-one-startup-line-per-shell.md) records installing, and [ADR-0101](../decisions/0101-completion-installs-on-linux-and-macos-and-a-startup-line-is-written-or-printed.md) narrows it to Linux and macOS. In the answer above, `→` stands for one tab character.

- **The Commands.** `completion` is a group, `Print or install a shell completion script.`, with these children:
  - `bash`, `zsh`, `fish`, `nu`, and `powershell`, each `Print the <Shell> completion script.`, where `<Shell>` is `Bash`, `Zsh`, `Fish`, `Nushell`, or `PowerShell`, with no argument or option.
  - `install`, `Install completion for your shell.`, with one optional argument, `shell`, `The shell: bash, zsh, fish, pwsh, or nu. Your login shell when left out.`, validated to those five values.
  - `update`, `Bring installed completion up to date with this version.`, with no argument or option.
  - `uninstall`, `Remove completion from your shell.`, with one optional argument, `shell`, `The shell: bash, zsh, fish, pwsh, or nu. Every installed shell when left out.`, validated the same way.
  - the hidden `__complete`, `Answer a completion script.`, which declares the [passthrough mode](../core/options.md#passthrough) and no argument or option.

  A `shell` value outside the set is core's usage error for that input, with exit 2. No child declares a result, so `--format` never applies. A group declares no arguments, under [ADR-0160](../decisions/0160-a-command-with-an-action-may-declare-arguments-and-hold-children-and-an-exact-child-name-routes-first.md), so each printed shell is a child, and `jsonkit completion` prints the missing-subcommand error that lists the visible children. `pwsh` is the shell name `install` and `uninstall` take for PowerShell 7, not a print child, because PowerShell runs the script `powershell` prints.
- **Exact bytes.** Each print child and `__complete` write through `out.render` with a view that escapes the text's markup delimiters, so the bytes reach stdout as the plugin built them, with no newline added. A print child writes its script, and `__complete` writes its answer; a failure in either writes nothing to stdout. Because both write through `out`, a reader that closes stdout early, such as `jsonkit completion bash | head -1`, ends the run with 141 under [Signals, cancellation, and shutdown](../core/signals.md). `install`, `update`, and `uninstall` write through `out`, as Output states.
- **The callback.** The script runs `<program> completion __complete -- <words>`, where `<program>` is the first word with its quoting removed and no expansion, and `<words>` are the words after it, the last cut at the cursor and empty when the cursor starts a new word. The words arrive in `passthrough`, because `__complete` declares the passthrough mode, so the parser never reads one of them as an option or an argument and a typed `--help` activates nothing. `__complete` passes them to [`locate`](../core/graph-inspection.md#locating-a-word) with the action's `graph`. Each Tab is an ordinary run: always-on middleware and the configuration source run as on any run, and the script discards stderr. Stdout that an always-on middleware, or a plugin activated through its environment binding, writes on a `__complete` run is read as offered words, so a plugin that writes to stdout on a run it does not own breaks completion.
- **Offered words.** By the position `locate` reports:
  - `command`: the canonical names of the node's children, each with its description, and a [visible alias](../core/commands.md#visible-aliases) of a child only where the child's canonical name does not start with the prefix, and then the values the position's `argument` offers under its `argument` rule below. With no `argument`, or one with a closed set, the directive is `4`. With an `argument` that has no closed set and no hint, the directive is `0` rather than `4`, so when no child's name starts with the prefix the shell completes file names, as Cobra's scripts do: `textstat co<Tab>` offers `completion`, and `textstat a<Tab>` completes file names, under [ADR-0160](../decisions/0160-a-command-with-an-action-may-declare-arguments-and-hold-children-and-an-exact-child-name-routes-first.md).
  - `option`: the long spellings of the options in scope, a Boolean's negative spelling included, and the spellings of a [visible option alias](../core/options.md#visible-option-aliases) only for an option none of whose own spellings starts with the prefix, and also the short spellings when `prefix` is exactly `-`, each with its option's description, and directive `4`. An option the earlier words gave is left out unless another occurrence still adds anything, the rule help's `...` reads too, through one package-internal module outside either subpath that help and completion both import: a multiple string option, an arity option included, collects another value, a [last-wins option](../core/options.md#last-occurrence-wins), an arity one included, replaces its value, and a counted option adds one, so each is offered again, while any other scalar option, a scalar arity option included, is offered once, except that the [quiet-marked](../core/verbosity.md) option is not offered once `counts` holds it at 1 and the verbose-marked option is not offered once `counts` holds it at 2, because the verbosity reads neither count higher.
  - `value` and `argument`: the values of the closed set the input's `schema` names, each written after `lead` under `value`, with no description, and directive `4`. The closed set is the one help derives for its [accepted values](help.md#accepted-values), read through one package-internal module outside either subpath, beside `encode.ts`, that help and completion both import. The module returns the whole set, and each reader applies its own bound: help keeps its limit of eight under Bounds, and completion offers every value, so a Command with more than eight view names completes each of them. An input with no closed set, a `null` schema included, and no [value hint](#value-hints) offers nothing with directive `0`, so the shell completes file names, except that a value attached to its option has the answer write its `lead`, as [A value attached to its option](#value-hints) states; with a hint it offers what [Value hints](#value-hints) states. An [arity option](../core/options.md#option-value-arity) offers the values of its one-word schema at each word it takes, the `value` position `locate` reports for every word until the count is met, and the word after them is read afresh.
  - `passthrough`, after a bare `--` on a Command that declares the passthrough mode: nothing, with directive `0`. On a Command without the mode, a word after a bare `--` is an `argument` position, offered as above.
  - `none`: nothing, with directive `1`.

  A string option with an [implied value](../core/options.md#implied-values) has its values offered only after `=`, as `--backup=<Tab>`, or after its short letter in the same word, because `locate` reads a bare spelling as complete: after `--backup` and a space, completion offers what the next word may otherwise be and awaits no value.

  A hidden or deprecated Command or option is never offered, and one typed in full still routes and completes past. Only words that start with `prefix`, compared by code unit, are offered, a value compared before `lead` is added to it, so `--format=j` offers `--format=json`, in graph order with repeats removed.

  A [visible alias](../core/commands.md#visible-aliases) is offered only where its member's canonical name does not match what was typed, under [ADR-0168](../decisions/0168-a-command-or-an-option-may-declare-a-visible-alias-that-every-listing-shows-beside-its-canonical-name.md). At a `command` position, a child whose canonical name does not start with `prefix` offers each of its visible aliases that does, in the order `visibleAliases` holds them, each with the child's description, in the child's place, so with `.visibleAlias('ls')` on `list`, `app l<Tab>` offers `list` and `app ls<Tab>` offers `ls`. At an `option` position, an option none of whose own offered spellings starts with `prefix` offers each long spelling of its [visible aliases](../core/options.md#visible-option-aliases) that does, a negative form included, each with the option's description, in the option's place, so `--min<Tab>` offers `--min-bytes` and `--mini<Tab>` offers `--minimum`. An option the rules above leave out, because the earlier words gave it or an exclusive sibling claimed its group, is left out under every spelling, and a hidden or deprecated member offers no alias. Any other alias, a Command's or an option's, is never offered, and no alias is ever rewritten: `locate` routes through it and reads an option alias's value, and completion reads `visibleAliases` and never `aliases`.
- **The answer.** One line per offered word: the word, then, when it has a description, a tab and the description. The last line is `:` and the directive. Every line ends with a newline. The directive numbers are Cobra's: `1` error, `2` no space, `4` no file completion, `8` filter by file extension, `16` directories only, `32` keep order, and `0` the shell's default. The plugin writes `0`, `1`, `4`, `8`, or `16`, and all five scripts honor all of them, with the Nushell script's limits under [Nushell](#nushell), `8` and `16` as [Value hints](#value-hints) states, Fish included. Under `8` and `16`, a first word that starts with `-` is the `lead` of a value attached to its option, and never a folder to list in, as Cobra's scripts read a word under `16`. Under `0`, a first word that starts with `-` is that `lead` too, because no Command name starts with `-`, and the answer writes it only when some of the value follows it, as [A value attached to its option](#value-hints) states.
- **Exact or omitted.** An offered word that holds a control character or a line separator, U+0000 through U+001F, U+007F through U+009F, U+2028, or U+2029, is left out rather than cut, so completion never inserts a value other than the one offered. An empty value, a value holding a lone surrogate, which the shell would receive as U+FFFD, and a value that starts with `_activeHelp_ `, which Cobra's scripts read as help text, are left out too. So is a word whose first character is `~`, because Bash 3.2 and Fish insert it unescaped and it would expand when the line runs; a `~` later in a word, such as after `--format=`, is offered. The Bash script escapes every `~` it inserts, because Bash expands a `~` after `=` or `:` in a word shaped like an assignment. A description is display text: each line break in it, CRLF or a single terminator, reads as one space, as help reads it, then every such character is removed, and no tab when nothing is left.
- **The scripts.** The Bash, Zsh, Fish, and PowerShell scripts are ported from Cobra, with Cobra's Apache-2.0 notice and license text kept beside them in the pack and the changes stated. The Nushell script is Loom's own, because Cobra has no Nushell script, and it carries no Cobra notice; [Nushell](#nushell) describes it. Each inserts an offered word through its shell's own completion call as one exact value. The PowerShell script runs on PowerShell 7, which CI runs on Linux and macOS, registers with `Register-ArgumentCompleter -Native`, and returns each offered word as a `CompletionResult` whose text is the word itself when it holds only ASCII letters, digits, and `-`, `_`, `.`, `/`, `:`, and `=` and does not start with one `-` and hold a `.`, which PowerShell splits at that `.` when it passes the word to a program, so `-calpha.json` would arrive as `-calpha` and `.json`, and otherwise the word in PowerShell's single quotes as The name states. The script passes an empty last word, and a word holding `"`, to the program as that exact argument. When the program resolves to a `.bat` or `.cmd` file, the script offers nothing and does not call it, because `cmd.exe` reads its arguments again as commands. The Bash script runs on Bash 3.2 and later, with or without the bash-completion package. A Bash without `compopt`, such as 3.2, cannot turn default file completion off, so there the script registers without it and completes file names itself, only when the directive allows files and no word was offered. Where the Bash script lists file names itself, it does so by pathname expansion of the typed word with only a trailing `*` unquoted, and it calls no `compgen -f` or `compgen -d`, because in a completion Bash 3.2 expands the directory part of their word. The Bash script escapes every word it inserts with `printf %q`, and a leading `~` too. With several matches it lists the escaped words, so the common prefix readline inserts is escaped text. Under directives `8` and `16` each script lists the file names a hint accepts and no other name, and reads a lead in the answer as [A value attached to its option](#value-hints) states. Under directive `0` after a lead, the Bash, Zsh, Fish, and PowerShell scripts list every file name by the same listing and insert each behind the lead. The Bash script lists them by the pathname expansion above, with or without the bash-completion package, rather than through `_filedir`, whose extension match ignores case, and turns default file completion off where `compopt` exists. The Zsh script moves the lead from `$PREFIX` to `$IPREFIX` as a literal and lists the names itself, as it does under directive `0`. Where the Zsh script lists file names, it does so by a glob of the folder part of the typed word, quoted, with only a trailing `*` live, after removing its quoting with `(Q)`. It quotes each name with `compquote`, which escapes a leading `~` or `=` too, and offers it with `compadd -Q -f` and the name itself as its display, so the inserted word is the name, the listing shows the name, and a folder is shown and inserted with a `/`. The operator's completion styles for the `files` tag, or the `directories` tag under directive `16`, such as `matcher-list`, `format`, `group-name`, and `list-colors`, apply through `_description`, which reads styles and evaluates nothing typed. It calls no `_files` or `_path_files`, because Zsh's own file listing expands the folder part of the typed word, so a `$(…)/` in it would run. It matches only the last path component of the typed word, so an abbreviated path such as `D/R` does not expand to `Docs/Readme.json`, as Zsh's own listing expands it. The folder part is inserted as typed, and only a leading `~/` is read as the home folder; a `~/` after the lead of an attached value, a `$HOME/`, a `~user/`, a `~[x]`, a `=cmd`, or any other `~` is read as text. A name that starts with a dot is listed only when the typed name does. The PowerShell script lists the folder the word names with `Get-ChildItem -LiteralPath`. The Fish script lists the names that start with the typed word by Fish's own expansion of a variable followed by `*`, which expands no wildcard, command, or tilde that the word holds, so it honors both directives without evaluating anything, and a `~` in the typed word is matched as a literal character, so `--config ~x<Tab>` lists a file named `~x.json`. A name with a control character is left out. The Zsh script's completion function is `_loom_<identifier>`, so no application name shadows a completion system function such as `_describe`.
- **No evaluation.** A script never evaluates text. Every `eval` in Cobra's scripts is removed, and so is the PowerShell script's `Invoke-Expression`, through which Cobra's builds and runs its request as a string, and every construct that expands an operand, such as Bash's `compgen -W`, which expands its word list: a script filters offered words by string comparison, and it honors directives `8` and `16` without evaluating an offered word. It calls the program with an argument array, so a typed word reaches the application as its characters and the script never runs it. It removes quoting without evaluating, through Zsh's `(Q)` flag, Fish's own tokenizer and `string unescape`, a string-only decoder in the Bash script, and the value of each constant string element in the command PowerShell's parser hands the completer, passing any other element, such as one holding a variable or a subexpression, as the text typed, and it performs no expansion, so `~`, `$HOME`, and `$(…)` reach the application as typed, the Bash file listing never rewrites them, and the Zsh file listing rewrites only a leading `~/`; a Bash with `compopt` leaves the fallback to its own default file completion, which keeps the typed `$HOME/` and may append a file name it finds under the expanded directory. Zsh itself can still expand a typed word, which the script cannot prevent. Its default Tab widget, `expand-or-complete`, expands a typed `$(…)` before any completion function runs, and the `_expand` completer, when the operator's `completer` style lists it, as `compinstall` offers, expands it during completion, so in either case pressing Tab runs it whether or not the script is installed. `bindkey '^I' complete-word` binds Tab to completion alone, and with it and a `completer` style without `_expand`, such as the default, nothing typed runs. When the word under the cursor holds an unclosed quote, the script offers nothing and does not call the application. A nonzero exit, or an answer whose final line is not `:` followed by decimal digits, offers nothing.
- **The name.** The application name reaches a script only as data: as a single-quoted string in its shell's quoting, for Bash and Zsh with each `'` written as `'\''`, for Fish, whose single quotes read `\'` and `\\` as escapes, with each `\` written as `\\` and each `'` written as `\'`, for Nushell, as a double-quoted string with each `\` written as `\\` and each `"` written as `\"`, and for PowerShell, whose single quotes end at `'` and at each of U+2018 through U+201B and read a doubled one as that character, with each of those five written twice; as the suffix of a function identifier in which every character outside `A-Z`, `a-z`, and `0-9`, `_` included, is written as `_` and its code point's lowercase hexadecimal digits and another `_`, so `git-lfs` gives `git_2d_lfs` and no two names give one identifier, and in the Zsh `#compdef` comment and autoload check as it is, because a portable name holds nothing a comment or a double-quoted string can misread. A script takes the Application's name, which `new Application()` already holds to the portable set under `@loomcli/core/portable-name`, so no other name reaches a script. The quoting and the identifier encoding stay, because `.` and `-` are portable and neither is an identifier character, so any name the constructor accepts yields a script that runs nothing but completion.
- **Which applications.** A root that declares arguments holds the plugin's Command like any child, as [Plugin Commands](../core/plugin-contract.md#plugin-commands) states, so textstat can install the plugin, and an application installs it once, because a second `completion` collides there. On such a root without the passthrough mode, an operator passes the word `completion` as an argument after `--`.

## Value hints

An author hints one input's values with `completionInput` on an option or `completionArgument` on an argument, from `@loomcli/plugins/completion/extension`, which holds declarations alone, so a Command library hints its inputs without importing the plugin. The descriptors have the identities `@loomcli/plugins/completion/input` and `@loomcli/plugins/completion/argument`, and the plugin registers both. An argument's facts are `CompletionValueFacts`, and an option's are `CompletionInputFacts`, the same hints without `commands`, because only an argument's earlier words name a path of Commands. The value holds exactly one hint, as exactly one key, of the six this section and [Named completers](#named-completers) state. A value with two hints, with none, with `commands` on an option, with an `extensions` list that is empty, with an extension that is not a name, or with an empty completer name is the ordinary [invalid extension value](../core/diagnostics.md#loomclicoreinvalid-extension-value) fault at the declaration that receives it. The types also reject the first three, and the schema alone rejects the rest, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md), so the plugin adds no rule. An extension is a name without its dot, such as `json` or `tar.gz`: it starts with an ASCII letter or digit and holds only letters, digits, `.`, `_`, `+`, and `-`, so a script compares it as text. The hints read at a `value` or `argument` position, at the `command` position's argument, and at every word of an [arity option](../core/options.md#option-value-arity), and offer:

- `files: true`: nothing, with directive `0`, so the shell completes file names, as it does with no hint. It states the default, and is the hint an author gives to say so. A value attached to its option writes its `lead`, as below.
- `extensions: ['json', 'yaml']`: the extensions as the offered words, with no description, in the order given with repeats removed, and directive `8`. The prefix filter does not apply, and no `lead` is added: the words are the filter and never inserted. The script lists the names that start with the word under the cursor, the directories, and the files that end in `.json` or `.yaml`, compared as strings, so case counts and a name that ends in `.` is not listed.
- `directories: true`: nothing, with directive `16`. The script lists the directories that start with the word under the cursor.
- `none: true`: nothing, with directive `4`, so the shell completes neither a word nor a file name.
- `commands: true`: the listed children of the Command that the words the input holds so far have reached, with directive `4`. The words are the earlier words that [`locate`](../core/graph-inspection.md#locating-a-word) reads as that argument, so an option and its value among them are not words of the argument. Routing starts at the root and takes each word as the canonical name or any alias of a child, a hidden or deprecated Command included, as the [help Command](help.md#the-help-command) does, and a word that names no child reaches nothing, so the answer offers nothing. The reached Command's children are offered under the `command` rule above: canonical names with their descriptions, a visible alias only where the canonical name does not start with the prefix, and no hidden or deprecated member. `app help ta<Tab>` offers `task`, and `app help task sh<Tab>` offers `show` and `shelve`. At a `command` position the children of the position's own Command come first, and the offered words follow with repeats removed. An option takes no `commands` hint.

**A value attached to its option.** At a `value` position whose `lead` is not empty, a value typed in the option's word, as in `--config=a`, `-ca`, `-c=a`, or a short group `-vca`, the answer under directive `8` or `16` writes the `lead` as its first word, before any extension: `--config=`, `-c`, `-c=`, or `-vc`. No extension starts with `-`, so a script reads a first word that starts with `-` as the lead. It lists the file names for the part of the word under the cursor after the lead, and inserts each name behind the lead, so `-ca<Tab>` inserts `-calpha.json`, single-quoted in PowerShell, and `--into=d<Tab>` inserts `--into=docs/`. A word under the cursor that does not start with the lead lists nothing. A value in a word of its own, as in `-c a` or `-vc a.j`, has no lead, and the answer writes none.

Under directive `0`, with no hint or with `files: true`, the answer writes the `lead` as its only word when some of the value follows it, as in `--path=a`, `-pa`, `-p=a`, or `-vpa`. No Command name starts with `-`, so a script reads a first word under `0` that starts with `-` as the lead, lists every file name for the rest of the word, by the same listing as under `8` and `16`, and inserts each behind the lead, so `-pa<Tab>` inserts `-palpha.json` and `-pn<Tab>` inserts `-pnotes.txt`, single-quoted in PowerShell. The Nushell script returns nothing there, as it does under `8` and `16`, so Nushell completes as it does without the lead, which after an attached value lists no file name, as [Nushell](#nushell) states. A word that ends at the lead, as in `--path=` or `-p=`, gets no lead and directive `0` as before, because a script from before the lead under `0` offers every word that starts with the word under the cursor, and would insert a lead that is the whole word as a value; a lead shorter than the word under the cursor does not start with it, so that script completes as it did. A word that ends at the lead completes in each script as it does with no lead under `0`: the Bash and Fish scripts list the file names after the `=`, and the Zsh and PowerShell scripts list nothing, so in those shells `--path=<Tab>` offers no file name until a character of the value is typed. In PowerShell, a `.` typed after a single-dash lead, as in `-pnotes.<Tab>`, lists nothing, because PowerShell splits such a word at the `.` before the script reads it. A short spelling with nothing after it, as in `-p` or `-vc`, is the option itself, which [`locate`](../core/graph-inspection.md#locating-a-word) reads as awaiting its value in the next word, so `-p<Tab>` offers no word and no file name.

A schema that names a closed set wins over a hint: the input offers the set under directive `4` and its hint is not read for the answer, though a completer name it holds is still checked at graph build, so an operator is never offered a word the validator rejects. At a `command` position that has children and an argument whose hint is `extensions` or `directories`, a child whose name starts with the prefix is offered with directive `4` and the file filter is not applied, because a script that filters file names lists no offered word. Where no child's name starts with the prefix, the hint's directive applies. Core does not change: `inspect()` reports a hint as an ordinary extension value on the option or the argument, the [manifest](manifest.md) leaves it out as it leaves out every extension value, under [Extensions](../core/extensions.md), and a hint is inert in an application that installs no completion plugin.


## Named completers

An author supplies an input's values at Tab time from the author's own code, as a task tracker offers its task ids, with a named completer. The functions live in the plugin's settings, and the graph names them, because core stores an extension value as plain data and forbids a function in one, under [Extensions](../core/extensions.md).

```ts
import { Application, Command } from '@loomcli/core';
import { completion } from '@loomcli/plugins/completion';
import { completionArgument } from '@loomcli/plugins/completion/extension';

const show = new Command('show')
  .option('project', { short: 'p', type: 'string' })
  .argument('id', { extensions: [completionArgument({ values: 'task' })] })
  .action(() => {});

export function taskApp(
  listTasks: (query: { project: string | undefined; signal: AbortSignal }) =>
    Promise<readonly { id: string; title: string }[]>,
) {
  return new Application('mimir', {
    plugins: [
      completion({
        values: {
          task: async ({ typed, signal }) => {
            const project = typed.options.get('project')?.[0];
            return (await listTasks({ project, signal })).map(({ id, title }) => ({
              description: title,
              value: id,
            }));
          },
        },
      }),
    ],
  }).command(show);
}
```

An option or an argument names a completer with `{ values: '<name>' }`, as one of the six hints, a member of both `CompletionInputFacts` and `CompletionValueFacts`, so a value with the name beside another hint is rejected as any value with two hints is. A name is any nonempty text. The completer is the function the settings' `values` record holds under that name, found among the record's own entries alone, so a name such as `toString` is never defined by inheritance.

- **When it runs.** The `__complete` Command calls the completer when the last word is a `value` position of the option, or an `argument` position of the argument, or the position's `command` kind whose first argument names it, and the input's schema names no closed set, which wins over every hint. No other Command calls a completer: help, the manifest, the MCP server, and `inspect()` never do, and core adds no timer, so a completer that waits on something ends when the run signal aborts. The plugin's module that calls it loads only when a typed input names a completer.
- **What it reads.** `word` is the part of the word being completed that a value would start with: the whole word, or what follows `--opt=` or the short letter in `-ov`, so `--opt=ab` gives `ab`. `typed` is the position's `typed` member, which [`locate`](../core/graph-inspection.md#locating-a-word) reports: the words the earlier words gave each option and each argument, by name, a global option's included, exactly as the parser read them and before any validation. The input being completed holds its earlier words too, and never `word`. An own option of a Command with children that routing still holds unbound, such as `mid --project foo <Tab>` where `mid` also has children, holds its words under the reached Command's name for it. An [arity option](../core/options.md#option-value-arity)'s words are one flat list that ends with the words its open occurrence has received, so a completer at that option learns which word of the tuple it completes from the count modulo the arity: for an arity of 2, `-p 1 <Tab>` gives `['1']`, the second word, and `-p 1 2 -p <Tab>` gives `['1', '2']`, a first word again. `signal` is the run signal and `host` the run's host. Nothing the completer receives is validated, so it handles a word its input's validator would reject.
- **What it returns.** Any iterable object, now or in a promise: each item is a text, or `{ value, description? }`. The answer offers each value after the lead the typed word carries, as it does a closed set's, with the description as help does, with directive `4`, so the shell completes no file name after it. A completer with no values returns an empty iterable, such as `[]`, which offers nothing with directive `4`; a bare `return` is outside the type and reads as a failed completer. It cannot ask for file names: an input that completes files is hinted with `files`, `extensions`, or `directories`. Its words never use the lead line of directives `8` and `16`: each value carries its lead, as a closed set's do.
- **What is offered.** Only a value that starts with the typed word after its lead is offered, every exact-or-omitted rule of the answer applies, and a repeat is offered once, in the order the completer gave. An empty value is left out before the lead is added, as a closed set's is, so `--id=<Tab>` never offers the bare `--id=`. A value is never validated and never checked against the input's schema.
- **A failure.** A completer that throws or rejects offers nothing and the answer ends with directive `1`, an error, so the shell completes no file name. It adds one `warn` log event with the message `A completer failed, so completion offered no values.` and the fields `completer`, the name, and `error`, the thrown value, and writes nothing to the operator's terminal, because a script discards the program's standard error. An abort of the run signal ends the answer the same way, whether or not the completer returns, and adds no event. At a `command` position, where the argument that names the completer shares the word with the Command's children, a failure drops only the completer's values: a child whose name starts with the word is still offered, with directive `4`, because every script discards an answer that ends with `1`, and directive `1` stays where no child's name does.
- **An unknown name.** An input that names a completer the settings do not define is a declaration fault at the graph build, under the Developer Diagnostic [`@loomcli/plugins/completion/unknown-completer`](../core/diagnostics.md#loomclipluginscompletionunknown-completer), because that input would complete nothing and no run would say why. A completion plugin that is not installed leaves the extension value inert, as for every hint.

[ADR-0186](../decisions/0186-core-reports-the-words-an-unfinished-invocation-gave-each-input.md) records the words `locate` reports, and [ADR-0187](../decisions/0187-an-author-supplies-an-inputs-completion-values-from-a-named-completer.md) records the decision.

## Installing completion

`install`, `update`, and `uninstall` act on shells. For each, the plugin writes the shell's script to a file and, for every shell but Fish and Nushell, has the shell's startup file load it through one [startup line](../core/installation-record.md#installed-files). Both are recorded through the [installed-files module](../core/installation-record.md#installed-files), each shell in its own plugin's file, `completion.<shell>.json`, so an install for one shell never removes another's script or line.

- **The shell.** `install` acts on its `shell` argument. Left out, it reads `SHELL` from `host.env`: when the variable is set and the last segment of its value, after the last `/`, is one of the five shell names, that is the shell. Otherwise the action throws an `InputError` with exit 2, `jsonkit cannot tell your shell from SHELL (/bin/sh). Name it: jsonkit completion install bash, zsh, fish, pwsh, or nu.`, with `(unset)` for a variable that is unset or empty. `uninstall` acts on its `shell` argument, or, left out, on every shell whose plugin's file exists, in the order the five names are listed. `update` acts on every shell whose plugin's file, read as recovery would resolve it, records a file; a shell whose pending file records none keeps it for its next `install` or `uninstall`.
- **The files.** `<home>` is [`host.home`](../core/host.md#the-home-and-temporary-folders); `<data>` is `XDG_DATA_HOME` when it is an absolute path, else `<home>/.local/share`; and `<config>` is `XDG_CONFIG_HOME` when it is an absolute path, else `<home>/.config`; each variable read from `host.env`, so an absolute one wins over the home. `<app>` is the application's name.

  | Shell | Script | Startup file |
  | --- | --- | --- |
  | `bash` | `<data>/<app>/completion/<app>.bash` | `<home>/.bashrc`; on `darwin`, the first of `<home>/.bash_profile`, `<home>/.bash_login`, and `<home>/.profile` that exists, else `<home>/.bash_profile` |
  | `zsh` | `<data>/<app>/completion/zsh/_loom_<identifier>` | `$ZDOTDIR/.zshrc` when `ZDOTDIR` is an absolute path, else `<home>/.zshrc` |
  | `fish` | `<config>/fish/completions/<app>.fish` | none |
  | `pwsh` | `<data>/<app>/completion/<app>.pwsh.ps1` | the path `pwsh` reports for `$PROFILE` |
  | `nu` | `<nu-data>/nushell/vendor/autoload/<app>.nu` | none |

  `<nu-data>` is `<data>` when `XDG_DATA_HOME` is an absolute path, as Nushell reads it on every platform; otherwise it is `<home>/.local/share`, and on `darwin` `<home>/Library/Application Support`, the data folder Nushell uses there. Nushell sources every file in `<nu-data>/nushell/vendor/autoload` at the start of an interactive session, so `install` edits neither `config.nu` nor `env.nu` and writes no startup line, and `uninstall` leaves both alone. Fish reads `<config>/fish/completions` on every version since 3.0; the vendor folder under `<data>` joined its path only in 3.5. On `darwin`, a terminal opens a login Bash, which reads the first of those three files and never `.bashrc`, so the line goes where that Bash reads it and never creates a `.bash_profile` that would shadow an existing `.profile`; a Bash started from another shell is not a login shell and reads `.bashrc`, where the operator loads the script by hand. `$PROFILE` is the profile of the current user and the console host, so the PowerShell extension of an editor, which reads its own profile, does not load the line. On `win32`, `install`, `update`, and `uninstall` fail for every shell with a `FatalError` and exit 1: `jsonkit completion installs bash, zsh, fish, pwsh, and nu completion on Linux and macOS. Print the script with jsonkit completion powershell and load it yourself.`, naming the print child for the shell asked for, and `powershell` for `pwsh` or when no shell is named.
- **The scripts.** Each file holds the script the shell's print child prints, with two differences: the Zsh file's check for being loaded as a completion function names its own file, `_loom_<identifier>`, and, right after its `#compdef` line, it starts the completion system when no `compdef` function is defined, with `autoload -Uz compinit && compinit -i`, which skips an insecure folder on `fpath` rather than asking at every shell start, and returns before it registers anything when `compdef` is still not defined. The `pwsh` file holds the script `powershell` prints, and the `nu` file the script `nu` prints. Each is written with mode `644`, and each folder the module creates for it with mode `755`, whatever the umask, so a later `compinit` never reads the Zsh folder or its parent as insecure.
- **The startup line.** One line that loads the script when the file exists and ends with a comment naming the install Command:

  | Shell | Startup line |
  | --- | --- |
  | `bash` | `if [ -n "${BASH_VERSION-}" ] && [ -f '<script>' ]; then . '<script>'; fi # added by <app> completion install` |
  | `zsh` | `fpath=('<folder>' $fpath); if [ -f '<script>' ]; then . '<script>'; fi # added by <app> completion install` |
  | `pwsh` | `if (Test-Path -LiteralPath '<script>') { . '<script>' } # added by <app> completion install` |

  `<script>` is the script's path and `<folder>` the folder that holds the Zsh script, each in its shell's single quotes as The name states. The Bash line checks `BASH_VERSION` because a `.profile` is also read by other shells. The Zsh line puts the script's folder on `fpath` before it sources the script, so a `compinit` later in `.zshrc` that rebuilds its cache, as it does when the number of completion files on `fpath` changed since the cache was written, finds the script through its `#compdef` line rather than dropping the registration the source made. A later `compinit` that loads a cache written before the install, as `compinit -C` always does and `compinit` does when the number of files is unchanged, such as after one application's completion was uninstalled and another's installed, drops the registration until the cache is rebuilt; removing the cache, `.zcompdump` by default, rebuilds it at the next shell start. Loom never touches the cache, which is the operator's. The file is named `_loom_<identifier>`, with the identifier The name states, so no application name shadows a completion function Zsh ships, such as `_files` for an application named `files`. A shell starts no program to load the script, and a missing script loads nothing, so a line left behind is harmless.
- **Asking PowerShell for its profile.** For `pwsh`, `install` runs the shell with the words `-NoLogo -NoProfile -NonInteractive -Command` and `[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($PROFILE))`, as a child program through [`host.spawn`](../core/host.md#child-programs) with `host.env` as its environment, `<home>` as its working directory, no shell, and no input, and reads its standard output. The program is the first file named `pwsh` in an absolute entry of `PATH` from `host.env`, so a program in the working directory or under a relative entry never runs. It adds no time limit; the run signal ends the child with `SIGTERM`. The answer, with a trailing line feed or carriage return and line feed removed, is the profile's path in Base64 of its UTF-8 bytes, which no console code page changes. A shell not found on `PATH`, or that cannot start, fails with a `FatalError` and exit 1: `jsonkit cannot find the profile of pwsh, because pwsh could not start. Install pwsh, or name the shell you use.`; one that exits with any code but 0 fails the same way, `because pwsh exited with code <code>.`, with the same correction. An answer that is not that shape, or whose path is not absolute, fails with `jsonkit cannot find the profile of pwsh, because pwsh reported <answer>.`, corrected by `Check that pwsh -NoProfile -Command $PROFILE prints the path of your profile.`, with the answer passed through [`escapeControlCharacters`](../core/styles.md#strings-and-composition). `uninstall` and `update` read the startup file from the plugin's file and run no shell.
- **Checks first.** Each child checks, in this order, and fails at the first that fails, with the failure each names:
  1. Every child: the platform, which `win32` fails as The files states.
  2. `install`: the shell, as The shell states.
  3. `install`: `<home>`, unless the paths it needs come from absolute variables alone: `jsonkit cannot find your home folder because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.`, a `FatalError` that exits 1.
  4. Every child: the record's directory, `applicationDirectory('installation', name, host)`, which answering `{ variable }` fails as [Skills](skills.md#global-installs) states.
  5. Every child: each selected shell's plugin's file, read through the module. One that is damaged or holds an unknown `format` fails with a `FatalError` and exit 1: `<record> cannot be read, so jsonkit will not change the files and line it lists. Remove it, the files it lists, and the line it added, then run jsonkit completion install again.`, with `uninstall` in place of `install` for that child.
  6. `install` and `update`: every selected shell's script, which Files the record does not list may refuse.
  7. `install`, for `pwsh`: the profile.
  8. Every child: every startup file it would change, under A startup file the plugin cannot change.

  `update`, and `uninstall` with no shell, check every selected shell before they write any, so a refusal changes no file of any shell.

## Nushell

`jsonkit completion nu` prints a script that is Loom's own and holds no copy of the command tree. `jsonkit completion install nu` writes it into Nushell's vendor autoload folder, as [Installing completion](#installing-completion) states, and Nushell 0.117 is the floor. The record that governs it is [ADR-0195](../decisions/0195-completion-installs-for-nushell-as-one-owned-file-in-its-vendor-autoload-folder.md).

- **One extern.** The script declares `export extern "jsonkit" [ ...arguments: glob@"..." ]` for the application's name alone. Nushell runs the program through that extern once the script is loaded, and an extern's declaration changes how some typed arguments reach the program. The rest parameter is typed `glob`, which keeps Nushell's own handling for bare and quoted words, wildcards, `~`, variables, and spreads: `*.txt` and `~` reach the program expanded and `"*.txt"` as typed, where a `string` parameter would pass both as typed. Three forms reach it differently than with no script: a quote inside a word keeps its quotes, so `--field="a b"` arrives as `--field="a b"` rather than `--field=a b`; an interpolation that holds a subexpression, such as `$"($dir)/*.txt"`, is expanded as a wildcard; and a bare `true`, `false`, or `null` fails to parse, because the parameter expects a glob. Quoting the whole word, as in `"--field=a b"`, avoids all three, and the values the script inserts are already quoted that way. No parameter type, and no `def --wrapped` command that can carry a completer, keeps Nushell's own handling for every form. Nushell hands the completer the whole line up to the cursor, and the completer asks the application at every Tab, as the other scripts do. Nushell's one global external completer is left as the operator set it. The autoloaded `extern` shares the application's name, so an application named like a Nushell built-in command, such as `sort`, shadows that built-in in the operator's Nushell once installed.
- **The words.** The completer reads the call at the end of the line: the words after the last `|`, `;`, or new line, or after a `(` or `{` still open at the end, outside every quoted span, because the line holds whatever came before the call, as in `echo x | jsonkit ke`. A `( … )` or `{ … }` closed before the end is one word of the call, joined to the text it touches, so `jsonkit keys --path (pwd) --f` still asks for `keys --path (pwd) --f`. The first of those words is the program word and is dropped, and a boundary with no word after it offers nothing. It splits the call into words itself: a double-quoted span, which skips a backslash escape such as `\"`, a single-quoted span, a backtick string, and, at the start of a word, a raw string `r#'…'#` with any number of `#` each stay whole, whether the span is the word or sits inside it, as in `--field="a b"` or `foo'b c'`. The word reaches the application as the characters typed without the quotes of its spans, and no escape is read, so the value the script itself inserts, a backtick string that holds a space, reaches the application as one word, and a space at the end adds an empty word. It calls `jsonkit completion __complete -- <words>` with the words as arguments, so a typed word reaches the application as its characters. A line with an unclosed quote, backtick string, or raw string offers nothing, without a call.
- **What Nushell does with the answer.** Each answer line becomes a value and a description. A value that is not a bare word of letters, digits, and `_`, `.`, `/`, `:`, `=`, `+`, and `-`, or that is `true`, `false`, or `null`, which Nushell reads as keywords and not as a string argument, is offered as a backtick string, because Nushell inserts a value as the script returns it and a space, `$`, `;`, a bracket, or a quote would otherwise split or run when the line runs; a value that holds a backtick is offered double-quoted. Nushell then matches the word under the cursor by substring in place of by prefix, because a string does not start with it. The no-files directive `4` returns an empty list as well, so Nushell offers no file name. A nonzero exit, an answer whose last line is not `:` and decimal digits, and the error directive `1` offer nothing and no file name; any other answer with no word leaves Nushell to complete file names.
- **Value hints.** Under directives `8` and `16`, the answer's lines are extensions and the lead of an attached value, never values, so the script offers none of them as a value. It returns nothing, and Nushell lists every file name and directory by its own rule. Nushell does not narrow file names by a value hint, so `--config <Tab>` lists names a `json` hint would reject, and Nushell completes no file name after an `=` in the same word, so `--config=<Tab>` and a short option's attached value, as in `-ca<Tab>`, list nothing. Under directive `0`, a first line that starts with `-` is the lead of an attached value too, and the script returns nothing for it, so `--path=a<Tab>` and `-pa<Tab>` list nothing either.
- **Versions.** Nushell 0.117 is the floor. Releases 0.104 through 0.114 list file names after a completer answers with an empty list, so an unclosed quote, an error, or the no-files directive inserts a file name that was not offered, and releases 0.115 and 0.116 skip the completer for a word that looks like a flag, so no option completes; the script is not written to work with them. Nushell 0.117 binds the command line to the completer's parameter named `buffer`, which the script names, and older releases bind it as the first positional parameter.

CI installs one pinned Nushell release on Linux and macOS and drives it through a pseudo-terminal, because `nu --ide-complete` is no test of a custom completer.

## A startup file the plugin cannot change

Before it writes anything, a child that would add, replace, or remove a startup line reads the startup file, resolved through symbolic links to its real path, and the nearest folder at or above it that exists.

- **Not a file.** A directory or any other file that is not a regular file there, or a symbolic link whose target does not exist, fails `install` with a `FatalError` and exit 1, `<startup> is not a file, so jsonkit cannot add its startup line. Remove it, then run jsonkit completion install again.`, and writes nothing.
- **Cannot change.** The startup file cannot be changed when the process may not write the file, or the folder that holds it, or, for a file that does not exist, the nearest folder at or above it that exists; when the file is owned by another user; or when it is not UTF-8, which Installed files reads. A read-only home configuration manager that links the startup file is the common case. A startup line is then printed and never recorded, and Loom removes only a line it wrote, under [ADR-0101](../decisions/0101-completion-installs-on-linux-and-macos-and-a-startup-line-is-written-or-printed.md).
  - `install` writes the script and records it with no startup line, prints `jsonkit cannot change <startup>, so add this line to it yourself:` through `out.warn`, then the line itself through `out.print`, and exits 0. A line the record held for that file is dropped from the record without writing the file; when its text differs and the file holds it, or cannot be read to tell, `install` first prints the line to remove as `uninstall` does, and the line to add follows `Add this line to <startup> in its place:`. A file that already holds the line prints `<startup> already loads it.` and no line to add.
  - `uninstall` does everything else and drops the recorded line from the plugin's file without writing the startup file, prints `jsonkit cannot change <startup>, so remove this line from it yourself:` through `out.warn` and the line through `out.print`, and exits 0. A file it can read that no longer holds the line prints the no-longer-holds line instead.
  - `update` does everything else and drops the recorded line the same way. When this version changes the line's text and the file holds the old line, or cannot be read to tell, it prints the line to remove, then, unless the file already holds the new line, `Add this line to <startup> in its place:` through `out.warn` and the new line through `out.print`. A line whose text is unchanged is dropped with nothing printed, because no line in the file has to change.

## Install, update, and uninstall

- **`install`.** For the selected shell, the module installs the script file and, for every shell but Fish and Nushell, the startup line. A script file that is unchanged, recorded with the digest of the script it would write, is not rewritten and prints `<script> is unchanged.`; otherwise it prints `Installed the <shell> completion script in <script>.` A startup line added prints `Added a line to <startup> that loads it.`, and one the startup file already holds prints `<startup> already loads it.` When the script now differs from the one recorded, as after `XDG_DATA_HOME` changed, the module removes the recorded script, which prints as `uninstall` states, and replaces the recorded line where it stands in its startup file, which prints `Updated the line in <startup>.` When the startup file it computes now differs from the one recorded, as after `ZDOTDIR` changed, the module removes the recorded line, which prints as `uninstall` states. When anything changed, it prints `Open a new shell to use it.`
- **Files the record does not list.** A script file the shell's plugin's file does not record, any file or folder at its path, refuses `install` and `update`, and so does a recorded script whose digest changed since it was written. The child prints one line for each through `out.warn`, `<script> was not installed by jsonkit completion install.` or `<script> changed since jsonkit completion install wrote it.`, then fails with a `FatalError` and exit 1: `jsonkit completion install changed nothing, because files it did not install are in the way.`, corrected by `Remove them, then run jsonkit completion install <shell> again.` `update` uses `jsonkit completion update` in the failure sentence and `jsonkit completion install` in the correction. There is no `--force`.
- **`update`.** For each shell it acts on, it rewrites the script at its recorded path with this version's script, printing `Updated the <shell> completion script in <script>.` in place of the installed line, or the unchanged line. When the line `install` would add for the recorded script differs from the recorded line, which happens only when a new version changes the line's text, it replaces each line of the recorded startup file equal to the recorded one where it stands and prints `Updated the line in <startup>.` It reads no variable the paths come from, so a refresh run from another environment never moves a script, and it never adds a line the startup file no longer holds. With no shell recording a file, it prints `jsonkit has no completion installed, so there is nothing to update. Run jsonkit completion install to install it.` and exits 0.
- **`uninstall`.** For each shell it acts on, the module removes the recorded script when its digest is unchanged, removes each line of the startup file equal to the recorded line, removes each directory it created that is then empty, and deletes the plugin's file. It prints `Removed <script>.` and `Removed the line from <startup>.` A changed script is kept and prints `<script> changed since jsonkit completion install wrote it, so it was left in place.` through `out.warn`; a script already gone prints `<script> was already gone.`, and a startup file that no longer holds the line prints `<startup> no longer holds the line jsonkit completion install added, so it was left as it is.` With nothing recorded for the shells it acts on, it prints `jsonkit has no completion installed, so there is nothing to remove.` and exits 0. The startup file itself is never removed.
- **Any build.** Every child acts from a `source`, `development`, or `distributed` build alike, because a script calls the program by the name the operator typed, not by the binary's path.

## Refreshing completion after a self-update

`refreshCompletion` is an `afterReplace` function for the [self-update plugin](self-update.md), which passes it a context that holds every member `RefreshContext` names. A script changes only when a new version of Loom changes it, but the replaced process holds the old version's scripts, so `refreshCompletion` runs the new binary, and `update` decides what to refresh. It runs `path` with the words `completion update` exactly as [`refreshSkills`](skills.md#refreshing-after-a-self-update) runs `skills update`, under the same rules for the child, its output, and the run signal. A child that fails, or that cannot start, adds the `warn` log event `Completion was not refreshed after the update.`, with the same fields, and resolves; one that cannot start writes `Completion was not refreshed because /home/me/.local/bin/jsonkit could not start. Run jsonkit completion update.` to `host.stderr`. An application that also refreshes skills calls both from its own `afterReplace`:

```ts
import { refreshCompletion } from '@loomcli/plugins/completion';
import { selfUpdate } from '@loomcli/plugins/self-update';
import { refreshSkills } from '@loomcli/plugins/skills';

selfUpdate({
  afterReplace: async (context) => {
    await refreshSkills(context);
    await refreshCompletion(context);
  },
});
```

A binary that a package manager, npm, or the installer script replaced runs no `afterReplace`. Until the operator runs `completion update`, its installed script is the one the earlier version wrote, which keeps completing every Command and option the new binary has, because it asks the binary at every Tab.

- **Output.** The `Installed`, `Updated`, `Added a line`, `Updated the line`, and nothing-to lines go through `out.success`; the `is unchanged`, `already loads`, `Removed`, `already gone`, `no longer holds`, and `Open a new shell` lines through `out.info`; the refused-file, left-in-place, and cannot-change lines through `out.warn`; and a line the operator adds or removes by hand through `out.print`, the only thing `install`, `update`, or `uninstall` writes to stdout. The examples above omit the glyph each lane view adds. Every path a sentence repeats passes through `escapeControlCharacters`. Every refusal and check failure above is a `FatalError` that exits 1, and an unknown shell is the `InputError` above.
- **Names.** `completion`, `refreshCompletion`, `RefreshContext`, `Completer`, `CompleterContext`, `CompletionSettings`, `CompletionValue`, and `CompletionValues` are exported from `@loomcli/plugins/completion`, and `completionInput`, `completionArgument`, `CompletionValueFacts`, and `CompletionInputFacts` from `@loomcli/plugins/completion/extension`. `RefreshContext` is the same declaration `@loomcli/plugins/skills` exports.

## At -v and in the log

The Commands print a confirmation for each file they write or remove, so they write no line of their own. The refresh after a self-update writes these:

| Level | Line | When |
| --- | --- | --- |
| `-vv` | `Skipped the completion refresh: nothing is installed.` | The refresh did not run, because the installation record holds none of the plugin's files. |

- **Nothing is installed.** Before it starts the child, a refresh whose context carries `name` looks in `applicationDirectory('installation', name, host)` for `completion.<shell>` for any shell. When none exists, it starts no child, writes its `-vv` line, and resolves. It reads only whether each file exists, so an unreadable or damaged record still runs the child, whose failure names the fix. A directory that does not resolve, and a context without `name`, run the child. This is the one reason a refresh does not run.
- **Its lines.** The refresh logs its `-v` and `-vv` lines through the context's `log`, which the self-update plugin passes with the graph's `name`. A child that fails or cannot start logs no `-v` line and keeps its `warn` event and its line on `host.stderr`.
- **Log events.** Each script, startup file, and shell's record file the Commands write records `File written.`, and each one they delete `File removed.`, a startup file whose line was added, replaced, or removed counting as written, under the path the plugin's file records for it. A run that finds everything in place writes nothing and records nothing. A refresh child that exits 0 records `Program run.` with `{ program: path, arguments: ['completion', 'update'], code: 0 }` through the context's `log`, the self-update action's, so its `plugin` reads `@loomcli/plugins/self-update`. Each event is an `info` [change event](../core/logging.md#change-events), and a Command's events name `@loomcli/plugins/completion`. A leftover staging file the plugin removes beside a file it writes, which a run that was stopped mid-write left, records `File removed.` too.
- **Log lines.** Each `-v` line is one `log.debug` call and each `-vv` line one `log.trace` call, whose message is a constant [message template](../core/logging.md#message-templates) with the values the line shows in the event's fields, so the screen reads the sentence the table shows and a record keeps the template. Core shows each through its [log-line view](../core/logging.md#at--v) under the run's [verbosity](../core/verbosity.md): `-v -q` shows none, the lines go to stderr whether or not it is a terminal, an [`app.invoke`](../core/invocation.md#invocation-by-name) shows them in its `messages` when its values ask for them, and under an action's `invoke` or an [MCP](mcp.md) tool call they follow the outermost run's verbosity. Every value a line shows passes through [`escapeControlCharacters`](../core/styles.md#strings-and-composition). Each line is a log event, so an installed [logging plugin](logging.md) records it at its level, and each change event the plugin records shows at `-v` too, as every `info` event does. [ADR-0165](../decisions/0165-first-party-plugins-say-what-they-did-at-v-and-record-each-change-they-make-as-a-log-event.md) records the lines and the events, and [ADR-0174](../decisions/0174-v-shows-the-log-through-message-templates-and-out-keeps-what-the-operator-is-told.md) moves the lines onto `log`.
