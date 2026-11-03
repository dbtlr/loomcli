import type { StandardSchemaV1 } from '@standard-schema/spec';

import type { Host } from '../host/types.js';
import type { ExtensionValue } from '../plugins/extension.js';
import type { Content } from './content.js';

type LowercaseLetter =
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'n'
  | 'o'
  | 'p'
  | 'q'
  | 'r'
  | 's'
  | 't'
  | 'u'
  | 'v'
  | 'w'
  | 'x'
  | 'y'
  | 'z';

type ShortAlias = LowercaseLetter | Uppercase<LowercaseLetter>;

/**
 * The spellings an option declares beyond its long form. `aliases` adds a long spelling for each
 * name, so `shortOnly`, which removes every long spelling, never declares one.
 */
type OptionSpelling =
  | { short?: ShortAlias; shortOnly?: false; aliases?: readonly string[] }
  | { short: ShortAlias; shortOnly: true; aliases?: never };

type Presence = { required: true; default?: never } | { required?: false; default?: unknown };

/**
 * The literal member keeps `multiple: true` exact under contextual typing, as `Presence` does.
 * A multiple option takes its list from the configuration source, or binds a variable beside the
 * delimiter that splits the variable's value into the list. Every other option shape, and the
 * member of `ListBinding` that binds no variable, declares `envDelimiter?: never`, so the types
 * reject it on an option that is not multiple or binds no variable.
 */
type Multiplicity = ListBinding | ({ multiple?: false } & StringBinding);

/** A multiple option's binding: no variable, or a variable and the delimiter that splits it. */
type ListBinding =
  | { multiple: true; env?: never; envDelimiter?: never; envAllowEmpty?: never }
  | {
      multiple: true;
      env: string | readonly [string, ...string[]];
      /** The non-empty string that separates the items of the variable's value. */
      envDelimiter: string;
      envAllowEmpty?: never;
    };

/**
 * A scalar string option's binding: the plain binding, or a variable an empty value may supply.
 * Only the member that requires `env` declares `envAllowEmpty`, so the types reject the key on an
 * option that binds no variable, while a binding whose `env` may be absent still fits the plain one.
 */
type StringBinding =
  | EnvBinding
  | {
      env: string | readonly [string, ...string[]];
      envDelimiter?: never;
      /** `true` lets the first defined name supply the option, its value empty or not. */
      envAllowEmpty?: boolean;
    };

/**
 * The environment binding: the variable, or the non-empty list of variables, the input-source
 * stage fills the option from when argv supplies none. The first name holding a value supplies it.
 * The declaration names each explicitly, and core derives no name.
 */
interface EnvBinding {
  env?: string | readonly [string, ...string[]];
  /** Only a multiple option declares a delimiter, under `ListBinding`. */
  envDelimiter?: never;
  /** Only a scalar string option's binding declares it, under `StringBinding`. */
  envAllowEmpty?: never;
}

/**
 * `validateOmitted: true` sends an omitted optional scalar to its own schema. The literal member
 * keeps the flag exact under contextual typing, as `Multiplicity` does.
 */
type Omission = { validateOmitted: true } | { validateOmitted?: false };

/**
 * The presence rules a global option never declares, because its validation runs on every Command.
 * `GlobalOptionConfig` and `GlobalOmissionConstraint` both read the rule from here.
 */
type PresenceRuleKey = 'required' | 'validateOmitted';

/** The fault each presence rule names when a global option declares it. */
interface PresenceRuleFaults {
  required: {
    'A global option declares no required; the Commands that read it check for it': never;
  };
  validateOmitted: {
    'A global option declares no validateOmitted; its omission is plain absence': never;
  };
}

/** The first presence rule a config declares, in the order the faults name them. */
type DeclaredPresenceRule<Config> = {
  [Key in PresenceRuleKey]: [Extract<Config, Record<Key, unknown>>] extends [never] ? never : Key;
}[PresenceRuleKey];

