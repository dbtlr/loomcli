- Add static value hints to shell completion. `completionInput` and `completionArgument` from `@loomcli/plugins/completion/extension` mark an option or an argument as completing file names, files of some extensions, directories only, nothing, or, for an argument only, the Commands its earlier words have reached; Tab then completes accordingly in Bash, Zsh, Fish, and PowerShell, including, for the files-of-some-extensions and directories-only hints, a value attached to its option, as in `--config=a` or `-ca`, and never falls back to a file name the hint rejects. The Fish script now filters by extension and to directories instead of completing every file name.
  ```ts
  new Command('load').option('config', {
    extensions: [completionInput({ extensions: ['json', 'yaml'] })],
    type: 'string',
  });
  ```
- Complete Commands after `help` when the help Command is on: `app help ta<Tab>` offers `task`, and `app help task sh<Tab>` offers its children.
