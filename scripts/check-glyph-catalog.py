#!/usr/bin/env python3
"""Generate or check the glyph reference against an immutable upstream source."""

import argparse
import re
import urllib.request
from pathlib import Path


REVISION = "a446ea9e273864a3653a26943f59b4fbe8003796"
SOURCE = f"https://raw.githubusercontent.com/SBoudrias/Inquirer.js/{REVISION}/packages/figures/src/index.ts"
TARGET = Path(__file__).resolve().parents[1] / "docs" / "glyphs.md"
SOCKET_TIMEOUT_SECONDS = 30


def read_map(source, name):
    """Parse one pinned upstream map, rejecting entries outside its known shape."""
    block = re.search(rf"const {name} = \{{\n(.*?)\n\}};", source, re.S)
    if block is None:
        raise ValueError(f"Missing upstream map: {name}")
    entries = {}
    for line in block[1].splitlines():
        match = re.fullmatch(r"  ([A-Za-z0-9]+): '([^'\\]*)',", line)
        if match is None or match[1] in entries:
            raise ValueError(f"Unexpected upstream entry: {line}")
        entries[match[1]] = match[2]
    return entries


def reference(source):
    """Build the canonical catalog from upstream forms and Loom's aliases."""
    common = read_map(source, "common")
    main = common | read_map(source, "specialMainSymbols")
    fallback = common | read_map(source, "specialFallbackSymbols")
    if main.keys() != fallback.keys():
        raise ValueError("Upstream main and fallback names differ")
    for alias, target in {"success": "tick", "error": "cross"}.items():
        if alias in main:
            raise ValueError(f"Alias collides with upstream: {alias}")
        main[alias], fallback[alias] = main[target], fallback[target]
    header = f"""---
description: Complete proposed core glyph inventory, with the pinned Inquirer main and compatibility forms and Loom semantic aliases.
---

# Glyph reference

This catalog belongs to the [proposed style contract](core.md#styles-and-rendering-policy-proposed).
Core exposes every name below as an unstyled marked string under `glyph`.
Compatibility forms are not restricted to ASCII. Glyphs never select a theme token.

The inventory comes from [Inquirer figures at `{REVISION[:12]}`]({SOURCE}).
Loom adds `success` as an alias of `tick` and `error` as an alias of `cross`.
The upstream `info` and `warning` names already express those meanings.
Aliases select the same forms as their targets and add no styling.

Run `python3 scripts/check-glyph-catalog.py --check` to compare this file with the pinned upstream source.
Run the command without `--check` to regenerate it. Both commands need network access.
The generator rejects an unrecognized source shape instead of silently omitting an entry.

The source is MIT-licensed. Its [license notice](data/inquirer-figures-license.txt) accompanies this catalog.

| Name | Main form | Compatibility form |
| --- | --- | --- |
"""
    def cell(value):
        """Keep literal glyphs inside one Markdown table cell."""
        return "`" + value.replace("|", "\\|") + "`"
    return header + "".join(
        f"| `{name}` | {cell(main[name])} | {cell(fallback[name])} |\n"
        for name in main
    )


def main():
    """Fetch the pinned source and check or regenerate the UTF-8 catalog."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        with urllib.request.urlopen(SOURCE, timeout=SOCKET_TIMEOUT_SECONDS) as response:
            source = response.read().decode("utf-8")
    except OSError as error:
        raise SystemExit(
            f"Cannot read {SOURCE} (socket timeout: {SOCKET_TIMEOUT_SECONDS} s): {error}"
        ) from error
    expected = reference(source)
    if args.check:
        if TARGET.read_text(encoding="utf-8") != expected:
            raise SystemExit(
                f"{TARGET} differs from the catalog generated from {SOURCE}; "
                "run scripts/check-glyph-catalog.py"
            )
        print("Glyph reference matches pinned upstream and semantic aliases")
    else:
        TARGET.write_text(expected, encoding="utf-8")
        print(f"Wrote {TARGET.relative_to(TARGET.parents[1])}")


if __name__ == "__main__":
    main()
