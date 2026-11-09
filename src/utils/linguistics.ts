import { App, TFile } from 'obsidian';

/**
 * Associates a synonym with the canonical term that should replace it.
 */
export interface SynonymReplacementRule {
	synonym: string;
	term: string;
}

export interface CommonWordCandidate {
	/** Complete term or synonym value checked against the common-word set. */
	value: string;
	/** Identifies which editor field supplied the candidate. */
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

interface SynonymMatch {
	/** Canonical term associated with the matched synonym, if any. */
	term?: string;
	/** Whether a matched synonym covers the entire candidate word. */
	exactMatch: boolean;
	/** Whether matches in the candidate word resolve to different terms. */
	conflict: boolean;
}

/** Trie node used by the compiled multi-pattern synonym matcher. */
interface SynonymMatcherNode {
	/** Edges to child nodes, keyed by the next synonym character. */
	transitions: Map<string, number>;
	/** Fallback state used when the current character has no outgoing edge. */
	failure: number;
	/** Next suffix state that has a matching synonym output. */
	outputLink: number;
	/** Rules ending at this node. */
	rules: Array<{ synonym: string; term: string }>;
}

/** Matches all configured synonyms contained in a candidate word. */
type SynonymMatcher = (word: string) => SynonymMatch;

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

export async function loadStopwords(app: App, pluginDirectory?: string): Promise<Set<string>> {
	if (!pluginDirectory) {
		throw new Error('Cannot locate the plugin folder to load resources/stopwords.txt.');
	}

	const resourcePath = `${pluginDirectory}/resources/stopwords.txt`;
	let content: string;
	try {
		content = await app.vault.adapter.read(resourcePath);
	} catch {
		throw new Error(`Could not load "${resourcePath}". Word frequency was cancelled.`);
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
 *
 * @param candidates Values collected from editable term and synonym fields.
 * @param commonWords Lowercase exact-word set loaded from the resource file.
 * @returns Candidates whose normalized values exist in the set.
 */
export function findCommonWordCandidates(
	candidates: CommonWordCandidate[],
	commonWords: Set<string>,
): CommonWordCandidate[] {
	return candidates.filter(candidate => commonWords.has(normalizeSynonym(candidate.value)));
}

/**
 * Builds an Aho–Corasick matcher so each word is scanned once rather than
 * testing it against every synonym rule.
 */
function createSynonymMatcher(rules: SynonymReplacementRule[]): SynonymMatcher {
	const nodes: SynonymMatcherNode[] = [{
		transitions: new Map(),
		failure: 0,
		outputLink: 0,
		rules: [],
	}];
	const getNode = (index: number): SynonymMatcherNode => {
		const node = nodes[index];
		if (!node) {
			throw new Error('Invalid synonym matcher state.');
		}
		return node;
	};

	rules.forEach(rule => {
		const synonym = normalizeSynonym(rule.synonym);
		if (!synonym) {
			return;
		}

		let nodeIndex = 0;
		for (const character of synonym) {
			let nextIndex = getNode(nodeIndex).transitions.get(character);
			if (nextIndex === undefined) {
				nextIndex = nodes.length;
				getNode(nodeIndex).transitions.set(character, nextIndex);
				nodes.push({
					transitions: new Map(),
					failure: 0,
					outputLink: 0,
					rules: [],
				});
			}
			nodeIndex = nextIndex;
		}
		getNode(nodeIndex).rules.push({ synonym, term: rule.term });
	});

	const queue: number[] = [];
	getNode(0).transitions.forEach(childIndex => queue.push(childIndex));
	for (let head = 0; head < queue.length; head++) {
		const nodeIndex = queue[head];
		if (nodeIndex === undefined) {
			continue;
		}
		const node = getNode(nodeIndex);
		node.transitions.forEach((childIndex, character) => {
			queue.push(childIndex);
			let fallback = node.failure;
			while (fallback !== 0 && !getNode(fallback).transitions.has(character)) {
				fallback = getNode(fallback).failure;
			}
			const childNode = getNode(childIndex);
			childNode.failure = getNode(fallback).transitions.get(character) ?? 0;
			const failureNode = getNode(childNode.failure);
			childNode.outputLink = failureNode.rules.length > 0
				? childNode.failure
				: failureNode.outputLink;
		});
	}

	return (word: string): SynonymMatch => {
		const normalizedWord = word.toLowerCase();
		let nodeIndex = 0;
		let term: string | undefined;
		let exactMatch = false;
		let conflict = false;

		for (const character of normalizedWord) {
			while (nodeIndex !== 0 && !getNode(nodeIndex).transitions.has(character)) {
				nodeIndex = getNode(nodeIndex).failure;
			}
			nodeIndex = getNode(nodeIndex).transitions.get(character) ?? 0;

			let outputIndex = getNode(nodeIndex).rules.length > 0
				? nodeIndex
				: getNode(nodeIndex).outputLink;
			while (outputIndex !== 0) {
				for (const rule of getNode(outputIndex).rules) {
					if (term !== undefined && term !== rule.term) {
						conflict = true;
						return { term, exactMatch, conflict };
					}
					term = rule.term;
					if (rule.synonym === normalizedWord) {
						exactMatch = true;
					}
				}
				outputIndex = getNode(outputIndex).outputLink;
			}
		}

		return { term, exactMatch, conflict };
	};
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
	const matchSynonyms = createSynonymMatcher(rules);
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
			const matchResult = matchSynonyms(word);
			if (matchResult.conflict) {
				throw new Error(`The word "${word}" matches synonyms assigned to different terms.`);
			}
			// Exact matches are safe to replace automatically, so only queue substrings.
			if (matchResult.term === undefined || matchResult.exactMatch) {
				continue;
			}

			const term = matchResult.term;
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
	return createSynonymReplacer(rules)(content, approvedWords);
}

/**
 * Prepares a reusable refactor function for a stable set of synonym rules.
 * The compiled matcher can be shared across all files in one refactor.
 *
 * @param rules Synonym-to-term mappings to compile.
 * @returns A function that transforms content using a set of approved larger words.
 * @throws When a token matches synonyms assigned to different terms.
 */
export function createSynonymReplacer(
	rules: SynonymReplacementRule[],
): (content: string, approvedWords: Set<string>) => string {
	const matchSynonyms = createSynonymMatcher(rules);

	return (content, approvedWords) => content.replace(/[\p{L}\p{N}_]+/gu, word => {
		const normalizedWord = word.toLowerCase();
		const match = matchSynonyms(word);
		if (match.conflict) {
			throw new Error(`The word "${word}" matches synonyms assigned to different terms.`);
		}
		if (match.term === undefined) {
			return word;
		}

		return match.exactMatch || approvedWords.has(normalizedWord)
			? match.term
			: word;
	});
}
