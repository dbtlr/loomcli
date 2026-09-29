import { diagnosticRule } from '@loomcli/core';

import Package from '../package.json' with { type: 'json' };

/*
 * The pack's rules for the declaration faults its plugins raise. Each is declared once here through
 * the public diagnosticRule(), under the package's own name, as any third-party plugin declares its
 * rules, and shared by every site that raises it.
 */

/** A configuration plugin `files` setting that is not a list of paths. */
const configFiles = diagnosticRule(`${Package.name}/config-files`, {
  explanation:
    'The configuration plugin reads the project files its settings list, most specific first, and opens each path as it is written, so files is a list of nonempty paths with no control character.',
  headline: 'Invalid configuration files',
});

/** An application name a completion script cannot carry into shell source. */
const scriptName = diagnosticRule(`${Package.name}/script-name`, {
  explanation:
    "A completion script carries the application name into shell source, as a function name and as a quoted string, so it takes a name inside core's portable name rule alone, which no shell reads as code.",
  headline: 'Name not portable in a script',
});

/** One failure name declared with two exit codes or two meanings. */
const failureNameConflict = diagnosticRule(`${Package.name}/failure-name-conflict`, {
  explanation:
    'The manifest lists each failure name once for the whole application, with one exit code and one meaning, so a consumer reads one contract for each name. Two declarations of one name that disagree leave it no single entry to list.',
  headline: 'Failure name conflict',
});

export { configFiles, failureNameConflict, scriptName };
