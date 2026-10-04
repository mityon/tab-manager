# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.

If these files don't exist, proceed silently. The `/domain-modeling` skill creates them when terms or decisions get resolved.

## File structure

This repo uses a single context:

/
├── CONTEXT.md
├── docs/adr/
└── pages/

## Use the glossary's vocabulary

When your output names a domain concept, use the term as defined in `CONTEXT.md`. If the concept is missing, reconsider the term or note the gap for `/domain-modeling`.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface the conflict explicitly.
