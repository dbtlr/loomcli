/**
 * The shells completion installs for on Linux and macOS, in the order `uninstall` with no shell
 * follows. `pwsh` is PowerShell 7, which runs the script `completion powershell` prints. The names
 * sit apart from what installs each shell, because the plugin's declaration validates against them
 * when it loads.
 */
const shells = ['bash', 'zsh', 'fish', 'pwsh'] as const;

type Shell = (typeof shells)[number];

/**
 * The plugin's file in the installation record for a shell, `completion.<shell>.json`. The Commands
 * and the refresh read it from here, so both name the same file.
 */
function recordName(shell: Shell): string {
  return `completion.${shell}`;
}

export type { Shell };
export { recordName, shells };
