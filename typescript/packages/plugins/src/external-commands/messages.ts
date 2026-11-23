/*
 * The operator sentences of the external-commands plugin, under ADR-0164.
 * `tests/message-voice.test.ts` holds this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

const shown = escapeControlCharacters;

/**
 * The failure of a program the search found that did not start, naming the application, the
 * program's path, and the cause by the system error's code, in Loom's words, with the step that
 * fixes it, or a general cause that names any other code.
 */
function cannotRun(application: string, program: string, code: string | undefined): string {
  switch (code) {
    case 'EACCES': {
      return `${shown(application)} cannot run ${shown(program)}, because the system does not allow it to run. Check its permissions and the file system it is on, or remove it from PATH.`;
    }
    case 'ENOENT': {
      return `${shown(application)} cannot run ${shown(program)}, because the interpreter its first line names, or the file itself, is missing. Install the interpreter, or remove the file from PATH.`;
    }
    case 'ENOEXEC': {
      return `${shown(application)} cannot run ${shown(program)}, because this system cannot run it as a program. Replace it with a program for this system, or remove it from PATH.`;
    }
    case undefined: {
      return `${shown(application)} cannot run ${shown(program)}, because the system refused to start it. Check that it is a program this system can run, or remove it from PATH.`;
    }
    default: {
      return `${shown(application)} cannot run ${shown(program)}, because the system refused to start it (${shown(code)}). Check that it is a program this system can run, or remove it from PATH.`;
    }
  }
}

/** The `debug` log template for the program the plugin starts. */
const runningProgram = 'Running {program}.';

/** The `trace` log template for one `PATH` entry the search passed over. */
const programNotIn = 'No {program} in {folder}.';

export { cannotRun, programNotIn, runningProgram };
