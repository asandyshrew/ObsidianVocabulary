import { ItemView, Notice, setIcon, TFile, WorkspaceLeaf } from 'obsidian';
import type { EventRef } from 'obsidian';
import { stemmer } from 'stemmer';
import lemmatizer from 'wink-lemmatizer';
import { loadCommonWords } from '../utils/linguistics';

export const WORD_FREQUENCY_VIEW_TYPE = 'obsidian-vocabulary-word-frequency';
const MAX_FILE_SIZE_BYTES = 512 * 1024;
const REFRESH_INTERVAL_MS = 30_000;
const SCAN_YIELD_INTERVAL = 2_000;
const RENDER_BATCH_SIZE = 100;

function yieldToUI(): Promise<void> {
	return new Promise(resolve => window.setTimeout(resolve, 0));
}

interface WordFrequency {
	word: string;
	count: number;
}

interface FileWordCounts {
	mtime: number;
	size: number;
	counts?: Map<string, number>;
}

export class WordFrequencyView extends ItemView {
	private statusEl?: HTMLElement;
	private searchInput?: HTMLInputElement;
	private filterMenuEl?: HTMLDivElement;
	private filterMenuButton?: HTMLButtonElement;
	private groupingButtons = new Map<'none' | 'stem' | 'lemma', HTMLButtonElement>();
	private singleFileCheckbox?: HTMLInputElement;
	private commonWordsCheckbox?: HTMLInputElement;
	private hideCommonWordsCheckbox?: HTMLInputElement;
	private listEl?: HTMLUListElement;
	private words: WordFrequency[] = [];
	private sourceLabel = 'in the workspace';
	private pluginDirectory?: string;
	private commonWords?: Set<string>;
	private excludingCommonWords = false;
	private hidingCommonWords = false;
	private groupingMode: 'none' | 'stem' | 'lemma' = 'none';
	private refreshTimer?: number;
	private intervalId?: number;
	private largeFileAlertTimeout?: number;
	private largeFileAlert?: HTMLDivElement;
	private hasShownLargeFileAlert = false;
	private scanId = 0;
	private renderId = 0;
	private scanInProgress = false;
	private refreshRequested = false;
	private fileWordCounts = new Map<string, FileWordCounts>();
	private workspaceEventRef?: EventRef;
	private outsideClickHandler?: (event: MouseEvent) => void;

