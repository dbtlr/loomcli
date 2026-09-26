import { describe, expect, it, test } from 'vite-plus/test';

import { url } from '../src/index.js';
import {
  conforms,
  declarationFault,
  faultOf,
  published,
  rejectedWith,
  rejection,
  verdict,
} from './support.js';

const dialect = 'https://json-schema.org/draft/2020-12/schema';

describe('accepted tokens read as a parsed URL and satisfy the published schema', () => {
  const accepted: [string, ReturnType<typeof url>, string, string][] = [
    ['a host', url(), 'https://example.com', 'https://example.com/'],
    [
      'every component',
      url(),
      'http://user:pass@example.com:8080/path?q=1#frag',
      'http://user:pass@example.com:8080/path?q=1#frag',
    ],
    ['a mailto URI', url(), 'mailto:someone@example.com', 'mailto:someone@example.com'],
    ['a URN', url(), 'urn:isbn:0451450523', 'urn:isbn:0451450523'],
    ['an empty authority', url(), 'file:///etc/hosts', 'file:///etc/hosts'],
    ['an IPv6 host', url(), 'http://[::1]:3000/', 'http://[::1]:3000/'],
    ['an IPv4 host', url(), 'http://192.168.0.1/', 'http://192.168.0.1/'],
    ['an uppercase scheme and host', url(), 'HTTPS://EXAMPLE.COM', 'https://example.com/'],
    ['a percent-encoded path', url(), 'https://example.com/a%20b', 'https://example.com/a%20b'],
    ['a scheme with a plus', url(), 'svn+ssh://host/repo', 'svn+ssh://host/repo'],
    ['a scheme with a hyphen and a dot', url(), 'x-y.z:opaque', 'x-y.z:opaque'],
    [
      'a slash and a question mark in the query',
      url(),
      'http://example.com/?a=b/c?d',
      'http://example.com/?a=b/c?d',
    ],
    [
      'a listed scheme',
      url({ protocols: ['https'] }),
      'https://example.com',
      'https://example.com/',
    ],
    [
      'a listed scheme in another case',
      url({ protocols: ['https'] }),
      'HtTpS://example.com',
      'https://example.com/',
    ],
    [
      'a listed scheme declared in uppercase',
      url({ protocols: ['HTTPS'] }),
      'https://example.com',
      'https://example.com/',
    ],
    [
      'a listed scheme with a plus',
      url({ protocols: ['svn+ssh', 'git-lfs', 'a.b'] }),
      'SVN+SSH://host/repo',
      'svn+ssh://host/repo',
    ],
    [
      'a listed scheme with a hyphen',
      url({ protocols: ['svn+ssh', 'git-lfs', 'a.b'] }),
      'Git-Lfs://host/x',
      'git-lfs://host/x',
    ],
    [
      'a listed scheme with a dot',
      url({ protocols: ['svn+ssh', 'git-lfs', 'a.b'] }),
      'A.b:opaque',
      'a.b:opaque',
    ],
  ];

  it.each(accepted)('%s', async (_name, validator, token, href) => {
    const result = await verdict(validator, token);
    expect(result.issues).toBeUndefined();
    const value: unknown = result.issues === undefined ? result.value : undefined;
    expect(value).toBeInstanceOf(URL);
    expect(value).toHaveProperty('href', href);
    expect(conforms(validator, token)).toBe(true);
  });
});

