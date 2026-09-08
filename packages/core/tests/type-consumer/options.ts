import { Application } from '@loomcli/core';
import type { BooleanOption, OptionConfig, StringOption } from '@loomcli/core';

const metric = { short: 'm', shortOnly: true, type: 'string' } satisfies StringOption;
const total = { polarity: 'both', short: 't', type: 'boolean' } satisfies BooleanOption;
const color = { polarity: 'negative', type: 'boolean' } satisfies OptionConfig;

// @ts-expect-error TS2322: Short aliases contain exactly one ASCII letter.
new Application('invalid-short').option('metric', { short: 'mm', type: 'string' });

new Application('options')
  .option('metric', metric)
  .argument('files', { required: true, variadic: true })
  .option('total', total)
  .option('color', color)
  .action(({ args, options, passthrough }) => {
    const files: string[] = args.files;
    const selectedMetric: string | undefined = options.metric;
    const selectedTotal: boolean = options.total;
    const selectedColor: boolean = options.color;
    const tail: string[] = passthrough;
    // @ts-expect-error TS2322: An absent string option is undefined.
    const requiredMetric: string = options.metric;
    // @ts-expect-error TS2322: A Boolean option never produces a string.
    const stringTotal: string = options.total;
    // @ts-expect-error TS2339: Short aliases are not handler keys.
    options.m;
    // @ts-expect-error TS7053: Negative spellings are not handler keys.
    options['no-color'];
    // @ts-expect-error TS2339: Options do not enter args.
    args.metric;
    // @ts-expect-error TS2339: Arguments do not enter options.
    options.files;
    return {
      files,
      requiredMetric,
      selectedColor,
      selectedMetric,
      selectedTotal,
      stringTotal,
      tail,
    };
  });

new Application('independent').action(({ options, passthrough }) => {
  const tail: string[] = passthrough;
  // @ts-expect-error TS2339: Options from another application cannot leak here.
  options.metric;
  return tail;
});

// @ts-expect-error TS2345: Short-only declarations require a short alias.
new Application('missing-short').option('metric', { shortOnly: true, type: 'string' });
// @ts-expect-error TS2345: Strings cannot have Boolean polarity.
new Application('string-polarity').option('metric', { polarity: 'negative', type: 'string' });
// @ts-expect-error TS2345: Both polarities require long forms.
new Application('both-short-only').option('total', {
  polarity: 'both',
  short: 't',
  shortOnly: true,
  type: 'boolean',
});
// @ts-expect-error TS2322: Only the declared Boolean polarities are supported.
new Application('invalid-polarity').option('total', { polarity: 'unknown', type: 'boolean' });
