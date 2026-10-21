- Change `completion install`, `completion update`, and `completion uninstall` to serve `bash`, `zsh`, `fish`, and `pwsh` on Linux and macOS alone, under [ADR-0101](docs/decisions/0101-completion-installs-on-linux-and-macos-and-a-startup-line-is-written-or-printed.md). On Windows each exits 1 with `<app> completion installs bash, zsh, fish, and pwsh completion on Linux and macOS. Print the script with <app> completion powershell and load it yourself.`, naming the print Command of the shell asked for. `completion powershell` still prints the PowerShell script.
- Remove `powershell`, Windows PowerShell 5.1, as a shell `install` and `uninstall` take, with its `completion.powershell.json` record file. `install` with `SHELL` unset no longer picks a PowerShell edition from `PSModulePath`, and the plugin reads no `LOCALAPPDATA` or `USERPROFILE`, checks no execution policy, and reads or writes no UTF-16LE startup file.

### Migration

**Affected surface.** Applications that install `completion()` and whose operators ran `completion install` on Windows, or ran `completion install powershell` or `completion uninstall powershell` anywhere, including in documentation or scripts the application ships.

**Why.** No CI job runs Windows, so the Windows install paths ran only under a faked platform, and support that no CI entry runs is not shipped, under [ADR-0100](docs/decisions/0100-acceptance-plans-live-beside-the-tests.md).

**Before and after.**

Before, on Windows:

```powershell
notes completion install powershell
```

After, on Windows, the operator loads the printed script from `$PROFILE` with this line:

```powershell
notes completion powershell | Out-String | Invoke-Expression
```

After, on Linux and macOS, PowerShell 7 installs as `pwsh`:

```sh
notes completion install pwsh
```

**Steps.**

1. Replace `completion install powershell` and `completion uninstall powershell` in the application's documentation and scripts with `completion install pwsh` and `completion uninstall pwsh` for Linux and macOS.
2. Tell Windows operators to add the `completion powershell` line above to `$PROFILE`, and to remove the line an earlier release added there, which ends with `# added by <app> completion install`.
3. Tell Windows operators that the script an earlier release wrote under `%LOCALAPPDATA%\<app>\completion\` and its record file under `%LOCALAPPDATA%\<app>\installation\` are no longer read, and that they may delete both.

**Validation.** On Linux or macOS, run `<app> completion install pwsh` and confirm that it exits 0, and run `<app> completion install powershell` and confirm that it exits 2 and lists `bash, zsh, fish, pwsh`. On Windows, open a new PowerShell session and confirm that Tab completes the application's Commands.
