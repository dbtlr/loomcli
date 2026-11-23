import type { LoomError } from '../failures/errors.js';
import type { ArgumentConfig, OptionConfig } from '../inputs/types.js';
import type { OptionsOf, Plugin } from '../plugins/plugin.js';
import type { InvocationOutcome, InvocationValues, InvokeOptions } from './types.js';

/**
 * Phantom key. On a Command it carries the Command's entry keyed by its canonical name, the record
 * its parent's `command()` joins to the parent's children; on an Application it carries the root's
 * entry with every global option. It holds no runtime value.
 */
declare const commandPaths: unique symbol;

/**
 * The type-level entry of one Command in an Application's Command paths: the value an invocation by
 * name may supply for each of its arguments and local options, by declared name, its children's
 * entries, by canonical name, and, at the root, the value each global option takes. `invoke` reads
 * it to type a literal path's values.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/invocation.md#typed-paths
 * @public
 * @sealed
 */
interface CommandPaths<Args = {}, Options = {}, Commands = {}, Globals = {}> {
  /** The value each argument takes, by argument name. */
  readonly args: Args;
  /** The value each local option takes, by declared name. */
  readonly options: Options;
  /** Each child's entry, by canonical name. */
  readonly commands: Commands;
  /** The value each global option takes, by declared name, which the root's entry alone holds. */
  readonly globals: Globals;
}

/**
 * The value an invocation by name supplies for one argument: one token, a string or a number
 * `String` writes, or on a variadic argument one token or a list of them.
 */
type NamedArgumentValue<Config extends ArgumentConfig> = Config extends { variadic: true }
  ? string | number | readonly (string | number)[]
  : string | number;

/**
 * The value an invocation by name supplies for one option, as `invoke` lowers it: a Boolean on a
 * Boolean option, a count on a counted one, words on an arity option, `true` for the bare spelling
 * of an option with an implied value, and otherwise one token, or a list of them on a multiple
 * option. A tuple's length is checked when the call runs.
 */
type NamedOptionValue<Config extends OptionConfig> = Config extends { type: 'boolean' }
  ? boolean
  : Config extends { type: 'count' }
    ? number
    : Config extends { arity: number }
      ? Config extends { multiple: true }
        ? readonly (string | number)[] | readonly (readonly (string | number)[])[]
        : readonly (string | number)[]
      : | (Config extends { multiple: true }
            ? string | number | readonly (string | number)[]
            : string | number)
        | (Config extends { implied: unknown } ? true : never);

/** An entry with one more argument. */
type WithArgument<Paths, Name extends string, Config extends ArgumentConfig> =
  Paths extends CommandPaths<infer Args, infer Options, infer Commands, infer Globals>
    ? CommandPaths<
        Args & Readonly<Record<Name, NamedArgumentValue<Config>>>,
        Options,
        Commands,
        Globals
      >
    : Paths;

/** An entry with one more local option. */
type WithOption<Paths, Name extends string, Config extends OptionConfig> =
  Paths extends CommandPaths<infer Args, infer Options, infer Commands, infer Globals>
    ? CommandPaths<
        Args,
        Options & Readonly<Record<Name, NamedOptionValue<Config>>>,
        Commands,
        Globals
      >
    : Paths;

/** An entry with each option of a set as one more local option. */
type WithOptions<Paths, Configs extends Readonly<Record<string, OptionConfig>>> =
  Paths extends CommandPaths<infer Args, infer Options, infer Commands, infer Globals>
    ? CommandPaths<
        Args,
        Options & {
          readonly [Name in Extract<keyof Configs, string>]: NamedOptionValue<Configs[Name]>;
        },
        Commands,
        Globals
      >
    : Paths;

/** An entry with one more global option, which the root's entry alone holds. */
type WithGlobal<Paths, Name extends string, Config extends OptionConfig> =
  Paths extends CommandPaths<infer Args, infer Options, infer Commands, infer Globals>
    ? CommandPaths<
        Args,
        Options,
        Commands,
        Globals & Readonly<Record<Name, NamedOptionValue<Config>>>
      >
    : Paths;

