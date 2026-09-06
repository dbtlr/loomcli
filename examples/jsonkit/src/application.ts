import { get } from './commands/get.js';
import { keys } from './commands/keys.js';
import { root } from './commands/root.js';

export const jsonkit = root.command(get).command(keys);
