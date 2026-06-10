---
name: Sahib design language (SongForge)
description: Decisions for applying the "Sahib (صاحب)" obsidian design system to SongForge
---

# Sahib design language — SongForge application

The Sahib spec (`attached_assets/design_*.md`) is an Arabic-first dark chat design system.
It was applied to SongForge as the canonical visual language.

## Durable decisions

- **Kept the app LTR.** Sahib's RTL rule is Arabic-content-specific; SongForge's chrome and
  content are English, so RTL would break layout. Only the visual system (color, type, radii,
  shadows, motion) was adopted, not the RTL/Arabic copy.
  **Why:** RTL on English content reverses alignment and reads broken.

- **Fonts:** Muna (the chrome face) is unshippable (ships only as .ttf elsewhere). Use the
  spec's own fallback chain with `IBM Plex Sans Arabic` as the working Latin face for all
  chrome/headings/body. `Aref Ruqaa` (`.font-song` utility) is reserved for **song titles only**
  (song-card h3 + song-detail h1) — never headings or body.

- **Orange rarity rule (most-violated, enforce it):** `#F7731E` (the `--primary` token) is the
  ONE high-intent action color. Reserve it for the Generate Dossier CTA, the logo square, and the
  input focus ring only. Everything secondary/decorative/navigational (section icons, chips, link
  affordances, timeline markers, export buttons) uses brand blue `#5E94FF` (`text-brand-blue` /
  `bg-brand-blue` / `border-brand-blue`, wired as `--color-brand-blue`).
  **Why:** code review failed the first pass for spreading orange onto decorative elements.

- **No glows (§7):** shadows are short, downward, low-opacity only. No `blur-3xl` glow blobs, no
  glow rings. Hover = color wash (border/bg shift), never scale/translate. Press = `scale(0.98)`.

- **Prompt bar:** the generate input uses the `.prompt-glow` animated orange→blue gradient rim
  (mask-border technique, `@property --sh-angle`, 6s linear), radius 17, on a `bg-secondary` base.
