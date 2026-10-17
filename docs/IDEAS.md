# Ideas (not scope)

One line per idea, who had it, which AC it would serve. Nothing here gets built unless Roberto moves it to DECISIONS.md.
- Amount guard: count withholding and discount lines (ReteFuente, ReteICA, Descuento) in the line-item sum, so a Colombian invoice with retenciones is not a false «total no cuadra» (builder 7d, AC-14 / R-80).
- Amount guard: read a three-letter word before parentheses as a currency only when it is an ISO code, so «Total for (2) items: 500» is not a false nota_credito ESCALAR (builder 7e, AC-14 / R-82 (A)-(B)).
- Cloudflare Turnstile CAPTCHA on anonymous sign-in (Supabase supports it); needs a Turnstile site only Roberto can create (product, AC-96 / R-117, Q17).
- Open Bandeja instantly for a new trial and let the activity panel show the agent deciding in the background (product, AC-92 / R-120's rejected option; proposed again by the launcher at 21:42Z with QA's 14.6-18.4 s, R-139).