/**
 * The one-line summary every projection reads. It is a core fact: optional, and a string that holds
 * a character other than whitespace and no line terminator.
 */
interface Described {
  description?: string;
}

/**
 * The two core facts a listing reads on a named Command and on an option.
 * `hidden` keeps the member off every listing, and an omitted one reads `false`.
 * `deprecated` is the one-line migration message a listing shows beside the member.
 * Neither belongs to an argument, which cannot leave the grammar it sits in, or to the root.
 */
interface Listed {
  hidden?: boolean;
  deprecated?: string;
}

/** Every key any member of a union declares. */
type KeysOf<Type> = Type extends unknown ? keyof Type : never;

/**
 * The core fact that marks an option as controlling the invocation rather than feeding the
 * Command's work, such as `--help` or `--format`. An omitted mark reads `false`. Core never reads
 * it at run time; a projection that lists what a Command needs does.
 */
interface Controlled {
  control?: boolean;
}

/** The extension values one option declaration carries, whatever scope declares the option. */
interface OptionExtensions {
  extensions?: readonly ExtensionValue<'option'>[];
}

/** What every Boolean option declares, whichever of its three shapes it takes. */
type BooleanFacts = Described &
  Listed &
  Controlled &
  OptionExtensions & {
    type: 'boolean';
    interaction?: true;
    verbose?: never;
    quiet?: never;
    background?: never;
    validate?: never;
    default?: never;
    multiple?: never;
    required?: never;
    validateOmitted?: never;
    implied?: never;
  };

/**
 * A value-taking option carries no run-wide mark but the background mark, which the marked string
 * shape declares: the interaction and color marks belong to one Boolean global option each, and
 * the verbose and quiet marks to one counted global option each. A local option's declaration
 * carries none of them either.
 */
interface Unmarked {
  interaction?: never;
  color?: never;
  verbose?: never;
  quiet?: never;
  background?: never;
}

/** The same slot on an argument declaration, typed by the target its values must name. */
interface ArgumentExtensions {
  extensions?: readonly ExtensionValue<'argument'>[];
}

/**
 * The tokens one declaration collects before validation: one string, or several. A multiple option
 * and a variadic argument collect alike, so they share this raw shape.
 */
type RawValue<Config> = Config extends { multiple: true } | { variadic: true } ? string[] : string;

/** A multiple option and a variadic argument pass each value through the same validator. */
type PerValue<Config, Value> = Config extends { multiple: true } | { variadic: true }
  ? Value[]
  : Value;

/** The validated value: the validator's output for each value, or the raw shape without one. */
type SchemaOutput<Config, Schema, Raw> = Schema extends StandardSchemaV1
  ? PerValue<Config, StandardSchemaV1.InferOutput<Schema>>
  : Raw;

type SchemaInput<Schema> = Schema extends StandardSchemaV1
  ? StandardSchemaV1.InferInput<Schema>
  : string;

/** The value a default stands in for: the validator's input for each value, or the raw tokens. */
type DefaultInput<Config> = 'validate' extends keyof Config
  ? PerValue<Config, SchemaInput<Config['validate']>>
  : RawValue<Config>;

/**
 * The defaults a config accepts: its default input, or a readonly list of it. A list a conditional
 * declaration writes inline infers as a readonly tuple, and core copies a declared list for each
 * run, so the action still receives its own array.
 */
type AcceptedDefault<Config> =
  | DefaultInput<Config>
  | (DefaultInput<Config> extends unknown[] ? Readonly<DefaultInput<Config>> : never);

/**
 * The members of a config whose declared default is outside their own accepted defaults. A
 * default a config spreads in conditionally is optional, and is checked the same way. An
 * `unknown` default, which the wide `OptionConfig` declares, states nothing to check.
 */
type DefaultFault<Config> = Config extends { default: infer Default }
  ? [Default] extends [AcceptedDefault<Config>]
    ? never
    : Config
  : 'default' extends keyof Config
    ? unknown extends Config['default']
      ? never
      : Config extends { default?: AcceptedDefault<Config> }
        ? never
        : Config
    : never;

