import { App, TFile } from 'obsidian';

/**
 * Counts case-insensitive matches for a term or synonym in the scanned vault.
 */
export type UsageCounter = (value: string) => number;

/**
 * Associates a synonym with the canonical term that should replace it.
 */
export interface SynonymReplacementRule {
	synonym: string;
	term: string;
}

export interface CommonWordCandidate {
	value: string;
	type: 'term' | 'synonym';
}

/**
 * The Markdown snapshot and larger words collected during a refactor scan.
 *
 * Keeping file contents from the scan lets the UI preview which files would
 * change before it asks the user to confirm the write.
 */
export interface RefactorScan {
	files: Array<{ file: TFile; content: string }>;
	largerWords: Array<{ word: string; term: string }>;
}

/**
 * Adds the usage count for each value, including repeated values if present.
 */
export function countTotalUsages(values: string[], getUsageCount: UsageCounter): number {
	return values.reduce((total, value) => total + getUsageCount(value), 0);
}

/**
 * Normalizes values for matching: trims surrounding whitespace, removes leading
 * hashtag markers, and ignores letter casing.
 *
 * @param synonym A lexicon synonym, plain word, or Markdown hashtag.
 * @returns The normalized value used by the count and replacement helpers.
 */
export function normalizeSynonym(synonym: string): string {
	return synonym.trim().replace(/^#+/, '').toLowerCase();
}

/**
 * Loads the plugin's newline-delimited common-word list from its vault folder.
 *
 * @param app Obsidian app used to read the resource through the vault adapter.
 * @param pluginDirectory Vault-relative directory from the plugin manifest.
 * @returns Lowercase words with blank lines omitted.
 * @throws If the plugin directory is unavailable or the resource cannot be read.
 */
export async function loadCommonWords(app: App, pluginDirectory?: string): Promise<Set<string>> {
	if (!pluginDirectory) {
		throw new Error('Cannot locate the plugin folder to load resources/common_words.txt.');
	}

	const resourcePath = `${pluginDirectory}/resources/common_words.txt`;
	let content: string;
	try {
		content = await app.vault.adapter.read(resourcePath);
	} catch {
		throw new Error(`Could not load "${resourcePath}". Refactor was cancelled.`);
	}

	return new Set(
		content.split(/\r?\n/)
			.map(word => word.trim().toLowerCase())
			.filter(Boolean),
	);
}

/**
 * Returns each non-empty term or synonym whose complete value is a common word.
 * Matching ignores case and surrounding whitespace but does not match substrings.
 */
export function findCommonWordCandidates(
	candidates: CommonWordCandidate[],
	commonWords: Set<string>,
): CommonWordCandidate[] {
	return candidates.filter(candidate => commonWords.has(normalizeSynonym(candidate.value)));
}

/**
 * Counts substring matches, including overlapping ones.
 *
 * @param text The text to search; callers provide normalized text.
 * @param query The normalized substring to count.
 * @returns The number of matches, or zero when the query is empty.
 */
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

/**
 * Reads all Markdown files and collects candidate larger words for refactoring.
 *
 * Exact synonym tokens are not returned as larger-word candidates; those are
 * replaced without an individual prompt. Tokens containing a synonym as a
 * substring are returned so the caller can ask whether to replace each word.
 * A token that matches synonyms mapped to different terms aborts the scan.
 *
 * @param app Obsidian app used to enumerate and read vault Markdown files.
 * @param rules Synonym-to-term replacement mappings from the modal.
 * @param onProgress Called after each file begins scanning.
 * @returns File snapshots and unique larger words requiring user approval.
 * @throws If any file cannot be read or a word maps to conflicting terms.
 */
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

		// Treat each Unicode letter/number/underscore sequence as a word candidate.
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
			// Exact matches are safe to replace automatically, so only queue substrings.
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

/**
 * Replaces exact synonym tokens and user-approved larger tokens in Markdown text.
 *
 * Matching is case-insensitive and replaces an entire token with the canonical
 * term; it does not preserve the original token's casing. Punctuation and
 * whitespace are left untouched. Conflicting synonym mappings are rejected.
 *
 * @param content Markdown content to update.
 * @param rules Synonym-to-term replacement mappings.
 * @param approvedWords Normalized larger words approved by the user.
 * @returns Updated content; unchanged content if there are no approved matches.
 * @throws If a token matches synonyms mapped to different terms.
 */
export function replaceSynonymWords(
	content: string,
	rules: SynonymReplacementRule[],
	approvedWords: Set<string>,
): string {
	const normalizedRules = rules.map(rule => ({
		synonym: normalizeSynonym(rule.synonym),
		term: rule.term,
	}));

	// Match the same token boundaries used when gathering refactor candidates.
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

/**
 * Builds a reusable usage counter by scanning the vault's Markdown files.
 *
 * Hashtags are counted from Obsidian's parsed metadata, with each component
 * of a hierarchical tag counted separately. The source ranges occupied by
 * those hashtags are masked before the prose scan so each tag only counts once.
 *
 * @param app Obsidian app used to read Markdown files and their cached metadata.
 * @param onProgress Called once per file with the completed and total counts.
 * @returns A normalized, case-insensitive counter for any term or synonym.
 * @throws If a Markdown file cannot be read.
 */
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
			// Clamp metadata offsets in case the cached range exceeds current file text.
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