	constructor(leaf: WorkspaceLeaf, pluginDirectory?: string) {
		super(leaf);
		this.pluginDirectory = pluginDirectory;
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

		const filterControl = this.contentEl.createDiv({ cls: 'word-frequency-filter-control' });
		const filterInputRow = filterControl.createDiv({ cls: 'word-frequency-filter-input-row' });
		this.searchInput = filterInputRow.createEl('input', {
			type: 'search',
			placeholder: 'Filter words',
			attr: { 'aria-label': 'Filter words' },
		});
		this.searchInput.addEventListener('input', () => {
			void this.renderWords();
		});
		this.filterMenuButton = filterInputRow.createEl('button', {
			cls: 'word-frequency-filter-button',
			attr: {
				type: 'button',
				'aria-label': 'Filter options',
				'aria-expanded': 'false',
				'aria-haspopup': 'true',
				'aria-controls': 'word-frequency-filter-menu',
			},
		});
		setIcon(this.filterMenuButton, 'filter');
		this.filterMenuEl = filterControl.createDiv({
			cls: 'word-frequency-filter-menu',
			attr: { id: 'word-frequency-filter-menu', role: 'group', 'aria-label': 'Filter options' },
		});
		this.filterMenuEl.hide();
		this.filterMenuButton.addEventListener('click', () => this.toggleFilterMenu());
		filterControl.addEventListener('keydown', event => {
			if (event.key === 'Escape') {
				this.closeFilterMenu();
				this.filterMenuButton?.focus();
			}
		});

		const modeLabel = this.filterMenuEl.createEl('label', { cls: 'word-frequency-mode' });
		this.singleFileCheckbox = modeLabel.createEl('input', { type: 'checkbox' });
		modeLabel.appendText(' Count active file only');
		this.singleFileCheckbox.addEventListener('change', () => {
			void this.refreshCounts();
		});
		const commonWordsLabel = this.filterMenuEl.createEl('label', { cls: 'word-frequency-mode' });
		this.commonWordsCheckbox = commonWordsLabel.createEl('input', { type: 'checkbox' });
		commonWordsLabel.appendText(' Exclude common words');
		this.commonWordsCheckbox.addEventListener('change', () => {
			void this.updateCommonWordFilter();
		});
		const hideCommonWordsLabel = this.filterMenuEl.createEl('label', { cls: 'word-frequency-mode' });
		this.hideCommonWordsCheckbox = hideCommonWordsLabel.createEl('input', { type: 'checkbox' });
		hideCommonWordsLabel.appendText(' Hide common words; keep in relative frequencies');
		this.hideCommonWordsCheckbox.addEventListener('change', () => {
			void this.updateHideCommonWords();
		});

		const refreshButton = this.contentEl.createEl('button', {
			text: 'Refresh counts',
			attr: { type: 'button' },
		});
		refreshButton.addEventListener('click', () => {
			void this.refreshCounts();
		});
		const groupingControl = this.contentEl.createDiv({
			cls: 'word-frequency-grouping',
			attr: { role: 'group', 'aria-label': 'Word grouping' },
		});
		([
			['none', 'None'],
			['stem', 'Stem'],
			['lemma', 'Lemma'],
		] as const).forEach(([mode, label]) => {
			const button = groupingControl.createEl('button', {
				text: label,
				attr: { type: 'button', 'aria-pressed': String(mode === this.groupingMode) },
			});
			button.addEventListener('click', () => this.setGroupingMode(mode));
			this.groupingButtons.set(mode, button);
		});
		this.statusEl = this.contentEl.createEl('p', {
			cls: 'word-frequency-status',
			attr: { role: 'status', 'aria-live': 'polite' },
		});
		this.listEl = this.contentEl.createEl('ul', { cls: 'word-frequency-list' });

		this.workspaceEventRef = this.app.workspace.on('active-leaf-change', () => {
			if (this.singleFileCheckbox?.checked) {
				this.scheduleRefresh();
			}
		});
		this.intervalId = window.setInterval(() => {
			void this.refreshCounts();
		}, REFRESH_INTERVAL_MS);
		this.outsideClickHandler = event => {
			if (event.target instanceof Node && !filterControl.contains(event.target)) {
				this.closeFilterMenu();
			}
		};
		document.addEventListener('click', this.outsideClickHandler);

		await this.refreshCounts();
	}

