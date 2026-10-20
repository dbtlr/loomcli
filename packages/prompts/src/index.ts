import { resolveLink } from './link.js';
import { askSelect, askText } from './question.js';
import { checkSettings } from './settings.js';
import type {
  Answer,
  ConfirmSettings,
  LinkKey,
  PromptContext,
  SecretSettings,
  SelectSettings,
  TextSettings,
} from './types.js';

function text<Options, const Key extends LinkKey<Options> = never, Output = string>(
  context: PromptContext<Options>,
  settings: TextSettings<Key, Output>,
): Promise<Answer<Options, Key, Output>>;
async function text<Options, Key extends LinkKey<Options>, Output>(
  context: PromptContext<Options>,
  settings: TextSettings<Key, Output>,
): Promise<Options[Key] | Output | string> {
  context.signal.throwIfAborted();
  checkSettings(settings, 'text');
  const resolved = resolveLink(context, settings, 'text');
  if (resolved.kind === 'answered') {
    return resolved.value;
  }
  const raw = context.supplied.options[settings.option ?? ''];
  const hint =
    typeof raw === 'string'
      ? raw
      : (settings.default ?? (typeof resolved.prefill === 'string' ? resolved.prefill : undefined));
  return askText(context, {
    hint,
    kind: 'text',
    message: settings.message,
    ...(settings.option === undefined ? {} : { option: settings.option }),
    ...(settings.validate ? { validate: settings.validate } : {}),
  });
}

function secret<Options, const Key extends LinkKey<Options> = never, Output = string>(
  context: PromptContext<Options>,
  settings: SecretSettings<Key, Output>,
): Promise<Answer<Options, Key, Output>>;
async function secret<Options, Key extends LinkKey<Options>, Output>(
  context: PromptContext<Options>,
  settings: SecretSettings<Key, Output>,
): Promise<Options[Key] | Output | string> {
  context.signal.throwIfAborted();
  checkSettings(settings, 'secret');
  const resolved = resolveLink(context, settings, 'secret');
  if (resolved.kind === 'answered') {
    return resolved.value;
  }
  return askText(context, {
    hint: undefined,
    kind: 'secret',
    message: settings.message,
    ...(settings.option === undefined ? {} : { option: settings.option }),
    ...(settings.validate ? { validate: settings.validate } : {}),
  });
}

function confirm<Options, const Key extends LinkKey<Options> = never>(
  context: PromptContext<Options>,
  settings: ConfirmSettings<Key>,
): Promise<Answer<Options, Key, boolean>>;
async function confirm<Options, Key extends LinkKey<Options>>(
  context: PromptContext<Options>,
  settings: ConfirmSettings<Key>,
): Promise<Options[Key] | boolean | string> {
  context.signal.throwIfAborted();
  checkSettings(settings, 'confirm');
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

function select<Options, const Choice extends string, const Key extends LinkKey<Options> = never>(
  context: PromptContext<Options>,
  settings: SelectSettings<Key, Choice>,
): Promise<Answer<Options, Key, Choice>>;
async function select<Options, Choice extends string, Key extends LinkKey<Options>>(
  context: PromptContext<Options>,
  settings: SelectSettings<Key, Choice>,
): Promise<Options[Key] | Choice> {
  context.signal.throwIfAborted();
  checkSettings(settings, 'select');
  const resolved = resolveLink(context, settings, 'select');
  if (resolved.kind === 'answered') {
    return resolved.value;
  }
  const raw = context.supplied.options[settings.option ?? ''];
  const prefill = raw ?? settings.default ?? resolved.prefill;
  return askSelect(context, { choices: settings.choices, message: settings.message, prefill });
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
  SecretSettings,
  SelectSettings,
  TextSettings,
} from './types.js';

export { confirm, secret, select, text };
