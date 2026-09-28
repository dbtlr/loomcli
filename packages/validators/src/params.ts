import type { StandardSchemaV1 } from '@loomcli/core';

import { vendor } from './create.js';
import { isPlainObject } from './data.js';
import type { PathKind } from './probe.js';

/** A check on one parameter that also tells the compiler its type. */
type Guard<Value> = (value: unknown) => value is Value;

/** The parameters of a code whose sentence has no blank. */
type NoParams = Readonly<Record<string, never>>;

/**
 * A Standard Schema for one fixed parameter shape, built without a schema library. It accepts a
 * plain object with exactly `keys`, which `read` turns into the typed parameters, and outputs a
 * frozen copy, so an issue's parameters cannot be changed by a reader.
 */
function paramsSchema<Params extends object>(
  shape: string,
  keys: readonly string[],
  read: (record: Readonly<Record<string, unknown>>) => Params | undefined,
): StandardSchemaV1<Params> {
  const refusal = (): StandardSchemaV1.FailureResult => ({
    issues: [{ message: `Expected the parameters ${shape}.` }],
  });
  return Object.freeze({
    '~standard': Object.freeze({
      validate: (value: unknown): StandardSchemaV1.Result<Params> => {
        if (!isPlainObject(value)) {
          return refusal();
        }
        const exact =
          Object.keys(value).length === keys.length &&
          keys.every((key) => Object.hasOwn(value, key));
        const params = exact ? read(value) : undefined;
        if (params === undefined) {
          return refusal();
        }
        Object.freeze(params);
        return { value: params };
      },
      vendor,
      version: 1,
    }),
  });
}

const none = 0;

const isCount: Guard<number> = (value): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= none;

const isSafeInteger: Guard<number> = (value): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

const isFiniteNumber: Guard<number> = (value): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isKind: Guard<PathKind> = (value): value is PathKind =>
  value === 'file' || value === 'directory' || value === 'any';

/** A nonempty list of strings, copied and frozen, or undefined for anything else. */
function stringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items: readonly unknown[] = value;
  return items.length > none && items.every((item): item is string => typeof item === 'string')
    ? Object.freeze([...items])
    : undefined;
}

const noParams = paramsSchema('{}', [], (): NoParams => ({}));

function minParams(accepts: Guard<number>) {
  return paramsSchema('{ min: number }', ['min'], ({ min }) =>
    accepts(min) ? { min } : undefined,
  );
}

function maxParams(accepts: Guard<number>) {
  return paramsSchema('{ max: number }', ['max'], ({ max }) =>
    accepts(max) ? { max } : undefined,
  );
}

function rangeParams(accepts: Guard<number>) {
  return paramsSchema('{ min: number; max: number }', ['max', 'min'], ({ max, min }) =>
    accepts(max) && accepts(min) ? { max, min } : undefined,
  );
}

const lengthParams = paramsSchema('{ length: number }', ['length'], ({ length }) =>
  isCount(length) ? { length } : undefined,
);

const messageParams = paramsSchema('{ message: string }', ['message'], ({ message }) =>
  typeof message === 'string' && message !== '' ? { message } : undefined,
);

const valuesParams = paramsSchema('{ values: readonly string[] }', ['values'], (record) => {
  const values = stringList(record.values);
  return values === undefined ? undefined : { values };
});

const protocolsParams = paramsSchema(
  '{ protocols: readonly string[] }',
  ['protocols'],
  (record) => {
    const protocols = stringList(record.protocols);
    return protocols === undefined ? undefined : { protocols };
  },
);

const kindParams = paramsSchema("{ kind: 'file' | 'directory' | 'any' }", ['kind'], ({ kind }) =>
  isKind(kind) ? { kind } : undefined,
);

export {
  isCount,
  isFiniteNumber,
  isSafeInteger,
  kindParams,
  lengthParams,
  maxParams,
  messageParams,
  minParams,
  noParams,
  protocolsParams,
  rangeParams,
  valuesParams,
};
export type { NoParams };
