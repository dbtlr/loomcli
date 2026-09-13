---
description: Complete proposed core glyph inventory, with the pinned Inquirer main and compatibility forms and Loom semantic aliases.
---

# Glyph reference

This catalog belongs to the [proposed style contract](core.md#styles-and-rendering-policy-proposed).
Core exposes every name below as an unstyled marked string under `glyph`.
Compatibility forms are not restricted to ASCII. Glyphs never select a theme token.

The inventory comes from [Inquirer figures at `a446ea9e2738`](https://raw.githubusercontent.com/SBoudrias/Inquirer.js/a446ea9e273864a3653a26943f59b4fbe8003796/packages/figures/src/index.ts).
Loom adds `success` as an alias of `tick` and `error` as an alias of `cross`.
The upstream `info` and `warning` names already express those meanings.
Aliases select the same forms as their targets and add no styling.

Run `python3 scripts/check-glyph-catalog.py --check` to compare this file with the pinned upstream source.
Run the command without `--check` to regenerate it. Both commands need network access.
The generator rejects an unrecognized source shape instead of silently omitting an entry.

The source is MIT-licensed. Its [license notice](data/inquirer-figures-license.txt) accompanies this catalog.

| Name | Main form | Compatibility form |
| --- | --- | --- |
| `circleQuestionMark` | `(?)` | `(?)` |
| `questionMarkPrefix` | `(?)` | `(?)` |
| `square` | `█` | `█` |
| `squareDarkShade` | `▓` | `▓` |
| `squareMediumShade` | `▒` | `▒` |
| `squareLightShade` | `░` | `░` |
| `squareTop` | `▀` | `▀` |
| `squareBottom` | `▄` | `▄` |
| `squareLeft` | `▌` | `▌` |
| `squareRight` | `▐` | `▐` |
| `squareCenter` | `■` | `■` |
| `bullet` | `●` | `●` |
| `dot` | `․` | `․` |
| `ellipsis` | `…` | `…` |
| `pointerSmall` | `›` | `›` |
| `triangleUp` | `▲` | `▲` |
| `triangleUpSmall` | `▴` | `▴` |
| `triangleDown` | `▼` | `▼` |
| `triangleDownSmall` | `▾` | `▾` |
| `triangleLeftSmall` | `◂` | `◂` |
| `triangleRightSmall` | `▸` | `▸` |
| `home` | `⌂` | `⌂` |
| `heart` | `♥` | `♥` |
| `musicNote` | `♪` | `♪` |
| `musicNoteBeamed` | `♫` | `♫` |
| `arrowUp` | `↑` | `↑` |
| `arrowDown` | `↓` | `↓` |
| `arrowLeft` | `←` | `←` |
| `arrowRight` | `→` | `→` |
| `arrowLeftRight` | `↔` | `↔` |
| `arrowUpDown` | `↕` | `↕` |
| `almostEqual` | `≈` | `≈` |
| `notEqual` | `≠` | `≠` |
| `lessOrEqual` | `≤` | `≤` |
| `greaterOrEqual` | `≥` | `≥` |
| `identical` | `≡` | `≡` |
| `infinity` | `∞` | `∞` |
| `subscriptZero` | `₀` | `₀` |
| `subscriptOne` | `₁` | `₁` |
| `subscriptTwo` | `₂` | `₂` |
| `subscriptThree` | `₃` | `₃` |
| `subscriptFour` | `₄` | `₄` |
| `subscriptFive` | `₅` | `₅` |
| `subscriptSix` | `₆` | `₆` |
| `subscriptSeven` | `₇` | `₇` |
| `subscriptEight` | `₈` | `₈` |
| `subscriptNine` | `₉` | `₉` |
| `oneHalf` | `½` | `½` |
| `oneThird` | `⅓` | `⅓` |
| `oneQuarter` | `¼` | `¼` |
| `oneFifth` | `⅕` | `⅕` |
| `oneSixth` | `⅙` | `⅙` |
| `oneEighth` | `⅛` | `⅛` |
| `twoThirds` | `⅔` | `⅔` |
| `twoFifths` | `⅖` | `⅖` |
| `threeQuarters` | `¾` | `¾` |
| `threeFifths` | `⅗` | `⅗` |
| `threeEighths` | `⅜` | `⅜` |
| `fourFifths` | `⅘` | `⅘` |
| `fiveSixths` | `⅚` | `⅚` |
| `fiveEighths` | `⅝` | `⅝` |
| `sevenEighths` | `⅞` | `⅞` |
| `line` | `─` | `─` |
| `lineBold` | `━` | `━` |
| `lineDouble` | `═` | `═` |
| `lineDashed0` | `┄` | `┄` |
| `lineDashed1` | `┅` | `┅` |
| `lineDashed2` | `┈` | `┈` |
| `lineDashed3` | `┉` | `┉` |
| `lineDashed4` | `╌` | `╌` |
| `lineDashed5` | `╍` | `╍` |
| `lineDashed6` | `╴` | `╴` |
| `lineDashed7` | `╶` | `╶` |
| `lineDashed8` | `╸` | `╸` |
| `lineDashed9` | `╺` | `╺` |
| `lineDashed10` | `╼` | `╼` |
| `lineDashed11` | `╾` | `╾` |
| `lineDashed12` | `−` | `−` |
| `lineDashed13` | `–` | `–` |
| `lineDashed14` | `‐` | `‐` |
| `lineDashed15` | `⁃` | `⁃` |
| `lineVertical` | `│` | `│` |
| `lineVerticalBold` | `┃` | `┃` |
| `lineVerticalDouble` | `║` | `║` |
| `lineVerticalDashed0` | `┆` | `┆` |
| `lineVerticalDashed1` | `┇` | `┇` |
| `lineVerticalDashed2` | `┊` | `┊` |
| `lineVerticalDashed3` | `┋` | `┋` |
| `lineVerticalDashed4` | `╎` | `╎` |
| `lineVerticalDashed5` | `╏` | `╏` |
| `lineVerticalDashed6` | `╵` | `╵` |
| `lineVerticalDashed7` | `╷` | `╷` |
| `lineVerticalDashed8` | `╹` | `╹` |
| `lineVerticalDashed9` | `╻` | `╻` |
| `lineVerticalDashed10` | `╽` | `╽` |
| `lineVerticalDashed11` | `╿` | `╿` |
| `lineDownLeft` | `┐` | `┐` |
| `lineDownLeftArc` | `╮` | `╮` |
| `lineDownBoldLeftBold` | `┓` | `┓` |
| `lineDownBoldLeft` | `┒` | `┒` |
| `lineDownLeftBold` | `┑` | `┑` |
| `lineDownDoubleLeftDouble` | `╗` | `╗` |
| `lineDownDoubleLeft` | `╖` | `╖` |
| `lineDownLeftDouble` | `╕` | `╕` |
| `lineDownRight` | `┌` | `┌` |
| `lineDownRightArc` | `╭` | `╭` |
| `lineDownBoldRightBold` | `┏` | `┏` |
| `lineDownBoldRight` | `┎` | `┎` |
| `lineDownRightBold` | `┍` | `┍` |
| `lineDownDoubleRightDouble` | `╔` | `╔` |
| `lineDownDoubleRight` | `╓` | `╓` |
| `lineDownRightDouble` | `╒` | `╒` |
| `lineUpLeft` | `┘` | `┘` |
| `lineUpLeftArc` | `╯` | `╯` |
| `lineUpBoldLeftBold` | `┛` | `┛` |
| `lineUpBoldLeft` | `┚` | `┚` |
| `lineUpLeftBold` | `┙` | `┙` |
| `lineUpDoubleLeftDouble` | `╝` | `╝` |
| `lineUpDoubleLeft` | `╜` | `╜` |
| `lineUpLeftDouble` | `╛` | `╛` |
| `lineUpRight` | `└` | `└` |
| `lineUpRightArc` | `╰` | `╰` |
| `lineUpBoldRightBold` | `┗` | `┗` |
| `lineUpBoldRight` | `┖` | `┖` |
| `lineUpRightBold` | `┕` | `┕` |
| `lineUpDoubleRightDouble` | `╚` | `╚` |
| `lineUpDoubleRight` | `╙` | `╙` |
| `lineUpRightDouble` | `╘` | `╘` |
| `lineUpDownLeft` | `┤` | `┤` |
| `lineUpBoldDownBoldLeftBold` | `┫` | `┫` |
| `lineUpBoldDownBoldLeft` | `┨` | `┨` |
| `lineUpDownLeftBold` | `┥` | `┥` |
| `lineUpBoldDownLeftBold` | `┩` | `┩` |
| `lineUpDownBoldLeftBold` | `┪` | `┪` |
| `lineUpDownBoldLeft` | `┧` | `┧` |
| `lineUpBoldDownLeft` | `┦` | `┦` |
| `lineUpDoubleDownDoubleLeftDouble` | `╣` | `╣` |
| `lineUpDoubleDownDoubleLeft` | `╢` | `╢` |
| `lineUpDownLeftDouble` | `╡` | `╡` |
| `lineUpDownRight` | `├` | `├` |
| `lineUpBoldDownBoldRightBold` | `┣` | `┣` |
| `lineUpBoldDownBoldRight` | `┠` | `┠` |
| `lineUpDownRightBold` | `┝` | `┝` |
| `lineUpBoldDownRightBold` | `┡` | `┡` |
| `lineUpDownBoldRightBold` | `┢` | `┢` |
| `lineUpDownBoldRight` | `┟` | `┟` |
| `lineUpBoldDownRight` | `┞` | `┞` |
| `lineUpDoubleDownDoubleRightDouble` | `╠` | `╠` |
| `lineUpDoubleDownDoubleRight` | `╟` | `╟` |
| `lineUpDownRightDouble` | `╞` | `╞` |
| `lineDownLeftRight` | `┬` | `┬` |
| `lineDownBoldLeftBoldRightBold` | `┳` | `┳` |
| `lineDownLeftBoldRightBold` | `┯` | `┯` |
| `lineDownBoldLeftRight` | `┰` | `┰` |
| `lineDownBoldLeftBoldRight` | `┱` | `┱` |
| `lineDownBoldLeftRightBold` | `┲` | `┲` |
| `lineDownLeftRightBold` | `┮` | `┮` |
| `lineDownLeftBoldRight` | `┭` | `┭` |
| `lineDownDoubleLeftDoubleRightDouble` | `╦` | `╦` |
| `lineDownDoubleLeftRight` | `╥` | `╥` |
| `lineDownLeftDoubleRightDouble` | `╤` | `╤` |
| `lineUpLeftRight` | `┴` | `┴` |
| `lineUpBoldLeftBoldRightBold` | `┻` | `┻` |
| `lineUpLeftBoldRightBold` | `┷` | `┷` |
| `lineUpBoldLeftRight` | `┸` | `┸` |
| `lineUpBoldLeftBoldRight` | `┹` | `┹` |
| `lineUpBoldLeftRightBold` | `┺` | `┺` |
| `lineUpLeftRightBold` | `┶` | `┶` |
| `lineUpLeftBoldRight` | `┵` | `┵` |
| `lineUpDoubleLeftDoubleRightDouble` | `╩` | `╩` |
| `lineUpDoubleLeftRight` | `╨` | `╨` |
| `lineUpLeftDoubleRightDouble` | `╧` | `╧` |
| `lineUpDownLeftRight` | `┼` | `┼` |
| `lineUpBoldDownBoldLeftBoldRightBold` | `╋` | `╋` |
| `lineUpDownBoldLeftBoldRightBold` | `╈` | `╈` |
| `lineUpBoldDownLeftBoldRightBold` | `╇` | `╇` |
| `lineUpBoldDownBoldLeftRightBold` | `╊` | `╊` |
| `lineUpBoldDownBoldLeftBoldRight` | `╉` | `╉` |
| `lineUpBoldDownLeftRight` | `╀` | `╀` |
| `lineUpDownBoldLeftRight` | `╁` | `╁` |
| `lineUpDownLeftBoldRight` | `┽` | `┽` |
| `lineUpDownLeftRightBold` | `┾` | `┾` |
| `lineUpBoldDownBoldLeftRight` | `╂` | `╂` |
| `lineUpDownLeftBoldRightBold` | `┿` | `┿` |
| `lineUpBoldDownLeftBoldRight` | `╃` | `╃` |
| `lineUpBoldDownLeftRightBold` | `╄` | `╄` |
| `lineUpDownBoldLeftBoldRight` | `╅` | `╅` |
| `lineUpDownBoldLeftRightBold` | `╆` | `╆` |
| `lineUpDoubleDownDoubleLeftDoubleRightDouble` | `╬` | `╬` |
| `lineUpDoubleDownDoubleLeftRight` | `╫` | `╫` |
| `lineUpDownLeftDoubleRightDouble` | `╪` | `╪` |
| `lineCross` | `╳` | `╳` |
| `lineBackslash` | `╲` | `╲` |
| `lineSlash` | `╱` | `╱` |
| `tick` | `✔` | `√` |
| `info` | `ℹ` | `i` |
| `warning` | `⚠` | `‼` |
| `cross` | `✘` | `×` |
| `squareSmall` | `◻` | `□` |
| `squareSmallFilled` | `◼` | `■` |
| `circle` | `◯` | `( )` |
| `circleFilled` | `◉` | `(*)` |
| `circleDotted` | `◌` | `( )` |
| `circleDouble` | `◎` | `( )` |
| `circleCircle` | `ⓞ` | `(○)` |
| `circleCross` | `ⓧ` | `(×)` |
| `circlePipe` | `Ⓘ` | `(│)` |
| `radioOn` | `◉` | `(*)` |
| `radioOff` | `◯` | `( )` |
| `checkboxOn` | `☒` | `[×]` |
| `checkboxOff` | `☐` | `[ ]` |
| `checkboxCircleOn` | `ⓧ` | `(×)` |
| `checkboxCircleOff` | `Ⓘ` | `( )` |
| `pointer` | `❯` | `>` |
| `triangleUpOutline` | `△` | `∆` |
| `triangleLeft` | `◀` | `◄` |
| `triangleRight` | `▶` | `►` |
| `lozenge` | `◆` | `♦` |
| `lozengeOutline` | `◇` | `◊` |
| `hamburger` | `☰` | `≡` |
| `smiley` | `㋡` | `☺` |
| `mustache` | `෴` | `┌─┐` |
| `star` | `★` | `✶` |
| `play` | `▶` | `►` |
| `nodejs` | `⬢` | `♦` |
| `oneSeventh` | `⅐` | `1/7` |
| `oneNinth` | `⅑` | `1/9` |
| `oneTenth` | `⅒` | `1/10` |
| `success` | `✔` | `√` |
| `error` | `✘` | `×` |
