# sg-cards

Local, versioned archive of **Singapore credit card terms & conditions** — all 11 issuers — with fast full-text search and silent-change detection, packaged as an [Agent Skills](https://agentskills.io) plugin that works with any agent harness that can run shell commands.

## Why

- SG has 100+ credit cards; each T&C is a 20–100 page PDF.
- Banks **update T&Cs silently** — holders rarely notice.
- Comparison sites show marketing rates, not the fine print (caps, exclusions, minimum spends).

sg-cards fixes all three: every card's governing documents archived locally, **every version kept forever** (so "what changed over time" is answerable), and freshness verified by **hash, not by search** — conditional HTTP GETs detect even unannounced same-URL edits.

## Install (per harness)

Clone the repo, then point your harness at the folder:

| Harness | How |
|---|---|
| pi | add path to `skills` in settings, or copy to `~/.pi/agent/skills/sg-cards/` |
| Claude Code | `cp -r` into `~/.claude/skills/` |
| Codex | `cp -r` into `$CODEX_HOME/skills/` |
| OpenClaw | copy into your OpenClaw workspace skills dir (or `openclaw migrate`) |
| Cursor / Hermes / any terminal | just run the commands below |

## Usage

```bash
node sgcards.mjs fetch        # first run: download + extract all cataloged docs
node sgcards.mjs check        # revalidate (fast); versions any doc that changed
node sgcards.mjs grep "miles per S\$"
node sgcards.mjs diff uob/card/uob-one/card-tnc
node sgcards.mjs list
```

Data layout: `data/docs/<issuer>/<issuer|card>/<id>/<type>/<date>-<hash8>.{pdf,html,txt}` + `data/manifest.json`. Append-only — nothing is ever deleted.

Requirements: node ≥18. `pdftotext` (poppler) recommended for PDF extraction; without it, extraction falls back to Exa's free keyless MCP.

## Coverage

All 11 issuers seeded: DBS/POSB, OCBC, UOB, Citi, HSBC, Standard Chartered, Maybank, Bank of China, Amex, Trust Bank, plus co-brands (SAFRA-DBS, BOC Zaobao). The catalog (`catalog/*.json`) is community-maintained — see [CONTRIBUTING.md](CONTRIBUTING.md) to add cards and documents.

## Disclaimer

Not financial advice. Answers are grounded in the banks' own published documents; always confirm with the issuer's official page before acting. Respect issuer websites — this tool only fetches publicly published legal documents, politely (throttled, conditional GETs).
