import { logging } from '@loomcli/plugins/logging';

logging({ destinations: [{ file: 'a.jsonl', level: 'debug' }, { to: 'console' }] });
logging({ file: 'a.jsonl', level: 'debug' });

// @ts-expect-error A list has no shared level.
logging({ destinations: [{ file: 'a.jsonl' }], level: 'debug' });
// @ts-expect-error A list cannot also name a file.
logging({ destinations: [{ file: 'a.jsonl' }], file: 'old.jsonl' });
// @ts-expect-error A list cannot also choose a destination kind.
logging({ destinations: [], to: 'console' });
// @ts-expect-error A list has no shared rotation size.
logging({ destinations: [], maxBytes: 100 });
// @ts-expect-error A list has no shared rotation count.
logging({ destinations: [], keep: 1 });
// @ts-expect-error A list has no shared error callback.
logging({ destinations: [], onError: () => undefined });

// A settings object built first is held to the same rule.
const mixed = { destinations: [{ file: 'wanted.jsonl' }], file: 'ignored.jsonl' };
// @ts-expect-error A list cannot also name a file, through a variable too.
logging(mixed);
