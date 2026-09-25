# Contributing

The catalog (`catalog/*.json`) is the heart of sg-cards. One file per issuer:

```json
{
  "issuer": "dbs",
  "displayName": "DBS / POSB",
  "issuerDocs": [ { "type": "cardmember-agreement", "label": "...", "url": "https://issuer-domain/....pdf" } ],
  "cards": [ { "id": "posb-everyday", "name": "POSB Everyday Card",
               "docs": [ { "type": "card-tnc", "label": "...", "url": "https://..." } ] } ]
}
```

## Adding a card or document

1. Find the **official T&C URL on the issuer's own domain** (no aggregators/mirrors).
2. Verify it: `curl -sIL "<url>" | head` — must return 200 and be the real document.
3. Register it:
   ```bash
   node sgcards.mjs add <issuer> card <card-id> <type> "<label>" <url>
   # types: cardmember-agreement, card-tnc, rewards-tnc, fees, product-terms ...
   ```
4. Fetch and confirm it extracts to text: `node sgcards.mjs fetch && node sgcards.mjs grep "<card-id>"`
5. PR the catalog JSON change.

## Rules

- One doc entry per distinct document URL; never edit an existing URL in place unless the bank moved it (then note the move in your PR).
- Card `id` is stable lowercase-kebab; doc `type` follows existing conventions.
- Don't commit the `data/` directory — users build their own local archive and history.
- If `check` reports a 404 for a doc you added, fix it promptly — a catalog entry that 404s is worse than none.