/**
 * Each member paired with its own default input. A member whose default misses that input
 * reduces to `never`, so another member's validator input never stands in for it.
 */
type PairedDefault<Config> = Config extends unknown
  ? Config & { default?: DefaultInput<Config> }
  : never;

interface ContentInput {
  type: 'content';
  stdin?: boolean;
  required?: boolean;
  default?: never;
  validate?: never;
  validateOmitted?: never;
}

/** The declaration one schema call validates, under the name and the scope it was declared in. */
export interface InputIdentity {
  kind: 'argument' | 'option' | 'stdin';
  name: string;
  global: boolean;
}

/**
 * The raw tokens of one invocation, keyed by declared name, before any schema or default runs.
 * Each schema call reads its own snapshot, so a collected value is read-only and writing to one
 * changes nothing the parser, a later schema, or the action reads.
 */
export interface SuppliedInputs {
  /** Raw positional values of the routed Command: one string, or the tokens of a variadic. */
  args: Readonly<Record<string, string | readonly string[] | undefined>>;
  /**
   * Raw option values, globals and locals: a string, every occurrence, a Boolean presence, or the
   * number of times a counted option was supplied.
   */
  options: Readonly<Record<string, string | readonly string[] | boolean | number | undefined>>;
}

/**
 * What core knows when it calls one schema. A default validates before any token is read, so its
 * phase carries the host and the declaration alone. An invocation call adds the routed path, the
 * passthrough tail, and the tokens every declared input received. A question carries the same run
 * facts and identifies its link, or its own title when unlinked.
 */
export type ValidationContext =
  | { phase: 'default'; host: Host; input: InputIdentity }
  | {
      phase: 'invocation';
      host: Host;
      input: InputIdentity;
      command: readonly string[];
      passthrough: readonly string[];
      supplied: SuppliedInputs;
    }
  | {
      phase: 'question';
      host: Host;
      input: InputIdentity | { kind: 'question'; name: string; global: false };
      command: readonly string[];
      passthrough: readonly string[];
      supplied: SuppliedInputs;
    };

export type StringOption = UnmarkedStringOption | BackgroundOption;

/** A string option that carries no run-wide mark. */
export type UnmarkedStringOption = OptionSpelling &
  (
    | (Presence & Multiplicity & Omission)
    | ({
        required: 'non-interactive';
        default?: never;
        multiple?: false;
        validateOmitted?: never;
      } & StringBinding)
  ) &
  Described &
  Listed &
  Controlled &
  OptionExtensions &
  Unmarked & {
    type: 'string';
    polarity?: never;
    validate?: StandardSchemaV1;
    /** The value a bare spelling supplies, so an explicit value is attached to the spelling. */
    implied?: string;
  };

/**
 * The string global option that carries the background mark, whose value the run reads from argv
 * beside the color choice. argv is its one source, so it declares no short alias, variable,
 * default, implied value, or list.
 */
export type BackgroundOption = Described &
  Listed &
  Controlled &
  OptionExtensions & {
    type: 'string';
    background: true;
    aliases?: readonly string[];
    validate?: StandardSchemaV1;
    short?: never;
    shortOnly?: never;
    env?: never;
    envDelimiter?: never;
    envAllowEmpty?: never;
    default?: never;
    implied?: never;
    multiple?: false;
    required?: never;
    validateOmitted?: never;
    polarity?: never;
    interaction?: never;
    color?: never;
    verbose?: never;
    quiet?: never;
  };

/** A variadic argument collects the remaining tokens, so it follows the multiple option rules. */
export type VariadicArgument = Presence &
  Described &
  ArgumentExtensions & { type?: 'string'; variadic: true; validate?: StandardSchemaV1 };

export type ScalarArgument = Presence &
  Omission &
  Described &
  ArgumentExtensions & { type?: 'string'; variadic?: false; validate?: StandardSchemaV1 };

export type ContentArgument = ContentInput &
  Described &
  ArgumentExtensions &
  ({ variadic: true; min?: number; max?: number } | { variadic?: false; min?: never; max?: never });

