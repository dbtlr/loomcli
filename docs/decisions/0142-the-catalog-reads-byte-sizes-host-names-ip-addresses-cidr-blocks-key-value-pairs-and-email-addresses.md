---
type: adr
title: ADR-0142 - The catalog reads byte sizes, host names, IP addresses, CIDR blocks, key-value pairs, and email addresses
description: '`@loomcli/validators` gains six factories. `bytes()` reads IEC 80000-13 sizes, decimal prefixes as powers of 1000 and binary prefixes as powers of 1024, into a safe-integer byte count. `ip()` and `host()` hand the action canonical strings, `cidr()` hands it `{ address, prefix }` and rejects host bits, `keyValue()` splits at the first separator into `{ key, value }`, and `email()` follows the WHATWG HTML rule browsers apply. Each publishes a sound schema and one issue code per sentence. This supersedes the validators reference''s listing of email as not shipped.'
status: proposed
created: 2026-11-09
modified: 2026-11-09
---

# ADR-0142 - The catalog reads byte sizes, host names, IP addresses, CIDR blocks, key-value pairs, and email addresses

## Context

[ADR-0037](0037-validators-ship-in-their-own-package-as-standard-schema-values.md) admits a factory that covers an input shape a command-line author would otherwise need a schema library for. Six such shapes are common on a command line and missing from the catalog: a size such as `--max-upload 10MB`, a host such as `--host db.internal`, an address such as `--bind 0.0.0.0`, a network such as `--allow 10.0.0.0/8`, a pair such as `--label env=prod`, and an address such as `--notify ops@example.com`. The [configuration reference](../plugins/config.md) has its author write a byte-size validator, and Docker, Helm, kubectl, and systemd each read sizes, hosts, and pairs from their command lines.