	async onClose(): Promise<void> {
		this.scanId++;
		this.renderId++;
		this.refreshRequested = false;
		if (this.refreshTimer !== undefined) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = undefined;
		}
		if (this.intervalId !== undefined) {
			window.clearInterval(this.intervalId);
			this.intervalId = undefined;
		}
		if (this.largeFileAlertTimeout !== undefined) {
			window.clearTimeout(this.largeFileAlertTimeout);
			this.largeFileAlertTimeout = undefined;
		}
		this.largeFileAlert?.remove();
		this.largeFileAlert = undefined;
		if (this.workspaceEventRef) {
			this.app.workspace.offref(this.workspaceEventRef);
			this.workspaceEventRef = undefined;
		}
		if (this.outsideClickHandler) {
			document.removeEventListener('click', this.outsideClickHandler);
			this.outsideClickHandler = undefined;
		}
		this.contentEl.empty();
	}

	private toggleFilterMenu(): void {
		if (this.filterMenuEl?.isShown()) {
			this.closeFilterMenu();
			return;
		}
		this.filterMenuEl?.show();
		this.filterMenuButton?.setAttribute('aria-expanded', 'true');
	}

	private closeFilterMenu(): void {
		this.filterMenuEl?.hide();
		this.filterMenuButton?.setAttribute('aria-expanded', 'false');
	}

	private setGroupingMode(mode: 'none' | 'stem' | 'lemma'): void {
		this.groupingMode = mode;
		this.groupingButtons.forEach((button, buttonMode) => {
			const isSelected = buttonMode === mode;
			button.setAttribute('aria-pressed', String(isSelected));
			button.toggleClass('is-active', isSelected);
		});
		void this.renderWords();
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

	private async updateCommonWordFilter(): Promise<void> {
		if (!await this.ensureCommonWordsLoaded()) {
			if (this.commonWordsCheckbox) {
				this.commonWordsCheckbox.checked = false;
			}
			this.excludingCommonWords = false;
			void this.renderWords();
			return;
		}

		this.excludingCommonWords = this.commonWordsCheckbox?.checked ?? false;
		void this.renderWords();
	}

	private async updateHideCommonWords(): Promise<void> {
		if (!await this.ensureCommonWordsLoaded()) {
			if (this.hideCommonWordsCheckbox) {
				this.hideCommonWordsCheckbox.checked = false;
			}
			this.hidingCommonWords = false;
			void this.renderWords();
			return;
		}

		this.hidingCommonWords = this.hideCommonWordsCheckbox?.checked ?? false;
		void this.renderWords();
	}

	private async ensureCommonWordsLoaded(): Promise<boolean> {
		if (!this.commonWords) {
			try {
				this.commonWords = await loadCommonWords(this.app, this.pluginDirectory);
			} catch (error) {
				console.error('Failed to load common words for word frequency:', error);
				new Notice(error instanceof Error ? error.message : 'Could not load common words.');
				return false;
			}
		}
		return true;
	}

	private async refreshCounts(): Promise<void> {
		if (this.scanInProgress) {
			this.refreshRequested = true;
			return;
		}

		this.scanInProgress = true;
		try {
			await this.scanWordCounts();
		} finally {
			this.scanInProgress = false;
			if (this.refreshRequested) {
				this.refreshRequested = false;
				void this.refreshCounts();
			}
		}
	}

	private async scanWordCounts(): Promise<void> {
		const scanId = ++this.scanId;
		const activeFileOnly = this.singleFileCheckbox?.checked ?? false;
		const activeFile = activeFileOnly ? this.app.workspace.getActiveFile() : null;
		if (activeFileOnly && !this.isMarkdownFile(activeFile)) {
			this.words = [];
			void this.renderWords();
			this.statusEl?.setText('Open a Markdown file to count its words.');
			return;
		}
		const allFiles = this.app.vault.getMarkdownFiles();
		const files = activeFileOnly && this.isMarkdownFile(activeFile)
			? [activeFile]
			: allFiles;
		this.sourceLabel = activeFileOnly && this.isMarkdownFile(activeFile)
			? `in ${activeFile.path}`
			: 'in the workspace';

		try {
			const currentPaths = new Set(allFiles.map(file => file.path));
			this.fileWordCounts.forEach((_, path) => {
				if (!currentPaths.has(path)) {
					this.fileWordCounts.delete(path);
				}
			});
			let changedFiles = 0;
			let oversizedFilesFound = false;
			for (const [index, file] of files.entries()) {
				if (scanId !== this.scanId) {
					return;
				}
				const { mtime, size } = file.stat;
				const cached = this.fileWordCounts.get(file.path);
				if (size > MAX_FILE_SIZE_BYTES) {
					this.fileWordCounts.set(file.path, { mtime, size });
					oversizedFilesFound = true;
					if ((index + 1) % 20 === 0) {
						this.statusEl?.setText(
							`Checking Markdown files (${index + 1}/${files.length}; ${changedFiles} changed)...`,
						);
						await yieldToUI();
					}
					continue;
				}

				if (cached?.mtime === mtime && cached.size === size) {
					if ((index + 1) % 20 === 0) {
						this.statusEl?.setText(
							`Checking Markdown files (${index + 1}/${files.length}; ${changedFiles} changed)...`,
						);
						await yieldToUI();
					}
					continue;
				}

				try {
					const content = await this.app.vault.cachedRead(file);
					if (scanId !== this.scanId) {
						return;
					}
					const counts = await this.countWords(content, scanId);
					if (!counts || scanId !== this.scanId) {
						return;
					}
					this.fileWordCounts.set(file.path, { mtime, size, counts });
					changedFiles++;
				} catch (error) {
					console.error(`Failed to scan Markdown file "${file.path}":`, error);
					if (!cached) {
						this.fileWordCounts.delete(file.path);
					}
				}
				if ((index + 1) % 20 === 0 || index === files.length - 1) {
					if (scanId !== this.scanId) {
						return;
					}
					this.statusEl?.setText(
						`Checking Markdown files (${index + 1}/${files.length}; ${changedFiles} changed)...`,
					);
					await yieldToUI();
				}
			}

			if (scanId !== this.scanId) {
				return;
			}
			if (oversizedFilesFound) {
				this.showLargeFileAlert();
			}

			const counts = new Map<string, number>();
			let processedWords = 0;
			for (const file of files) {
				const fileCounts = this.fileWordCounts.get(file.path)?.counts;
				if (!fileCounts) {
					continue;
				}
				for (const [word, count] of fileCounts) {
					counts.set(word, (counts.get(word) ?? 0) + count);
					processedWords++;
					if (processedWords % SCAN_YIELD_INTERVAL === 0) {
						this.statusEl?.setText(`Combining word counts (${processedWords.toLocaleString()})...`);
						await yieldToUI();
						if (scanId !== this.scanId) {
							return;
						}
					}
				}
			}
			this.words = [];
			let converted = 0;
			for (const [word, count] of counts) {
				this.words.push({ word, count });
				converted++;
				if (converted % SCAN_YIELD_INTERVAL === 0) {
					await yieldToUI();
					if (scanId !== this.scanId) {
						return;
					}
				}
			}
			this.words = await this.sortWords(this.words, () => scanId === this.scanId);
			if (scanId === this.scanId) {
				void this.renderWords();
			}
		} catch (error) {
			if (scanId !== this.scanId) {
				return;
			}
			console.error('Failed to update Markdown word frequency:', error);
			this.statusEl?.setText('Unable to update word frequency. Try refreshing.');
			new Notice('Could not update word frequency.');
		}
	}

	private async countWords(content: string, scanId: number): Promise<Map<string, number> | undefined> {
		const counts = new Map<string, number>();
		const tokenPattern = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
		let token = tokenPattern.exec(content);
		let processedTokens = 0;
		while (token) {
			const word = token[0].toLowerCase();
			counts.set(word, (counts.get(word) ?? 0) + 1);
			processedTokens++;
			if (processedTokens % SCAN_YIELD_INTERVAL === 0) {
				await yieldToUI();
				if (scanId !== this.scanId) {
					return undefined;
				}
			}
			token = tokenPattern.exec(content);
		}
		return counts;
	}

	private async sortWords(
		words: WordFrequency[],
		isCurrent: () => boolean,
	): Promise<WordFrequency[]> {
		if (words.length < 2) {
			return words;
		}

		let source = words;
		let target = new Array<WordFrequency>(words.length);
		let processed = 0;
		for (let width = 1; width < words.length; width *= 2) {
			for (let start = 0; start < words.length; start += width * 2) {
				const middle = Math.min(start + width, words.length);
				const end = Math.min(start + width * 2, words.length);
				let left = start;
				let right = middle;
				for (let output = start; output < end; output++) {
					const leftWord = source[left];
					const rightWord = source[right];
					if (
						left < middle &&
						(right >= end || !rightWord ||
							(leftWord && (
								leftWord.count > rightWord.count ||
								(leftWord.count === rightWord.count &&
									leftWord.word.localeCompare(rightWord.word) <= 0)
							)))
					) {
						if (leftWord) {
							target[output] = leftWord;
						}
						left++;
					} else if (rightWord) {
						target[output] = rightWord;
						right++;
					}
					processed++;
					if (processed % SCAN_YIELD_INTERVAL === 0) {
						await yieldToUI();
						if (!isCurrent()) {
							return [];
						}
					}
				}
			}
			[source, target] = [target, source];
		}
		return source;
	}

	private showLargeFileAlert(): void {
		if (this.hasShownLargeFileAlert) {
			return;
		}
		this.hasShownLargeFileAlert = true;
		this.largeFileAlert = document.body.createDiv({
			cls: 'word-frequency-large-file-alert',
			text: 'Some Markdown files larger than 512 KB were skipped.',
			attr: { role: 'alert' },
		});
		this.largeFileAlertTimeout = window.setTimeout(() => {
			this.largeFileAlert?.remove();
			this.largeFileAlert = undefined;
			this.largeFileAlertTimeout = undefined;
		}, 8000);
	}

	private async renderWords(): Promise<void> {
		if (!this.listEl || !this.statusEl || !this.searchInput) {
			return;
		}

		const renderId = ++this.renderId;
		const query = this.searchInput.value.trim().toLowerCase();
		const words = this.groupingMode === 'stem'
			? await this.groupWords(this.words, word => stemmer(word), () => renderId === this.renderId)
			: this.groupingMode === 'lemma'
				? await this.groupWords(this.words, word => this.lemmatizeWord(word), () => renderId === this.renderId)
				: this.words;
		if (renderId !== this.renderId) {
			return;
		}
		const denominatorWords = this.excludingCommonWords && this.commonWords
			? await this.filterWords(words, ({ word }) => !this.commonWords?.has(word), renderId)
			: words;
		const displayWords = (this.excludingCommonWords || this.hidingCommonWords) && this.commonWords
			? await this.filterWords(words, ({ word }) => !this.commonWords?.has(word), renderId)
			: words;
		if (renderId !== this.renderId) {
			return;
		}
		const visibleWords = query
			? await this.filterWords(displayWords, ({ word }) => word.includes(query), renderId)
			: displayWords;
		if (renderId !== this.renderId) {
			return;
		}
		this.statusEl.setText(`${visibleWords.length.toLocaleString()} words ${this.sourceLabel}`);
		this.listEl.empty();
		let totalCount = 0;
		for (let index = 0; index < denominatorWords.length; index++) {
			const word = denominatorWords[index];
			if (word) {
				totalCount += word.count;
			}
			if ((index + 1) % SCAN_YIELD_INTERVAL === 0) {
				await yieldToUI();
				if (renderId !== this.renderId) {
					return;
				}
			}
		}
		for (let index = 0; index < visibleWords.length; index += RENDER_BATCH_SIZE) {
			if (renderId !== this.renderId) {
				return;
			}
			const batch = visibleWords.slice(index, index + RENDER_BATCH_SIZE);
			for (const { word, count } of batch) {
			const item = this.listEl.createEl('li');
			item.createSpan({ text: word, cls: 'word-frequency-word' });
			const relativeFrequency = totalCount > 0 ? count / totalCount : 0;
			const bar = item.createSpan({
				cls: 'word-frequency-bar',
				attr: {
					role: 'img',
					'aria-label': `Relative frequency: ${(relativeFrequency * 100).toFixed(2)}% of all words`,
				},
			});
			bar.createSpan({
				cls: 'word-frequency-bar-fill',
				attr: { style: `width: ${relativeFrequency * 100}%` },
			});
			item.createSpan({ text: count.toLocaleString(), cls: 'word-frequency-count' });
			}
			await yieldToUI();
		}
	}

	private async filterWords(
		words: WordFrequency[],
		shouldInclude: (entry: WordFrequency) => boolean,
		renderId: number,
	): Promise<WordFrequency[]> {
		const filtered: WordFrequency[] = [];
		for (let index = 0; index < words.length; index++) {
			const entry = words[index];
			if (entry && shouldInclude(entry)) {
				filtered.push(entry);
			}
			if ((index + 1) % SCAN_YIELD_INTERVAL === 0) {
				await yieldToUI();
				if (renderId !== this.renderId) {
					return [];
				}
			}
		}
		return filtered;
	}

	private async groupWords(
		words: WordFrequency[],
		getGroup: (word: string) => string,
		isCurrent: () => boolean,
	): Promise<WordFrequency[]> {
		const counts = new Map<string, number>();
		for (let index = 0; index < words.length; index++) {
			const entry = words[index];
			if (!entry) {
				continue;
			}
			const group = getGroup(entry.word);
			counts.set(group, (counts.get(group) ?? 0) + entry.count);
			if ((index + 1) % SCAN_YIELD_INTERVAL === 0) {
				await yieldToUI();
				if (!isCurrent()) {
					return [];
				}
			}
		}
		const grouped: WordFrequency[] = [];
		let converted = 0;
		for (const [word, count] of counts) {
			grouped.push({ word, count });
			converted++;
			if (converted % SCAN_YIELD_INTERVAL === 0) {
				await yieldToUI();
				if (!isCurrent()) {
					return [];
				}
			}
		}
		return this.sortWords(grouped, isCurrent);
	}

	private lemmatizeWord(word: string): string {
		const candidates = /(?:ing|ed|en)$/.test(word)
			? [lemmatizer.verb(word), lemmatizer.noun(word), lemmatizer.adjective(word)]
			: /(?:ies|ves|men|s)$/.test(word)
				? [lemmatizer.noun(word), lemmatizer.verb(word), lemmatizer.adjective(word)]
				: /(?:er|est)$/.test(word)
					? [lemmatizer.adjective(word), lemmatizer.noun(word), lemmatizer.verb(word)]
					: [lemmatizer.verb(word), lemmatizer.noun(word), lemmatizer.adjective(word)];
		return candidates.find(candidate => candidate !== word) ?? word;
	}
}
