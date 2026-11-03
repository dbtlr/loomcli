/** Grapheme boundaries are the unit of both editing and drawing. */
function graphemes(text: string): string[] {
  return Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
    ({ segment }) => segment,
  );
}

/** A single editable line, with a cursor that never bisects a grapheme. */
class TypedLine {
  value = '';
  cursor = 0;

  edit(kind: string, inserted = ''): void {
    const parts = graphemes(this.value);
    const count = parts.length;
    let start = this.cursor;
    let end = this.cursor;
    const word = (index: number) => /^[\p{L}\p{N}]/u.test(parts[index] ?? '');
    const whitespace = (index: number) => /^\p{White_Space}/u.test(parts[index] ?? '');
    const before = (space: boolean) => {
      let index = this.cursor;
      while (index > 0 && (space ? whitespace(index - 1) : !word(index - 1))) {
        index -= 1;
      }
      while (index > 0 && (space ? !whitespace(index - 1) : word(index - 1))) {
        index -= 1;
      }
      return index;
    };
    switch (kind) {
      case 'left': {
        this.cursor = Math.max(0, this.cursor - 1);
        return;
      }
      case 'right': {
        this.cursor = Math.min(count, this.cursor + 1);
        return;
      }
      case 'home': {
        this.cursor = 0;
        return;
      }
      case 'end': {
        this.cursor = count;
        return;
      }
      case 'wordLeft': {
        this.cursor = before(false);
        return;
      }
      case 'wordRight': {
        while (this.cursor < count && !word(this.cursor)) {
          this.cursor += 1;
        }
        while (this.cursor < count && word(this.cursor)) {
          this.cursor += 1;
        }
        return;
      }
      case 'backspace': {
        start = Math.max(0, start - 1);
        break;
      }
      case 'delete':
      case 'eof': {
        end = Math.min(count, end + 1);
        break;
      }
      case 'killWhitespace': {
        start = before(true);
        break;
      }
      case 'killWord': {
        start = before(false);
        break;
      }
      case 'killStart': {
        start = 0;
        break;
      }
      case 'killEnd': {
        end = count;
        break;
      }
      case 'text':
      case 'paste': {
        break;
      }
      default: {
        return;
      }
    }
    const prefix = parts.slice(0, start).join('') + inserted;
    this.value = prefix + parts.slice(end).join('');
    let offset = 0;
    this.cursor = 0;
    for (const part of graphemes(this.value)) {
      if (offset >= prefix.length) {
        break;
      }
      offset += part.length;
      this.cursor += 1;
    }
  }
}

export { graphemes, TypedLine };
