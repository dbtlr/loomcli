- Change the first bare `--` so it ends option parsing and every later word is a plain word for the routed Command, as POSIX reads it. A word after `--` fills the next unfilled argument, so `rm -- -draft.txt` fills `rm`'s argument, and a word with no argument left to fill is the unexpected-argument usage error, with exit code 2. See [Passthrough](docs/core/options.md#passthrough).
- Add `.passthrough({ description? })`, which a Command with an action declares to keep a passthrough tail. With it, every word after the first bare `--` reaches the action in `passthrough` untouched, as every Command's did before. Without it, the action context has no `passthrough` member. The validation context and the middleware `request` keep `passthrough`, which is `[]` without the mode.
- Change `invoke` to refuse a non-empty `values.passthrough` on a Command that does not declare `.passthrough()`, with an `UnexpectedArgumentError`.
- Rename the declaration rule `@loomcli/core/variadic-argument-last` to `@loomcli/core/argument-after-variadic`, which now allows required scalar arguments after a variadic argument.

### Migration

**Affected surface.** This change holds three breaks.

- The type checker reports every affected site. The surface is an action, or a test built with `@loomcli/testing`'s `actionContext`, that reads `passthrough` from the action context of a Command that does not declare `.passthrough()`.
- No compile error: behavior changes at run time. The surface is a Command without `.passthrough()` that an operator, a script, or an `invoke` call gives words after a bare `--`. Those words now fill the Command's arguments, or fail with exit code 2 when no argument is left, where they were dropped into an unread `passthrough` before. The service plugin is in the surface: a `run` setting whose words after a bare `--` leave an extra word on a Command without the mode, such as `run: ['convert', '--', 'in.txt', 'extra']`, now fails the graph build, where an earlier release accepted it.
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

**Steps.**

1. Run the type checker, and add `.passthrough()` to each Command whose action reads `passthrough`. Call it before `.action()`.
2. For each Command without `.passthrough()`, check the scripts, documentation, and `invoke` calls that pass words after a bare `--`. Declare `.passthrough()` where the words are meant for a tail, or drop the `--` where they are meant as arguments.
3. Check each service plugin `run` setting that carries a bare `--`. Declare `.passthrough()` on its Command where the words after `--` are a tail, or remove the extra word or the `--`, so the graph builds.
4. Replace `@loomcli/core/variadic-argument-last` with `@loomcli/core/argument-after-variadic` wherever code or documentation names the rule.

**Validation.** Run the application's type check, such as `tsc --noEmit`, and its test command, such as `vitest run` or `bun test`. Run each Command that declares `.passthrough()` with a tail after `--`, and check that the action receives it. Run one Command without it as `app <command> -- extra` and check that it fails with exit code 2.
