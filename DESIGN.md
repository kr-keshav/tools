# WorkKit Design System: Ripple

The visual and motion rules for every WorkKit product. Use this file when building or restyling any tool so they all feel like one product.

**Status:** live in Calc, in light and Graphite dark, through the `.ripple` scope in `src/app.css`. Other tools still use the older dark theme. To move one over, add `ripple` and `data-theme` to its outer element.
**Reference:** the Ripple tab of the [live prototype](https://claude.ai/artifact/4pv2w4xbSFsoNR2em7skQ1) (private, so it must be shared before others can open it).

## Principles

1. **Calm surfaces, one strong colour.** White cards sit on a cool grey page. Cobalt marks what is active or primary.
2. **Numbers come first.** Results are the boldest text in a row, and digits always line up.
3. **Colour carries meaning.** Tag colours identify categories and are not decoration.
4. **Motion shows cause and effect.** Animate what changed, so people can see what their action affected. Never animate just to decorate.

## Tokens

These keep the variable names already used in `src/app.css`, so a tool can adopt the theme by swapping values. Tokens marked `new` need adding.

```css
@theme {
  /* Surfaces */
  --color-bg-primary: #eceff7;   /* page */
  --color-bg-surface: #ffffff;   /* cards, inputs */
  --color-bg-panel: #f7f8fc;     /* entry bars, quiet areas */
  --color-bg-hover: #f2f4fa;
  --color-bg-active: #eef0ff;    /* new: row being edited */

  /* Lines */
  --color-border-default: #e6e9f2;
  --color-border-subtle: #e6e9f2;

  /* Text */
  --color-text-primary: #171a2b;
  --color-text-secondary: #5f6680;
  --color-text-muted: #5f6680;
  --color-text-faint: #7a809a;   /* placeholders and line numbers only */

  /* Brand */
  --color-accent: #3d4fe0;       /* new: primary colour everywhere */
  --color-accent-soft: #e3e6ff;  /* new: operator keys, soft highlights */
  --color-on-accent: #ffffff;    /* new */
  --color-danger: #c23b3b;       /* new: proposed, errors and delete */

  /* Type */
  --font-family-sans: 'Manrope', system-ui, sans-serif; /* new: replaces mono */

  /* Radius, all new */
  --radius-card: 20px;
  --radius-control: 14px;
  --radius-field: 10px;

  /* Motion, all new */
  --ease-spring: cubic-bezier(0.2, 1.5, 0.35, 1); /* playful overshoot */
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);     /* smooth settle */
}
```

### Dark mode: Graphite

Same layout, type and motion as light. Only these values change. The neutrals carry no tint, so colour appears only where it means something.

```css
[data-theme="dark"] {
  --color-bg-primary: #111214;
  --color-bg-surface: #1a1b1e;
  --color-bg-panel: #16171a;
  --color-bg-hover: #26272b;
  --color-bg-active: #25263a;

  --color-border-default: #2a2c30;
  --color-border-subtle: #2a2c30;

  --color-text-primary: #ececee;
  --color-text-secondary: #a3a5ac;
  --color-text-muted: #a3a5ac;
  --color-text-faint: #7f828a;

  --color-accent: #7f8cff;
  --color-accent-soft: #2a2c45;
  --color-on-accent: #101114;
  --color-danger: #e5807f;  /* proposed */
}
```

In dark mode, keys are `#26272B` (digit), `#202125` (utility) and accent-soft with `#AAB4FF` text (operator). Card shadows become `0 8px 28px #00000066`.

### Tag colours

Assign each tag a pair, and use the same pair everywhere that tag appears. In dark mode the background is the dark text colour at 20% opacity.

| Name | Light background | Light text | Dark text | Calc example |
|---|---|---|---|---|
| Blue | `#E3E8FF` | `#3346C9` | `#A9B6FF` | `#home` |
| Amber | `#FFE9CF` | `#94500A` | `#F5BE7E` | `#bills` |
| Green | `#DDF4E4` | `#1C7A45` | `#7FD8A0` | `#food` |
| Pink | `#F9E0EA` | `#A82860` | `#F29ABC` | `#tax` |
| Violet | `#E7E0FA` | `#5B3BBF` | `#C3AEFF` | `#car` |

### Tool accents

Cobalt is the primary colour in every tool. The current tool accents (`#6c8ebf`, `#82b366`, `#b5866b`, `#9673a6`) were chosen for a dark background and are too pale for text on white. Where a tool needs its own identity, such as an icon or tab, reuse the text colour of a pair above. The pairing of tool to colour is still to be decided.

## Typography

Manrope, weights 400 to 800, from Google Fonts. Always set `font-variant-numeric: tabular-nums` where numbers appear.

| Role | Size | Weight |
|---|---|---|
| Entry field | 17px | 600 |
| Pinned or headline value | 17px | 800 |
| Row result | 15px | 700 |
| Row label | 13.5px | 700 |
| Body and secondary text | 12.5px | 500 |
| Chips, tags, captions | 10.5px | 600 |
| Keypad digit | 17px | 700 |

The sizes above are from the prototype's laptop screen.

## Layout

- Page padding and gap between cards: 16px. Padding inside cards and rows: 14px.
- **Radius:** cards 20px, keys and pills 14px (12px on phones), small cards 16px, inputs 9 to 10px, tags 10px.
- **Elevation:** cards use `0 8px 28px #2A336614`. Nothing else casts a shadow, except the focused keypad.
- Separate rows with 1px lines. Don't put each row in its own card.
- **Laptop:** the main content takes the remaining width, with a 340px side column.
- **Phone:** one full-width column. Cards lose their radius and shadow, and the main controls dock at the bottom in a sheet with 22px top corners.

## Components

| Component | Rules |
|---|---|
| Primary button | Accent fill, white text, one per area |
| Key: digit | `#F2F4FA` fill, primary text |
| Key: utility | `#E6E9F5` fill, secondary text |
| Key: operator | Accent-soft fill, accent text |
| Tab | Active tab has primary text and a 2px accent underline |
| Chip (filter) | 1px line, 14px radius. Active chip is dark fill with white text |
| Tag | Colour pair from the table, 10px radius |
| Input | White, 1px line. When active, 1.5px accent border and accent caret |
| Active row | `--color-bg-active` background, result in accent, label stays visible |
| Targeted control | When a control acts on something elsewhere, give it a 1.5px accent ring |

## Motion

| Moment | Animation | Duration | Easing |
|---|---|---|---|
| Press a key or button | Scale to 0.93 | 120ms | out |
| Ripple on press | Circle grows from the pointer, 28% opacity fading to 0 | 500ms | out |
| Value changes | Only the changed digits slide up 70% and fade in, 18ms apart | 460ms | spring |
| Dependent rows update | Each row's tag colour at 26% fades out, 70ms apart | 800ms | out |
| Summary chip or total updates | Scale to 1.09 and back | 500ms | spring |
| New item appears | Rises 26px and fades in | 550ms | spring |
| Popover or card opens | Scales from 0.85 | 420ms | spring |
| Filter hides rows | Height collapses and fades | 320ms | out |
| Page loads | Main content rises 26px once | 600ms | out |

**Rules**
- Stagger follows dependency order, so people can trace what caused what.
- Keep springs for small elements. Large panels use the smooth easing.
- Don't loop anything except a text caret.
- With `prefers-reduced-motion: reduce`, turn all animation off and apply changes instantly. `src/app.css` already has a block for this.

## Accessibility

- Don't use `--color-text-faint` for anything people must read: it is below 4.5:1 on white.
- Don't rely on colour alone. Tags also show their name.
- Every control needs a visible focus state: a 2px accent outline with 2px offset.
- Touch targets on phones should be at least 40px tall.
- Icon-only buttons need an `aria-label`.

## Not defined yet

- Final colour for each tool, and how tags beyond five get their colours.
