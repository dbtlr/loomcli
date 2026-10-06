import { diagnosticRule } from '@loomcli/core';

import Package from '../package.json' with { type: 'json' };

/*
 * The pack's rules for the declaration faults its plugins raise. Each is declared once here through
 * the public diagnosticRule(), under the package's own name and the subpath of the plugin that raises
 * it, as any third-party plugin declares its rules, and shared by every site that raises it.
 */

/** A configuration plugin `file` setting that is not a relative path. */
const configFilePath = diagnosticRule(`${Package.name}/config/file-path`, {
  explanation:
    'The configuration plugin looks for its file in the working directory and then in the home directory, so file is a relative path whose segments each name a directory or a file, with no control character.',
  headline: 'Invalid configuration file path',
});

/** A configuration plugin `file` setting whose glob syntax is not a whole extension it can read. */
const configFilePattern = diagnosticRule(`${Package.name}/config/file-pattern`, {
  explanation:
    "The configuration plugin chooses a file's parser by its extension, so file holds glob syntax only as the whole extension of its name: * for any format the plugin reads, or a brace list of json, toml, yaml, and yml, tried in the order listed.",
  headline: 'Invalid configuration file pattern',
});

/** One failure name declared with two exit codes or two meanings. */
const failureNameConflict = diagnosticRule(`${Package.name}/manifest/failure-name-conflict`, {
  explanation:
    'The manifest lists each failure name once for the whole application, with one exit code and one meaning, so a consumer reads one contract for each name. Two declarations of one name that disagree leave it no single entry to list.',
  headline: 'Failure name conflict',
});

/** A version plugin `postfix` setting that is not one line of prose. */
const versionPostfix = diagnosticRule(`${Package.name}/version/postfix`, {
  explanation:
    'The version plugin prints the postfix after the version on its one line, so the postfix holds a character other than whitespace and no line terminator.',
  headline: 'Invalid version postfix',
});

export { configFilePath, configFilePattern, failureNameConflict, versionPostfix };
