import { App, Modal, Notice, TFile } from 'obsidian';
import type { EventRef } from 'obsidian';
import {
	findCommonWordCandidates,
	loadCommonWords,
	normalizeSynonym,
	createSynonymReplacer,
	scanRefactorCandidates,
} from '../utils/linguistics';
import type { SynonymReplacementRule } from '../utils/linguistics';
import { confirmAction } from './ConfirmationModal';
import { createLexiconEntry } from './LexiconEntry';
import type { LexiconEntryInputs } from './LexiconEntry';
import type { UsageIndex } from '../utils/UsageIndex';

export interface LexiconModalOptions {
	/** Vault-relative lexicon data path; defaults to vocabulary.lexicon. */
	fileName?: string;
	/** Vault-relative plugin directory containing resources/common_words.txt. */
	pluginDirectory?: string;
	/** Mutable normalized list of common terms already approved by the user. */
	confirmedCommonTerms: string[];
	/** Persists changes to the common-term confirmation list. */
	persistCommonTermConfirmations: () => Promise<void>;
	/** Shared service that supplies and refreshes vault-wide usage counts. */
	usageIndex: UsageIndex;
}

/**
 * Editor for the root lexicon file.
 *
 * Each entry has a term, definition, and semicolon-separated synonyms. Counts
 * come from the linguistics helper, while this class owns rendering, editing,
 * confirmation prompts, and vault writes.
 */
export class LexiconModal extends Modal {
	private fileName: string;
	private pluginDirectory?: string;
	private confirmedCommonTerms: string[];
	private persistCommonTermConfirmations: () => Promise<void>;
	private usageIndex: UsageIndex;
	private usageRefreshTimer?: number;
	private vaultEventRefs: EventRef[] = [];
	private metadataEventRef?: EventRef;

	/**
	 * @param app Obsidian app instance used by the modal.
	 * @param options File location and persistence for common-word confirmations.
	 */
	constructor(
		app: App,
		options: LexiconModalOptions,
	) {
		super(app);
		this.fileName = options.fileName ?? 'vocabulary.lexicon';
		this.pluginDirectory = options.pluginDirectory;
		this.confirmedCommonTerms = options.confirmedCommonTerms;
		this.persistCommonTermConfirmations = options.persistCommonTermConfirmations;
		this.usageIndex = options.usageIndex;
	}

	/** Load lexicon data and usage counts, then build the interactive editor. */
	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Vocabulary' });

		// Keep the modal usable while the lexicon and vault usage counts load.
		const loadingIndicator = contentEl.createEl('p', {
			text: 'Loading vocabulary items...',
			cls: 'loading-text',
		});
		let rawContent = '';

		try {
			// Read through the adapter so the configured vault-relative path is used.
			if (await this.app.vault.adapter.exists(this.fileName)) {
				rawContent = await this.app.vault.adapter.read(this.fileName);
			} else {
				// Starting with an empty list lets users create the file by saving.
				new Notice(`File "${this.fileName}" not found at the root. Initializing an empty list.`);
			}
		} catch (error) {
			console.error('Failed to read lexicon file:', error);
			new Notice('Error loading vocabulary data.');
		}

		loadingIndicator.remove();
		const scanProgress = contentEl.createEl('p', {
			cls: 'loading-text',
			text: 'Preparing usage counts...',
		});
		void this.usageIndex.refresh((completed, total) => {
			scanProgress.setText(`Scanning Markdown files (${completed}/${total})...`);
		}).catch(error => {
			console.error('Failed to scan Markdown files for synonym usages:', error);
			new Notice('Could not update vocabulary usage counts.');
		}).finally(() => {
			scanProgress.remove();
		});

