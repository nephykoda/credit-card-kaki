---
name: sg-cards
description: >-
  Answer questions about Singapore credit cards (all 11 issuers: DBS/POSB,
  OCBC, UOB, Citi, HSBC, Standard Chartered, Maybank, Bank of China, Amex,
  Trust, co-brands) from locally archived, versioned terms & conditions.
  Use for "best card for miles/petrol/cashback", rate caps, fees, exclusions,
  or "what changed in the T&C". Keeps answers accurate via hash-verified
  freshness checks against issuer documents.
---

# sg-cards — Singapore credit card T&C archive

A local, versioned archive of Singapore credit card fine print, plus search.
Ground answers in these documents — not memory — because card terms change
silently and often.

## Commands (run from this skill's directory)

```bash
node sgcards.mjs list                                  # catalog + what's fetched
node sgcards.mjs fetch                                 # bootstrap: download missing docs
node sgcards.mjs check                                 # revalidate all docs (fast, conditional GETs)
node sgcards.mjs grep "miles per S\$"                   # search extracted T&C text
node sgcards.mjs grep "petrol" --issuer dbs --card posb-everyday
node sgcards.mjs grep "cashback" --all                 # include historical versions
node sgcards.mjs diff uob/card/uob-one/card-tnc        # latest two versions, clause diff
node sgcards.mjs add <issuer> card <id> <type> "<label>" <url>   # register a new doc
```

## Session flow

1. **Freshness first**: before answering anything rate- or term-sensitive, run
   `node sgcards.mjs check`. It is cheap (conditional GETs; ~1s per doc) and
   catches silent T&C edits by hash. If docs UPDATED, mention the change date.
2. **Search, don't recall**: use `grep` (broad regex, then narrow with
   `--issuer`/`--card`) to find the governing clauses. Read the matched `.txt`
   files around the hit lines — grep output is a pointer, not the answer.
3. **Cite**: quote the clause and cite `docId @ version date`, e.g.
   "UOB ONE Card T&C, version 2025-11-30".
4. **Comparisons** ("best card for miles"): grep the category keywords across
   ALL issuers (no issuer filter), compare earn rates *including caps,
   exclusions and minimum spend* from the fine print — that is this tool's
   edge over marketing comparison sites. If a card is missing from the
   catalog, say so explicitly rather than guessing.
5. **"What changed?"**: run `diff <docId>`, then summarize the `-/+` clauses
   in plain English with both version dates. Use `grep --all` to trace when a
   term appeared historically.
6. **New cards / new docs**: web-search for the card's official T&C URL
   (issuer domain only), verify it loads, then `add` + `fetch`, and suggest a
   PR upstream.
7. **Blocked downloads**: if `fetch`/`check` reports `UNREACHABLE`, an HTTP
   error, or "archived Exa-extracted text (no original PDF)", use your
   harness's built-in browser (Claude in Chrome, Codex in-app Browser, Cursor
   Browser, Hermes browser tools, OpenClaw browser, browser-use CLI, ...) to
   open the doc's URL and save the file locally — a real browser session has
   the right fingerprint and geo to pass CDN bot checks. Then archive it:
   ```bash
   node sgcards.mjs import <docId> <saved-file>
   ```
   Import runs the same hash/version/extract machinery, so the original PDF
   lands in the archive with full text — a strict upgrade over the text-only
   fallback. As a last resort, ask the user to save the file themselves.

## Notes

- Data lives in `data/docs/<docId>/<date>-<hash8>.{pdf,html,txt}` — old
  versions are never deleted; history is the feature.
- `check` reporting `HTTP 404/ERROR` means a bank moved a document: fix the
  catalog URL (PR) — do not silently drop it.
- PDF text needs `pdftotext` (poppler). Without it, extraction falls back to
  Exa's keyless MCP; if both fail the PDF is still archived, just not greppable.
- Not financial advice; terms are the bank's own documents — always point
  users to the issuer's page for the authoritative current version.
