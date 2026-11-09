# Lexicon

The Obsidian-Lexicon plugin manages synonyms across your entire vault for hotswapping terms.

## Features

- Lexicon modal that tracks term usage count.
- A refactor system to hot swap all synonyms with the chosen term.
- Word frequency view listing case-insensitive counts for every word in Markdown files.

Open the **Word frequency** view from the command palette. It appears in the right sidebar, scans changed Markdown files every 30 seconds, and includes a word search field. Files larger than 512 KB are skipped; the view shows one alert in the top-right corner when this happens. Select the filter icon next to the search field to open options. Enable **Count active file only** to show counts from the active Markdown file instead of the full workspace. **Exclude common words** removes common words from both the list and the relative-frequency denominator. **Hide common words; keep in relative frequencies** hides them from the list only. Select **Group by stem** to combine English word forms by their Porter stem, or **Group by lemma** to combine inflected forms under their English base form. Both modes sum grouped counts.
