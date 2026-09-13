import { Command } from '@loomcli/core';
import type { ActionHandler } from '@loomcli/core';

const report: ActionHandler<typeof local> = ({ options, out }) => out.print(String(options.trace));
const local = new Command('local').action(report);

export { local };
