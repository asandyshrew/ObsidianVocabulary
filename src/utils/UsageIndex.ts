import { App, TFile } from 'obsidian';
import { stemmer } from 'stemmer';
import lemmatizer from 'wink-lemmatizer';
import { normalizeSynonym } from './linguistics';

const MAX_FILE_SIZE_BYTES = 512 * 1024;
const YIELD_INTERVAL = 2_000;

export type GroupingMode = 'none' | 'stem' | 'lemma';
export type UsageCounter = (value: string) => Promise<number>;
export type WordFrequencyProgress = (completed: number, total: number) => void;

interface IndexedFile {
	mtime: number;
	size: number;
	wordCounts: Record<GroupingMode, Map<string, number>>;
	prose: string;
	tagUsages: Map<string, number>;
}

function yieldToUI(): Promise<void> {
	return new Promise(resolve => window.setTimeout(resolve, 0));
}

function increment(counts: Map<string, number>, value: string): void {
	counts.set(value, (counts.get(value) ?? 0) + 1);
}

function lemmatizeWord(word: string): string {
	const candidates = /(?:ing|ed|en)$/.test(word)
		? [lemmatizer.verb(word), lemmatizer.noun(word), lemmatizer.adjective(word)]
		: /(?:ies|ves|men|s)$/.test(word)
			? [lemmatizer.noun(word), lemmatizer.verb(word), lemmatizer.adjective(word)]
			: /(?:er|est)$/.test(word)
				? [lemmatizer.adjective(word), lemmatizer.noun(word), lemmatizer.verb(word)]
				: [lemmatizer.verb(word), lemmatizer.noun(word), lemmatizer.adjective(word)];
	return candidates.find(candidate => candidate !== word) ?? word;
}

/**
 * Shares one incremental Markdown scan between modal usages and word-frequency
 * counts. Each changed file is read and tokenized once; derived counts remain
 * cached until the file changes.
 */
export class UsageIndex {
	private files = new Map<string, IndexedFile>();
	private skippedFiles = new Set<string>();
	private usageCounts = new Map<string, number>();
	private usageRequests = new Map<string, Promise<number>>();
	private scanPromise?: Promise<void>;
	private refreshRequested = false;
	private hasScanned = false;
	private dataVersion = 0;
	private progressListeners = new Set<WordFrequencyProgress>();

	constructor(private app: App) {}

	async refresh(onProgress?: WordFrequencyProgress): Promise<void> {
		if (onProgress) {
			this.progressListeners.add(onProgress);
		}

		if (this.scanPromise) {
			this.refreshRequested = true;
		} else {
			this.scanPromise = this.runRefreshLoop();
		}
		const scanPromise = this.scanPromise;

		try {
			await scanPromise;
		} finally {
			if (this.scanPromise === scanPromise) {
				this.scanPromise = undefined;
			}
			if (onProgress) {
				this.progressListeners.delete(onProgress);
			}
		}
	}

	private async runRefreshLoop(): Promise<void> {
		do {
			this.refreshRequested = false;
			await this.scanFiles();
		} while (this.refreshRequested);
	}

	async getWordFrequencies(
		mode: GroupingMode = 'none',
		file?: TFile,
		onProgress?: WordFrequencyProgress,
	): Promise<Map<string, number>> {
		await this.refresh(onProgress);
		const result = new Map<string, number>();
		const indexedFiles = file
			? [this.files.get(file.path)].filter((indexed): indexed is IndexedFile => indexed !== undefined)
			: [...this.files.values()];

		let processed = 0;
		for (const indexed of indexedFiles) {
			for (const [word, count] of indexed.wordCounts[mode]) {
				result.set(word, (result.get(word) ?? 0) + count);
				processed++;
				if (processed % YIELD_INTERVAL === 0) {
					await yieldToUI();
				}
			}
		}
		return result;
	}

	getSkippedFiles(file?: TFile): string[] {
		return [...this.skippedFiles].filter(path => !file || path === file.path);
	}

	async getUsageCount(value: string): Promise<number> {
		if (!this.hasScanned && !this.scanPromise) {
			await this.refresh();
		} else if (this.scanPromise) {
			await this.scanPromise;
		}

		const normalizedValue = normalizeSynonym(value);
		if (!normalizedValue) {
			return 0;
		}
		const cached = this.usageCounts.get(normalizedValue);
		if (cached !== undefined) {
			return cached;
		}
		const pending = this.usageRequests.get(normalizedValue);
		if (pending) {
			const requestVersion = this.dataVersion;
			const count = await pending;
			return requestVersion === this.dataVersion
				? count
				: this.getUsageCount(value);
		}

		const request = this.countUsage(normalizedValue);
		this.usageRequests.set(normalizedValue, request);
		const requestVersion = this.dataVersion;
		try {
			const count = await request;
			if (requestVersion !== this.dataVersion) {
				return this.getUsageCount(value);
			}
			this.usageCounts.set(normalizedValue, count);
			return count;
		} finally {
			if (this.usageRequests.get(normalizedValue) === request) {
				this.usageRequests.delete(normalizedValue);
			}
		}
	}

