# Heartland Mutual — Insurance Website (Demo)

An **original, fictional** insurance company website built as a front-end
learning project. It demonstrates the structure and interactions a modern
insurance marketing site uses — a mega-menu, a multi-step quote form, an
agent finder, a testimonial carousel, and an FAQ accordion — using only
HTML, CSS, and vanilla JavaScript (no frameworks, no build step, no
dependencies).

> **Not a real company.** "Heartland Mutual" is invented. Nothing is sold,
> no data is collected or transmitted, and it is not affiliated with any
> real insurer. Every form runs entirely in your browser.

## Run it

No build needed. Either:

```bash
# option A: just open the file
open index.html          # macOS   (use `xdg-open` on Linux)

# option B: serve it (nicer for smooth-scroll + relative paths)
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Project layout

```
.
├── index.html            # all markup / page structure
├── assets/
│   ├── css/styles.css    # design tokens + components + responsive rules
│   ├── js/app.js         # all interactivity (commented by section)
│   └── img/              # (empty — the art is inline SVG, no binary images)
└── README.md
```

## What each feature teaches

| Feature | File / section | Technique shown |
|---|---|---|
| Sticky header + scroll shadow | `app.js` §3 | `scroll` listener toggling a class |
| Mega-menu dropdown | `app.js` §3 + `.mega-menu` CSS | accessible click toggle, outside-click & `Esc` to close |
| Mobile hamburger menu | `app.js` §3 | `hidden` attribute + `aria-expanded` |
| Product cards | `app.js` §1–2 | rendering a list from a data array |
| Multi-step quote form | `app.js` §4 | step state, per-step validation, `aria-invalid` |
| Live premium estimate | `app.js` §4 | a small transparent pricing formula |
| Agent finder | `app.js` §5 | ZIP → region lookup, dynamic results |
| Testimonial carousel | `app.js` §6 | transform-based slider, dots, autoplay with pause-on-hover |
| FAQ accordion | `app.js` §7 | `max-height` transition + `aria-expanded` |

## Design notes

- **CSS custom properties** (`:root` in `styles.css`) hold the color palette,
  spacing, and radii — change the brand color in one place (`--brand`).
- **Accessibility:** semantic landmarks, visible focus rings, `aria-*`
  attributes on interactive widgets, a `prefers-reduced-motion` block, and
  an `.sr-only` utility for screen-reader-only text.
- **No images:** the logo and hero art are inline SVG drawn from scratch, so
  there are no copyrighted assets and nothing extra to download.

## Make it your own

1. Rename the brand: search `Heartland` / `HeartlandMutual` in
   `index.html` + `README.md`. Choose a name that is **not** a look-alike of
   a real insurer.
2. Recolor: edit `--brand`, `--brand-dark`, `--accent` in `styles.css`.
3. Change products / FAQs / testimonials: edit the arrays at the top of
   `app.js` (§1) — the page rebuilds those sections from the data.

## License

Example code for learning — use and adapt freely. The brand name and copy
are fictional placeholders; replace them with your own.
