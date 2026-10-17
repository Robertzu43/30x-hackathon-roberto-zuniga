# UX gate (D38, AC-91)

No screen merges and the video is not recorded until every screen of both experiences (finance user and vendor portal) passes this gate, verified in a real browser (Playwright + Chromium at /opt/pw-browsers/chromium) with screenshots committed under `docs/ux/<screen>-<width>-<lang>.png`:

1. Widths 360, 390, 768, 1024 and 1440 px, es and en: no horizontal scroll, no overlapping or clipped text, no element off-screen, layout reflows (tables become cards or scroll inside their own container on mobile).
2. Touch targets at least 44x44 px on mobile; form inputs at least 16 px font on mobile (no iOS zoom); the primary action reachable with the thumb.
3. Accessibility: axe-core run with zero serious or critical violations per screen; text contrast WCAG AA (4.5:1 body, 3:1 large); visible focus ring; every action usable by keyboard; labels on every input; `lang` attribute follows the chosen language.
4. Feedback: every action shows a response within 100 ms (pressed state, spinner or progress); no blank screen while loading (skeleton or message); no layout jump when data arrives (reserved space); empty, error and offline states designed, with a next step, in both languages.
5. Copy: no untranslated keys, no mixed languages on one screen, no developer words (null, undefined, error codes) shown to users, numbers and dates in the chosen locale.
6. Visual: the approved palette and type (D37) only; consistent spacing scale; one primary button per view; the logo present; no console errors or warnings; images and icons crisp at 2x.
7. Speed: first view usable in under 2 s on the deployed URL from a fresh browser; no interaction blocked more than 300 ms.

A dedicated UX reviewer (fresh agent, preloaded design-taste-frontend and minimalist-ui, never the builder) checks the screenshots and the axe/console output against this list; each failed item is a blocking finding regardless of the usual >= 95 confidence bar. Two failed rounds on the same screen go to product to simplify the screen, never to lower the bar.

## Run it

```
npm run ux:gate -- --base <url> --screens inbox,policy      # a UI task's own screens
npm run ux:gate -- --base <url>                             # every screen
```

It writes `docs/ux/<screen>-<width>-<lang>.png` (device scale 2 at 360 and 390, 1 otherwise) and `docs/ux/gate-<experience>.md` (PASS or FAIL per item with the measured number; screens a partial run did not touch keep their old section). Exit code 1 when any item failed. Chromium is `/opt/pw-browsers/chromium`, or `GATE_CHROMIUM`. Playwright is the local or the global install.

Screen ids: finance `login tour inbox new-invoice (file, email, chat) detail-pagar detail-frenar detail-escalar detail-unread ask policy beneficiaries period approve demo`; vendor `portal portal-reply portal-error status status-invalid`. `inbox beneficiaries period portal status` also run their `empty`, `error` and `offline` states (ids `inbox-empty` and so on). `policy` runs `policy-fx-empty` (GET /api/fx answers `{provider, rates: []}`) and `policy-fx-error` (GET /api/fx answers 500); the rest of the screen loads normally. Each is checked by `4.state` in es and en: a message with `role="alert"` or `"status"` and a next step.

| Flag | Meaning |
|---|---|
| `--base <url>` | the app (finance) or the `facturas` Worker (vendor); default `$GATE_BASE` or `http://127.0.0.1:8787` |
| `--screens a,b` | ids or base ids (`new-invoice`); default all |
| `--only 3.axe,4` | run only the checks whose id starts with these |
| `--palette` | only the colour audit (`--only 6.palette`), no screenshots or gate file |
| `--mutate` | let the primary-action test and `portal-reply` really send. Default: non-GET requests never reach the app; they are answered `{"ok":true}` after 600 ms |
| `--route id=/path` | override a screen's path (for example `ask`, `portal`) |
| `--approve-token`, `--status-token` | real tokens for `approve` and `status` (`status` is skipped without one) |

Finance screens sign in as the public demo user (AC-46) by injecting its session. `detail-*` use the demo inbox's invoices by outcome; `detail-unread` opens the first invoice that has no outcome yet or whose reader failed (`fields.read_error`); the demo may have none, and then the screen is reported N/A (with the reason), never FAIL, because no screen exists to test.

## What the script measures, and what stays with the UX reviewer

Measured per screen, width and language: `1.scroll 1.offscreen 1.clip 1.overlap 1.tables 2.targets 2.inputs 2.primary 3.axe 3.contrast 3.labels 3.lang 4.cls 4.loading 5.words 5.mixed 5.locale 6.palette 6.fonts 6.logo 6.images 6.console 7.usable 7.longtask`. At 390 px, once per language: `3.focus 3.enter 4.busy` (Tab to the primary action, ring, Enter, busy within 100 ms) and `4.loading` (data requests held 1.5 s). Per state: `4.state`.

- Items judged by the UX reviewer from the screenshots: one primary button per view (the count is printed as `6.primary_count`, INFO), the spacing scale, and the meaning of the copy.
- The primary action is `button.primary` (override per screen in `SCREENS`). `2.primary` scrolls the primary's form to the bottom of the viewport and needs the button in the lower 60%, or inside a fixed or sticky ancestor.
- The logo is any visible `[data-logo]`, `.logo`, image or element whose alt or aria-label contains "logo".
- A designed state marks its message with `role="alert"`, `role="status"` or class `error`, `empty`, `state`; the container of that message must hold the next step (a button or link, or a verb such as "recarga" or "retry").
- `5.words` flags null, undefined, NaN, [object Object], dotted keys, stack traces, and error codes only as such: after "error", "HTTP", "status" or "code", or as a standalone 400, 401, 403, 404, 405, 408, 409, 422, 429, 500, 502, 503 or 504. An amount such as "160 USD" is not flagged.
- `5.mixed` compares visible text nodes with the other language's UI dictionary (`src/i18n/es.ts`, `en.ts`, `features/*.ts`); stored data is not in the dictionary, so it is excepted.
- Approved palette and fonts: the colours and the three font stacks of `web/styles.css` at 6d34830 (`PALETTE` and `FONTS` in the script; the test compares them with that commit).
