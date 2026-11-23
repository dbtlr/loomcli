import type { StandardSchemaV1 } from '@loomcli/core';

import { isRecord } from '../plain-data.js';

/**
 * The `$schema` pointer a configuration file may hold: the URL of the file's hosted JSON Schema,
 * which an editor reads. The schema the plugin publishes lists it, and the plugin removes it from
 * the file before it validates, so it is never a setting.
 */
const pointerKey = '$schema';

/** A reference into the schema's own definitions. */
const definitionPrefix = '#/$defs/';

/** The pointer's own shape in the published schema. */
const pointerShape = Object.freeze({ type: 'string' });

/**
 * A Standard JSON Schema converter as the plugin passes it on. Its answers stay `unknown`, because
 * core judges each one: anything but a plain object is a converter fault.
 */
interface Converter {
  readonly input: (options: unknown) => unknown;
  readonly output: (options: unknown) => unknown;
}

/** The converter a schema's standard properties declare, or `undefined` when they declare none. */
function converterOf(standard: object): Converter | undefined {
  if (!('jsonSchema' in standard)) {
    return undefined;
  }
  const converter: unknown = standard.jsonSchema;
  if (
    !isRecord(converter) ||
    typeof converter.input !== 'function' ||
    typeof converter.output !== 'function'
  ) {
    return undefined;
  }
  const { input, output } = converter;
  return {
    input: (options) => withPointer(Reflect.apply(input, converter, [options])),
    output: (options) => Reflect.apply(output, converter, [options]),
  };
}

/**
 * A published JSON Schema with the pointer listed among the properties of its top-level object, as
 * a copy: the object the library returned is never changed. A top level that is a `$ref` into its
 * own `$defs` lists it in the definition it names. A top level that describes an object with no
 * `properties`, such as a record, gains `properties` with the pointer alone. A property the author
 * already declared for the pointer is kept. Any other answer, a union or an `allOf` included, is
 * passed on as it is, and so is a value that is not an object, which core then judges.
 */
function withPointer(published: unknown): unknown {
  if (!isRecord(published)) {
    return published;
  }
  const reference = published.$ref;
  const defs = published.$defs;
  const name = typeof reference === 'string' ? reference.slice(definitionPrefix.length) : '';
  if (
    typeof reference === 'string' &&
    reference.startsWith(definitionPrefix) &&
    isRecord(defs) &&
    Object.hasOwn(defs, name)
  ) {
    return { ...published, $defs: { ...defs, [name]: listing(defs[name]) } };
  }
  return listing(published);
}

/** One object schema with the pointer among its `properties`, or the schema as it is otherwise. */
function listing(schema: unknown): unknown {
  if (!isRecord(schema) || !describesObject(schema)) {
    return schema;
  }
  const properties = isRecord(schema.properties) ? schema.properties : {};
  return Object.hasOwn(properties, pointerKey)
    ? schema
    : { ...schema, properties: { ...properties, [pointerKey]: pointerShape } };
}

/** Whether a schema describes an object: its `type` is `object`, or it lists `properties`. */
function describesObject(schema: Record<string, unknown>): boolean {
  return schema.type === 'object' || isRecord(schema.properties);
}

/**
 * The schema the plugin hands core's source slot: the author's, whose published shape also lists
 * the `$schema` pointer. Core reads its standard properties inside its own converter guard, so the
 * author's properties are read there, when core asks, and never at the `configuration()` call.
 */
function pointerListingSchema(schema: StandardSchemaV1): StandardSchemaV1 {
  return {
    get '~standard'() {
      const standard = schema['~standard'];
      const converter = converterOf(standard);
      if (converter === undefined) {
        return standard;
      }
      const converting = { ...standard, jsonSchema: converter };
      return converting;
    },
  };
}

/** The file's object with a top-level `$schema` pointer removed, or the object itself without one. */
function withoutPointer(object: Record<string, unknown>): Record<string, unknown> {
  if (!Object.hasOwn(object, pointerKey)) {
    return object;
  }
  return Object.fromEntries(Object.entries(object).filter(([key]) => key !== pointerKey));
}

export { pointerListingSchema, withoutPointer };
