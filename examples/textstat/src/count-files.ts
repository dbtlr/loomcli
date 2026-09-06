import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { ActionHandler, Out } from '@loom/core';

import type { textstat } from './application.js';

function selectMetric(raw: string | undefined, out: Out) {
  const metric = raw ?? 'bytes';
  if (metric === 'bytes' || metric === 'words' || metric === 'lines') {
    return metric;
  }
  return out.fatal(`Unsupported metric "${metric}". Use bytes, words, or lines.`);
}

function countContent(bytes: Buffer, metric: 'bytes' | 'words' | 'lines') {
  switch (metric) {
    case 'bytes': {
      return bytes.byteLength;
    }
    case 'words': {
      return [...bytes.toString('utf8').matchAll(/\S+/gu)].length;
    }
    case 'lines': {
      return [...bytes.toString('utf8').matchAll(/\n/gu)].length;
    }
    default: {
      const exhaustive: never = metric;
      return exhaustive;
    }
  }
}

export const countFiles: ActionHandler<typeof textstat> = async ({ args, options, host, out }) => {
  const metric = selectMetric(options.metric, out);
  let total = 0;
  for (const file of args.files) {
    const bytes = await readFile(resolve(host.cwd, file)).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : 'The file could not be read.';
      return out.fatal(`Cannot read file: ${file}: ${reason}`);
    });
    const count = countContent(bytes, metric);
    total += count;
    await out.print(`${count}\t${file}`);
  }
  if (options.total) {
    await out.print(`${total}\ttotal`);
  }
};
