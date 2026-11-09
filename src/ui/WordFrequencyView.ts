import { ItemView, Notice, setIcon, TFile, WorkspaceLeaf } from 'obsidian';
import type { EventRef } from 'obsidian';
import { loadCommonWords } from '../utils/linguistics';
import type { GroupingMode, UsageIndex } from '../utils/UsageIndex';

export const WORD_FREQUENCY_VIEW_TYPE = 'obsidian-vocabulary-word-frequency';
const REFRESH_INTERVAL_MS = 30_000;
const YIELD_INTERVAL = 2_000;
const RENDER_BATCH_SIZE = 100;

interface WordFrequency {
	word: string;
	count: number;
}

function yieldToUI(): Promise<void> {
	return new Promise(resolve => window.setTimeout(resolve, 0));
}

export class WordFrequencyView extends ItemView {
	private statusEl?: HTMLElement;
	private searchInput?: HTMLInputElement;
	private filterMenuEl?: HTMLDivElement;
	private filterMenuButton?: HTMLButtonElement;
	private groupingButtons = new Map<GroupingMode, HTMLButtonElement>();
	private singleFileCheckbox?: HTMLInputElement;
	private commonWordsCheckbox?: HTMLInputElement;
	private hideCommonWordsCheckbox?: HTMLInputElement;
	private listEl?: HTMLUListElement;
	private words: WordFrequency[] = [];
	private sourceLabel = 'in the workspace';
	private commonWords?: Set<string>;
	private excludingCommonWords = false;
	private hidingCommonWords = false;
	private groupingMode: GroupingMode = 'none';
	private intervalId?: number;
	private refreshTimer?: number;
	private scanId = 0;
	private renderId = 0;
	private hasShownLargeFileAlert = false;
	private largeFileAlert?: HTMLElement;
	private largeFileAlertTimer?: number;
	private vaultEventRefs: EventRef[] = [];
	private workspaceEventRef?: EventRef;
	private outsideClickHandler?: (event: MouseEvent) => void;

	constructor(
		leaf: WorkspaceLeaf,
		private usageIndex: UsageIndex,
		private pluginDirectory?: string,
	) {
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

		const singleFileLabel = this.filterMenuEl.createEl('label', { cls: 'word-frequency-mode' });
		this.singleFileCheckbox = singleFileLabel.createEl('input', { type: 'checkbox' });
		singleFileLabel.appendText(' Count active file only');
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
		if (this.refreshTimer !== undefined) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = undefined;
		}
		if (this.intervalId !== undefined) {
			window.clearInterval(this.intervalId);
			this.intervalId = undefined;
		}
		if (this.largeFileAlertTimer !== undefined) {
			window.clearTimeout(this.largeFileAlertTimer);
			this.largeFileAlertTimer = undefined;
		}
		this.largeFileAlert?.remove();
		this.largeFileAlert = undefined;
		this.vaultEventRefs.forEach(eventRef => this.app.vault.offref(eventRef));
		this.vaultEventRefs = [];
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

