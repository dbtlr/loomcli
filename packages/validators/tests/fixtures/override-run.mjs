import { Application, InputError, issuePath, override } from '@loomcli/core';
import { integer, integerRangeIssue, oneOf } from '@loomcli/validators';

/**
 * One run of an application whose `InputError` view rewords the catalog's `integer-range`
 * sentence and keeps every other issue's sentence, as the validators reference shows.
 */
const app = new Application('serve', {
  views: [
    override(InputError, {
      render: (failure, { hints, style }) =>
        [
          ...failure.problems
            .flatMap((problem) =>
              problem.reason === 'missing'
                ? [`${problem.spelling} is required. Supply a value.`]
                : problem.issues.map((issue) => {
                    const at = issuePath(issue);
                    const subject =
                      at === undefined ? problem.spelling : `${problem.spelling} at ${at}`;
                    const range = integerRangeIssue.read(issue);
                    return range === undefined
                      ? `${subject}: ${issue.message}`
                      : `${subject} takes from ${String(range.min)} to ${String(range.max)} workers.`;
                  }),
            )
            .map((line) => `serve: ${style.escape(line)}`),
          ...hints,
        ]
          .map((line) => `${line}\n`)
          .join(''),
    }),
  ],
})
  .option('workers', { type: 'string', validate: integer({ max: 64, min: 1 }) })
  .option('mode', { type: 'string', validate: oneOf(['dev', 'prod']) })
  .action(({ options, out }) => out.print(`served ${String(options.workers)}`));

process.exitCode = await app.run({ host: { argv: process.argv.slice(2) } });
