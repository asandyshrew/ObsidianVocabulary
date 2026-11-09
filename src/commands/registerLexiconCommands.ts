import { Plugin } from 'obsidian';
import { LexiconModal } from '../ui/LexiconModal';
import type { LexiconModalOptions } from '../ui/LexiconModal';

/**
 * Registers the command-palette command and ribbon button for opening the
 * vocabulary editor. Both surfaces share the same modal configuration.
 *
 * @param plugin Plugin instance that owns the command and ribbon icon.
 * @param options Shared modal options excluding the optional lexicon filename.
 */
export function registerLexiconCommands(
	plugin: Plugin,
	options: Omit<LexiconModalOptions, 'fileName'>,
): void {
	const openLexiconModal = () => new LexiconModal(plugin.app, options).open();

	plugin.addCommand({
		id: 'open-lexicon-modal',
		name: 'Open lexicon modal',
		callback: openLexiconModal,
	});

	plugin.addRibbonIcon('book-open', 'Open lexicon modal', openLexiconModal);
}
