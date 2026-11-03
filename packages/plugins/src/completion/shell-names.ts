/**
 * The shells completion installs for on Linux and macOS, in the order `uninstall` with no shell
 * follows. `pwsh` is PowerShell 7, which runs the script `completion powershell` prints. The names
 * sit apart from what installs each shell, because the plugin's declaration validates against them
 * when it loads.
 */
const shells = ['bash', 'zsh', 'fish', 'pwsh'] as const;

type Shell = (typeof shells)[number];

export type { Shell };
export { shells };
