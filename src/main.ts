import { Notice, Plugin } from 'obsidian';
import { registerLexiconCommands } from './commands/registerLexiconCommands';
import { DEFAULT_SETTINGS } from './settings';
import type { VocabularyPluginSettings } from './settings';
import { UsageIndex } from './utils/UsageIndex';
import { WORD_FREQUENCY_VIEW_TYPE, WordFrequencyView } from './ui/WordFrequencyView';

/**
 * Initializes persisted preferences and registers the plugin's entry points.
 */
export default class ObsidianVocabularyPlugin extends Plugin {
	/** Settings persisted through Obsidian's plugin data storage. */
	settings!: VocabularyPluginSettings;
	/** Shared vault usage index, scanned once as the plugin loads. */
	usageIndex!: UsageIndex;

	/** Load settings safely, then register the modal command and ribbon icon. */
	async onload() {
		this.registerView(
			WORD_FREQUENCY_VIEW_TYPE,
			leaf => new WordFrequencyView(leaf, this.manifest.dir),
		);
		this.addCommand({
			id: 'open-word-frequency',
			name: 'Open word frequency',
			callback: () => {
				void this.openWordFrequencyView();
			},
		});
		this.addRibbonIcon('bar-chart-3', 'Open word frequency', () => {
			void this.openWordFrequencyView();
		});

		this.usageIndex = new UsageIndex(this.app);
		const savedSettings = await this.loadData() as Partial<VocabularyPluginSettings> | null;
		this.settings = {
			...DEFAULT_SETTINGS,
			...savedSettings,
			confirmedCommonTerms: Array.isArray(savedSettings?.confirmedCommonTerms)
				? savedSettings.confirmedCommonTerms
				: [],
		};

		registerLexiconCommands(this, {
			pluginDirectory: this.manifest.dir,
			confirmedCommonTerms: this.settings.confirmedCommonTerms,
			persistCommonTermConfirmations: () => this.saveSettings(),
			usageIndex: this.usageIndex,
		});
	}

	/** Persist the current settings object to plugin storage. */
	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async openWordFrequencyView(): Promise<void> {
		try {
			let leaf = this.app.workspace.getLeavesOfType(WORD_FREQUENCY_VIEW_TYPE)[0];
			if (!leaf) {
				leaf = this.app.workspace.getRightLeaf(false)
					?? this.app.workspace.getRightLeaf(true)
					?? undefined;
			}
			if (!leaf) {
				throw new Error('Could not create a right sidebar for word frequency.');
			}
			await leaf.setViewState({
				type: WORD_FREQUENCY_VIEW_TYPE,
				active: true,
			});
			this.app.workspace.rightSplit.expand();
		} catch (error) {
			console.error('Failed to open the word frequency view:', error);
			new Notice('Could not open the word frequency view.');
		}
	}
}
