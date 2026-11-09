import {
	Editor,
	MarkdownView,
	MarkdownFileInfo,
	Modal,
	Notice,
	Plugin,
	TFile,
	TFolder,
} from 'obsidian';
import {
	DEFAULT_SETTINGS,
	MyPluginSettings,
	SampleSettingTab,
} from './settings';

import { LexiconModal } from './LexiconModal';

// Remember to rename these classes and interfaces!

export default class MyPlugin extends Plugin {
	settings!: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: 'open-lexicon-modal',
			name: 'Open lexicon modal',
			callback: () => new LexiconModal(
				this.app,
				'vocabulary.lexicon',
				this.manifest.dir,
				this.settings.confirmedCommonTerms,
				() => this.saveSettings(),
			).open(),
		});

		this.addRibbonIcon('book-open', 'Open lexicon modal', () => {
			new LexiconModal(
				this.app,
				'vocabulary.lexicon',
				this.manifest.dir,
				this.settings.confirmedCommonTerms,
				() => this.saveSettings(),
			).open();
		});

		// Prints All Files in Vault
		this.addCommand({
			id: 'print-files',
			name: "Iteratively Prints through all files in vault",
			checkCallback: (checking: boolean) => {
				const files = this.app.vault.getMarkdownFiles()

				if (files.length < 1) {
					return false;
				}

				files.forEach((file) => {
					console.log(file.path);
				});
				return true;
			}
		});
		
		// Prints All Files in Vault
		this.addCommand({
			id: 'print-vocab',
			name: "Print all Vocab Elements",
			callback: async () => {
				const vocab = this.app.vault.getAbstractFileByPath("vocab.md")

				// if (vocab instanceof TFolder || vocab == null) {
				// 	return false;
				// }

				if (vocab instanceof TFile) {
					const content = await this.app.vault.read(vocab);
					console.log(content)
				}

			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

	
		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(
			window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000),
		);
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MyPluginSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
