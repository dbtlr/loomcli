import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import type { ActionOptions } from '@loomcli/core';

import type { textstat } from './application.js';

const NEWLINE = /\n/gu;
/** Whitespace separates words, so each whitespace character closes the word it was reading. */
const SPACE = /\s/u;

/** The metric one invocation counts. The declaration's schema is the one place it is named. */
export type Metric = ActionOptions<typeof textstat>['metric'];

/** The counts one pass produces: the byte size the threshold reads, and the selected metric. */
export interface SourceCounts {
  bytes: number;
  counted: number;
}

/**
 * One incremental pass over a source, so a file and stdin count alike and neither is held in
 * memory. Bytes sum the chunks as they arrive and never decode. The text metrics decode with a
 * carried decoder and carry one Boolean word state, so a character or a word that a chunk boundary
 * splits is counted once and no word text is retained.
 */
export async function countSource(stream: Readable, metric: Metric): Promise<SourceCounts> {
  const decoder = new StringDecoder('utf8');
  let bytes = 0;
  let counted = 0;
  let inWord = false;
  const readText = (text: string) => {
    if (metric === 'lines') {
      counted += [...text.matchAll(NEWLINE)].length;
      return;
    }
    // A word is counted where it starts, so the state alone carries a word across a boundary.
    for (const character of text) {
      if (SPACE.test(character)) {
        inWord = false;
      } else {
        if (!inWord) {
          counted++;
        }
        inWord = true;
      }
    }
  };
  await new Promise<void>((resolve, reject) => {
    let ended = false;
    stream.on('data', (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      bytes += buffer.byteLength;
      if (metric !== 'bytes') {
        readText(decoder.write(buffer));
      }
    });
    stream.once('end', () => {
      ended = true;
      resolve();
    });
    stream.once('error', reject);
    /**
     * A connection destroyed without an error emits "close" and no "end", so a read that waits
     * for "end" alone never finishes. The reason below is what the action reports instead.
     */
    stream.once('close', () => {
      if (!ended) {
        reject(new Error('The connection closed before the source ended.'));
      }
    });
  });
  if (metric !== 'bytes') {
    readText(decoder.end());
  }
  return { bytes, counted: metric === 'bytes' ? bytes : counted };
}