describe('rejected tokens read the one sentence for the configuration', () => {
  const plain = 'Expected an absolute URL, such as https://example.com.';
  const rejected: [string, ReturnType<typeof url>, string, string][] = [
    ['no scheme', url(), 'example.org', plain],
    ['a relative path', url(), '/relative/path', plain],
    ['the empty string', url(), '', plain],
    // RFC 3986 allows an empty path, but the published uri format does not, so soundness rejects it.
    ['a scheme with nothing after it', url(), 'mailto:', plain],
    ['a scheme and a query only', url(), 'x:?q=1', plain],
    ['a scheme and a fragment only', url(), 'x:#top', plain],
    [
      'an empty path under protocols',
      url({ protocols: ['h+x.y-z'] }),
      'h+x.y-z:#',
      'Expected an absolute URL with the scheme h+x.y-z.',
    ],
    ['a space the WHATWG parser would encode', url(), 'https://example.org/a b', plain],
    [
      'a backslash the WHATWG parser would turn',
      url(),
      String.raw`https://example.org\path`,
      plain,
    ],
    ['a leading space the WHATWG parser would trim', url(), ' https://example.org', plain],
    ['a malformed percent escape', url(), 'https://example.org/%zz', plain],
    ['a non-ASCII path', url(), 'https://example.org/ä', plain],
    ['a scheme that starts with a digit', url(), '1http://example.org', plain],
    ['a port that is not a number', url(), 'https://example.org:port', plain],
    ['an IPvFuture host the WHATWG parser refuses', url(), 'http://[v1.x]/', plain],
    ['a special scheme with no host', url(), 'http://', plain],
    [
      'an unlisted scheme',
      url({ protocols: ['https'] }),
      'http://example.org',
      'Expected an absolute URL with the scheme https.',
    ],
    [
      'a token that is no URL at all under protocols',
      url({ protocols: ['https'] }),
      'not a url',
      'Expected an absolute URL with the scheme https.',
    ],
    [
      'an unlisted scheme of two',
      url({ protocols: ['https', 'http'] }),
      'ftp://example.org',
      'Expected an absolute URL with the scheme https or http.',
    ],
    [
      'an unlisted scheme of three',
      url({ protocols: ['https', 'http', 'ftp'] }),
      'ws://example.org',
      'Expected an absolute URL with the scheme https, http, or ftp.',
    ],
  ];

  it.each(rejected)('%s', async (_name, validator, token, message) => {
    await expect(rejection(validator, token)).resolves.toEqual(rejectedWith(message));
  });
});

test('url() publishes the uri format', () => {
  expect(published(url())).toEqual({ $schema: dialect, format: 'uri', type: 'string' });
});

test('protocols publish an anchored pattern that spells each letter in both cases', () => {
  expect(published(url({ protocols: ['https'] }))).toEqual({
    $schema: dialect,
    format: 'uri',
    pattern: '^(?:[hH][tT][tT][pP][sS]):',
    type: 'string',
  });
  expect(published(url({ protocols: ['https', 'svn+ssh'] })).pattern).toBe(
    String.raw`^(?:[hH][tT][tT][pP][sS]|[sS][vV][nN]\+[sS][sS][hH]):`,
  );
});

test('a hyphen stays unescaped, because the u flag refuses the escape outside a class', () => {
  expect(published(url({ protocols: ['git-lfs', 'a.b', 'x2'] })).pattern).toBe(
    String.raw`^(?:[gG][iI][tT]-[lL][fF][sS]|[aA]\.[bB]|[xX]2):`,
  );
});

describe('an option that can never work throws from the call', () => {
  const scheme = 'List a letter followed by letters, digits, +, -, or ., with no trailing colon.';
  const faults: [string, unknown, string][] = [
    [
      'options that are not an object',
      'https',
      'url() options is not a plain object. Supply an object or leave it out.',
    ],
    [
      'an empty protocols list',
      { protocols: [] },
      'url() protocols is empty. List at least one scheme.',
    ],
    [
      'protocols that are not an array',
      { protocols: 'https' },
      'url() protocols is not an array. Supply an array of scheme names.',
    ],
    [
      'a scheme with a trailing colon',
      { protocols: ['https:'] },
      `url() protocols lists "https:", which is not a scheme name. ${scheme}`,
    ],
    [
      'a scheme that starts with a digit',
      { protocols: ['2x'] },
      `url() protocols lists "2x", which is not a scheme name. ${scheme}`,
    ],
    [
      'a scheme that is not a string',
      { protocols: [5] },
      `url() protocols lists 5, which is not a scheme name. ${scheme}`,
    ],
    [
      'a list with a hole',
      // oxlint-disable-next-line no-sparse-arrays -- The hole is the fault under test.
      { protocols: ['https', , 'http'] },
      `url() protocols lists undefined, which is not a scheme name. ${scheme}`,
    ],
  ];

  it.each(faults)('%s', (_name, options, message) => {
    expect(faultOf(() => Reflect.apply(url, undefined, [options]))).toEqual(
      declarationFault(message),
    );
  });
});
