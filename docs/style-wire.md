---
description: Internal marked-string framing and resolver invariants for style spans, glyphs, literal escaping, and deferred padding.
---

# Marked-string wire contract

This is the internal representation behind the [style API](core.md#styles-and-rendering-policy).
It is an implementation contract, not an authoring API or a format for persistent storage.
SDK authors use the helpers and keep ordinary strings. They do not construct headers.

## Framing

Four private-use code points delimit frames:

| Name | Code point | Role |
| --- | --- | --- |
| Open | `U+E000` | Begins a header |
| Header end | `U+E001` | Ends a header and begins its body |
| Close | `U+E002` | Closes the innermost active frame |
| Escape | `U+E003` | Introduces one escaped delimiter |

A frame is `Open + JSON header + Header end + body + Close`.
Headers contain compact JSON arrays. A header never contains a literal delimiter: JSON strings encode these code points with `\u` escapes.
The resolver reads headers as data and never evaluates them as code.

| Header | Body |
| --- | --- |
| `["style", operations]` | Text to which the ordered operations apply |
| `["glyph", name]` | Empty; the selected glyph form replaces the frame |
| `["pad", minimumWidth, alignment]` | Text to measure and pad after glyph resolution |

`alignment` is `"left"`, `"right"`, or `"center"`. `minimumWidth` is a nonnegative safe integer.
`name` is a name in the [glyph catalog](glyphs.md).
Style operations use these arrays:

| Operation | Meaning |
| --- | --- |
| `["token", name]` | Apply the Application's mapping for the semantic name |
| `["foreground", color]` | Set the foreground |
| `["background", color]` | Set the background |
| `["modifier", name]` | Enable one supported modifier |
| `["reset"]` | Clear colors and modifiers |
| `["resetForeground"]` | Restore the terminal's foreground default |
| `["resetBackground"]` | Restore the terminal's background default |

`color` is a named foreground color from the core API, `["rgb", r, g, b]`, or `["ansi256", index]`.
Hex helpers normalize their input to RGB. Background operations use the same color values without a `bg` prefix.
Modifier names match the public catalog. A theme mapping expands to concrete operations and cannot expand to another token.
Operations retain their order. A token with no mapping contributes no operation.

## Explicit color fallbacks (proposed)

[ADR-0029](decisions/0029-explicit-color-fallbacks-preserve-theme-hues.md) proposes these additional color forms. They are not recognized by the current parser.

| Color | Fields in the final object |
| --- | --- |
| `["rgb", r, g, b, {"ansi256": 108, "ansi16": "green"}]` | Optional `ansi256` and `ansi16` |
| `["ansi256", index, {"ansi16": "green"}]` | Optional `ansi16` only |

The original tuples remain valid. RGB channels and palette indices remain integers from 0 through 255. The final object contains only the listed fields, and an empty object is valid. `ansi16` is a core foreground color name, also when the enclosing operation sets a background. Unknown fields, invalid values, `null`, or any other tuple length invalidate the frame under the existing malformed-frame rules.

Helpers copy validated fallback values into their color operation. They omit undefined fields from the serialized object. Raw JSON null is not an omitted value. The optional object remains part of that color through composition, nesting, and embedded ANSI reset restoration. A later foreground operation replaces the whole foreground color, including its fallback object.

Core selects only the fallback for the destination's depth. At a depth with no explicit fallback, it approximates the original color. A fallback at another depth does not affect that result. Color policy can suppress the selected color. Background selection uses the same rule, and width measurement remains independent of color.

## Literal data and malformed frames

`style.escape(text)` replaces each of the four delimiters with `Escape` followed by its four uppercase hexadecimal digits.
For example, a literal `U+E000` becomes `U+E003` followed by the ASCII text `E000`.
The resolver decodes that escape once and emits the resulting character as literal data, without scanning it again as markup.
Escaping preserves every other character, including ANSI sequences. It is not an ANSI sanitizer and is not idempotent.

A complete, valid header opens a frame only when every referenced operation and glyph is recognized.
A token reference is recognized when its name is a core token or a custom name declared by the installed theme.
A declared custom name with an undefined mapping is still recognized.
An unknown name, invalid JSON, invalid operand, or unknown operation makes the opening delimiter literal.
The resolver preserves the rejected candidate header as literal text through its header end, or through the end of the string if no header end exists.
It does not interpret delimiters inside that rejected header.
Outside an active frame, a closing delimiter is literal.
A glyph header is valid only when its header end is immediately followed by a close. Otherwise, the candidate header is literal and does not open a glyph frame.
For example, `Open + ["glyph","tick"] + Header end + KEEP + Close` remains literal in full at top level. It never discards `KEEP`.
A header-end delimiter outside a header is literal. An invalid escape leaves the escape delimiter literal and continues with the following text.
An open, recognized frame ends at the end of its containing rendered string if no close occurs.
This implicit close restores the prior style and ends any deferred padding frame.

Private-use characters are valid string data. A balanced recognized frame can therefore appear in arbitrary data by coincidence or by construction.
`style.escape()` is the explicit way to display that data literally.
Normal style calls preserve existing markup so nested styling remains possible.
First-party views escape raw data values they interpolate, but preserve a message that the output API already accepts as authored marked text.

## Resolution

Each rendered string starts with an empty Loom style stack. State does not cross output calls.
The resolver processes nested frames with an explicit stack rather than recursive calls proportional to input depth.
It resolves glyph forms before measuring enclosing padding. Nested padding resolves from the inside outward.
Escape decoding produces literal data before measurement; the resulting literal is never reparsed as a frame.
The width helper and output resolver share the same frame parser and display-column rules.

The active style is an attribute set: foreground, background, and the supported modifiers.
Entering a style frame applies its operations to the enclosing set. Closing it restores the enclosing set.
An explicit reset inside a Loom frame clears the corresponding inherited attributes for that frame's body.
Embedded ANSI styling participates in the same output policy. An ANSI reset restores the enclosing Loom attributes it resets.
An ANSI color reset does not reset unrelated modifiers. A full ANSI reset restores the enclosing Loom attribute set.
At the end of a rendered string, core closes any active ANSI styling and hyperlink so neither leaks into later output.
Preserved cursor commands remain terminal operations; width measurement does not emulate their effect on screen contents.

### Parsing order

Loom framing is the outer encoding. It resolves first into text runs carrying Loom attributes, glyph choices, and padding boundaries. Raw ANSI does not make a Loom delimiter opaque at this stage.
The ANSI scanner then consumes the resulting character stream across adjacent runs, including across removed Loom frame boundaries. No raw segment reaches the output before this classification.
Loom attribute transitions inside an ANSI control string update the outer annotation state but do not emit terminal bytes inside its payload.
The policy layer treats the complete decoded control string and its payload as one ANSI unit. It does not interpret payload bytes as nested ANSI commands.
Padding spaces and generated ANSI are emitted only after the original character stream is classified. The resolver therefore cannot assemble a previously unclassified ANSI command by removing markup.

With controls stripped, `style.red('\x1b]0;hidden') + '\x07X'` emits only unstyled `X`: the Loom span closes before `X`.
With colors and modifiers disabled and controls preserved, `'\x1b[3' + style.bold('1mX')` emits only plain `X`.
The scanner recognizes the reassembled foreground command before applying policy, even though its source characters came from different Loom runs.

An incomplete ANSI sequence at the end of a rendered string is discarded, including under `terminalControls: 'preserve'`.
The parser does not carry an incomplete command into the next output call. Preserve mode accepts complete terminal commands within one rendered string.
For separate output calls containing `'\x1b[3'` and `'1mX'`, the first emits nothing and the second emits literal `1mX`.
This boundary prevents separately emitted fragments from assembling a command that bypasses color, modifier, hyperlink, or terminal-control policy.

Color removal happens after composition. It cannot remove the control codes needed to close styles that remain enabled.
The resolver uses the [rendering policies](core.md#rendering-policies) for ANSI colors, modifiers, hyperlinks, and other terminal controls separately.
It treats CRLF as one line break. LF starts a new line; a lone CR is a cursor control rather than a newline.
Tabs remain text except inside a padding frame, where they expand under the tab rule before alignment.

The parser scans each input segment once. A rejected header cannot trigger rescans from every embedded opening delimiter.
Emitted output is proportional to input and requested padding, with no implicit small limit on valid strings.
Deep padding around unchanged content reuses its Unicode analysis. Arbitrary nested padding that changes its content at every level can require quadratic measurement work and transient allocation, including repeated appends of combining marks.
Eliminating that pathological cost is a separate performance increment. The current resolver does not promise linear work for every nested composition.
Run `node packages/core/tests/fixtures/padding-growth.mjs concatenated` after building to reproduce it; `unchanged` exercises cached wrappers.
Numeric validation prevents negative, fractional, infinite, and unsafe widths before a padding frame is produced.
Allocation failure follows the ordinary view failure path; core does not silently truncate output.

## Required constructions

Implementation acceptance includes these cases through both width measurement and final output:

- Every delimiter as literal input, escaped once, escaped twice, and next to a valid frame.
- Unknown tokens and glyphs, malformed JSON, truncated headers, extra closes, and unterminated recognized frames.
- A recognized glyph header with a nonempty body, preserving the malformed frame as literal text.
- A known token without a mapping, a custom undefined mapping, and a literal string resembling a complete registered frame.
- Nested styles, reset variants, embedded ANSI resets, and an ANSI reset inside a padded frame.
- A multi-character compatibility glyph inside nested padding and escaped delimiters inside a measured value.
- Large malformed headers without quadratic header rescanning, and deep unchanged padding without recursive-stack failure or repeated Unicode analysis.
- Unclosed ANSI styling and hyperlinks followed by a separate output call, with no leaked formatting.
- Loom frame boundaries inside raw OSC payloads and raw ANSI commands split across Loom frames, under disabled styling policies.

Public process fixtures in `packages/core/tests/style.test.ts` exercise these constructions on Node and Bun.
