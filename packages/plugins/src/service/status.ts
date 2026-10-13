import type { ContextualStyle } from '@loomcli/core';

import type { Reading } from './backend.js';
import { shown } from './messages.js';
import type { ServiceDetail, ServiceState, ServiceStatus } from './types.js';

/** The spaces between the longest row name and every row's value. */
const gutter = 2;

/** The rows' indent under the first line. */
const indent = '  ';

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

/** The result status sends: the state, then the probe's rows. */
function statusOf(state: ServiceState, details: readonly ServiceDetail[]): ServiceStatus {
  return { ...state, details };
}

/** The summary after the label: running with its pid, running, or the state word. */
function summaryOf(status: ServiceStatus): string {
  if (!status.running) {
    return status.state;
  }
  return status.pid === undefined ? 'running' : `running (pid ${status.pid})`;
}

/**
 * The text view: `<label>: <summary>`, then the unit's path, each detail, and each note as
 * two-space-indented rows, the names padded to the longest name plus two spaces. Manager words and
 * paths are escaped; the probe's names and values are printed as the author gives them.
 */
function statusText(status: Readonly<ServiceStatus>, style: ContextualStyle): string {
  const quoted = (text: string) => style.escape(shown(text));
  const rows: (readonly [string, string])[] = [
    ['unit', quoted(status.unit)],
    ...status.details.map(({ name, value }): readonly [string, string] => [name, value]),
    ...status.notes.map((note): readonly [string, string] => ['note', quoted(note)]),
  ];
  const width = Math.max(...rows.map(([name]) => name.length)) + gutter;
  const lines = rows.map(([name, value]) => `${indent}${name.padEnd(width)}${value}`);
  return `${[`${quoted(status.label)}: ${quoted(summaryOf(status))}`, ...lines].join('\n')}\n`;
}

export { stateOf, statusOf, statusText };
