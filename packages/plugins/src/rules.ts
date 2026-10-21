import { diagnosticRule } from '@loomcli/core';

import { packageName } from './constants.js';

/*
 * The pack's rules for the declaration faults its plugins raise. Each is declared once here through
 * the public diagnosticRule(), under the package's own name and the subpath of the plugin that raises
 * it, as any third-party plugin declares its rules, and shared by every site that raises it.
 */

/** A configuration plugin `file` setting that is not a relative path. */
const configFilePath = diagnosticRule(`${packageName}/config/file-path`, {
  explanation:
    'The configuration plugin looks for its file in the working directory and then in the home directory, so file is a relative path whose segments each name a directory or a file, with no control character.',
  headline: 'Invalid configuration file path',
});

/** A configuration plugin `file` setting whose glob syntax is not a whole extension it can read. */
const configFilePattern = diagnosticRule(`${packageName}/config/file-pattern`, {
  explanation:
    "The configuration plugin chooses a file's parser by its extension, so file holds glob syntax only as the whole extension of its name: * for any format the plugin reads, or a brace list of json, toml, yaml, and yml, tried in the order listed.",
  headline: 'Invalid configuration file pattern',
});

/** Two findable Commands whose man page names are one file on a file system that ignores case. */
const manpagePageNameTaken = diagnosticRule(`${packageName}/manpage/page-name-taken`, {
  explanation:
    "The manpage plugin writes one page for each Command an operator can find, named by the application name and the Command's path joined with hyphens. Two names that are equal when letters are compared without case would be one file on a file system that ignores case, such as macOS's default, so one page would replace the other.",
  headline: 'Man page name taken',
});

/** One failure code declared with two exit codes or two meanings. */
const failureCodeConflict = diagnosticRule(`${packageName}/manifest/failure-code-conflict`, {
  explanation:
    'The manifest lists each failure code once for the whole application, with one exit code and one meaning, so a consumer reads one contract for each code. Two declarations of one code that disagree leave it no single entry to list.',
  headline: 'Failure code conflict',
});

/** Two opted-in Commands that give one MCP tool name, the root included. */
const mcpToolNameTaken = diagnosticRule(`${packageName}/mcp/tool-name-taken`, {
  explanation:
    'An MCP client calls a tool by its name: the Command path joined with underscores, or the application name for the root, with each hyphen written as an underscore. Two Commands that give one name leave the client no way to call either one.',
  headline: 'MCP tool name taken',
});

/** `mcpCommand` on a Command that registers no action. */
const mcpToolWithoutAction = diagnosticRule(`${packageName}/mcp/tool-without-action`, {
  explanation:
    "An MCP tool call runs the Command's action, so a Command with no action, such as a group, has nothing to run when a client calls it.",
  headline: 'MCP tool without an action',
});

/** An argument and an option one MCP tool would list under one name. */
const mcpPropertyNameTaken = diagnosticRule(`${packageName}/mcp/property-name-taken`, {
  explanation:
    'An MCP tool takes its arguments and options as one object keyed by declared name, so an argument and an option that share a name leave the client no way to supply each one.',
  headline: 'MCP property name taken',
});

/** A self-update `notices.env` setting that is not an environment variable name. */
const selfUpdateSettings = diagnosticRule(`${packageName}/self-update/settings`, {
  explanation:
    'The self-update plugin reads the variable that notices.env names from the environment, as an input binds one, and turns update notices off when it is set and not empty, so env is a variable name: letters, digits, and underscores, not starting with a digit.',
  headline: 'Invalid self-update setting',
});

/** A service plugin `label` that is not a reverse-DNS name its unit can carry. */
const serviceSettings = diagnosticRule(`${packageName}/service/settings`, {
  explanation:
    "The service plugin names its unit by label: the systemd unit is <label>.service and the launchd agent's Label is the label. So label is a reverse-DNS name of two or more segments of letters, digits, and hyphens, each opening with a letter or digit, 247 characters at most, which keeps the unit name within systemd's 255 characters.",
  headline: 'Invalid service setting',
});

/** Service `run` words that do not route to a Command with an action. */
const serviceRunUnrouted = diagnosticRule(`${packageName}/service/run-unrouted`, {
  explanation:
    "The service unit runs the application with the words in run, so they name a Command that has an action, with its options and arguments, as the application's command line takes them. Words that route nowhere would leave the manager restarting a process that fails at once.",
  headline: 'Service run words do not route',
});

/** A skills plugin setting that is not one it accepts. */
const skillsSettings = diagnosticRule(`${packageName}/skills/settings`, {
  explanation:
    "The skills plugin installs each skill the application declares from a name and a function that returns its files, so skills is a nonempty list of objects, each name is lowercase letters and digits joined by single hyphens, 64 characters at most, no name repeats, and files is a function. A name is one path segment in an agent's skills folder.",
  headline: 'Invalid skills setting',
});

/** A skill's loaded files that the plugin cannot write as a folder. */
const skillsFiles = diagnosticRule(`${packageName}/skills/files`, {
  explanation:
    "The skills plugin writes each skill as one folder, so a skill's files function returns a list of files, each with a relative path that has / between its parts and no empty, ., or .. part, and text or bytes as content. Each path appears once, and the list holds the skill's SKILL.md.",
  headline: 'Invalid skill files',
});

/** A version plugin `postfix` setting that is not one line of prose. */
const versionPostfix = diagnosticRule(`${packageName}/version/postfix`, {
  explanation:
    'The version plugin prints the postfix after the version on its one line, so the postfix holds a character other than whitespace and no line terminator.',
  headline: 'Invalid version postfix',
});

/** A dotenv `only` or `except` list that holds a name no assignment in `.env` gives. */
const dotenvVariableName = diagnosticRule(`${packageName}/dotenv/variable-name`, {
  explanation:
    'The dotenv plugin compares each name an only or except list holds with the names the assignments in .env give, and an assignment names a variable with a letter or underscore followed by letters, digits, or underscores. A listed name of another form never matches, so the list would not do what it says.',
  headline: 'Invalid dotenv variable name',
});

export {
  dotenvVariableName,
  configFilePath,
  configFilePattern,
  failureCodeConflict,
  manpagePageNameTaken,
  mcpPropertyNameTaken,
  mcpToolNameTaken,
  mcpToolWithoutAction,
  selfUpdateSettings,
  serviceRunUnrouted,
  serviceSettings,
  skillsFiles,
  skillsSettings,
  versionPostfix,
};