	private setGroupingMode(mode: GroupingMode): void {
		this.groupingMode = mode;
		this.groupingButtons.forEach((button, buttonMode) => {
			const selected = buttonMode === mode;
			button.setAttribute('aria-pressed', String(selected));
			button.toggleClass('is-active', selected);
		});
		void this.refreshCounts();
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
		} else {
			this.excludingCommonWords = this.commonWordsCheckbox?.checked ?? false;
		}
		await this.renderWords();
	}

	private async updateHideCommonWords(): Promise<void> {
		if (!await this.ensureCommonWordsLoaded()) {
			if (this.hideCommonWordsCheckbox) {
				this.hideCommonWordsCheckbox.checked = false;
			}
			this.hidingCommonWords = false;
		} else {
			this.hidingCommonWords = this.hideCommonWordsCheckbox?.checked ?? false;
		}
		await this.renderWords();
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

	private setStatusLoading(text: string): void {
		if (!this.statusEl) {
			return;
		}
		this.statusEl.empty();
		this.statusEl.createSpan({ cls: 'word-frequency-loading-spinner', attr: { 'aria-hidden': 'true' } });
		this.statusEl.createSpan({ text });
	}

	private async refreshCounts(): Promise<void> {
		const scanId = ++this.scanId;
		const activeFileOnly = this.singleFileCheckbox?.checked ?? false;
		const activeFile = activeFileOnly ? this.app.workspace.getActiveFile() : null;
		if (activeFileOnly && !this.isMarkdownFile(activeFile)) {
			this.words = [];
			this.listEl?.empty();
			this.statusEl?.setText('Open a Markdown file to count its words.');
			return;
		}

		this.sourceLabel = activeFileOnly && this.isMarkdownFile(activeFile)
			? `in ${activeFile.path}`
			: 'in the workspace';
		this.listEl?.empty();
		this.setStatusLoading('Updating word counts...');
		try {
			const frequencies = await this.usageIndex.getWordFrequencies(
				this.groupingMode,
				activeFileOnly && this.isMarkdownFile(activeFile) ? activeFile : undefined,
				(completed, total) => {
					if (scanId === this.scanId && (completed % 20 === 0 || completed === total)) {
						this.setStatusLoading(`Scanning Markdown files (${completed}/${total})...`);
					}
				},
			);
			if (scanId !== this.scanId) {
				return;
			}

			const entries = await this.createFrequencyEntries(frequencies, () => scanId === this.scanId);
			if (scanId !== this.scanId) {
				return;
			}
			this.words = await this.sortWords(
				entries,
				() => scanId === this.scanId,
			);
			if (scanId !== this.scanId) {
				return;
			}
			const skippedFiles = this.usageIndex.getSkippedFiles(
				activeFileOnly && this.isMarkdownFile(activeFile) ? activeFile : undefined,
			);
			if (skippedFiles.length > 0) {
				this.showLargeFileAlert();
			}
			await this.renderWords(scanId);
		} catch (error) {
			if (scanId !== this.scanId) {
				return;
			}
			console.error('Failed to update Markdown word frequency:', error);
			this.statusEl?.setText('Unable to update word frequency. Try refreshing.');
			new Notice('Could not update word frequency.');
		}
	}

	private async createFrequencyEntries(
		frequencies: Map<string, number>,
		isCurrent: () => boolean,
	): Promise<WordFrequency[]> {
		const words: WordFrequency[] = [];
		let processed = 0;
		for (const [word, count] of frequencies) {
			words.push({ word, count });
			processed++;
			if (processed % YIELD_INTERVAL === 0) {
				await yieldToUI();
				if (!isCurrent()) {
					return [];
				}
			}
		}
		return words;
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
		let comparisons = 0;
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
					comparisons++;
					if (comparisons % YIELD_INTERVAL === 0) {
						await new Promise(resolve => window.setTimeout(resolve, 0));
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

	private async renderWords(scanId = this.scanId): Promise<void> {
		if (!this.listEl || !this.statusEl || !this.searchInput) {
			return;
		}
		const renderId = ++this.renderId;
		const isCurrent = () => scanId === this.scanId && renderId === this.renderId;
		const query = this.searchInput.value.trim().toLowerCase();
		const shouldHideCommon = (this.excludingCommonWords || this.hidingCommonWords) && this.commonWords;
		const visibleWords: WordFrequency[] = [];
		const denominatorWords: WordFrequency[] = [];
		for (let index = 0; index < this.words.length; index++) {
			if (!isCurrent()) {
				return;
			}
			const entry = this.words[index];
			if (!entry) {
				continue;
			}
			const isCommon = shouldHideCommon && this.commonWords?.has(entry.word);
			if (!this.excludingCommonWords || !isCommon) {
				denominatorWords.push(entry);
			}
			if (
				(!shouldHideCommon || !isCommon) &&
				(!query || entry.word.includes(query))
			) {
				visibleWords.push(entry);
			}
			if ((index + 1) % YIELD_INTERVAL === 0) {
				await new Promise(resolve => window.setTimeout(resolve, 0));
			}
		}

		let totalCount = 0;
		for (let index = 0; index < denominatorWords.length; index++) {
			const entry = denominatorWords[index];
			if (entry) {
				totalCount += entry.count;
			}
			if ((index + 1) % YIELD_INTERVAL === 0) {
				await new Promise(resolve => window.setTimeout(resolve, 0));
			}
		}
		if (!isCurrent()) {
			return;
		}
		this.statusEl.setText(`${visibleWords.length.toLocaleString()} words ${this.sourceLabel}`);
		this.listEl.empty();
		if (visibleWords.length === 0) {
			this.listEl.createEl('li', { text: 'No matching words.' });
			return;
		}
		for (let index = 0; index < visibleWords.length; index += RENDER_BATCH_SIZE) {
			if (!isCurrent()) {
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
			await new Promise(resolve => window.setTimeout(resolve, 0));
		}
	}

	private showLargeFileAlert(): void {
		if (this.hasShownLargeFileAlert) {
			return;
		}
		this.hasShownLargeFileAlert = true;
		const alert = document.body.createDiv({
			cls: 'word-frequency-large-file-alert',
			text: 'Some Markdown files larger than 512 KB were skipped.',
			attr: { role: 'alert' },
		});
		this.largeFileAlert = alert;
		this.largeFileAlertTimer = window.setTimeout(() => {
			alert.remove();
			this.largeFileAlert = undefined;
			this.largeFileAlertTimer = undefined;
		}, 8_000);
	}
}
