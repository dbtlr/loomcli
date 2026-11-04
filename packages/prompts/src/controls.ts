/** The terminal controls a question writes, each defined once. */
const hideCursor = '\u001b[?25l';
const showCursor = '\u001b[?25h';
const pasteOn = '\u001b[?2004h';
const pasteOff = '\u001b[?2004l';

/** The bare view the controls draw through with `out.draw`, which nothing overrides. */
const controls = { render: (text: string) => text };

export { controls, hideCursor, pasteOff, pasteOn, showCursor };
