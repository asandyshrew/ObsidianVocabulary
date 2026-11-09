import { Plugin } from 'obsidian';
import { LexiconModal } from '../ui/LexiconModal';
import type { LexiconModalOptions } from '../ui/LexiconModal';

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
