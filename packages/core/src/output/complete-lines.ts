/**
 * Every completed line of resolved text, each with its line break, and the text after the last
 * one. It finds line breaks with `indexOf`, so one call reads its text once, where a global
 * pattern that backtracks from every start position reads a text with no line break in square time.
 */
export function completeLines(text: string): { lines: string[]; tail: string } {
  const lines: string[] = [];
  let start = 0;
  for (let end = text.indexOf('\n'); end !== -1; end = text.indexOf('\n', start)) {
    lines.push(text.slice(start, end + 1));
    start = end + 1;
  }
  return { lines, tail: text.slice(start) };
}
