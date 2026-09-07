import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import type { ActionOptions } from '@loom/core';

import type { textstat } from './application.js';

type Metric = ActionOptions<typeof textstat>['metric'];

const NEWLINE = /\n/gu;
/** Whitespace separates words, so the text between two runs of it is one word. */
const SPACES = /\s+/u;
/** A trailing space closes the last word, so the final run is counted once at the end. */
const FLUSH = ' ';

/** The counts one pass produces: the byte size the threshold reads, and the selected metric. */
export interface SourceCounts {
  bytes: number;
  metric: number;
}

/**
 * One incremental pass over a source, so a file and stdin count alike and neither is held in
 * memory. Bytes sum the chunks as they arrive and never decode. The text metrics decode with a
 * carried decoder and carry the unfinished word, so a character or a word that a chunk boundary
 * splits is counted once.
 */
export async function countSource(stream: Readable, metric: Metric): Promise<SourceCounts> {
  const decoder = new StringDecoder('utf8');
  let bytes = 0;
  let counted = 0;
  let pending = '';
  const readText = (text: string) => {
    if (metric === 'lines') {
      counted += [...text.matchAll(NEWLINE)].length;
      return;
    }
    const parts = `${pending}${text}`.split(SPACES);
    pending = parts.pop() ?? '';
    counted += parts.filter((part) => part !== '').length;
  };
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      bytes += buffer.byteLength;
      if (metric !== 'bytes') {
        readText(decoder.write(buffer));
      }
    });
    stream.once('end', resolve);
    stream.once('error', reject);
  });
  if (metric !== 'bytes') {
    readText(`${decoder.end()}${FLUSH}`);
  }
  return { bytes, metric: metric === 'bytes' ? bytes : counted };
}
