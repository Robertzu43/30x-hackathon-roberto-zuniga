# Ideas (not scope)

One line per idea, who had it, which AC it would serve. Nothing here gets built unless Roberto moves it to DECISIONS.md.
- Amount guard: count withholding and discount lines (ReteFuente, ReteICA, Descuento) in the line-item sum, so a Colombian invoice with retenciones is not a false «total no cuadra» (builder 7d, AC-14 / R-80).
- Amount guard: read a three-letter word before parentheses as a currency only when it is an ISO code, so «Total for (2) items: 500» is not a false nota_credito ESCALAR (builder 7e, AC-14 / R-82 (A)-(B)).
- Cloudflare Turnstile CAPTCHA on anonymous sign-in (Supabase supports it); needs a Turnstile site only Roberto can create (product, AC-96 / R-117, Q17).
- Open Bandeja instantly for a new trial and let the activity panel show the agent deciding in the background (product, AC-92 / R-120's rejected option; proposed again by the launcher at 21:42Z with QA's 14.6-18.4 s, R-139).
- ux-gate item 7 `7.usable`: count a busy (disabled, aria-busy) «Ejecutar agente» as usable like AC-97 target 5 does, or the trial screen fails 7.usable while the first-login pass runs once Task 52 lands Bandeja first (builder 52b, AC-91 item 7 / R-143).
- screen_period and screen_beneficiary still carry every decision ever with its checks (2.1 MB for the demo, archived invoices included), the same statement-timeout risk 20261018000100 removed from screen_inbox; the same join trims them, and `[observability] enabled = true` in wrangler.toml would keep 5xx causes readable (builder 52c, AC-97 target 3 / AC-98).
- One money form across the beneficiary page: the KPI tiles show "$1,800.00", while the agreement line and the table show "1,800 USD" (Task 33 gate, AC-104 / R-166).
- A hide flag for test policy versions, such as «QA21 vacía», in the demo company's history. Policies stay append-only. Today the rule is that QA writes go to a trial workspace (Task 33 gate, AC-30 / R-166).
- Before saying «No encontré este valor literal», match a date the document prints in another format, such as "Oct 18, 2026" (Task 33 gate, AC-77 / R-107 / R-166).
- Plainer words than «LLM» and «JEV» in the /demo pitch copy, for finance readers (Task 33 gate, AC-79 / R-166).
- A shorter top bar at 360 and 390 px. Today the bar takes about 275 px before the h1 (Task 33 gate, AC-91 / R-166).
- Show the six /demo agent-loop stages as one row of 6 at ≥ 1440 px, the way the README diagram draws the loop. R-171 chose 3 across (product, AC-116 / R-171).
- On any landing, in any tab, start an agent pass whenever the company has pending invoices, not only to resume the tab's own first-login pass. R-175 keys the resume on the tab's flag instead (orchestrator's option (a) as proposed, AC-107 / R-175).
- Add a play glyph to the README video thumbnail with an ffmpeg overlay. Today «▶ Ver el video» sits under a plain poster (product, AC-114 / R-169).
