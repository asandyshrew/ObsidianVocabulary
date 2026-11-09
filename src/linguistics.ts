import { App, TFile } from 'obsidian';

export type UsageCounter = (value: string) => number;

export interface SynonymReplacementRule {
	synonym: string;
	term: string;
}

export interface RefactorScan {
	files: Array<{ file: TFile; content: string }>;
	largerWords: Array<{ word: string; term: string }>;
}

export function countTotalUsages(values: string[], getUsageCount: UsageCounter): number {
	return values.reduce((total, value) => total + getUsageCount(value), 0);
}

// Treat "#word" in a Markdown tag the same as "word" in a lexicon field.
export function normalizeSynonym(synonym: string): string {
	return synonym.trim().replace(/^#+/, '').toLowerCase();
}

// Advance one character after each match so overlapping substrings count too.
function countOccurrences(text: string, query: string): number {
	if (!query) {
		return 0;
	}

	let count = 0;
	let offset = 0;
	while ((offset = text.indexOf(query, offset)) !== -1) {
		count++;
		offset++;
	}
	return count;
}

export async function scanRefactorCandidates(
	app: App,
	rules: SynonymReplacementRule[],
	onProgress: (completed: number, total: number) => void,
): Promise<RefactorScan> {
	const normalizedRules = rules.map(rule => ({
		synonym: normalizeSynonym(rule.synonym),
		term: rule.term,
	}));
	const files: RefactorScan['files'] = [];
	const largerWords = new Map<string, { word: string; term: string }>();
	const markdownFiles = app.vault.getMarkdownFiles();

	for (const [i, file] of markdownFiles.entries()) {
		onProgress(i + 1, markdownFiles.length);
		const content = await app.vault.read(file);
		files.push({ file, content });

		for (const match of content.matchAll(/[\p{L}\p{N}_]+/gu)) {
			const word = match[0];
			const normalizedWord = word.toLowerCase();
			const matchingRules = normalizedRules.filter(rule =>
				rule.synonym && normalizedWord.includes(rule.synonym),
			);
			const terms = new Set(matchingRules.map(rule => rule.term));

			if (terms.size > 1) {
				throw new Error(`The word "${word}" matches synonyms assigned to different terms.`);
			}
			if (terms.size === 0 || matchingRules.some(rule => normalizedWord === rule.synonym)) {
				continue;
			}

			const term = matchingRules[0]?.term;
			if (term === undefined) {
				continue;
			}
			const existing = largerWords.get(normalizedWord);
			if (existing && existing.term !== term) {
				throw new Error(`The word "${word}" matches synonyms assigned to different terms.`);
			}
			largerWords.set(normalizedWord, { word, term });
		}
	}

	return {
		files,
		largerWords: Array.from(largerWords.values()),
	};
}

export function replaceSynonymWords(
	content: string,
	rules: SynonymReplacementRule[],
	approvedWords: Set<string>,
): string {
	const normalizedRules = rules.map(rule => ({
		synonym: normalizeSynonym(rule.synonym),
		term: rule.term,
	}));

	return content.replace(/[\p{L}\p{N}_]+/gu, word => {
		const normalizedWord = word.toLowerCase();
		const matchingRules = normalizedRules.filter(rule =>
			rule.synonym && normalizedWord.includes(rule.synonym),
		);
		const terms = new Set(matchingRules.map(rule => rule.term));

		if (terms.size > 1) {
			throw new Error(`The word "${word}" matches synonyms assigned to different terms.`);
		}
		if (terms.size === 0) {
			return word;
		}

		const exactMatch = matchingRules.some(rule => normalizedWord === rule.synonym);
		const term = matchingRules[0]?.term;
		return term !== undefined && (exactMatch || approvedWords.has(normalizedWord))
			? term
			: word;
	});
}

export async function createUsageCounter(
	app: App,
	onProgress: (completed: number, total: number) => void,
): Promise<UsageCounter> {
	// Keep hashtag counts separate from prose counts to avoid counting tags twice.
	const synonymUsages = new Map<string, number>();
	const regularText: string[] = [];
	const markdownFiles = app.vault.getMarkdownFiles();

	for (const [i, file] of markdownFiles.entries()) {
		onProgress(i + 1, markdownFiles.length);
		const content = await app.vault.read(file);
		// Obsidian's cache identifies actual hashtags, including their source positions.
		const markdownTags = app.metadataCache.getFileCache(file)?.tags ?? [];

		markdownTags.forEach(({ tag: markdownTag }) => {
			const normalizedSynonym = normalizeSynonym(markdownTag);
			if (!normalizedSynonym) {
				return;
			}

			// Count each part of a nested tag as well as the full tag.
			const synonymNames = new Set([
				normalizedSynonym,
				...normalizedSynonym.split('/'),
			]);
			synonymNames.forEach(synonym => {
				synonymUsages.set(synonym, (synonymUsages.get(synonym) ?? 0) + 1);
			});
		});

		let prose = '';
		let offset = 0;
		// Sort ranges so we can mask them in order without changing later offsets.
		const markdownTagRanges = markdownTags
			.map(({ position }) => ({
				start: position.start.offset,
				end: position.end.offset,
			}))
			.sort((a, b) => a.start - b.start);
		// Mask parsed hashtags so the prose scan won't count them twice.
		markdownTagRanges.forEach(({ start, end }) => {
			const rangeStart = Math.min(content.length, Math.max(offset, start));
			const rangeEnd = Math.min(content.length, Math.max(rangeStart, end));
			prose += content.slice(offset, rangeStart);
			prose += ' '.repeat(rangeEnd - rangeStart);
			offset = rangeEnd;
		});
		prose += content.slice(offset);
		regularText.push(prose.toLowerCase());
	}

	// Terms and synonyms use the same tag-plus-prose matching rules.
	return (value: string): number => {
		const normalizedValue = normalizeSynonym(value);
		return (synonymUsages.get(normalizedValue) ?? 0) + regularText.reduce(
			(total, text) => total + countOccurrences(text, normalizedValue),
			0,
		);
	};
}