The [validators reference](../libs/validators.md#not-shipped) lists email as not shipped, because every simple email rule rejects a real address somewhere. [Principle 6](../principles.md#6-standards-before-inventions) settles that differently: the WHATWG HTML standard defines the email rule every browser applies to `<input type="email">`, a deliberate departure from RFC 5322 whose limits are written down, so Loom follows it rather than inventing a rule or shipping none.

Each size convention in use reads `M` differently. IEC 80000-13, which Kubernetes follows, reads `MB` as 10⁶ bytes and `MiB` as 2²⁰. systemd and Docker read `M` as 2²⁰. Many tools read `MB` as 2²⁰ by habit.

## Decision

- **Six factories.** `@loomcli/validators` exports `bytes`, `host`, `ip`, `cidr`, `keyValue`, and `email`. Each is built with `createValidator` under the Shared rules of the [validators reference](../libs/validators.md#shared-rules): it publishes a sound input schema, answers each configuration's rejections with one `Expected` sentence, or two where the reference names a second, as for `cidr`'s host bits, that never repeats the token, carries one issue code per sentence under [ADR-0048](0048-a-validator-package-declares-one-issue-code-per-sentence.md), and throws a declaration fault only for what a type cannot express, under [ADR-0093](0093-a-value-that-bypasses-the-types-gets-no-rule.md).
- **Byte sizes follow IEC 80000-13.** `bytes({ min?, max? })` reads a number, digits with an optional fraction, and an optional unit, with whitespace allowed between them. `B` is a byte; `kB`, `MB`, `GB`, `TB`, and `PB` are powers of 1000; `KiB`, `MiB`, `GiB`, `TiB`, and `PiB` are powers of 1024. Units are case-sensitive, except that the decimal kilo prefix may be written `k` or `K`. A bare number counts bytes. A binary prefix may stand without `B`, as Kubernetes writes `512Mi`; a decimal prefix without `B`, such as `10M`, is rejected, because it reads two ways. The output is the number of bytes, computed in exact decimal arithmetic, which must be a safe integer; a fraction is accepted only when the bytes come out whole, so `1.5GB` is 1,500,000,000 and `1.5B` is rejected. One number and one unit make a size, so `1GB 500MB` is rejected. `min` and `max` are sizes in the same grammar, both inclusive.
- **Addresses are canonical.** `ip({ version? })` accepts an IPv4 address in dotted decimal, each part from 0 through 255 with no leading zero, and an IPv6 address in the text forms of RFC 4291, with no zone identifier. It hands the action the canonical form: IPv4 as written, and IPv6 as RFC 5952 writes it, lowercase, each group without leading zeros, and the longest run of two or more zero groups compressed to `::`, the first such run on a tie, with an IPv4-mapped address in its dotted form and every other address in hexadecimal groups. `version` limits the family.
- **CIDR blocks are two facts.** `cidr({ version? })` reads an address, a `/`, and a decimal prefix with no leading zero, at most 32 for IPv4 and 128 for IPv6, and hands the action `{ address, prefix }`, the address canonical as `ip()` writes it and the prefix a number. A block whose address has a bit set below the prefix, such as `10.0.0.1/8`, is rejected with its own sentence, because a block names a network.
- **Host names are DNS names.** `host({ ip? })` accepts an RFC 1123 host name: labels of letters, digits, and hyphens, each from 1 through 63 characters and neither starting nor ending with a hyphen, at most 253 characters in all, with no trailing dot, and a last label that is not a number under the WHATWG URL standard's ends-in-a-number rule, digits alone or `0x` followed by zero or more hexadecimal digits, so a name a resolver reads as an IPv4 address, such as `1.2.3.4` or `0x7f000001`, is never a host name. It hands the action the name in lowercase. A name outside ASCII is rejected, and the operator writes its Punycode form, because the published `hostname` format admits ASCII alone. With `ip: true` it also accepts an IPv4 address and an IPv6 address in brackets, as a URL writes one, and hands the action the canonical address without brackets.
- **Pairs split at the first separator.** `keyValue({ separator? })` splits a token at the first occurrence of its separator, `=` unless the author names another, into `{ key, value }`. A token with no separator, or with an empty key, is rejected; an empty value is accepted as `''`. On a multiple option the action receives the pairs in the order given, repeated keys kept; folding them into a record is the author's, through a `pipe` step or the action. A separator that is empty or holds whitespace throws a declaration fault under `@loomcli/validators/key-value-separator`. Rules for the key or the value are a `pipe` step, not an option.
- **Email follows WHATWG.** `email()` accepts what the WHATWG HTML standard's valid email address production accepts and hands the action the token as written. It publishes a `pattern` rather than JSON Schema's `format: 'email'`, because RFC 5321's local part rejects forms the WHATWG rule accepts, such as `a..b`, and the format as validators check it requires a dot in the domain, so publishing it would be stricter than the validator.

The grammars, outputs, published schemas, sentences, and codes are the contract in the [validators reference](../libs/validators.md#catalog).

## Considered options

- **Size prefixes as powers of 1024 for `K`, `M`, and `G`, as systemd and Docker read them.** Rejected. `duration()` follows systemd's grammar, but sizes under that reading make `10MB` mean 10 MiB, which an operator who reads SI gets wrong. Under IEC every spelling has one meaning, and an operator who wants powers of 1024 writes `MiB`.
- **A `base` option on `bytes()`.** Rejected. Two applications built with Loom would read the same `10M` as two sizes.
- **IPv6 zone identifiers, such as `fe80::1%eth0`.** Rejected. A zone names an interface on one machine, so the address does not travel, and JSON Schema's `ipv6` format does not admit it.
- **Bare IPv6 under `host({ ip: true })`.** Rejected. A URL brackets an IPv6 host, so an operator writing a host already knows the form, and brackets keep a host from reading as an address with a port.
- **Keeping email out of the catalog.** Rejected under principle 6, because a published standard rule exists. Its limits, such as quoted local parts and comments, are named in the reference, and an author who needs them passes a schema library's value.

## Consequences

- The catalog holds seventeen factories, and the manifest and the inspected graph describe six more input shapes with no authored line. Help derives accepted values from an enum alone, so it prints none for these patterns and formats.
- An operator's size, address, and host reach the action in one canonical form, so two spellings of one address compare equal.
- The validators reference's not-shipped list no longer names email, and its list of bounds gains sizes. A JSON validator stays unshipped.
- The Shared rules' message bullet names `cidr`'s host bits beside the existing second sentences of `text` and `duration`.
- ADR-0037 carries a dated entry for the six factories.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-09: Proposed with the contract for the six factories (LM-486). It supersedes the validators reference's listing of email as not shipped, and ADR-0037 carries a dated entry.