	private async scanFiles(): Promise<void> {
		const markdownFiles = this.app.vault.getMarkdownFiles();
		const paths = new Set(markdownFiles.map(file => file.path));
		const indexChanged = !this.hasScanned ||
			[...this.files.keys()].some(path => !paths.has(path)) ||
			markdownFiles.some(file => {
				const cached = this.files.get(file.path);
				return file.stat.size > MAX_FILE_SIZE_BYTES
					? Boolean(cached) || !this.skippedFiles.has(file.path)
					: !cached || cached.mtime !== file.stat.mtime || cached.size !== file.stat.size;
			});
		if (indexChanged) {
			this.dataVersion++;
			this.usageCounts.clear();
			this.usageRequests.clear();
		}

		this.files.forEach((_, path) => {
			if (!paths.has(path)) {
				this.files.delete(path);
				this.skippedFiles.delete(path);
			}
		});

		for (const [index, file] of markdownFiles.entries()) {
			const { mtime, size } = file.stat;
			const cached = this.files.get(file.path);
			if (size > MAX_FILE_SIZE_BYTES) {
				this.files.delete(file.path);
				this.skippedFiles.add(file.path);
			} else if (cached?.mtime !== mtime || cached.size !== size) {
				const content = await this.app.vault.cachedRead(file);
				const indexed = await this.indexFile(file, content, mtime, size);
				this.files.set(file.path, indexed);
				this.skippedFiles.delete(file.path);
			}

			this.progressListeners.forEach(listener => listener(index + 1, markdownFiles.length));
			if ((index + 1) % 4 === 0 || index === markdownFiles.length - 1) {
				await yieldToUI();
			}
		}

		this.hasScanned = true;
	}

	private async indexFile(
		file: TFile,
		content: string,
		mtime: number,
		size: number,
	): Promise<IndexedFile> {
		const wordCounts: Record<GroupingMode, Map<string, number>> = {
			none: new Map(),
			stem: new Map(),
			lemma: new Map(),
		};
		const tokenPattern = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
		let token = tokenPattern.exec(content);
		let processedTokens = 0;
		while (token) {
			const word = token[0].toLowerCase();
			increment(wordCounts.none, word);
			increment(wordCounts.stem, stemmer(word));
			increment(wordCounts.lemma, lemmatizeWord(word));
			processedTokens++;
			if (processedTokens % YIELD_INTERVAL === 0) {
				await yieldToUI();
			}
			token = tokenPattern.exec(content);
		}

		const markdownTags = this.app.metadataCache.getFileCache(file)?.tags ?? [];
		const tagUsages = new Map<string, number>();
		for (let index = 0; index < markdownTags.length; index++) {
			const tagEntry = markdownTags[index];
			if (!tagEntry) {
				continue;
			}
			const { tag } = tagEntry;
			const normalizedTag = normalizeSynonym(tag);
			if (normalizedTag) {
				new Set([normalizedTag, ...normalizedTag.split('/')]).forEach(value => {
					increment(tagUsages, value);
				});
			}
			if ((index + 1) % YIELD_INTERVAL === 0) {
				await yieldToUI();
			}
		}

		let prose = '';
		let offset = 0;
		const tagRanges = markdownTags
			.map(({ position }) => ({
				start: position.start.offset,
				end: position.end.offset,
			}))
			.sort((left, right) => left.start - right.start);
		for (let index = 0; index < tagRanges.length; index++) {
			const range = tagRanges[index];
			if (!range) {
				continue;
			}
			const { start, end } = range;
			const rangeStart = Math.min(content.length, Math.max(offset, start));
			const rangeEnd = Math.min(content.length, Math.max(rangeStart, end));
			prose += content.slice(offset, rangeStart);
			prose += ' '.repeat(rangeEnd - rangeStart);
			offset = rangeEnd;
			if ((index + 1) % YIELD_INTERVAL === 0) {
				await yieldToUI();
			}
		}
		prose += content.slice(offset);

		return { mtime, size, wordCounts, prose: prose.toLowerCase(), tagUsages };
	}

	private async countUsage(value: string): Promise<number> {
		let total = 0;
		let processed = 0;
		for (const indexed of this.files.values()) {
			total += indexed.tagUsages.get(value) ?? 0;
			let offset = 0;
			while ((offset = indexed.prose.indexOf(value, offset)) !== -1) {
				total++;
				offset++;
				processed++;
				if (processed % YIELD_INTERVAL === 0) {
					await yieldToUI();
				}
			}
			await yieldToUI();
		}
		return total;
	}
}
