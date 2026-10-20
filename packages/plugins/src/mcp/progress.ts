import type { ProgressUpdate } from '@loom/mcp';
import type { ProgressEvent } from '@loomcli/core';

/**
 * The counts an event's message carries: `completed/total` with a total, `completed` alone without
 * one, and none for an event with no `completed`.
 */
function countsOf({ completed, total }: ProgressEvent): string {
  if (completed === undefined) {
    return '';
  }
  return total === undefined ? String(completed) : `${String(completed)}/${String(total)}`;
}

/**
 * The message one progress event sends: its label when it is not empty, its counts, and its state
 * in parentheses, joined by single spaces, such as `Fetching packages 3/8 (updated)`.
 */
function progressMessage(event: ProgressEvent): string {
  return [event.label, countsOf(event), `(${event.state})`].filter((part) => part !== '').join(' ');
}

/** Each event a call delivers counts once toward its `progress`. */
const eachEvent = 1;

/**
 * The observer one tool call passes to `invoke`, which sends each progress event of the call as one
 * notification. `progress` counts the events the call has delivered, this one included, so every
 * event is sent and `progress` always increases, and no `total` is sent: the counts travel in the
 * message.
 */
function progressRelay(send: (update: ProgressUpdate) => void): (event: ProgressEvent) => void {
  let delivered = 0;
  return (event) => {
    delivered += eachEvent;
    send({ message: progressMessage(event), progress: delivered });
  };
}

export { progressMessage, progressRelay };