/**
 * An entry with one more child, the record the child carries under its canonical name. A child
 * whose name is the wide `string` carries an index signature, so a path through that level reads
 * dynamically.
 */
type WithChild<Paths, Child> = Child extends { readonly [commandPaths]: infer Entry }
  ? Paths extends CommandPaths<infer Args, infer Options, infer Commands, infer Globals>
    ? CommandPaths<Args, Options, Commands & Entry, Globals>
    : Paths
  : Paths;

/**
 * The value each of one plugin tuple's options takes, as `InstalledOptionValues` reads the plugins:
 * a plugin typed as the wide `Plugin` states no option names, so it names none here either.
 */
type InstalledNamedOptionValues<Plugins extends readonly Plugin[]> = Plugins extends readonly [
  infer First extends Plugin,
  ...infer Rest extends readonly Plugin[],
]
  ? (string extends keyof OptionsOf<First>
      ? {}
      : {
          readonly [Name in keyof OptionsOf<First> & string]: NamedOptionValue<
            OptionsOf<First>[Name]
          >;
        }) &
      InstalledNamedOptionValues<Rest>
  : {};

/**
 * The root's entry an Application publishes: its global options, a plugin's included, join the
 * root's. A plugin may contribute Commands at the root, which no type names, so an Application that
 * installs any plugin reads a first name it does not declare dynamically.
 */
type ApplicationPaths<Paths, Plugins extends readonly Plugin[]> =
  Paths extends CommandPaths<infer Args, infer Options, infer Commands, infer Globals>
    ? CommandPaths<
        Args,
        Options,
        Plugins extends readonly [] ? Commands : Commands & Readonly<Record<string, unknown>>,
        Globals & InstalledNamedOptionValues<Plugins>
      >
    : unknown;

/**
 * The Command paths of an Application, which `Register.paths` takes, so an action's `invoke` types
 * a literal path's values in this compilation.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/invocation.md#typed-paths
 * @public
 * @sealed
 */
type PathsOf<Value extends { readonly [commandPaths]: unknown }> = Value[typeof commandPaths];

/** The deepest path `invoke` types, four names; a longer one reads dynamically. */
type DeepestPath = readonly [string, string, string, string];

/** The canonical names one level declares, without the index signature a wide name leaves. */
type DeclaredNames<Commands> = Extract<
  keyof { [Name in keyof Commands as string extends Name ? never : Name]: unknown },
  string
>;

/**
 * Where one path leads: the entry it names, `dynamic` when no type states what it names, or the
 * path a caller could have meant, with the first undeclared name replaced by the names its level
 * declares, or cut after the last Command when that one has no children.
 */
type Walk<
  Node,
  Path extends readonly string[],
  Walked extends readonly string[] = [],
> = Path extends readonly [infer Head extends string, ...infer Rest extends readonly string[]]
  ? Walked extends DeepestPath
    ? 'dynamic'
    : Node extends CommandPaths<unknown, unknown, infer Commands, unknown>
      ? Head extends DeclaredNames<Commands>
        ? Walk<Commands[Head], Rest, readonly [...Walked, Head]>
        : string extends keyof Commands
          ? 'dynamic'
          : {
              fault: [DeclaredNames<Commands>] extends [never]
                ? readonly [...Walked]
                : readonly [...Walked, DeclaredNames<Commands>, ...Rest];
            }
      : 'dynamic'
  : Node extends CommandPaths
    ? { entry: Node }
    : 'dynamic';

/** Whether a type is a union of more than one member: each member reads as less than the whole. */
type IsUnion<Type, Whole = Type> = Type extends unknown
  ? [Whole] extends [Type]
    ? false
    : true
  : never;

/**
 * A path no type fixes: an array, a tuple with an element typed as the wide `string`, or a union of
 * paths, such as a conditional's two literal paths, which no one Command's values type.
 */
type DynamicPath<Path extends readonly string[]> = number extends Path['length']
  ? true
  : string extends Path[number]
    ? true
    : IsUnion<Path>;

/**
 * The path parameter: the path itself, or, for a literal path that names an undeclared Command,
 * the path a caller could have meant, so the error names the expected names at the wrong element.
 */
