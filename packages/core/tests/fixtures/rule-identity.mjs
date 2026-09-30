import { isRuleIdentity, plugin } from '@loomcli/core';

/** Whether `plugin()` accepts a value as its identity. */
function isPluginIdentity(value) {
  try {
    plugin(value, {});
    return true;
  } catch {
    return false;
  }
}

// The first argument names the check.
// Each later argument is JSON, so a test can pass a value that is not a string.
const check = process.argv[2] === 'plugin' ? isPluginIdentity : isRuleIdentity;
const answers = process.argv.slice(3).map((argument) => check(JSON.parse(argument)));
process.stdout.write(`${JSON.stringify(answers)}\n`);
