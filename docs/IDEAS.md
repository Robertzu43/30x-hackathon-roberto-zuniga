# Ideas (not scope)

One line per idea, who had it, which AC it would serve. Nothing here gets built unless Roberto moves it to DECISIONS.md.
- Amount guard: count withholding and discount lines (ReteFuente, ReteICA, Descuento) in the line-item sum, so a Colombian invoice with retenciones is not a false «total no cuadra» (builder 7d, AC-14 / R-80).
- Amount guard: read a three-letter word before parentheses as a currency only when it is an ISO code, so «Total for (2) items: 500» is not a false nota_credito ESCALAR (builder 7e, AC-14 / R-82 (A)-(B)).
