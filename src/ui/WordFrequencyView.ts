import { ItemView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import type { EventRef } from 'obsidian';

export const WORD_FREQUENCY_VIEW_TYPE = 'obsidian-vocabulary-word-frequency';

interface WordFrequency {
	word: string;
	count: number;
}

export class WordFrequencyView extends ItemView {
	private statusEl?: HTMLElement;
	private searchInput?: HTMLInputElement;
	private listEl?: HTMLUListElement;
	private words: WordFrequency[] = [];
	private refreshTimer?: number;
	private scanId = 0;
	private vaultEventRefs: EventRef[] = [];

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return WORD_FREQUENCY_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Word frequency';
	}

	getIcon(): string {
		return 'bar-chart-3';
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('word-frequency-view');
		this.contentEl.createEl('h3', { text: 'Word frequency' });
		this.contentEl.createEl('p', {
			text: 'Counts words in Markdown files, case-insensitively.',
			cls: 'word-frequency-description',
		});

		this.searchInput = this.contentEl.createEl('input', {
			type: 'search',
			placeholder: 'Filter words',
			attr: { 'aria-label': 'Filter words' },
		});
		this.searchInput.addEventListener('input', () => this.renderWords());
		const refreshButton = this.contentEl.createEl('button', {
			text: 'Refresh counts',
			attr: { type: 'button' },
		});
		refreshButton.addEventListener('click', () => {
			void this.refreshCounts();
		});
		this.statusEl = this.contentEl.createEl('p', {
			cls: 'word-frequency-status',
			attr: { role: 'status', 'aria-live': 'polite' },
		});
		this.listEl = this.contentEl.createEl('ul', { cls: 'word-frequency-list' });

		this.vaultEventRefs.push(this.app.vault.on('create', file => {
			if (this.isMarkdownFile(file)) {
				this.scheduleRefresh();
			}
		}));
		this.vaultEventRefs.push(this.app.vault.on('modify', file => {
			if (this.isMarkdownFile(file)) {
				this.scheduleRefresh();
			}
		}));
		this.vaultEventRefs.push(this.app.vault.on('delete', file => {
			if (this.isMarkdownFile(file)) {
				this.scheduleRefresh();
			}
		}));
		this.vaultEventRefs.push(this.app.vault.on('rename', (file, oldPath) => {
			if (this.isMarkdownFile(file) || oldPath.toLowerCase().endsWith('.md')) {
				this.scheduleRefresh();
			}
		}));

		await this.refreshCounts();
	}

	async onClose(): Promise<void> {
		this.scanId++;
		if (this.refreshTimer !== undefined) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = undefined;
		}
		this.vaultEventRefs.forEach(eventRef => this.app.vault.offref(eventRef));
		this.vaultEventRefs = [];
		this.contentEl.empty();
	}

	private isMarkdownFile(file: unknown): file is TFile {
		return file instanceof TFile && file.extension.toLowerCase() === 'md';
	}

	private scheduleRefresh(): void {
		if (this.refreshTimer !== undefined) {
			window.clearTimeout(this.refreshTimer);
		}
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = undefined;
			void this.refreshCounts();
		}, 300);
	}

	private async refreshCounts(): Promise<void> {
		const scanId = ++this.scanId;
		const files = this.app.vault.getMarkdownFiles();
		const counts = new Map<string, number>();
		if (this.statusEl) {
			this.statusEl.setText(`Scanning Markdown files (0/${files.length})...`);
		}

		try {
			for (const [index, file] of files.entries()) {
				const content = await this.app.vault.cachedRead(file);
				const tokens = content.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
				for (const token of tokens) {
					const word = token.toLowerCase();
					counts.set(word, (counts.get(word) ?? 0) + 1);
				}
				if ((index + 1) % 20 === 0 || index === files.length - 1) {
					if (scanId !== this.scanId) {
						return;
					}
					this.statusEl?.setText(`Scanning Markdown files (${index + 1}/${files.length})...`);
				}
			}

			if (scanId !== this.scanId) {
				return;
			}
			this.words = [...counts].map(([word, count]) => ({ word, count }));
			this.words.sort((left, right) =>
				right.count - left.count || left.word.localeCompare(right.word),
			);
			this.renderWords();
		} catch (error) {
			if (scanId !== this.scanId) {
				return;
			}
			console.error('Failed to scan Markdown files for word frequency:', error);
			this.statusEl?.setText('Unable to scan Markdown files. Try refreshing.');
			new Notice('Could not update word frequency.');
		}
	}

	private renderWords(): void {
		if (!this.listEl || !this.statusEl || !this.searchInput) {
			return;
		}

		const query = this.searchInput.value.trim().toLowerCase();
		const matchingWords = query
			? this.words.filter(({ word }) => word.includes(query))
			: this.words;
		this.statusEl.setText(`${matchingWords.length.toLocaleString()} words`);
		this.listEl.empty();
		for (const { word, count } of matchingWords) {
			const item = this.listEl.createEl('li');
			item.createSpan({ text: word, cls: 'word-frequency-word' });
			item.createSpan({ text: count.toLocaleString(), cls: 'word-frequency-count' });
		}
	}
}
