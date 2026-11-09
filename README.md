# Lexicon

The Obsidian-Lexicon plugin manages synonyms across your entire vault for hotswapping terms.

## Features

- Lexicon modal that tracks term usage count.
- A refactor system to hot swap all synonyms with the chosen term.
- Term Frequency Table featuring optional stemming and lemming.
- Asyncronous tokenizing to prioritize UI and performance.
- Large File Scanning

## How To Use
### Usage of the Lexicon
To open your custom lexicon, click the book icon in the ribbon. Add a term and some synonyms and you are good to go.

### Term Frequency
The Term Frequency chart begins calculating automatically upon the plugin and can be opened from the ribbon or via the command.

Files larger than 512 KB are skipped unless tagged `#force-scan` (or listed as `force-scan` in frontmatter)