import { resolveTimeZone } from '@loomcli/core';

/** Calls shared by both transports, including an omitted input that takes its declared default. */
const timeZoneCalls: readonly {
  zone?: unknown;
  arguments?: Record<string, string>;
  output?: string;
  error?: string;
}[] = [
  { output: 'UTC 2026-09-25T14:30:00.000Z\n' },
  {
    arguments: { at: '2026-09-25T14:30:00' },
    output: 'Asia/Tokyo 2026-09-25T05:30:00.000Z\n',
    zone: 'Asia/Tokyo',
  },
  { output: 'Asia/Tokyo 2026-09-25T05:30:00.000Z\n', zone: 'Asia/Tokyo' },
  {
    output: `${String(resolveTimeZone('US/Eastern'))} 2026-09-25T18:30:00.000Z\n`,
    zone: 'US/Eastern',
  },
  { zone: 'Mars/Olympus' },
  {
    arguments: { extra: 'unused' },
    error: 'Tool "stamp" takes no argument "extra". Use a property its input schema lists.',
    zone: 'Mars/Olympus',
  },
  { zone: '+09:00' },
  { zone: `${String.fromCodePoint(8722)}09:00` },
  { zone: null },
  { zone: false },
  { output: 'UTC 2026-09-25T14:30:00.000Z\n' },
];

const timeZoneKey = 'io.github.dbtlr.loomcli/timeZone';

const invalidTimeZone =
  'Metadata key "io.github.dbtlr.loomcli/timeZone" requires an IANA time zone name this runtime knows. Use a name such as "Asia/Tokyo".';

export { invalidTimeZone, timeZoneCalls, timeZoneKey };
