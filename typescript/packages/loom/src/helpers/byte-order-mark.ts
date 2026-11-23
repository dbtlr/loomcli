// A leading U+FEFF marks the encoding and is not content.
export function withoutByteOrderMark(source: string) {
  return source.startsWith('﻿') ? source.slice(1) : source;
}
