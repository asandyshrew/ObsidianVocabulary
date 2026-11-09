import { Plugin } from 'obsidian';
import { registerLexiconCommands } from './commands/registerLexiconCommands';
import { DEFAULT_SETTINGS } from './settings';
import type { VocabularyPluginSettings } from './settings';

export default class ObsidianVocabularyPlugin extends Plugin {
	settings!: VocabularyPluginSettings;

	async onload() {
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
		});
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
