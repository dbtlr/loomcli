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
    'The configuration plugin looks for its file in the start directory, each of its ancestors, and the home directory, so file is a relative path whose segments each name a directory or a file.',
  headline: 'Invalid configuration file path',
});

/** A configuration plugin `file` setting whose glob syntax is not a whole extension it can read. */
const configFilePattern = diagnosticRule(`${packageName}/config/file-pattern`, {
  explanation:
    "The configuration plugin chooses a file's parser by its extension, so file holds glob syntax only as the whole extension of its name: * for any format the plugin reads, or a brace list of json, jsonc, toml, yaml, and yml, tried in the order listed.",
  headline: 'Invalid configuration file pattern',
});

/** A configuration plugin `env` setting that is not an environment variable name. */
const configVariableName = diagnosticRule(`${packageName}/config/variable-name`, {
  explanation:
    "The configuration plugin reads the variable that env names from the run's environment, and an environment variable's name is a letter or underscore followed by letters, digits, or underscores, so a name of another form can never hold a value.",
  headline: 'Invalid configuration variable name',
});

/** A configuration plugin `root` marker that is not one path segment. */
const configRootName = diagnosticRule(`${packageName}/config/root-name`, {
  explanation:
    "The configuration plugin's project walk checks each directory it looks in for an entry of each root marker's name, so a marker names one entry: it is nonempty, holds no slash or backslash, and is neither . nor ..",
  headline: 'Invalid configuration root marker',
});

/** A configuration plugin `root` marker beside scopes that never walk the project. */
const configRootWithoutProject = diagnosticRule(`${packageName}/config/root-without-project`, {
  explanation:
    'A root marker bounds the project walk, and a scopes list without project reads the home file and the user file alone, so the marker would bound nothing and its setting would say something the lookup never does.',
  headline: 'Configuration root marker without the project scope',
});

/** A configuration schema that rejects an empty file, which the types cannot see. */
const configEmptyFile = diagnosticRule(`${packageName}/config/empty-file`, {
  explanation:
    'A command-line application runs before its operator has written any configuration, so the configuration schema accepts an empty file. The plugin drops every value the schema rejects and validates again, and a schema that still reports an issue once every key is gone, such as a refinement that fails for an empty object, leaves the plugin no file to give the application.',
  headline: 'Configuration schema rejects an empty file',
});

/** An option linked to a configuration path whose keys the schema does not hold. */
const configLinkPath = diagnosticRule(`${packageName}/config/link-path`, {
  explanation:
    'An option linked with configInput takes the value the configuration file holds at its path, and the configuration schema describes the whole file. A path whose keys the schema does not describe means the shape of the file and the option disagree, and the check catches a typo or a stale link at build time.',
  headline: 'Option linked to a path the configuration schema does not hold',
});

/** An option linked to a configuration path that holds a value the option cannot take. */
const configLinkType = diagnosticRule(`${packageName}/config/link-type`, {
  explanation:
    'An option linked with configInput takes a string or a number, a Boolean, a whole number, or an array, by its type. A path whose configuration schema holds no value of that kind can never fill the option, so the link is a mistake that only the assembled application reveals.',
  headline: 'Option linked to a value it cannot take',
});

/** Two findable Commands that give one man page name. */
const manpagePageNameTaken = diagnosticRule(`${packageName}/manpage/page-name-taken`, {
  explanation:
    "The manpage plugin writes one page for each Command an operator can find, named by the application name and the Command's path joined with hyphens, so a Command named with a hyphen can give the name of a child's page, and one page would replace the other.",
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

/** A required local option of an opted-in Command that `mcpInput({ exclude: true })` keeps off its tool. */
const mcpRequiredInputExcluded = diagnosticRule(`${packageName}/mcp/required-input-excluded`, {
  explanation:
    "An excluded option is off its Command's MCP tool, and a tool call reads no source for it, so a required option that is excluded, a one-required group whose every member is excluded, and a required-together group that excludes some of its members leave calls of the tool missing a value the Command needs.",
  headline: 'Required MCP input excluded',
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

/**
 * Skills settings that hold neither a folder nor a list, a folder that is not a file URL or a nonempty path, a skill
 * name outside the Agent Skills grammar, or one that two skills hold.
 */
const skillsSettings = diagnosticRule(`${packageName}/skills/settings`, {
  explanation:
    "The skills plugin installs each skill as one folder, named by the skill's name, where an agent reads skills, so the settings name a folder of skills, a file URL or a nonempty path, or a list of skills, each name follows the Agent Skills grammar, lowercase letters and digits joined by single hyphens, 64 characters at most, and no two skills hold one name.",
  headline: 'Invalid skills setting',
});

/** A skills folder the plugin cannot read as skills, or a carried folder it cannot find. */
const skillsFolder = diagnosticRule(`${packageName}/skills/folder`, {
  explanation:
    "The skills plugin installs each directory of the folder its folder setting names as one skill named by the directory, so the folder exists, holds a skill unless the application lists its skills, each skill directory's name is a skill name, and each entry inside a skill is a file or a folder. A relative folder resolves against the application module, which only loom build knows, so a run loom build did not make reads the folder through a URL or an absolute path, and an artifact loom build made reads the copy it carries.",
  headline: 'Unreadable skills folder',
});

/** A skill's loaded files that the plugin cannot write as a folder, or a listed skill that holds a folder skill's name. */
const skillsFiles = diagnosticRule(`${packageName}/skills/files`, {
  explanation:
    "The skills plugin writes each skill as one folder in the operator's agent folders, so each file's path is relative to that folder, with no .. part that would write outside it, and the list holds the skill's SKILL.md, the file every agent reads first, and no listed skill holds a name the skills folder holds.",
  headline: 'Invalid skill files',
});

/** A version plugin `postfix` setting that is not one line of prose. */
const versionPostfix = diagnosticRule(`${packageName}/version/postfix`, {
  explanation:
    'The version plugin prints the postfix after the version on its one line, so the postfix holds a character other than whitespace and no line terminator.',
  headline: 'Invalid version postfix',
});

/** A dotenv `only` or `except` list that holds a name no assignment in a dotenv file gives. */
const dotenvVariableName = diagnosticRule(`${packageName}/dotenv/variable-name`, {
  explanation:
    'The dotenv plugin compares each name an only or except list holds with the names the assignments in the dotenv files give, and an assignment names a variable with a letter or underscore followed by letters, digits, or underscores. A listed name of another form never matches, so the list would not do what it says.',
  headline: 'Invalid dotenv variable name',
});

export {
  dotenvVariableName,
  configEmptyFile,
  configFilePath,
  configFilePattern,
  configLinkPath,
  configLinkType,
  configRootName,
  configRootWithoutProject,
  configVariableName,
  failureCodeConflict,
  manpagePageNameTaken,
  mcpPropertyNameTaken,
  mcpRequiredInputExcluded,
  mcpToolNameTaken,
  mcpToolWithoutAction,
  selfUpdateSettings,
  serviceRunUnrouted,
  serviceSettings,
  skillsFiles,
  skillsFolder,
  skillsSettings,
  versionPostfix,
};
