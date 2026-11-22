---
version: alpha
name: Incodet
description: |
  Incodet's design system embodies a modern, professional SaaS aesthetic
  grounded in clarity and technological confidence. The visual language merges a
  predominantly dark (#000000) foundation with bright, accent-driven highlights
  to create striking focal points. Typography is generous and purposeful, using
  DM Sans at substantial sizes with generous letter-spacing on display elements,
  conveying authority without severity. The colour palette oscillates between
  pure blacks and whites, complemented by carefully deployed accent hues
  (#FFFFFF and #3B6CF6) that guide user attention. Layered shadows and gradient
  overlays add subtle depth without compromising readability. This is design
  built for conversion: minimal visual noise, maximum impact, and an emphasis on
  actionable elements rendered in pill-shaped, rounded buttons.
source:
  url: "https://incodet.com"
  pagesAnalyzed: 1
  extractedAt: 2026-11-20
  tokensMeasured: true
colors:
  primary: "#FFFFFF"
  accent: "#3B6CF6"
  canvas: "#000000"
  surface: "#F2F3F5"
  on-primary: "#0A0A0A"
  ink: "#FFFFFF"
  body: "#B3B3B3"
  muted: "#6B6B6B"
  faint: "#4D4D4D"
  hairline: "#E8E8E8"
  accent-1: "#C2410C"
  accent-2: "#5B3FD9"
  accent-3: "#0F5C55"
  accent-4: "#3B4F7A"
  accent-5: "#7E22CE"
  accent-6: "#0B5F8F"
  neutral-1: "#111111"
typography:
  display-xxl:
    fontFamily: "DM Sans"
    fontSize: 76px
    fontWeight: 500
    lineHeight: 1.06
    letterSpacing: -1.9px
  display-xl:
    fontFamily: "DM Sans"
    fontSize: 72px
    fontWeight: 400
    lineHeight: 1
    letterSpacing: 0px
  display-lg:
    fontFamily: "DM Sans"
    fontSize: 64px
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: -1.28px
  display-md:
    fontFamily: "DM Sans"
    fontSize: 52px
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: -1.04px
  display-sm:
    fontFamily: "DM Sans"
    fontSize: 48px
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: -1.2px
  display-xs:
    fontFamily: "DM Sans"
    fontSize: 44px
    fontWeight: 500
    lineHeight: 1.12
    letterSpacing: 0px
  heading-xl:
    fontFamily: "DM Sans"
    fontSize: 36px
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: -0.9px
  heading-lg:
    fontFamily: "DM Sans"
    fontSize: 32px
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: 0px
  heading-lg-tight:
    fontFamily: "DM Sans"
    fontSize: 32px
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: -0.64px
  heading-md:
    fontFamily: "DM Sans"
    fontSize: 26px
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: 0px
  heading-sm:
    fontFamily: "DM Sans"
    fontSize: 24px
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: -0.36px
  heading-xs:
    fontFamily: "DM Sans"
    fontSize: 17px
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: 0px
  quote:
    fontFamily: "DM Sans"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.63
    letterSpacing: 0px
  body-lg:
    fontFamily: "DM Sans"
    fontSize: 19px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0px
  body-md:
    fontFamily: "DM Sans"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0px
  body-md-loose:
    fontFamily: "DM Sans"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0px
  body-md-strong:
    fontFamily: "DM Sans"
    fontSize: 16px
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: 0px
  body-sm:
    fontFamily: "DM Sans"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0px
  body-sm-strong:
    fontFamily: "DM Sans"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0px
  button:
    fontFamily: "DM Sans"
    fontSize: 18px
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: 0px
  caption:
    fontFamily: "DM Sans"
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0px
rounded:
  none: 0px
  xs: 9px
  sm: 16px
  md: 28px
  lg: 40px
  full: 9999px
spacing:
  xxs: 8px
  xs: 12px
  sm: 16px
  md: 20px
  lg: 24px
  xl: 32px
  xxl: 40px
  xxxl: 48px
  section: 64px
  band: 80px
borderWidths:
  thin: 1px
shadows:
  sm: "rgba(0, 0, 0, 0.35) 0px 18px 30px -10px"
  md: "rgba(0, 0, 0, 0.2) 0px 28px 70px -18px"
  lg: "rgba(0, 0, 0, 0.4) 0px 8px 32px 0px, rgba(255, 255, 255, 0.2) 0px 1px 2px 0px inset"
  xl: "rgba(0, 0, 0, 0.22) 0px 12px 28px -6px, rgba(0, 0, 0, 0.1) 0px 2px 5px 0px"
elevationStrategy: layered-micro
themes:
  derived: light   # the other theme is the site's measured palette
  light:
    bg: "#F7FAFF"
    surface: "#EDF0F5"
    surfaceRaised: "#E6E9ED"
    text: "#13161C"
    textMuted: "#696C70"
    border: "#D4D7DB"
    accent: "#275DF5"
    accentFg: "#FFFFFF"
    focusRing: "#3B6CF6"
    elevation: shadow
  dark:
    bg: "#000000"
    surface: "#F2F3F5"
    surfaceRaised: "#F3F4F6"
    text: "#FFFFFF"
    textMuted: "#B3B3B3"
    border: "#E8E8E8"
    accent: "#3B6CF6"
    accentFg: "#FFFFFF"
    focusRing: "#3B6CF6"
    elevation: "border+surface"
  contrastFailures:
    - "dark: text on surface = 1.11:1 (needs 4.5:1)"
gradients:
  - context: section
    kind: radial
    value: "radial-gradient(at 50% 0px, rgba(255, 255, 255, 0.5), rgba(0, 0, 0, 0) 65%)"
  - context: section
    kind: linear
    value: "linear-gradient(to top, oklab(0 0 0 / 0.1) 0%, rgba(0, 0, 0, 0) 50%, rgba(0, 0, 0, 0) 100%)"
  - context: section
    kind: radial
    value: "radial-gradient(at 50% 0px, rgba(255, 255, 255, 0.09), rgba(0, 0, 0, 0) 60%)"
  - context: section
    kind: linear
    value: "linear-gradient(to top, oklab(0.164513 0.000114322 -0.0130809 / 0.85) 0%, oklab(0.164513 0.000114322 -0.0130809 / 0.35) 50%, rgba(0, 0, 0, 0) 100%)"
  - context: section
    kind: linear
    value: "linear-gradient(rgba(0, 0, 0, 0.42), rgba(0, 0, 0, 0))"
  - context: section
    kind: linear
    value: "linear-gradient(rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.48))"
components:
  button-outline:
    typography: "{typography.caption}"
    textColor: "{colors.faint}"
    border: "1px solid oklab(0.999994 0.0000455678 0.0000200868 / 0.3)"
    height: 52px
    padding: "4px 4px 4px 4px"
    boxShadow: "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.4) 0px 8px 32px 0px, rgba(255, 255, 255, 0.2) 0px 1px 2px 0px inset"
    rounded: "3.35544e+07px"
    backgroundColor: "oklab(0 0 0 / 0.35)"
  button-filled:
    typography: "{typography.body-md-strong}"
    textColor: "{colors.ink}"
    height: 48px
    padding: "0px 24px 0px 24px"
    boxShadow: "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.35) 0px 18px 30px -10px"
    rounded: "3.35544e+07px"
    backgroundColor: "{colors.on-primary}"
  button-filled-sm:
    typography: "{typography.caption}"
    textColor: "{colors.ink}"
    height: 16px
    padding: "8px 16px 8px 16px"
    rounded: "3.35544e+07px"
    backgroundColor: "{colors.on-primary}"
  button-outline-sm:
    typography: "{typography.body-md-strong}"
    textColor: "{colors.on-primary}"
    border: "1px solid {colors.hairline}"
    height: 48px
    padding: "0px 24px 0px 24px"
    boxShadow: "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.12) 0px 10px 40px -12px"
    rounded: "3.35544e+07px"
    backgroundColor: "{colors.primary}"
  card:
    typography: "{typography.caption}"
    textColor: "{colors.ink}"
    border: "1px solid rgb(34, 34, 34)"
    padding: "32px 32px 32px 32px"
    rounded: "{rounded.md}"
    backgroundColor: "{colors.canvas}"
  card-featured:
    typography: "{typography.caption}"
    textColor: "{colors.faint}"
    border: "1px solid {colors.hairline}"
    padding: "32px 32px 32px 32px"
    rounded: "{rounded.md}"
    backgroundColor: "rgb(247, 248, 248)"
  card-featured-lg:
    typography: "{typography.caption}"
    textColor: "{colors.on-primary}"
    boxShadow: "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.2) 0px 28px 70px -18px"
    rounded: "{rounded.lg}"
    backgroundColor: "rgb(223, 241, 234)"
  badge-text:
    typography: "{typography.body-md-strong}"
    textColor: "{colors.on-primary}"
    height: 48px
    padding: "0px 24px 0px 24px"
    boxShadow: "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.35) 0px 18px 30px -10px"
    rounded: "3.35544e+07px"
    backgroundColor: "{colors.primary}"
  badge-text-sm:
    typography: "{typography.body-sm-strong}"
    textColor: "{colors.on-primary}"
    height: 40px
    padding: "0px 20px 0px 20px"
    boxShadow: "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.35) 0px 18px 30px -10px"
    rounded: "3.35544e+07px"
    backgroundColor: "{colors.primary}"
  footer:
    typography: "{typography.caption}"
    textColor: "{colors.faint}"
    padding: "112px 0px 128px 0px"
    backgroundColor: "{colors.primary}"
  link:
    typography: "{typography.caption}"
    textColor: "oklab(0.144788 7.45058e-9 7.45058e-9 / 0.9)"
    boxShadow: "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.22) 0px 12px 28px -6px, rgba(0, 0, 0, 0.1) 0px 2px 5px 0px"
    rounded: "3.35544e+07px"
    backgroundColor: "{colors.primary}"
  link-lg:
    typography: "{typography.body-md}"
    textColor: "{colors.faint}"
    padding: "3px 0px 3px 0px"
    rounded: 8px
states:
  nav-hover:
    target: nav
    state: hover
    opacity: 1
  other-disabled:
    target: other
    state: disabled
    opacity: 0.7
  other-hover:
    target: other
    state: hover
    backgroundColor: "rgba(0, 0, 0, 0.45)"
  other-focus-visible:
    target: other
    state: focus-visible
    outlineWidth: 2px
  link-hover:
    target: link
    state: hover
    textDecoration: underline
  button-focus-visible:
    target: button
    state: focus-visible
    boxShadow: "rgba(0, 0, 0, 0.4) 0px 0px 0px 2px"
breakpoints:
  - width: 375
    containerWidth: 1920
    gridColumns: 0
    navLinksVisible: 0
    menuToggleVisible: true
    headingPx: 34
    bodyPx: 18
    sectionPaddingX: 20
  - width: 768
    containerWidth: 1920
    gridColumns: 0
    navLinksVisible: 0
    menuToggleVisible: true
    headingPx: 64
    bodyPx: 18
    sectionPaddingX: 20
  - width: 1024
    containerWidth: 1920
    gridColumns: 3
    navLinksVisible: 0
    menuToggleVisible: true
    headingPx: 76
    bodyPx: 18
    sectionPaddingX: 20
  - width: 1280
    containerWidth: 1920
    gridColumns: 6
    navLinksVisible: 0
    menuToggleVisible: true
    headingPx: 76
    bodyPx: 18
    sectionPaddingX: 20
  - width: 1440
    containerWidth: 1920
    gridColumns: 6
    navLinksVisible: 0
    menuToggleVisible: true
    headingPx: 76
    bodyPx: 18
    sectionPaddingX: 20
coverage:
  statesFound: 54
  gradientsFound: 7
  rolesUnassigned: 7
  archetypesUnnamed: 0
  archetypesDetected: 0
  responsiveMeasured: true
  stylesheetsBlocked: true
  semanticRampDeclared: false
---

# Design System Inspired by Incodet

## 1. Visual Theme & Atmosphere

Incodet's design system embodies a modern, professional SaaS aesthetic grounded in clarity and technological confidence. The visual language merges a predominantly dark (`{colors.canvas}` — `#000000`) foundation with bright, accent-driven highlights to create striking focal points. Typography is generous and purposeful, using DM Sans at substantial sizes with generous letter-spacing on display elements, conveying authority without severity. The colour palette oscillates between pure blacks and whites, complemented by carefully deployed accent hues (`{colors.primary}` — `#FFFFFF` and `{colors.accent}` — `#3B6CF6`) that guide user attention. Layered shadows and gradient overlays add subtle depth without compromising readability. This is design built for conversion: minimal visual noise, maximum impact, and an emphasis on actionable elements rendered in pill-shaped, rounded buttons.

**Key Characteristics**
- Dark-first foundation (`#000000` canvas) with white primary text and accents
- Generous, high-contrast typography hierarchy starting at `{typography.display-xxl}` (76px)
- Negative letter-spacing on large display text (−1.9px to −1.3px) for visual tightness
- Pill-shaped buttons (`{rounded.full}` — 9999px) as the dominant interactive pattern
- Subtle, layered shadows (`rgba(0, 0, 0, 0.35)` to `rgba(0, 0, 0, 0.4)`) for depth without distraction
- Colour-blocking strategy: depth from surface changes, not thick shadows
- High-converting CTA focus: brand white on dark, or dark on light, with consistent padding and sizing
- Gradient overlays (radial and linear) used sparingly on hero sections and card backgrounds

## 2. Color Palette & Roles

### Primary
- **Primary / Brand** (`{colors.primary}` — `#FFFFFF`): Primary text, headings, active states, and the dominant CTA fill on dark backgrounds. Acts as both ink and accent.
- **Brand Accent** (`{colors.accent}` — `#3B6CF6`): Secondary accent hue used alongside the achromatic primary; deployed in secondary CTAs and decorative accents.

### Accent Colors (Decorative)
- **Accent 1** (`{colors.accent-1}` — `#C2410C`): Warm burnt orange; no measured role—decorative only.
- **Accent 2** (`{colors.accent-2}` — `#5B3FD9`): Purple; no measured role—decorative only.
- **Accent 3** (`{colors.accent-3}` — `#0F5C55`): Teal; no measured role—decorative only.
- **Accent 4** (`{colors.accent-4}` — `#3B4F7A`): Slate blue; no measured role—decorative only.
- **Accent 5** (`{colors.accent-5}` — `#7E22CE`): Violet; no measured role—decorative only.
- **Accent 6** (`{colors.accent-6}` — `#0B5F8F`): Deep teal; no measured role—decorative only.

### Interactive
- **Canvas** (`{colors.canvas}` — `#000000`): Default page background; dominant surface.
- **On Primary** (`{colors.on-primary}` — `#0A0A0A`): Label and text colour on white/light brand surfaces.

### Neutral Scale
- **Surface** (`{colors.surface}` — `#F2F3F5`): Light card and panel backgrounds for contrast sections.
- **Body** (`{colors.body}` — `#B3B3B3`): Body copy colour on dark backgrounds; medium grey.
- **Muted** (`{colors.muted}` — `#6B6B6B`): Secondary and caption text; muted grey.
- **Faint** (`{colors.faint}` — `#4D4D4D`): Tertiary and placeholder text; very dark grey.
- **Neutral 1** (`{colors.neutral-1}` — `#111111`): Slight lift from pure black; used for subtle surface differentiation.

### Surface & Borders
- **Hairline** (`{colors.hairline}` — `#E8E8E8`): 1px borders, dividers, and subtle frame strokes.

## 3. Typography Rules

### Font Family
- **Primary:** DM Sans (https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400..700;1,9..40,400..700), weight 400–700, fallback: system sans-serif
- **Secondary (Accent):** Instrument Serif (https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@1), italic, for decorative headings and quotes

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|---|---|---|---|---|---|---|
| Display XXL | DM Sans | 76px | 500 | 1.06 | −1.9px | Hero headlines; primary impact |
| Display XL | DM Sans | 72px | 400 | 1.0 | 0px | Large display; looser weight |
| Display LG | DM Sans | 64px | 500 | 1.1 | −1.28px | Secondary hero size |
| Display MD | DM Sans | 52px | 500 | 1.15 | −1.04px to −1.3px | Large section headers |
| Display SM | DM Sans | 48px | 500 | 1.15 | −1.2px | Medium display |
| Display XS | DM Sans | 44px | 500 | 1.12 | 0px | Smaller display headings |
| Heading XL | DM Sans | 36px | 500 | 1.25 | −0.9px | Large section title |
| Heading LG | DM Sans | 32px | 500 | 1.25 | 0px or −0.64px (tight) | Primary heading; flexible tracking |
| Heading MD | DM Sans | 26px | 500 | 1.25 | 0px | Standard heading |
| Heading SM | DM Sans | 24px | 500 | 1.25 | −0.36px | Smaller heading |
| Heading XS | DM Sans | 17px | 500 | 1.45 | 0px | Label and small title |
| Body LG | DM Sans | 19px | 400 | 1.45 | 0px | Large body text |
| Body MD | DM Sans | 16px | 400 | 1.45 | 0px | Standard body; also used on links |
| Body MD Strong | DM Sans | 16px | 500 | 1.45 | 0px | Emphasis within body |
| Body MD Loose | DM Sans | 16px | 400 | 1.5 | 0px | Relaxed line height variant |
| Body SM | DM Sans | 14px | 400 | 1.4 | 0px | Small body text; secondary copy |
| Body SM Strong | DM Sans | 14px | 500 | 1.4 | 0px | Emphasis within small text |
| Button | DM Sans | 18px | 500 | 1.45 | 0px | CTA text; standard button size |
| Caption | DM Sans | 18px | 400 | 1.45 | 0px | Image captions; decorative text |
| Quote | DM Sans | 15px | 400 | 1.63 | 0px | Blockquote and testimonial text |

### Principles
- Display sizes carry strong negative letter-spacing (−1.9px to −1.04px) to create visual density and impact.
- Body text uses 0px letter-spacing, with increased line-height (1.4–1.63) for legibility.
- Weight contrast is deliberate: 400 for body and secondary roles, 500 for headings and CTAs.
- Instrument Serif is reserved for decorative accents and italic emphasis; never used for body.
- Button text is set at `{typography.button}` (18px, 500 weight) to command visual attention.

## 4. Component Stylings

### Buttons

**Primary Filled**
- Background: `{colors.on-primary}` (`#0A0A0A`)
- Text: `{colors.primary}` (`#FFFFFF`)
- Font: DM Sans, 16px, weight 500, line-height 1.45
- Padding: `0px 24px`
- Height: 48px
- Border Radius: `{rounded.full}` (9999px)
- Border: None
- Shadow: `rgba(0, 0, 0, 0.35) 0px 18px 30px -10px`
- Hover: Background shifts to darker shade or opacity increases

**Secondary Outline**
- Background: `rgba(0, 0, 0, 0.35)`
- Text: `#4D4D4D`
- Font: DM Sans, 18px, weight 400, line-height 1.45
- Padding: `4px 4px`
- Height: 52px
- Width: 152px (inline-padded variant)
- Border: `1px solid oklab(0.999994 0.0000455678 0.0000200868 / 0.3)`
- Border Radius: `{rounded.full}` (9999px)
- Shadow: `rgba(0, 0, 0, 0.4) 0px 8px 32px 0px, rgba(255, 255, 255, 0.2) 0px 1px 2px 0px inset`

**Small Filled**
- Background: `{colors.on-primary}` (`#0A0A0A`)
- Text: `{colors.primary}` (`#FFFFFF`)
- Font: DM Sans, 18px, weight 400, line-height 1.45
- Padding: `8px 16px`
- Height: 16px (compact)
- Border Radius: `{rounded.full}` (9999px)
- Border: None
- Shadow: None

**Outline Inverse (Light Background)**
- Background: `{colors.primary}` (`#FFFFFF`)
- Text: `{colors.on-primary}` (`#0A0A0A`)
- Font: DM Sans, 16px, weight 500, line-height 1.45
- Padding: `0px 24px`
- Height: 48px
- Width: 247px (fitted)
- Border: `1px solid {colors.hairline}` (`#E8E8E8`)
- Border Radius: `{rounded.full}` (9999px)
- Shadow: `rgba(0, 0, 0, 0.12) 0px 10px 40px -12px`

### Cards & Containers

**Default Dark Card**
- Background: `{colors.canvas}` (`#000000`)
- Border: `1px solid #222222`
- Text: `{colors.primary}` (`#FFFFFF`)
- Padding: `{spacing.xl}` (32px)
- Border Radius: `{rounded.md}` (28px)
- Font: DM Sans, 18px, weight 400, line-height 1.45
- Shadow: None
- Width: 360px, Height: 720px (typical card)
- Hover: Background shifts to `#111111` (minimal lift)

**Featured Light Card**
- Background: `{colors.surface}` (`#F2F3F5`)
- Border: `1px solid {colors.hairline}` (`#E8E8E8`)
- Text: `#4D4D4D`
- Padding: `{spacing.xl}` (32px)
- Border Radius: `{rounded.md}` (28px)
- Font: DM Sans, 18px, weight 400, line-height 1.45
- Shadow: None
- Width: 392px, Height: 540px (fitted)

**Featured Large Elevated**
- Background: `#DFF1EA` (teal-tinged light surface)
- Border: None
- Text: `{colors.on-primary}` (`#0A0A0A`)
- Padding: `0px` (image-fill variant)
- Border Radius: `{rounded.lg}` (40px)
- Font: DM Sans, 18px, weight 400, line-height 1.45
- Shadow: `rgba(0, 0, 0, 0.2) 0px 28px 70px -18px`
- Width: 670px, Height: 760px

### Inputs & Forms
- **Border:** `1px solid {colors.hairline}` (`#E8E8E8`)
- **Border Radius:** `{rounded.sm}` (16px) or `{rounded.md}` (28px) depending on input type
- **Focus State:** `outline: 2px solid {colors.primary}` (`#FFFFFF`); `box-shadow: rgba(0, 0, 0, 0.4) 0px 0px 0px 2px`
- **Disabled State:** `opacity: 0.7`

### Navigation
- Background: `{colors.canvas}` (`#000000`)
- Text: `{colors.body}` (`#B3B3B3`)
- Active Link: `{colors.primary}` (`#FFFFFF`)
- Padding: `{spacing.md}` (20px) to `{spacing.lg}` (24px) horizontal spacing
- Font: DM Sans, 16px–18px, weight 400–500
- Hover State: `opacity: 1`; text colour brightens to white
- Border Radius: None (linear navigation) or `{rounded.full}` (9999px) for pill-style tabs

### Badges
- **Text Badge:** Background `{colors.primary}` (`#FFFFFF`), Text `{colors.on-primary}` (`#0A0A0A`), Font 16px / 500, Padding `0px 24px`, Height 48px, Border Radius `{rounded.full}` (9999px), Shadow `rgba(0, 0, 0, 0.35) 0px 18px 30px -10px`
- **Text Badge Small:** Background `{colors.primary}` (`#FFFFFF`), Text `{colors.on-primary}` (`#0A0A0A`), Font 14px / 500, Padding `0px 20px`, Height 40px, Border Radius `{rounded.full}` (9999px), Shadow `rgba(0, 0, 0, 0.35) 0px 18px 30px -10px`

## 5. Layout Principles

### Spacing System
The spacing scale follows an 8px base unit with geometric progression, enabling flexible composition while maintaining visual rhythm.

- **`{spacing.xxs}`** = 8px — tight spacing between inline elements
- **`{spacing.xs}`** = 12px — compact vertical and horizontal gaps
- **`{spacing.sm}`** = 16px — standard component inner padding
- **`{spacing.md}`** = 20px — medium spacing; section horizontal padding
- **`{spacing.lg}`** = 24px — large spacing; card padding; inter-component gaps
- **`{spacing.xl}`** = 32px — extra large; card content padding
- **`{spacing.xxl}`** = 40px — substantial spacing; column gaps
- **`{spacing.xxxl}`** = 48px — large vertical rhythm
- **`{spacing.section}`** = 64px — section-level vertical spacing
- **`{spacing.band}`** = 80px — full-width band padding top/bottom

### Grid & Container
- **Content Column:** 1920px max width (consistent across all measured breakpoints; grid columns adapt responsively)
- **Grid Columns:** 1 at 375px, 1–3 at 768px–1024px, 6 at 1280px+ (measured at key breakpoints)
- **Horizontal Section Padding:** `{spacing.md}` (20px) consistent across all viewport sizes
- **Section Stacking:** Vertical rhythm managed via `{spacing.section}` (64px) to `{spacing.band}` (80px) between major sections

### Whitespace Philosophy
Whitespace is strategic and generous. The dark canvas (`#000000`) acts as breathing room; content is clustered into high-contrast zones (white text on black, light cards on black). Padding within components is consistent (`{spacing.lg}` / 24px for cards, `{spacing.xl}` / 32px for larger containers), and spacing between sections is substantial (`{spacing.band}` / 80px), creating visual repose without dead space.

### Border Radius Scale
- **`{rounded.none}`** = 0px — sharp corners; images, full-width blocks
- **`{rounded.xs}`** = 9px — subtle softness; rare use
- **`{rounded.sm}`** = 16px — input fields, secondary containers
- **`{rounded.md}`** = 28px — primary card and container radius
- **`{rounded.lg}`** = 40px — large featured cards, premium surfaces
- **`{rounded.full}`** = 9999px — pill-shaped buttons, badges, fully rounded avatars

### Border Widths
- **Thin:** `1px` — hairline borders on cards, inputs, and dividers; applied universally across component frames

## 6. Depth & Elevation

| Level | Treatment | Use |
|---|---|---|
| Base / Flat | No shadow; background colour only | Cards on dark canvas; text layers |
| Subtle (sm) | `rgba(0, 0, 0, 0.35) 0px 18px 30px -10px` | Small lifted cards; badges |
| Medium (md) | `rgba(0, 0, 0, 0.2) 0px 28px 70px -18px` | Featured cards; moderate elevation |
| Strong (lg) | `rgba(0, 0, 0, 0.4) 0px 8px 32px 0px, rgba(255, 255, 255, 0.2) 0px 1px 2px 0px inset` | Buttons; interactive focus |
| Prominent (xl) | `rgba(0, 0, 0, 0.22) 0px 12px 28px -6px, rgba(0, 0, 0, 0.1) 0px 2px 5px 0px` | Premium card surfaces; deep links |

**Shadow Philosophy**
Incodet's elevation system uses layered, semi-transparent shadows (`rgba(0, 0, 0, 0.35)` to `rgba(0, 0, 0, 0.4)`) stacked at precise offsets to suggest subtle depth without heaviness. Shadows on light backgrounds include white insets (`rgba(255, 255, 255, 0.2) 0px 1px 2px inset`) to add luminosity. This is a **colour-blocking system**: depth primarily derives from surface colour shifts (e.g., `#000000` to `#111111`, or dark card to light card), with shadows as a secondary accent. No element carries more than two shadow layers; the aesthetic is minimalist, befitting a high-conversion SaaS interface.

### Opacity Levels
- **70% (`0.70`)** — disabled or secondary interactive states
- **75% (`0.75`)** — muted or de-emphasized elements
- **42% (`0.42`)** — background overlays; gradient darkening
- **35% (`0.35`)** — soft drop shadows; button backgrounds
- **25% (`0.25`)** — very faint overlays; subtle tints

### Z-index / Layering
- **Base Layers:** `z-index: 1–2` — standard content (cards, text)
- **Dropdown / Overlay:** `z-index: 10–50` — stacked dropdowns, modals, sticky elements, tooltips
- The extraction identified numeric z-index values (1, 2, 10, 20, 30, 40, 50) used across the site; specific component assignment varies based on DOM hierarchy.

## 7. Do's and Don'ts

### Do
- **Do use pill-shaped buttons** (`{rounded.full}` / 9999px) as the primary interactive pattern; they are the system's visual anchor.
- **Do maintain high contrast** between text and background. Primary white (`#FFFFFF`) on black (`#000000`), or on-primary black (`#0A0A0A`) on light surfaces.
- **Do apply negative letter-spacing** to display sizes (76px–44px) as specified in the typography table; this tightness is a defining trait.
- **Do use generous padding** within components (`{spacing.lg}` / 24px to `{spacing.xl}` / 32px); whitespace signals premium quality.
- **Do stack shadows carefully**: use the measured values (sm, md, lg, xl) without layering multiple shadows beyond what was extracted.
- **Do favour colour-blocking over subtle tints**: the dark canvas is your whitespace; use it to separate zones.
- **Do include focus rings** (`2px solid {colors.primary}`) on all interactive elements for keyboard accessibility.

### Don't
- **Don't round images or full-width blocks** — they use `{rounded.none}` (0px) for edge-to-edge impact.
- **Don't invent new shadow values** — use only the four defined elevation levels (sm, md, lg, xl).
- **Don't use Instrument Serif for body text** — it is decorative and italic only.
- **Don't break the spacing scale** — use values from the system (8px, 12px, 16px, 20px, 24px, 32px, 40px, 48px, 64px, 80px).
- **Don't add opacity to interactive text** on hover unless the extraction explicitly defined that state; rely on colour change instead.
- **Don't apply `{rounded.full}`** to anything other than buttons, badges, and avatars; cards use `{rounded.md}` (28px) or `{rounded.lg}` (40px).
- **Don't mix dark and light card backgrounds on the same section** without clear spatial separation; it breaks the visual hierarchy.

## 8. Responsive Behavior

### Breakpoints

| Viewport | Content Width | Grid Columns | Nav Links | Menu Toggle | Largest Heading | Body Text | Section Padding-X |
|---|---|---|---|---|---|---|---|
| 375px (Mobile) | 1920px | 1 | 0 | Yes | 34px | 18px | 20px |
| 768px (Tablet) | 1920px | 1–3 | 0 | Yes | 64px | 18px | 20px |
| 1024px (Small Desktop) | 1920px | 3 | 0 | Yes | 76px | 18px | 20px |
| 1280px (Desktop) | 1920px | 6 | 0 | Yes | 76px | 18px | 20px |
| 1440px+ (Large Desktop) | 1920px | 6 | 0 | Yes | 76px | 18px | 20px |

**Key Observations:**
- The content column remains fixed at 1920px across all breakpoints; layout adaptation happens via grid column count (1 → 3 → 6) and component stacking.
- Navigation links are never visible in the measured viewports; a menu toggle always appears.
- Heading sizes scale down at mobile (34px vs. 76px at desktop), but body text remains 18px consistently.
- Horizontal padding (`{spacing.md}` / 20px) never changes, ensuring consistent breathing room on small screens.

### Touch Targets
- **Minimum Tap Area:** 48px × 48px (buttons, links, form inputs)
- **Buttons:** Height 48px–52px; width 152px+ for filled variants; pill-shaped radius (`{rounded.full}`) enhances target size perception
- **Form Inputs:** Height 48px minimum; padding `0px 24px` for comfortable text entry
- **Badge/Small CTA:** Height 40px minimum; suitable for secondary actions

### Collapsing Strategy
- **Card Grids:** At 375px, stack to 1 column; at 768px, arrange 1–2 per row; at 1024px+, arrange 3–6 depending on card width.
- **Navigation:** Always hidden behind a toggle (no breakpoint shows nav links inline); mobile-first drawer pattern.
- **Typography Scale:** Display sizes reduce from 76px (desktop) to 34px (mobile); body text remains constant at 18px, prioritizing readability.
- **Padding Consistency:** Horizontal `{spacing.md}` (20px) is maintained across all breakpoints; vertical spacing adapts via component stacking.

## 9. Agent Prompt Guide

### Quick Color Reference
- **Primary CTA Fill:** On-Primary (`#0A0A0A`) or Primary (`#FFFFFF`) depending on background
- **Primary CTA Text:** Primary (`#FFFFFF`) on dark, On-Primary (`#0A0A0A`) on light
- **Page Background:** Canvas (`#000000`)
- **Card Background:** Canvas (`#000000`) or Surface (`#F2F3F5`) for contrast
- **Body Text:** Body (`#B3B3B3`) on dark backgrounds, On-Primary (`#0A0A0A`) on light backgrounds
- **Secondary/Caption Text:** Muted (`#6B6B6B`)
- **Borders:** Hairline (`#E8E8E8`)
- **Accent:** Accent (`#3B6CF6`) for secondary emphasis

### Iteration Guide

1. **Button as Hero Element:** Every primary CTA must be `{rounded.full}`, 48px tall, with `{spacing.sm}` padding (0px 24px), filled with `{colors.on-primary}` background, `{colors.primary}` text, and the `{typography.button}` style (18px / 500 weight).

2. **Typography Hierarchy is Non-Negotiable:** Use exact px sizes from the hierarchy table. Display sizes (76px, 64px, 52px) must include negative letter-spacing (−1.9px to −1.04px). Body sizes (16px, 14px) use 0px letter-spacing with 1.4–1.45 line-height.

3. **Cards Are Colour-Blocked, Not Shadowed:** Dark cards on black canvas use `{rounded.md}` (28px), `{spacing.xl}` padding (32px), and `1px solid #222222` borders. Light cards use `{colors.surface}` (`#F2F3F5`), `{colors.hairline}` borders, and no shadow (or measured `md` / `rgba(0, 0, 0, 0.2)` on featured variants).

4. **Spacing is Modular:** Use only the defined scale: 8px, 12px, 16px, 20px, 24px, 32px, 40px, 48px, 64px, 80px. Horizontal section padding is always `{spacing.md}` (20px). Card/container padding is `{spacing.lg}` (24px) or `{spacing.xl}` (32px).

5. **Shadows Obey Four Levels:** sm (`rgba(0, 0, 0, 0.35) 0px 18px 30px -10px`), md (`rgba(0, 0, 0, 0.2) 0px 28px 70px -18px`), lg (`rgba(0, 0, 0, 0.4) 0px 8px 32px 0px, rgba(255, 255, 255, 0.2) 0px 1px 2px inset`), xl (`rgba(0, 0, 0, 0.22) 0px 12px 28px -6px, rgba(0, 0, 0, 0.1) 0px 2px 5px 0px`). Never layer more than two shadows.

6. **Borders Are Always Thin:** Apply `1px solid {colors.hairline}` (`#E8E8E8`) to cards, inputs, and dividers. No thicker borders unless directly extracted.

7. **Focus States Are Mandatory:** All interactive elements must include `:focus-visible` with `outline: 2px solid {colors.primary}` (`#FFFFFF`) and `box-shadow: rgba(0, 0, 0, 0.4) 0px 0px 0px 2px`. No element is exempt.

8. **Disable Opacity Tiers:** Use `opacity: 0.7` for standard disabled states; `opacity: 0.35–0.5` for background overlays.

9. **Border Radius Per Role:** Buttons and badges = `{rounded.full}` (9999px). Cards = `{rounded.md}` (28px) or `{rounded.lg}` (40px). Inputs = `{rounded.sm}` (16px) or `{rounded.md}` (28px). Images = `{rounded.none}` (0px).

10. **Mobile-First Responsive:** At 375px, stack to single column; at 768px, expand to 1–3 columns; at 1024px+, use full 6-column grid. Horizontal padding never changes (`{spacing.md}` / 20px). Display heading shrinks to 34px at mobile; body text stays 18px.

## 10. Known Gaps

- **Semantic Status Colours (Error, Success, Warning):** The site does not declare error, success, or warning states in its markup. No semantic colour ramp was extracted; do not invent these roles.
- **Interaction States Not Captured:** Hover, active, focus, and disabled states were partially extracted from stylesheets but may be incomplete. Specific multi-state transitions (e.g., button active → pressed → released) are not fully documented here.
- **7 Accent Colours Unassigned:** Colours `{colors.accent-1}` through `{colors.accent-6}` have no measured role in the UI. They may be reserved for future use or deployed in surfaces not captured during extraction. Treat them as decorative only unless you discover their use.
- **Cross-Origin Stylesheets:** Some CSS may have been blocked due to CORS; full cascade and computed styles are not guaranteed complete.
- **Dark Mode / Theme Variants:** Only a single theme (dark canvas, light accents) was observed. No derived or alternate theme was measured.
- **Authentication-Gated Content:** The extraction analysed only publicly visible pages. CMS dashboards, user profiles, and account management UIs were not visited.
- **Motion & Animation:** No CSS animations, transitions, or `@keyframes` rules were extracted. Hover and focus styles are listed, but animation duration, easing, and keyframe details are absent.
- **Specific Font Weights in Use:** While DM Sans supports 400–700, only 400 and 500 were observed. Other weights may exist but were not captured.
- **Gradient Colour Stops (Precise):** Gradient overlays were extracted verbatim in their CSS form (radial, linear, oklab colour space) but exact visual rendering depends on browser and device colour profile support.
- **Print / High-Contrast Styles:** No print media queries or `@media (prefers-contrast)` rules were observed.

---

**Document Confidence:** This DESIGN.md is built on extraction from 1 page (https://incodet.com). All hexadecimal values, typography sizes, spacing units, and component specifications are direct measurements. Where gaps exist, they are listed above; do not assume unobserved values. An AI coding assistant should be able to implement a faithful UI from this document alone.
