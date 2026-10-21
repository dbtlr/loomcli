import { isRuleIdentity } from '@loomcli/core';

// Each argument is JSON, so a test can pass a value that is not a string.
const answers = process.argv.slice(2).map((argument) => isRuleIdentity(JSON.parse(argument)));
process.stdout.write(`${JSON.stringify(answers)}\n`);
