/*
 * The operator sentences several plugins share, under ADR-0164. `tests/message-voice.test.ts` holds
 * this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

const shown = escapeControlCharacters;

function homeNotAbsolute(name: string): string {
  return `${shown(name)} cannot find your home folder because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.`;
}

function recordDirectoryNotAbsolute(name: string, variable: string): string {
  return `${shown(name)} cannot find its installation record because ${shown(variable)} is not an absolute path. Set ${shown(variable)} to an absolute path, then run the command again.`;
}

/** The four shared change-event templates, shown on screen at -v. */
const fileWrittenMessage = 'File written.';
const fileRemovedMessage = 'File removed.';
const programRunMessage = 'Program run.';
const binaryReplacedMessage = 'Binary replaced.';

export {
  binaryReplacedMessage,
  fileRemovedMessage,
  fileWrittenMessage,
  homeNotAbsolute,
  programRunMessage,
  recordDirectoryNotAbsolute,
};
