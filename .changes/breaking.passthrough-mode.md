- Change the first bare `--` so it ends option parsing and every later word is a plain word for the routed Command, as POSIX reads it. A word after `--` fills the next unfilled argument, so `rm -- -draft.txt` fills `rm`'s argument, and a word with no argument left to fill is the unexpected-argument usage error, with exit code 2. See [Passthrough](docs/core/options.md#passthrough).
- Add `.passthrough({ description? })`, which a Command with an action declares to keep a passthrough tail. With it, every word after the first bare `--` reaches the action in `passthrough` untouched, as every Command's did before. Without it, the action context has no `passthrough` member. The validation context and the middleware `request` keep `passthrough`, which is `[]` without the mode. `@loomcli/testing`'s `actionContext` reads an unstated `passthrough` as `[]` instead of throwing.
- Change `invoke` to refuse a non-empty `values.passthrough` on a Command that does not declare `.passthrough()`, with an `UnexpectedArgumentError`.
- Rename the declaration rule `@loomcli/core/variadic-argument-last` to `@loomcli/core/argument-after-variadic`, which now allows required scalar arguments after a variadic argument.
- Allow required scalar arguments after a variadic argument, so a Command can declare `copy <src...> <dest>` or `mv [src...] <dest>`. The arguments after the variadic fill from the end of the line, and the variadic takes the words between. An optional argument, a second variadic argument, an argument required only when input is not interactive, and a content argument still may not follow a variadic argument. See [Application declarations](docs/core/application.md).
- Add `passthrough` to `CommandNode` and the manifest's Command entry: the declared mode's description, or `null` on a Command without `.passthrough()`. Help's usage line ends with `[-- <args>...]` only on a Command that declares `.passthrough()`.
- Change the unknown-option sentence on a Command that declares an argument and does not declare `.passthrough()` to `Supply a declared option, or pass it as an argument after "--".`

### Migration

**Affected surface.** This change holds four breaks.

- The type checker reports every affected site. The surface is an action, or a test built with `@loomcli/testing`'s `actionContext`, that reads `passthrough` from the action context of a Command that does not declare `.passthrough()`.
- No compile error: behavior changes at run time. The surface is a Command without `.passthrough()` that an operator or a script gives words after a bare `--`. Those words now fill the Command's arguments, or fail with exit code 2 when no argument is left, where they were dropped into an unread `passthrough` before. The service plugin is in the surface: a `run` setting whose words after a bare `--` leave an extra word on a Command without the mode, such as `run: ['convert', '--', 'in.txt', 'extra']`, now fails the graph build, where an earlier release accepted it.
- No compile error: an `invoke` call fails at run time. A call by name types no `--`, so its tail is `values.passthrough`. The surface is an `invoke` call, or an `app.invoke` call, that passes a non-empty `values.passthrough` to a Command without `.passthrough()`. It now fails with an `UnexpectedArgumentError`, where the action ignored the words before.
- No compile error: a string no longer matches. The surface is code or documentation that names the rule identity `@loomcli/core/variadic-argument-last`, such as a test that matches a `DeclarationError`'s rule.

**Why.** Every Command used to accept a passthrough tail, so a word that starts with a hyphen could not fill an argument, and a Command that never read the tail dropped it in silence. Passthrough is now something a Command declares, and help shows `[-- <args>...]` only on a Command that takes a tail.

**Before and after.**

Before, an action that forwards its tail to another program:

```ts
new Command('exec')
  .argument('tool', { required: true })
  .action(({ args, passthrough }) => run(args.tool, passthrough));
```

After:

```ts
new Command('exec')
  .argument('tool', { required: true })
  .passthrough({ description: 'Arguments for the tool.' })
  .action(({ args, passthrough }) => run(args.tool, passthrough));
```

Before, a call by name that passed words the Command never read:

```ts
await invoke(['get'], { args: {}, options: {}, passthrough: ['user.name'] });
```

After, with the words as the argument the Command declares:

```ts
await invoke(['get'], { args: { path: 'user.name' }, options: {} });
```

**Steps.**

1. Run the type checker, and add `.passthrough()` to each Command whose action reads `passthrough`. Call it before `.action()`.
2. For each Command without `.passthrough()`, check the scripts and documentation that pass words after a bare `--`. Declare `.passthrough()` where the words are meant for a tail. Where they are meant as arguments, keep the `--`: the words after it now fill the Command's arguments, even a word that starts with `-` or names a child Command.
3. For each `invoke` and `app.invoke` call that passes `values.passthrough`, declare `.passthrough()` on its Command if the action reads a tail. Otherwise remove `passthrough` from the values, or move the words into `values.args` under the declared argument's name.
4. Check each service plugin `run` setting that carries a bare `--`. Declare `.passthrough()` on its Command where the words after `--` are a tail. Otherwise each word after `--` fills an argument, so remove a word that no argument takes, and the graph builds.
5. Replace `@loomcli/core/variadic-argument-last` with `@loomcli/core/argument-after-variadic` wherever code or documentation names the rule.

**Validation.** Run the application's type check, such as `tsc --noEmit`, and its test command, such as `vitest run` or `bun test`. Run each Command that declares `.passthrough()` with a tail after `--`, and check that the action receives it. Pick one Command without it whose arguments a line can fill completely, run it with every argument supplied and one more word after `--`, as `app <command> <arguments> -- extra`, and check that it fails with exit code 2. Run a Command without `.passthrough()` with a word that starts with `-` after `--`, as `app <command> -- -draft.txt`, and check that its action receives the word as the argument. After changing a service plugin `run` setting, run the application once, such as `app --help`, and check that it starts with no `DeclarationError`.
