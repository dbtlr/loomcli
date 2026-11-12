import { askEditor } from './editor.js';
import { resolveLink } from './link.js';
import { askList } from './list.js';
import { askText } from './question.js';
import type {
  Answer,
  ChoiceEntry,
  ChoiceValue,
  ChoiceAnswer,
  MultiselectSettings,
  ConfirmSettings,
  LinkKey,
  PromptContext,
  SecretSettings,
  SelectSettings,
  TextSettings,
  EditorSettings,
} from './types.js';

function linkedIdentity(settings: {
  argument?: string;
  option?: string;
}): { argument: string } | { option: string } | {} {
  if (settings.argument !== undefined) {
    return { argument: settings.argument };
  }
  return settings.option === undefined ? {} : { option: settings.option };
}

/**
 * The prefill a typed question starts with: the raw supplied value of its linked input, then the
 * question's own default, then the input's declared default. Text and editor questions share it.
 */
function typedPrefill<Options, Args>(
  context: PromptContext<Options, Args>,
  settings: { argument?: string; option?: string; default?: string },
  declared: unknown,
): string | undefined {
  const raw =
    settings.argument === undefined
      ? context.supplied.options[settings.option ?? '']
      : context.supplied.args[settings.argument];
  if (typeof raw === 'string') {
    return raw;
  }
  return settings.default ?? (typeof declared === 'string' ? declared : undefined);
}

/** @public */
function text<
  Options,
  const Key extends LinkKey<Options> = never,
  Output = string,
  Args = unknown,
  const Argument extends LinkKey<Args> = never,
>(
  context: PromptContext<Options, Args>,
  settings: TextSettings<Key, Output, Argument>,
): Promise<Answer<Args, Argument, Answer<Options, Key, Output>>>;
async function text<
  Options,
  Key extends LinkKey<Options>,
  Output,
  Args,
  Argument extends LinkKey<Args>,
>(
  context: PromptContext<Options, Args>,
  settings: TextSettings<Key, Output, Argument>,
): Promise<Args[Argument] | Options[Key] | Output | string> {
  context.signal.throwIfAborted();
  const resolved = resolveLink(context, settings, 'text');
  if (resolved.kind === 'answered') {
    return resolved.value;
  }
  const hint = typedPrefill(context, settings, resolved.prefill);
  return askText(context, {
    hint,
    kind: 'text',
    message: settings.message,
    ...linkedIdentity(settings),
    ...(settings.validate ? { validate: settings.validate } : {}),
  });
}

/** @public */
function editor<
  Options,
  const Key extends LinkKey<Options> = never,
  Output = string,
  Args = unknown,
  const Argument extends LinkKey<Args> = never,
>(
  context: PromptContext<Options, Args>,
  settings: EditorSettings<Key, Output, Argument>,
): Promise<Answer<Args, Argument, Answer<Options, Key, Output>>>;
async function editor<
  Options,
  Key extends LinkKey<Options>,
  Output,
  Args,
  Argument extends LinkKey<Args>,
>(
  context: PromptContext<Options, Args>,
  settings: EditorSettings<Key, Output, Argument>,
): Promise<Args[Argument] | Options[Key] | Output | string> {
  context.signal.throwIfAborted();
  const resolved = resolveLink(context, settings, 'text');
  if (resolved.kind === 'answered') {
    return resolved.value;
  }
  const hint = typedPrefill(context, settings, resolved.prefill);
  return askEditor(context, {
    hint,
    ...(settings.extension === undefined ? {} : { extension: settings.extension }),
    message: settings.message,
    ...linkedIdentity(settings),
    ...(settings.validate ? { validate: settings.validate } : {}),
  });
}

/** @public */
function secret<
  Options,
  const Key extends LinkKey<Options> = never,
  Output = string,
  Args = unknown,
  const Argument extends LinkKey<Args> = never,
>(
  context: PromptContext<Options, Args>,
  settings: SecretSettings<Key, Output, Argument>,
): Promise<Answer<Args, Argument, Answer<Options, Key, Output>>>;
async function secret<
  Options,
  Key extends LinkKey<Options>,
  Output,
  Args,
  Argument extends LinkKey<Args>,
