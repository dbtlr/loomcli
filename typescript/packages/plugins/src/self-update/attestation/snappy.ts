/*
 * A decoder of Snappy's block format, the encoding GitHub serves an attestation bundle in. It reads
 * only that format, not Snappy's framing format, and takes no dependency. It reads the declared
 * length first and refuses one above the bound before it allocates, and it refuses an element that
 * would write past that length or copy from before the start of what it has written.
 */

/** The largest uncompressed length a bundle may declare: 1 MiB, where a bundle is a few kilobytes. */
const maximumLength = 1_048_576;

/** The bits of a varint byte that carry its value, the bit that says another byte follows, and the radix. */
const varintValue = 0x7f;
const varintMore = 0x80;
const varintRadix = 128;

/** A varint longer than this cannot fit a length the bound allows. */
const varintBytes = 5;

/** The low two bits of an element's tag byte name its kind. */
const kindMask = 0b11;
const literal = 0b00;
const copyOneByte = 0b01;
const copyTwoBytes = 0b10;

/** A literal tag's upper six bits hold its length less one, or 60 to 63 for 1 to 4 length bytes. */
const tagShift = 2;
const inlineLiteral = 60;

/** A one-byte-offset copy: three bits of length less four and three high bits of the offset. */
const shortCopyLength = 0b111;
const shortCopyBase = 4;
const shortOffsetShift = 5;

/** The bits in one byte, and the radix the little-endian lengths and offsets step by. */
const byteBits = 8;
const byteRadix = 256;

/** A two- or four-byte-offset copy: six bits of length less one. */
const longCopyLength = 0b11_1111;

/** The bytes after the tag of each copy kind. */
const twoOffsetBytes = 2;
const fourOffsetBytes = 4;

/** A literal's or a long copy's stored length is one less than the bytes it writes. */
const lengthBias = 1;

/** A reader takes one byte at a time, starting at the input's first. */
const oneByte = 1;
const first = 0;

/** The value of no bytes, where a little-endian sum starts and an offset that repeats nothing. */
const empty = 0;

/** The index `findIndex` answers when no byte matches. */
const notFound = -1;

/** Where a decoder is: the input, the next byte to read, and the output so far. */
interface Cursor {
  readonly input: Uint8Array;
  at: number;
  readonly output: Uint8Array;
  written: number;
}

/** The `count` bytes at the cursor, which it then moves past, or `undefined` past the end. */
function take(cursor: Cursor, count: number): Uint8Array | undefined {
  const end = cursor.at + count;
  if (end > cursor.input.length) {
    return undefined;
  }
  const bytes = cursor.input.subarray(cursor.at, end);
  cursor.at = end;
  return bytes;
}

/** The little-endian unsigned number in the `count` bytes at the cursor, or `undefined` past the end. */
function littleEndian(cursor: Cursor, count: number): number | undefined {
  return take(cursor, count)?.reduceRight((value, byte) => value * byteRadix + byte, empty);
}

/** The declared uncompressed length and where the elements start, or `undefined` for a bad varint. */
function declaredLength(input: Uint8Array): { length: number; start: number } | undefined {
  const header = input.subarray(first, varintBytes);
  const last = header.findIndex((byte) => (byte & varintMore) !== varintMore);
  if (last === notFound) {
    return undefined;
  }
  const start = last + oneByte;
  const length = header
    .subarray(first, start)
    .reduceRight((value, byte) => value * varintRadix + (byte & varintValue), empty);
  return { length, start };
}

/** Copies a literal of `length` bytes from the input, or says it would overrun either side. */
function copyLiteral(cursor: Cursor, length: number): boolean {
  if (cursor.written + length > cursor.output.length) {
    return false;
  }
  const bytes = take(cursor, length);
  if (bytes === undefined) {
    return false;
  }
  cursor.output.set(bytes, cursor.written);
  cursor.written += length;
  return true;
}

/**
 * Copies `length` bytes from `offset` back in the output, or says it would copy from before the
 * output's start or write past its end. It copies at most `offset` bytes at a time, so a copy that
 * overlaps what it writes repeats the bytes before it.
 */
function copyBack(cursor: Cursor, length: number, offset: number): boolean {
  const end = cursor.written + length;
  if (offset === empty || offset > cursor.written || end > cursor.output.length) {
    return false;
  }
  while (cursor.written < end) {
    const from = cursor.written - offset;
    const count = Math.min(offset, end - cursor.written);
    cursor.output.copyWithin(cursor.written, from, from + count);
    cursor.written += count;
  }
  return true;
}

/** Decodes one literal whose tag byte is `tag`. */
function decodeLiteral(cursor: Cursor, tag: number): boolean {
  const short = tag >> tagShift;
  const length =
    short < inlineLiteral ? short : littleEndian(cursor, short - inlineLiteral + oneByte);
  return length !== undefined && copyLiteral(cursor, length + lengthBias);
}

/** Decodes one copy whose tag byte is `tag`. */
function decodeCopy(cursor: Cursor, tag: number): boolean {
  const kind = tag & kindMask;
  if (kind === copyOneByte) {
    const low = littleEndian(cursor, oneByte);
    const length = ((tag >> tagShift) & shortCopyLength) + shortCopyBase;
    return (
      low !== undefined && copyBack(cursor, length, ((tag >> shortOffsetShift) << byteBits) + low)
    );
  }
  const offset = littleEndian(cursor, kind === copyTwoBytes ? twoOffsetBytes : fourOffsetBytes);
  const length = ((tag >> tagShift) & longCopyLength) + lengthBias;
  return offset !== undefined && copyBack(cursor, length, offset);
}

/** Decodes every element after the declared length, and says whether they fill it exactly. */
function decodeElements(cursor: Cursor): boolean {
  while (cursor.at < cursor.input.length) {
    const tag = cursor.input.at(cursor.at);
    cursor.at += oneByte;
    if (tag === undefined) {
      return false;
    }
    const decoded =
      (tag & kindMask) === literal ? decodeLiteral(cursor, tag) : decodeCopy(cursor, tag);
    if (!decoded) {
      return false;
    }
  }
  return cursor.written === cursor.output.length;
}

/**
 * The bytes a Snappy block decodes to, `'too-long'` for a declared length above 1 MiB, or
 * `undefined` for a block that does not decode whole to its declared length.
 */
function decodeSnappyBlock(input: Uint8Array): Uint8Array | 'too-long' | undefined {
  const declared = declaredLength(input);
  if (declared === undefined) {
    return undefined;
  }
  if (declared.length > maximumLength) {
    return 'too-long';
  }
  const output = new Uint8Array(declared.length);
  return decodeElements({ at: declared.start, input, output, written: empty }) ? output : undefined;
}

export { decodeSnappyBlock, maximumLength };
