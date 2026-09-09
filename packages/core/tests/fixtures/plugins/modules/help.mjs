import { mark } from '../mark.mjs';

// The mark is written when the module is evaluated, which is when the chain reached this plugin.
mark('loaded:help');

/** Takes over the invocation: it renders and never calls `next()`. */
const middleware = ({ command, out }) =>
  out.print(`help:${command.path.length === 0 ? '(root)' : command.path.join(' ')}`);

export default middleware;
