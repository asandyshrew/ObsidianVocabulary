# Obsidian Vocabulary

Obsidian plugin for managing vocabulary terms, definitions, and synonyms in a `vocabulary.lexicon` file.

## Features

- Edit vocabulary entries and synonyms in a collapsible modal.
- Count terms and synonyms in Markdown text and tags.
- Refactor synonyms to their terms across Markdown files, with confirmation prompts.
- Remember approved common-word confirmations in plugin settings.

## Source layout

```text
src/
  commands/  Command and ribbon registration
  ui/        Vocabulary entry and modal components
  utils/     Shared usage index and vocabulary text helpers
  main.ts    Plugin lifecycle and settings initialization
  settings.ts
```

## Development

- Run `npm install` to install dependencies.
- Run `npm run dev` to compile in watch mode.
- Run `npm run build` for a production build and type check.
- Run `npm run lint` to lint the project.

## Releasing

Push or merge release-worthy commits to the `release` branch. GitHub Actions uses semantic-release to analyze commit messages, update the package and Obsidian plugin versions, create a version tag without a `v` prefix, and publish a GitHub release with `main.js`, `manifest.json`, and `styles.css`.

Use Conventional Commit messages: `fix:` creates a patch release, `feat:` creates a minor release, and a breaking change creates a major release. Update `minAppVersion` in `manifest.json` on the `release` branch when a release requires a newer Obsidian version.

The workflow needs repository Actions permissions that allow it to write contents so it can push the release metadata and create GitHub releases.

## Adding your plugin to the community plugin list

- Check the [plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines).
- Publish an initial version.
- Make sure you have a `README.md` file in the root of your repo.
- Make a pull request at https://github.com/obsidianmd/obsidian-releases to add your plugin.

## How to use

- Clone this repo.
- Make sure your NodeJS is at least v18 (`node --version`).
- `npm i` to install dependencies.
- `npm run dev` to start compilation in watch mode.

## Manually installing the plugin

- Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/your-plugin-id/`.

## Improve code quality with eslint

- [ESLint](https://eslint.org/) is a tool that analyzes your code to quickly find problems. You can run ESLint against your plugin to find common bugs and ways to improve your code.
- This project already has eslint preconfigured, you can invoke a check by running`npm run lint`
- Together with a custom eslint [plugin](https://github.com/obsidianmd/eslint-plugin) for Obsidan specific code guidelines.
- A GitHub action is preconfigured to automatically lint every commit on all branches.

## Funding URL

You can include funding URLs where people who use your plugin can financially support it.

The simple way is to set the `fundingUrl` field to your link in your `manifest.json` file:

```json
{
	"fundingUrl": "https://buymeacoffee.com"
}
```

If you have multiple URLs, you can also do:

```json
{
	"fundingUrl": {
		"Buy Me a Coffee": "https://buymeacoffee.com",
		"GitHub Sponsor": "https://github.com/sponsors",
		"Patreon": "https://www.patreon.com/"
	}
}
```

## API Documentation

See https://docs.obsidian.md
