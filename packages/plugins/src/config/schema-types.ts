import type { StandardSchemaV1 } from '@loomcli/core';

/**
 * The types that decide which schemas `configuration()` takes: one whose input accepts an empty
 * file. They read the schema's input type alone, so they hold alike for zod, valibot, and ArkType.
 */

type Input<Schema extends StandardSchemaV1> = StandardSchemaV1.InferInput<Schema>;

/** The keys a type declares, without its index signatures. */
type DeclaredKeys<Value> = {
  [
    Key in keyof Value as string extends Key
      ? never
      : number extends Key
        ? never
        : symbol extends Key
          ? never
          : Key
  ]: Value[Key];
};

/** `true` when every declared key of every object reachable through declared keys is optional; array items and index-signature values are not entered. */
type KeysOptional<Value> = Value extends readonly unknown[]
  ? true
  : Value extends object
    ? {} extends DeclaredKeys<Value>
      ? false extends {
          [Key in keyof DeclaredKeys<Value>]-?: KeysOptional<
            Exclude<DeclaredKeys<Value>[Key], undefined>
          >;
        }[keyof DeclaredKeys<Value>]
        ? false
        : true
      : false
    : true;

type EveryKeyOptional<Schema extends StandardSchemaV1> =
  {} extends Input<Schema> ? KeysOptional<Input<Schema>> : false;

/** The type error's own words: tsc names this interface and its one key. */
interface ConfigurationSchemaMustAcceptAnEmptyFile {
  readonly 'Make every key optional outside an array item or a record value': never;
}

/** `unknown` when the schema's input accepts an empty file, and `ConfigurationSchemaMustAcceptAnEmptyFile` otherwise. */
type EmptyFileGuard<Schema extends StandardSchemaV1> =
  EveryKeyOptional<Schema> extends true ? unknown : ConfigurationSchemaMustAcceptAnEmptyFile;

export type { ConfigurationSchemaMustAcceptAnEmptyFile, EmptyFileGuard };
