# Translator Discord v3.3 — RTL readability update

## What changed

- Larger translated text in Discord using supported Markdown headings.
- Proper RTL isolation for Arabic, Egyptian Arabic, Modern Standard Arabic, Persian, and Hebrew.
- Embedded English words, URLs, model names, and acronyms are isolated as LTR so they do not flip the Arabic sentence visually.
- Cleaner AI prompt: translation output is plain text without extra Markdown or commentary.
- Original text remains visually separated below the translation.

## Update

Replace these files in the GitHub repository:

- `src/handlers.ts`
- `src/providers/translatorAI.ts`

Railway will redeploy automatically after the commit.