		const entriesEl = contentEl.createDiv({ cls: 'lexicon-entries' });
		// Keep the inputs together so additions, removals, and saving use the same rows.
		const entries: LexiconEntryInputs[] = [];
		const saveErrors = new Map<HTMLInputElement, HTMLSpanElement>();
		/**
		 * Re-scan after a refactor and fire the existing input handlers to refresh
		 * all visible term, synonym, and collapsed row counts.
		 */
		const refreshUsageCounts = async (onProgress: (completed: number, total: number) => void) => {
			await this.usageIndex.refresh(onProgress);
			entries.forEach(entry => {
				entry.term.dispatchEvent(new Event('input'));
				entry.synonyms.forEach(synonym => synonym.dispatchEvent(new Event('input')));
			});
		};
		const scheduleUsageCountRefresh = () => {
			if (this.usageRefreshTimer !== undefined) {
				window.clearTimeout(this.usageRefreshTimer);
			}
			this.usageRefreshTimer = window.setTimeout(() => {
				this.usageRefreshTimer = undefined;
				const progress = contentEl.createEl('p', {
					text: 'Updating usage counts...',
					cls: 'loading-text',
				});
				void refreshUsageCounts((completed, total) => {
					progress.setText(`Updating usage counts (${completed}/${total})...`);
				}).catch(error => {
					console.error('Failed to refresh Markdown usage counts:', error);
					new Notice('Could not update usage counts.');
				}).finally(() => {
					progress.remove();
				});
			}, 300);
		};
		const isMarkdownFile = (file: unknown): file is TFile =>
			file instanceof TFile && file.extension.toLowerCase() === 'md';
		this.vaultEventRefs.push(this.app.vault.on('create', file => {
			if (isMarkdownFile(file)) {
				scheduleUsageCountRefresh();
			}
		}));
		this.vaultEventRefs.push(this.app.vault.on('modify', file => {
			if (isMarkdownFile(file)) {
				scheduleUsageCountRefresh();
			}
		}));
		this.vaultEventRefs.push(this.app.vault.on('delete', file => {
			if (isMarkdownFile(file)) {
				scheduleUsageCountRefresh();
			}
		}));
		this.vaultEventRefs.push(this.app.vault.on('rename', (file, oldPath) => {
			if (isMarkdownFile(file) || oldPath.toLowerCase().endsWith('.md')) {
				scheduleUsageCountRefresh();
			}
		}));
		this.metadataEventRef = this.app.metadataCache.on('changed', file => {
			if (isMarkdownFile(file)) {
				scheduleUsageCountRefresh();
			}
		});

		const addEntry = (
			initialValues: string[] = ['', '', ''],
			expanded = true,
			initialSynonyms?: string[],
		) => {
			entries.push(createLexiconEntry({
				container: entriesEl,
				initialValues,
				expanded,
				initialSynonyms,
				entryIndex: entries.length,
				getUsageCount: value => this.usageIndex.getUsageCount(value),
				saveErrors,
				onRefactor: (entry, button) => {
					void refactorEntries([entry], button);
				},
			}));
		};

		// Existing serialized rows open collapsed; an empty file starts with two
		// editable entries to make adding the first terms straightforward.
		if (rawContent.trim().length > 0) {
			const lines = rawContent.split(/\r?\n/).filter(line => line.trim().length > 0);
			lines.forEach(line => {
				const fields = line.split(',').map(field => field.trim());
				addEntry([fields[0] || '', fields[1] || '', fields[2] || ''], false);
			});
		} else {
			addEntry();
			addEntry();
		}

		const actionsDiv = contentEl.createDiv({ cls: 'modal-actions' });
		const addButton = actionsDiv.createEl('button', { text: 'Add row' });
		addButton.onclick = () => addEntry();

		const saveButton = actionsDiv.createEl('button', {
			text: 'Save updates',
			cls: 'mod-cta',
		});
		const refactorButton = actionsDiv.createEl('button', {
			text: 'Refactor',
			attr: { type: 'button' },
		});
		refactorButton.onclick = () => refactorEntries(entries, refactorButton);
		const app = this.app;
		const pluginDirectory = this.pluginDirectory;
		const modalEl = this.modalEl;

