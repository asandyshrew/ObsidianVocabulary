# Lexicon

The Obsidian-Lexicon plugin manages synonyms across your entire vault for hotswapping terms.

## Features

- Lexicon modal that tracks term usage count.
- A refactor system to hot swap all synonyms with the chosen term.
- Word frequency view listing case-insensitive counts for every word in Markdown files.

Open the **Word frequency** view from the command palette. It appears in the right sidebar, scans changed Markdown files every 30 seconds, and includes a word search field. The modal usage counters and word-frequency view share an incremental, asynchronous index; counts are cached per file and recalculated when files change. During a scan, word frequencies update every 100 scanned words and once more when scanning completes; existing rows are retained and updated in place. Loading skeletons appear on the initial scan. Files larger than 512 KB are skipped unless tagged `#force-scan` (or listed as `force-scan` in frontmatter); the view shows one alert in the top-right corner when oversized files are skipped. Select the filter icon next to the search field to open options. Enable **Count active file only** to show counts from the active Markdown file instead of the full workspace. **Exclude common words** removes common words from both the list and the relative-frequency denominator. **Hide common words; keep in relative frequencies** hides them from the list only. Select **Stem** to combine English word forms by their Porter stem, or **Lemma** to combine inflected forms under their English base form. Both modes sum grouped counts.