export type ContentOption = ContentInput &
  OptionSpelling &
  Described &
  Listed &
  Controlled &
  OptionExtensions &
  Unmarked & {
    polarity?: never;
    implied?: never;
  } & (
    | (ListBinding & { min?: number; max?: number })
    | ({ multiple?: false; min?: never; max?: never } & EnvBinding)
  );

export interface StdinConfig {
  description?: string;
  required?: boolean;
}

export type ArgumentConfig = VariadicArgument | ScalarArgument | ContentArgument;

export type ValidatedValue<Config, Raw> = Config extends { type: 'content' }
  ? PerValue<Config, Content>
  : Config extends unknown
    ? 'validate' extends keyof Config
      ? SchemaOutput<Config, Config['validate'], Raw>
      : Raw
    : never;

/**
 * Each member of a conditional declaration checks its default against its own validator input
 * type. Only a config with a failing member is paired, because the pairing intersects a union
 * config with a copy of itself, which multiplies it by its own members: a config whose type
 * parameters are erased to the wide `OptionConfig` declares no default and is never paired.
 */
export type DefaultConstraint<Config> = [DefaultFault<Config>] extends [never]
  ? unknown
  : PairedDefault<Config>;

/**
 * An argument's config names only the keys `ArgumentConfig` declares, because core reads no other.
 * TypeScript runs no excess-key check on a config a type parameter infers, so this constraint
 * rejects each other key. The key names the fault, the way the other declaration constraints do,
 * because an intersection with `never` properties would reduce the whole config and report every
 * key.
 */
export type ArgumentKeyConstraint<Config> = [
  Exclude<KeysOf<Config>, KeysOf<ArgumentConfig>>,
] extends [never]
  ? unknown
  : {
      [
        Key in Exclude<
          KeysOf<Config>,
          KeysOf<ArgumentConfig>
        > as `An argument declares no ${Key & string} key`
      ]: never;
    };

/**
 * An implied value is the string an operator would otherwise attach, so it must be a string the
 * validator's input type accepts, as a default must be. A multiple option's validator reads one
 * value, so the implied value meets that one value's input type. A validator that declares no types
 * infers `never`, so it states nothing to check against. The key names the fault, the way the
 * other declaration constraints do, because an intersection with the literal would reduce the whole
 * config to `never` and report every key.
 */
export type ImpliedConstraint<Config> = Config extends { implied: infer Implied }
  ? 'validate' extends keyof Config
    ? [SchemaInput<Config['validate']>] extends [never]
      ? unknown
      : Implied extends SchemaInput<Config['validate']>
        ? unknown
        : { 'An implied value must be in the validator input type': Config['validate'] }
    : unknown
  : unknown;

/**
 * A multiple option or a variadic argument passes each value to its validator alone, so the
 * declared validator must accept one `string`. The key names the fault, the way the other
 * declaration constraints do.
 */
export type PerValueConstraint<Config> = Config extends { multiple: true } | { variadic: true }
  ? 'validate' extends keyof Config
    ? // A validator that declares no types infers `never`, so it states nothing to reject.
      [SchemaInput<Config['validate']>] extends [never]
      ? unknown
      : string extends SchemaInput<Config['validate']>
        ? unknown
        : { 'A validator of several values must accept one string input': Config['validate'] }
    : unknown
  : unknown;

/**
 * The declaration rules `validateOmitted: true` needs: a schema that accepts `undefined`, an
 * omission the schema can answer, and no other rule that already decides absence. Each key names
 * its fault, the way the other declaration constraints do.
 */