		/**
		 * Validate a selected group, request approvals, then replace synonyms in
		 * Markdown files. Passing one entry scopes the action to its row button.
		 */
		async function refactorEntries(
			targetEntries: LexiconEntryInputs[],
			button: HTMLButtonElement,
		) {
			// Build one unambiguous replacement mapping per normalized synonym.
			const termRules = new Map<string, string>();
			const rules: SynonymReplacementRule[] = [];
			let invalidEntry = '';

			targetEntries.forEach(entry => {
				const term = entry.term.value.trim();
				if (!term) {
					if (entry.synonyms.some(synonym => synonym.value.trim())) {
						invalidEntry = 'Enter a term for every entry that has synonyms before refactoring.';
					}
					return;
				}

				entry.synonyms.forEach(synonymInput => {
					const synonym = synonymInput.value.trim();
					const normalizedSynonym = normalizeSynonym(synonym);
					if (!normalizedSynonym || normalizedSynonym === normalizeSynonym(term)) {
						return;
					}

					const existingTerm = termRules.get(normalizedSynonym);
					if (existingTerm && existingTerm.toLowerCase() !== term.toLowerCase()) {
						invalidEntry = `The synonym "${synonym}" is assigned to multiple terms.`;
					}
					if (!existingTerm) {
						termRules.set(normalizedSynonym, term);
						rules.push({ synonym, term });
					}
				});
			});

			if (invalidEntry) {
				new Notice(invalidEntry);
				return;
			}

			if (rules.length === 0) {
				new Notice('Add a term and at least one synonym before refactoring.');
				return;
			}
			const replaceSynonymWords = createSynonymReplacer(rules);

			button.disabled = true;
			const progress = contentEl.createEl('p', { cls: 'loading-text' });
			try {
				const commonWords = await loadCommonWords(app, pluginDirectory);
				const candidates = targetEntries.flatMap(entry => [
					{ value: entry.term.value, type: 'term' as const },
					...entry.synonyms.map(synonym => ({
						value: synonym.value,
						type: 'synonym' as const,
					})),
				]);

				for (const match of findCommonWordCandidates(candidates, commonWords)) {
					const confirmed = await confirmAction(
						app,
						'Common word detected',
						`The ${match.type} "${match.value.trim()}" appears in common_words.txt. Continue refactoring?`,
						'Continue',
					);
					if (!confirmed) {
						return;
					}
				}

				// Scan first so the user can approve each larger-word match before writing.
				const scan = await scanRefactorCandidates(app, rules, (completed, total) => {
					progress.setText(`Checking Markdown files (${completed}/${total})...`);
				});

				const approvedWords = new Set<string>();
				for (const { word, term } of scan.largerWords) {
					// Exact synonym tokens do not appear here and need no individual prompt.
					const confirmed = await confirmAction(
						app,
						'Replace a matching word?',
						`"${word}" contains a synonym. Replace every occurrence of "${word}" with "${term}"?`,
						'Replace word',
					);
					if (confirmed) {
						approvedWords.add(word.toLowerCase());
					}
				}

				const changedFiles = scan.files.filter(({ content }) =>
					replaceSynonymWords(content, approvedWords) !== content,
				);
				if (changedFiles.length === 0) {
					new Notice('No matching words were found to refactor.');
					return;
				}

				const confirmed = await confirmAction(
					app,
					'Confirm refactor',
					`Replace matching synonyms in ${changedFiles.length} Markdown file(s)? Exact synonym matches and approved larger words will be replaced.`,
					'Refactor files',
				);
				if (!confirmed) {
					return;
				}

				// Re-read each file immediately before changing it to avoid overwriting
				// edits made while the user was answering the confirmation dialogs.
				let updatedFiles = 0;
				try {
					for (const { file } of changedFiles) {
						progress.setText(`Refactoring Markdown files (${updatedFiles + 1}/${changedFiles.length})...`);
						const currentContent = await app.vault.read(file);
						const updatedContent = replaceSynonymWords(currentContent, approvedWords);
						if (updatedContent !== currentContent) {
							await app.vault.modify(file, updatedContent);
						}
						updatedFiles++;
					}
				} catch (error) {
					// Earlier writes cannot be rolled back, so refresh counts for partial work.
					console.error('Refactor stopped before all files were updated:', error);
					new Notice(`Refactor stopped after updating ${updatedFiles} of ${changedFiles.length} files.`);
					if (updatedFiles > 0) {
						try {
							progress.setText('Refreshing usage counts...');
							await refreshUsageCounts((completed, total) => {
								progress.setText(`Refreshing usage counts (${completed}/${total})...`);
							});
						} catch (refreshError) {
							console.error('Unable to refresh usage counts after a partial refactor:', refreshError);
							new Notice('Some files changed, but usage counts could not be refreshed.');
						}
					}
					return;
				}

				progress.setText('Refreshing usage counts...');
				try {
					// Rebuild the counter from the updated vault and refresh every visible count.
					await refreshUsageCounts((completed, total) => {
						progress.setText(`Refreshing usage counts (${completed}/${total})...`);
					});
				} catch (error) {
					console.error('Refactor completed, but usage counts could not be refreshed:', error);
					new Notice('Refactor completed, but usage counts could not be refreshed. Close and reopen the modal to update them.');
					return;
				}

				new Notice(`Refactor complete. Updated ${updatedFiles} Markdown file(s).`);
			} catch (error) {
				console.error('Failed to prepare lexicon refactor:', error);
				new Notice(error instanceof Error ? error.message : 'Failed to prepare refactor.');
			} finally {
				progress.remove();
				refactorButton.disabled = false;
			}
		}
		/**
		 * Validate synonym ownership and common-word confirmations before writing
		 * the current rows in the lexicon's existing comma-delimited format.
		 */
		saveButton.onclick = async () => {
			const synonymTerms = new Map<string, { synonym: string; term: string }>();
			saveErrors.forEach(error => {
				error.hide();
				error.empty();
			});
			modalEl.removeClass('lexicon-modal-shake');
			void modalEl.offsetWidth;
			for (const entry of entries) {
				const term = entry.term.value.trim();
				if (!term) {
					continue;
				}

				for (const synonymInput of entry.synonyms) {
					const synonym = synonymInput.value.trim();
					const normalizedSynonym = normalizeSynonym(synonym);
					if (!normalizedSynonym) {
						continue;
					}

					const existing = synonymTerms.get(normalizedSynonym);
					if (existing && existing.term.toLowerCase() !== term.toLowerCase()) {
						const message = `This synonym is assigned to both "${existing.term}" and "${term}".`;
						const error = saveErrors.get(synonymInput);
						if (error) {
							error.setText(message);
							error.show();
						}
						entry.container.open = true;
						synonymInput.focus();
						synonymInput.scrollIntoView({ block: 'center' });
						modalEl.addClass('lexicon-modal-shake');
						return;
					}
					synonymTerms.set(normalizedSynonym, { synonym, term });
				}
			}

			// Keep the existing comma-delimited file format and omit entirely blank rows.
			// Commas are stripped because the current storage format has no CSV escaping.
			const rowsData = entries
				.map(entry => [
					entry.term.value,
					entry.definition.value,
					entry.synonyms.map(synonym => synonym.value).filter(synonym => synonym.trim() !== '').join('; '),
				].map(value => value.replace(/,/g, '')))
				.filter(values => values.some(value => value.trim() !== ''))
				.map(values => values.join(', '));

			let commonWords: Set<string>;
			try {
				commonWords = await loadCommonWords(app, pluginDirectory);
			} catch (error) {
				console.error('Unable to check terms against the common-word list:', error);
				new Notice(error instanceof Error ? error.message : 'Unable to check common words. Updates were not saved.');
				return;
			}

			const commonTerms = new Map<string, string>();
			findCommonWordCandidates(
				entries.map(entry => ({ value: entry.term.value, type: 'term' as const })),
				commonWords,
			).forEach(({ value }) => {
				const normalizedTerm = normalizeSynonym(value);
				if (
					normalizedTerm &&
					!this.confirmedCommonTerms.includes(normalizedTerm) &&
					!commonTerms.has(normalizedTerm)
				) {
					commonTerms.set(normalizedTerm, value.trim());
				}
			});

			for (const [normalizedTerm, term] of commonTerms) {
				const confirmed = await confirmAction(
					app,
					'Common word in term',
					`The term "${term}" appears in common_words.txt. Save these updates anyway?`,
					'Save updates',
				);
				if (!confirmed) {
					return;
				}
				this.confirmedCommonTerms.push(normalizedTerm);
				try {
					await this.persistCommonTermConfirmations();
				} catch (error) {
					this.confirmedCommonTerms.pop();
					console.error('Unable to persist the common-term confirmation:', error);
					new Notice('Could not remember this confirmation. Updates were not saved.');
					return;
				}
			}

			try {
				await this.app.vault.adapter.write(this.fileName, rowsData.join('\n'));
				new Notice('Lexicon data successfully overwritten!');
				this.close();
			} catch (error) {
				console.error('Error writing lexicon back to vault:', error);
				new Notice('Failed to export changes.');
			}
		};
	}

	/** Remove modal content when Obsidian closes the dialog. */
	onClose() {
		if (this.usageRefreshTimer !== undefined) {
			window.clearTimeout(this.usageRefreshTimer);
			this.usageRefreshTimer = undefined;
		}
		this.vaultEventRefs.forEach(eventRef => this.app.vault.offref(eventRef));
		this.vaultEventRefs = [];
		if (this.metadataEventRef) {
			this.app.metadataCache.offref(this.metadataEventRef);
			this.metadataEventRef = undefined;
		}
		this.contentEl.empty();
	}
}
