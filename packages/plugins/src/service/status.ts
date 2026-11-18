import { existsSync } from 'node:fs';

import { escapeControlCharacters, nowrap, readExtension } from '@loomcli/core';
import type { CommandGraph, ContextualStyle, Host } from '@loomcli/core';

import { loggingFiles, resolveLoggingFiles } from '../logging/extension.js';
import type { Reading } from './backend.js';
import { logFileRow, managerLogRow } from './messages.js';
import type { ServiceDetail, ServiceState, ServiceStatus } from './types.js';

/** The spaces between the longest row name and every row's value. */
const gutter = 2;

/** The rows' indent under the first line. */
const indent = '  ';

/** A logging fact with no files leaves console capture to the manager. */
const emptyFiles = 0;

/** Where status read the state: the label, the unit's path, and whether a file is there. */
interface Subject {
  readonly label: string;
  readonly unit: string;
  readonly installed: boolean;
}

/** The state status reports, its members in the order the type lists them. */
function stateOf({ label, unit, installed }: Subject, reading: Reading): ServiceState {
  return {
    label,
    unit,
    installed,
    running: reading.running,
    state: reading.state,
    ...(reading.pid === undefined ? {} : { pid: reading.pid }),
    notes: reading.notes,
  };
}

/** The result status sends: the state, the probe's rows, and any log files or console capture. */
function statusOf(
  state: ServiceState,
  details: readonly ServiceDetail[],
  logs?: ServiceStatus['logs'],
): ServiceStatus {
  return { ...state, details, ...(logs === undefined ? {} : { logs }) };
}

/** Resolves the logging plugin's files for the status host, without creating them. */
function logsOf(graph: CommandGraph, host: Host): ServiceStatus['logs'] {
  const facts = readExtension(graph.root, loggingFiles);
  if (facts === undefined) {
    return undefined;
  }
  if (facts.files.length === emptyFiles) {
    return { kind: 'manager', capture: host.platform === 'linux' ? 'journald' : 'none' };
  }
  const resolved = resolveLoggingFiles(facts, { application: graph.name, host });
  return {
    kind: 'files',
    files: resolved.files.map((file) => {
      // The service checks require an absolute home and a supported platform before resolution.
      if ('error' in file) {
        throw file.error;
      }
      return { path: file.path, exists: existsSync(file.path) };
    }),
  };
}

/** The summary after the label: running with its pid, running, or the state word. */
function summaryOf(status: ServiceStatus): string {
  if (!status.running) {
    return status.state;
  }
  return status.pid === undefined ? 'running' : `running (pid ${status.pid})`;
}

/**
 * The text view: `<label>: <summary>`, then the unit's path, each log, each detail, and each note as
 * two-space-indented rows, the names padded to the longest name plus two spaces. Manager words and
 * paths are escaped, and file paths are kept whole for line breaking; the probe's names and
 * values are printed as the author gives them.
 */
function statusText(status: Readonly<ServiceStatus>, style: ContextualStyle): string {
  const quoted = (text: string) => style.escape(escapeControlCharacters(text));
  const rows: (readonly [string, string])[] = [
    ['unit', nowrap(quoted(status.unit))],
    ...logRows(status.logs, style),
    ...status.details.map(({ name, value }): readonly [string, string] => [name, value]),
    ...status.notes.map((note): readonly [string, string] => ['note', quoted(note)]),
  ];
  const width = Math.max(...rows.map(([name]) => name.length)) + gutter;
  const lines = rows.map(([name, value]) => `${indent}${name.padEnd(width)}${value}`);
  return `${[`${quoted(status.label)}: ${quoted(summaryOf(status))}`, ...lines].join('\n')}\n`;
}

/** Each file gets a row; a file-free installation names the manager's capture instead. */
function logRows(
  logs: ServiceStatus['logs'],
  style: ContextualStyle,
): (readonly [string, string])[] {
  if (logs === undefined) {
    return [];
  }
  if (logs.kind === 'manager') {
    return [['log', style.escape(managerLogRow(logs.capture))]];
  }
  return logs.files.map((file) => [
    'log',
    nowrap(style.escape(logFileRow(file.path, file.exists))),
  ]);
}

export { logsOf, stateOf, statusOf, statusText };
