/**
 * The grammar of an environment variable's name, as an input's environment binding reads it: a
 * letter or underscore, then letters, digits, or underscores. Every plugin of the pack that reads
 * or names a variable uses this one grammar.
 */
const variableNameSource = '[A-Za-z_][A-Za-z0-9_]*';

const variableName = new RegExp(`^${variableNameSource}$`, 'u');

/** Whether a name follows the environment variable grammar. */
function isVariableName(name: string): boolean {
  return variableName.test(name);
}

export { isVariableName, variableNameSource };
