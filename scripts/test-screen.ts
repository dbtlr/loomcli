import xterm from '@xterm/headless';

/**
 * One thing that reached a terminal, in order: bytes a stream wrote to it, or a resize the
 * terminal took between writes.
 */
export type ScreenEvent = { readonly write: string } | { readonly resize: number };

/** What a headless terminal emulator shows once it has taken every event. */
export interface Screen {
  /** Every row the emulator holds, scrollback first, each trimmed on the right, with trailing blank rows dropped. */
  readonly lines: readonly string[];
  /** The cursor's column and its row counted from the first row of `lines`. */
  readonly cursor: { readonly column: number; readonly row: number };
}

/**
 * Feeds the events to a headless terminal emulator of the given size and reads its screen back, so
 * a test asserts what an operator sees rather than the bytes that drew it. A resize reflows the
 * rows the emulator holds, as a terminal emulator does.
 */
export async function replay(
  events: readonly ScreenEvent[],
  size: { readonly columns: number; readonly rows?: number },
): Promise<Screen> {
  const rows = size.rows ?? 24;
  const terminal = new xterm.Terminal({
    allowProposedApi: true,
    cols: size.columns,
    // A terminal's line discipline turns each line feed into a carriage return and a line feed.
    convertEol: true,
    // A reflowing terminal rewraps the cursor's own row on a resize, as it rewraps every other.
    reflowCursorLine: true,
    rows,
    scrollback: 1000,
  });
  try {
    for (const event of events) {
      if ('resize' in event) {
        terminal.resize(event.resize, rows);
      } else {
        await new Promise<void>((resolve) => {
          terminal.write(event.write, resolve);
        });
      }
    }
    const buffer = terminal.buffer.active;
    const lines: string[] = [];
    for (let index = 0; index < buffer.length; index += 1) {
      lines.push((buffer.getLine(index)?.translateToString(true) ?? '').trimEnd());
    }
    const cursor = { column: buffer.cursorX, row: buffer.baseY + buffer.cursorY };
    let last = lines.length;
    while (last > 0 && lines[last - 1] === '') {
      last -= 1;
    }
    return { cursor, lines: lines.slice(0, last) };
  } finally {
    terminal.dispose();
  }
}