type PathParameter<Paths, Path extends readonly string[]> =
  DynamicPath<Path> extends true
    ? Path
    : Walk<Paths, Path> extends { fault: infer Fault extends readonly string[] }
      ? NoInfer<Fault>
      : Path;

/**
 * The values of one set of inputs, each optional, and `Empty` where the set is empty: a record whose
 * one key says so, so an object literal's undeclared key is an excess property the error names. Each
 * value is read within what `InvocationValues` accepts there, so a typed call is one of its values.
 * Over a union, as a path element that names either of two Commands gives, it takes either
 * Command's values, even when the two declare no name in common, and a Command with no inputs adds
 * nothing to the union, so its empty record cannot absorb the other's.
 */
type NamedValues<Values, Accepted, Empty> = [KeyOfAny<Values>] extends [never]
  ? Empty
  : Values extends unknown
    ? [keyof Values] extends [never]
      ? never
      : { readonly [Name in keyof Values]?: Extract<Values[Name], Accepted> | undefined }
    : never;

/** Every key any member of a union holds. */
type KeyOfAny<Values> = Values extends unknown ? keyof Values : never;

/** What `InvocationValues` accepts for one argument. */
type ArgumentValue = NonNullable<InvocationValues['args']>[string];

/** What `InvocationValues` accepts for one option. */
type OptionValue = NonNullable<InvocationValues['options']>[string];

/**
 * The values one literal path takes: its Command's arguments and local options, and every global
 * option, each by declared name. A path no type fixes takes the dynamic `InvocationValues`.
 */
type PathValues<Paths, Path extends readonly string[]> =
  DynamicPath<Path> extends true
    ? InvocationValues
    : Walk<Paths, Path> extends { entry: CommandPaths }
      ? EntryValues<Paths, WalkedEntry<Walk<Paths, Path>>>
      : InvocationValues;

/**
 * The entry or entries a walk reached, read one member at a time, so a path element that names
 * either of two Commands keeps both entries rather than the one an inference from the union keeps.
 */
type WalkedEntry<Walked> = Walked extends { entry: infer Entry extends CommandPaths }
  ? Entry
  : never;

/** The values an entry, or either of several, takes, with every global option. */
interface EntryValues<Paths, Entry extends CommandPaths> {
  /** The value each argument takes, by declared name. */
  readonly args?: NamedValues<
    Entry['args'],
    ArgumentValue,
    { readonly 'The Command declares no arguments'?: never }
  >;
  /** The value of each local or global option, by declared name. */
  readonly options?: NamedValues<
    Entry['options'] & (Paths extends CommandPaths ? Paths['globals'] : {}),
    OptionValue,
    { readonly 'The Command and the Application declare no options'?: never }
  >;
  /**
   * The words a command line would give after the `--` separator. They reach a Command that
   * declares the passthrough mode as its `passthrough`, and are refused, when not empty, on a
   * Command without it.
   */
  readonly passthrough?: readonly string[];
}

/**
 * `invoke`'s signature over one Application's Command paths. A literal path the paths declare types
 * its values against that Command; any other path, an array of names, a union of paths, a path
 * deeper than four Commands, or one through a level no type states, takes the dynamic
 * `InvocationValues`. `Extra` is what one door adds to the options. An explicit `Mapped` leaves
 * `Path` at its default, so that call is dynamic too.
 *
 * @public
 * @sealed
 */
type Invoke<Paths, Extra = {}> = <
  Mapped = LoomError,
  const Path extends readonly string[] = readonly string[],
>(
  path: PathParameter<Paths, Path>,
  values: NoInfer<PathValues<Paths, Path>>,
  options?: InvokeOptions<Mapped> & Extra,
) => Promise<InvocationOutcome<Mapped>>;

export type {
  ApplicationPaths,
  NamedArgumentValue,
  commandPaths,
  CommandPaths,
  Invoke,
  NamedOptionValue,
  PathParameter,
  PathsOf,
  PathValues,
  WithArgument,
  WithChild,
  WithGlobal,
  WithOption,
  WithOptions,
};
