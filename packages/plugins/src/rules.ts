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

/** One failure code declared with two exit codes or two meanings. */
const failureCodeConflict = diagnosticRule(`${packageName}/manifest/failure-code-conflict`, {
  explanation:
    'The manifest lists each failure code once for the whole application, with one exit code and one meaning, so a consumer reads one contract for each code. Two declarations of one code that disagree leave it no single entry to list.',
  headline: 'Failure code conflict',
});

/** A logging plugin setting that is out of its range, or a setting the console destination cannot use. */
const loggingSettings = diagnosticRule(`${packageName}/logging/settings`, {
  explanation:
    'The logging plugin writes records to a file or to the console, so to is file or console; a file is a nonempty name, absolute path, or path under ~/ with no control character; level is one of the five written levels; maxBytes and keep are whole numbers of 1 or more; onError is a function; and the console destination takes only a level.',
  headline: 'Invalid logging setting',
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

/** A version plugin `postfix` setting that is not one line of prose. */
const versionPostfix = diagnosticRule(`${packageName}/version/postfix`, {
  explanation:
    'The version plugin prints the postfix after the version on its one line, so the postfix holds a character other than whitespace and no line terminator.',
  headline: 'Invalid version postfix',
});

export {
  configFilePath,
  configFilePattern,
  failureCodeConflict,
  loggingSettings,
  mcpPropertyNameTaken,
  mcpToolNameTaken,
  mcpToolWithoutAction,
  versionPostfix,
};
