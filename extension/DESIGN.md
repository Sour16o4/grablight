# Design System: Grablight

## 1. Visual Theme & Atmosphere
A darkroom contact sheet. The popup is a quiet, dense, charcoal surface where the only colour is the light: every file carries a small lens that is green, amber or red, and nothing else on screen is allowed to compete with it. Daily-app balanced density (5), offset asymmetric layout (6), fluid CSS motion (5). It should feel like a photographer's loupe: precise, mono-labelled, calm.

## 2. Color Palette & Roles
- **Darkroom** (#0E0E10) — popup canvas. Never pure black.
- **Plate** (#17171A) — raised areas: quality picker, hover states.
- **Paper Ink** (#ECEAE4) — primary text and the one inverse (light) button.
- **Dim Silver** (#8C8C94) — secondary text, metadata, mono labels.
- **Hairline** (rgba(236,234,228,0.09)) — 1px dividers between rows. Rows are not cards.
- **Lens Green** (#59B88A) — file should download.
- **Lens Amber** (#D9A441) — may fail / could not verify.
- **Lens Red** (#D2605A) — cannot download.
The lens colours are the only chroma in the interface. There is no brand accent colour; the primary action is Paper Ink on Darkroom.

## 3. Typography Rules
- **UI:** Geist (variable), tight tracking on the wordmark, hierarchy by weight and tone, not size.
- **Data:** Geist Mono for sizes, types, counts, hostnames, timestamps. All numbers are mono.
- **Banned:** Inter, any serif.

## 4. Component Stylings
- **Lens:** 9px disc with a 3px same-hue ring at 22% opacity (a ring, not a glow). The reason for the colour is always in its tooltip and, if not green, printed under the file name.
- **Rows:** 44px thumbnail tile, name, mono meta line, lens, one action. Separated by hairlines, no fills, no nested cards. Images show their real thumbnail; other kinds show a drawn glyph.
- **Primary button:** Paper Ink fill, Darkroom text, 1px downward translate on press, no glow.
- **Quality picker:** inline under its row on a Plate surface; the chosen quality has a 2px Paper Ink rule on its left edge.
- **Progress:** a 2px line, not a fat bar.
- **Scanning:** skeleton rows with a shimmer, matching real row dimensions. No spinners.
- **Empty states:** a drawn aperture mark and one plain sentence.

## 5. Layout Principles
380px wide. Header is left-aligned wordmark with the page host in mono on the right. Tabs are text with mono counts, active tab marked by a 2px rule. A summary line of three mono counts (ready, may fail, blocked), each with its lens, sits above the list. Files are grouped under sticky mono section labels (VIDEO, AUDIO, IMAGE, FILE). Long lists scroll inside the popup, never the page.

## 6. Motion & Interaction
Rows rise 6px and fade in with a 24ms stagger (transform and opacity only), easing cubic-bezier(0.22, 1, 0.36, 1). Shimmer on skeletons and on "Checking" in the hover pill. Everything is disabled under prefers-reduced-motion.

## 7. Anti-Patterns (Banned)
No emojis. No Inter. No pure black. No neon or outer glows. No gradient text. No custom cursors. No overlapping elements. No three equal cards. No filler copy ("Seamless", "Unleash"). No second accent colour.