export type ValidateOmittedConstraint<Config> = Config extends { validateOmitted: true }
  ? Config extends { type: 'boolean' }
    ? { 'A Boolean option declares no validateOmitted': never }
    : Config extends { required: true }
      ? { 'A required input rejects validateOmitted': never }
      : Config extends { default: unknown }
        ? { 'A declared default rejects validateOmitted': never }
        : Config extends { multiple: true } | { variadic: true }
          ? { 'An input of several values receives no values as an empty array': never }
          : 'validate' extends keyof Config
            ? undefined extends SchemaInput<Config['validate']>
              ? unknown
              : { 'A validateOmitted validator must accept an undefined input': Config['validate'] }
            : { 'validateOmitted needs a validator to receive the omission': never }
  : unknown;

/**
 * A global option declares no presence rule, so its omission is always plain absence. A union
 * config fails when any member declares the key, and a wide `OptionConfig` passes, because its
 * members only allow the key. `required` is named first when a config declares both.
 */
export type GlobalOmissionConstraint<Config> = [Extract<Config, { type: 'content' }>] extends [
  never,
]
  ? [DeclaredPresenceRule<Config>] extends [never]
    ? unknown
    : PresenceRuleFaults['required' extends DeclaredPresenceRule<Config>
        ? 'required'
        : 'validateOmitted']
  : { 'A content input is local to its Command': never };

export type ArgumentValue<Config extends ArgumentConfig> = Config extends { variadic: true }
  ? ValidatedValue<Config, string[]>
  :
      | ValidatedValue<Config, string>
      | (Config extends { required: true } | { default: unknown } | { validateOmitted: true }
          ? never
          : undefined);

/**
 * A Boolean option: one polarity with any spelling, both polarities with long forms, or the color
 * mark, which the run reads from argv before short groups and binds no variable, so it declares
 * no short alias and no `env`.
 */
export type BooleanOption =
  | (OptionSpelling &
      BooleanFacts &
      EnvBinding & {
        color?: never;
        polarity?: 'positive' | 'negative';
      })
  | (BooleanFacts &
      EnvBinding & {
        color?: never;
        polarity: 'both';
        short?: ShortAlias;
        shortOnly?: false;
        aliases?: readonly string[];
      })
  | (BooleanFacts & {
      color: true;
      polarity?: 'positive' | 'negative' | 'both';
      short?: never;
      shortOnly?: never;
      aliases?: readonly string[];
      env?: never;
      envAllowEmpty?: never;
    });

/**
 * A counted option takes no value and reads how many times it was supplied, across every spelling,
 * so it declares no validator, default, presence rule, collection, polarity, or implied value. It
 * may carry the verbose mark or the quiet mark, never both, and a marked option binds no variable,
 * because the run settles its verbosity before it reads the environment.
 */
export type CountOption = OptionSpelling &
  Described &
  Listed &
  Controlled &
  OptionExtensions & {
    type: 'count';
    interaction?: never;
    color?: never;
    background?: never;
    validate?: never;
    default?: never;
    multiple?: never;
    required?: never;
    validateOmitted?: never;
    polarity?: never;
    implied?: never;
  } & (
    | ({ verbose?: never; quiet?: never } & EnvBinding)
    | { verbose: true; quiet?: never; env?: never; envAllowEmpty?: never }
    | { quiet: true; verbose?: never; env?: never; envAllowEmpty?: never }
  );

export type OptionConfig = StringOption | BooleanOption | CountOption | ContentOption;

/**
 * The configuration of a global option a plugin declares: everything `option()` takes except the
 * presence rules, which a global option never declares, because its validation runs on every
 * Command. `globalOption()` states the same rule through `GlobalOmissionConstraint`, which also
 * accepts a config typed as the wide `OptionConfig`.
 */
export type GlobalOptionConfig = Exclude<OptionConfig, ContentOption> &
  Readonly<Partial<Record<PresenceRuleKey, never>>>;

export type OptionValue<Config extends OptionConfig> = Config extends StringOption | ContentOption
  ? Config extends { multiple: true }
    ? ValidatedValue<Config, string[]>
    :
        | ValidatedValue<Config, string>
        | (Config extends { required: true } | { default: unknown } | { validateOmitted: true }
            ? never
            : undefined)
  : Config extends CountOption
    ? number
    : boolean;

export type { Unmarked };
