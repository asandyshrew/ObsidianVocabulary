import { Plugin } from 'obsidian';
import { registerLexiconCommands } from './commands/registerLexiconCommands';
import { DEFAULT_SETTINGS } from './settings';
import type { VocabularyPluginSettings } from './settings';
import { UsageIndex } from './utils/UsageIndex';

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
}
