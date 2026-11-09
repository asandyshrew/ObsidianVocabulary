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

import { TableModal } from './LexiconModal';

// Remember to rename these classes and interfaces!

export default class MyPlugin extends Plugin {
	settings!: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: 'open-lexicon-modal',
			name: 'Open lexicon modal',
			callback: () => new TableModal(this.app).open(),
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

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(activeDocument, 'click', (_evt: MouseEvent) => {
			new Notice('Click');
		});

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

class SampleModal extends Modal {
	onOpen() {
		const { contentEl } = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