>(
  context: PromptContext<Options, Args>,
  settings: SecretSettings<Key, Output, Argument>,
): Promise<Args[Argument] | Options[Key] | Output | string> {
  context.signal.throwIfAborted();
  const resolved = resolveLink(context, settings, 'secret');
  if (resolved.kind === 'answered') {
    return resolved.value;
  }
  return askText(context, {
    hint: undefined,
    kind: 'secret',
    message: settings.message,
    ...linkedIdentity(settings),
    ...(settings.validate ? { validate: settings.validate } : {}),
  });
}

/** @public */
function confirm<Options, const Key extends LinkKey<Options> = never>(
  context: PromptContext<Options>,
  settings: ConfirmSettings<Key>,
): Promise<Answer<Options, Key, boolean>>;
async function confirm<Options, Key extends LinkKey<Options>>(
  context: PromptContext<Options>,
  settings: ConfirmSettings<Key>,
): Promise<Options[Key] | boolean | string> {
  context.signal.throwIfAborted();
  const resolved = resolveLink(context, settings, 'confirm');
  if (resolved.kind === 'answered') {
    return resolved.value;
  }
  const raw = context.supplied.options[settings.option ?? ''];
  const prefill = typeof raw === 'boolean' ? raw : settings.default;
  return askText(context, {
    hint: confirmDefault(prefill),
    kind: 'confirm',
    message: settings.message,
    validate: {
      '~standard': {
        validate: (value) => {
          if (typeof value === 'string') {
            if (/^(?:y|yes)$/iu.test(value)) {
              return { value: true };
            }
            if (/^(?:n|no)$/iu.test(value)) {
              return { value: false };
            }
          }
          return { issues: [{ message: 'Type y or n.' }] };
        },
        vendor: '@loomcli/prompts',
        version: 1,
      },
    },
  });
}

/** @public */
function select<
  Options,
  const Entry extends ChoiceEntry = ChoiceEntry,
  const Key extends LinkKey<Options> = never,
  Args = unknown,
  const Argument extends LinkKey<Args> = never,
>(
  context: PromptContext<Options, Args>,
  settings: SelectSettings<Key, Entry, Argument>,
): Promise<ChoiceAnswer<Options, Key, Args, Argument, ChoiceValue<Entry>>>;
async function select<
  Options,
  Entry extends ChoiceEntry,
  Key extends LinkKey<Options>,
  Args,
  Argument extends LinkKey<Args>,
>(
  context: PromptContext<Options, Args>,
  settings: SelectSettings<Key, Entry, Argument>,
): Promise<unknown> {
  context.signal.throwIfAborted();
  return askList(context, settings, false);
}
/** @public */
function multiselect<
  Options,
  const Entry extends ChoiceEntry = ChoiceEntry,
  const Key extends LinkKey<Options> = never,
  Args = unknown,
  const Argument extends LinkKey<Args> = never,
>(
  context: PromptContext<Options, Args>,
  settings: MultiselectSettings<Key, Entry, Argument>,
): Promise<ChoiceAnswer<Options, Key, Args, Argument, ChoiceValue<Entry>[]>>;
async function multiselect<
  Options,
  Entry extends ChoiceEntry,
  Key extends LinkKey<Options>,
  Args,
  Argument extends LinkKey<Args>,
>(
  context: PromptContext<Options, Args>,
  settings: MultiselectSettings<Key, Entry, Argument>,
): Promise<unknown> {
  context.signal.throwIfAborted();
  return askList(context, settings, true);
}

function confirmDefault(value: boolean | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value ? 'yes' : 'no';
}

export { InteractionUnavailableError } from './link.js';
export { progress, progressStyle } from './progress.js';
export type {
  Progress,
  ProgressContext,
  ProgressSettings,
  ProgressStyleSettings,
  ProgressUpdate,
  Spinner,
  TrackMessages,
} from './progress.js';
export type {
  Answer,
  ConfirmSettings,
  LinkKey,
  PromptContext,
  SecretSettings,
  SelectSettings,
  TextSettings,
  EditorSettings,
} from './types.js';

export type {
  Choice,
  ChoiceObject,
  ChoiceEntry,
  ChoiceValue,
  ChoiceSource,
  ChoiceAnswer,
  Separator,
  MultiselectSettings,
} from './types.js';
export { EditorError } from './editor.js';
export { editor, confirm, secret, select, multiselect, text };
