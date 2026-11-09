import { App, Modal, Notice } from 'obsidian';
import {
	countTotalUsages,
	createUsageCounter,
	normalizeSynonym,
	replaceSynonymWords,
	scanRefactorCandidates,
} from './linguistics';
import type { SynonymReplacementRule } from './linguistics';

interface LexiconEntryInputs {
	term: HTMLInputElement;
	definition: HTMLInputElement;
	synonyms: HTMLInputElement[];
}

class ConfirmationModal extends Modal {
	private settled = false;

	constructor(
		app: App,
		private title: string,
		private message: string,
		private confirmLabel: string,
		private onDecision: (confirmed: boolean) => void,
	) {
		super(app);
	}

	onOpen() {
		this.contentEl.createEl('h2', { text: this.title });
		this.contentEl.createEl('p', { text: this.message });

		const actions = this.contentEl.createDiv({ cls: 'modal-actions' });
		actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => {
			this.finish(false);
		});
		actions.createEl('button', {
			text: this.confirmLabel,
			cls: 'mod-cta',
		}).addEventListener('click', () => {
			this.finish(true);
		});
	}

	onClose() {
		if (!this.settled) {
			this.settled = true;
			this.onDecision(false);
		}
		this.contentEl.empty();
	}

	private finish(confirmed: boolean) {
		if (this.settled) {
			return;
		}
		this.settled = true;
		this.onDecision(confirmed);
		this.close();
	}
}

function confirmAction(
	app: App,
	title: string,
	message: string,
	confirmLabel: string,
): Promise<boolean> {
	return new Promise(resolve => {
		new ConfirmationModal(app, title, message, confirmLabel, resolve).open();
	});
}

export class LexiconModal extends Modal {
	private fileName: string;

	constructor(app: App, fileName: string = 'vocabulary.lexicon') {
		super(app);
		this.fileName = fileName;
	}

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

		let getUsageCount: (value: string) => number;
		try {
			getUsageCount = await createUsageCounter(this.app, (completed, total) => {
				loadingIndicator.setText(`Scanning Markdown files (${completed}/${total})...`);
			});
		} catch (error) {
			// Don't show partial counts; they would look complete but miss unreadable files.
			console.error('Failed to scan Markdown files for synonym usages:', error);
			loadingIndicator.setText('Unable to scan Markdown files. Close and reopen the modal to try again.');
			new Notice('Could not scan Markdown files for synonym usages.');
			return;
		}

		loadingIndicator.remove();
		const entriesEl = contentEl.createDiv({ cls: 'lexicon-entries' });
		// Keep the inputs together so additions, removals, and saving use the same rows.
		const entries: LexiconEntryInputs[] = [];
		const refreshUsageCounts = async (onProgress: (completed: number, total: number) => void) => {
			getUsageCount = await createUsageCounter(this.app, onProgress);
			entries.forEach(entry => {
				entry.term.dispatchEvent(new Event('input'));
				entry.synonyms.forEach(synonym => synonym.dispatchEvent(new Event('input')));
			});
		};

		// Build one collapsible entry; existing entries start closed, new ones open.
		const addEntry = (
			initialValues: string[] = ['', '', ''],
			expanded = true,
			initialSynonyms?: string[],
		) => {
			const entry = entriesEl.createEl('details', { cls: 'lexicon-entry' });
			entry.open = expanded;

			const summary = entry.createEl('summary', {
				cls: 'lexicon-entry-summary',
			});
			const summaryTerm = summary.createSpan({
				text: initialValues[0] || 'New vocabulary item',
				cls: 'lexicon-entry-title',
			});
			const summaryCounts = summary.createSpan({
				cls: 'lexicon-entry-usage-group',
			});
			// The collapsed row shows the term count, then the combined row total.
			const summaryUsageCount = summaryCounts.createSpan({ cls: 'lexicon-entry-usage' });
			summaryCounts.createSpan({ text: '|', cls: 'lexicon-entry-usage-separator' });
			const summaryRowUsageCount = summaryCounts.createSpan({ cls: 'lexicon-entry-usage' });
			const fieldsEl = entry.createDiv({ cls: 'lexicon-entry-fields' });
			const entryIndex = entries.length;
			const createField = (label: string, value: string, index: number) => {
				const field = fieldsEl.createDiv({ cls: 'lexicon-entry-field' });
				const inputId = `lexicon-field-${entryIndex}-${index}`;
				// Linking labels to unique inputs also makes each field easier to access.
				field.createEl('label', { text: label, attr: { for: inputId } });
				const input = field.createEl('input', {
					type: 'text',
					value,
					placeholder: label,
					attr: { id: inputId },
				});
				return { field, input };
			};

			const termField = createField('Term', initialValues[0] || '', 0);
			const rowInputs: LexiconEntryInputs = {
				term: termField.input,
				definition: createField('Definition', initialValues[1] || '', 1).input,
				synonyms: [],
			};
			entries.push(rowInputs);

			const updateSummaryRowUsageCount = () => {
				// Recalculate from current inputs so edits and removals are reflected immediately.
				const count = countTotalUsages(
					[rowInputs.term.value, ...rowInputs.synonyms.map(synonym => synonym.value)],
					getUsageCount,
				);
				summaryRowUsageCount.textContent = `${count}`;
				summaryRowUsageCount.setAttribute('aria-label', `${count} total usages for this row`);
				summaryRowUsageCount.title = `${count} total usages for this row`;
			};
			const termUsageCount = termField.field.createSpan({ cls: 'lexicon-synonym-usage' });
			const updateTermUsageCount = () => {
				const count = getUsageCount(rowInputs.term.value);
				termUsageCount.textContent = `${count} usages`;
				termUsageCount.setAttribute('aria-label', `${count} usages in Markdown files`);
				termUsageCount.title = `${count} usages in Markdown files`;
				summaryUsageCount.textContent = `${count}`;
				summaryUsageCount.setAttribute('aria-label', `${count} usages in Markdown files`);
				summaryUsageCount.title = `${count} usages in Markdown files`;
				updateSummaryRowUsageCount();
			};
			rowInputs.term.addEventListener('input', updateTermUsageCount);
			updateTermUsageCount();

			rowInputs.term.addEventListener('input', () => {
				summaryTerm.textContent = rowInputs.term.value || 'New vocabulary item';
			});

			const synonymField = fieldsEl.createDiv({ cls: 'lexicon-entry-field' });
			synonymField.createEl('label', { text: 'Synonyms' });
			const synonymList = synonymField.createDiv({ cls: 'lexicon-synonym-list' });

			// Each synonym owns its counter and controls, while the entry tracks its input.
			const addSynonym = (value = '') => {
				const synonymRow = synonymList.createDiv({ cls: 'lexicon-synonym-row' });
				const input = synonymRow.createEl('input', {
					type: 'text',
					value,
					placeholder: 'Synonym',
					attr: { 'aria-label': 'Synonym' },
				});
				const usageCount = synonymRow.createSpan({
					cls: 'lexicon-synonym-usage',
					attr: { 'aria-live': 'polite' },
				});
				const updateUsageCount = () => {
					const count = getUsageCount(input.value);
					usageCount.textContent = String(count);
					usageCount.setAttribute('aria-label', `${count} synonym usages in Markdown files`);
					usageCount.title = `${count} synonym usages in Markdown files`;
					updateSummaryRowUsageCount();
				};
				const swapButton = synonymRow.createEl('button', {
					text: 'Swap with term',
					attr: { type: 'button', 'aria-label': 'Swap synonym with term' },
				});
				swapButton.addEventListener('click', () => {
					// Dispatch input events so both counters and the collapsed title refresh.
					const term = rowInputs.term.value;
					rowInputs.term.value = input.value;
					input.value = term;
					rowInputs.term.dispatchEvent(new Event('input'));
					input.dispatchEvent(new Event('input'));
				});
				const removeButton = synonymRow.createEl('button', {
					text: 'Remove',
					attr: { type: 'button', 'aria-label': 'Remove synonym' },
				});
				removeButton.addEventListener('click', () => {
					synonymRow.remove();
					// Remove the detached input from the data model as well as the UI.
					const inputIndex = rowInputs.synonyms.indexOf(input);
					if (inputIndex !== -1) {
						rowInputs.synonyms.splice(inputIndex, 1);
					}
					updateSummaryRowUsageCount();
				});
				rowInputs.synonyms.push(input);
				input.addEventListener('input', updateUsageCount);
				updateUsageCount();
			};

			// The file stores synonyms in one field separated by semicolons.
			const synonyms = initialSynonyms ?? (
				initialValues[2]
					? initialValues[2].split(';').map(synonym => synonym.trim()).filter(Boolean)
					: ['']
			);
			synonyms.forEach(synonym => addSynonym(synonym));

			const addSynonymButton = synonymField.createEl('button', {
				text: 'Add synonym',
				attr: { type: 'button' },
			});
			addSynonymButton.addEventListener('click', () => addSynonym());
		};

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
		refactorButton.onclick = async () => {
			const termRules = new Map<string, string>();
			const rules: SynonymReplacementRule[] = [];
			let invalidEntry = '';

			entries.forEach(entry => {
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

			refactorButton.disabled = true;
			const progress = contentEl.createEl('p', { cls: 'loading-text' });
			try {
				const scan = await scanRefactorCandidates(this.app, rules, (completed, total) => {
					progress.setText(`Checking Markdown files (${completed}/${total})...`);
				});

				const approvedWords = new Set<string>();
				for (const { word, term } of scan.largerWords) {
					const confirmed = await confirmAction(
						this.app,
						'Replace a matching word?',
						`"${word}" contains a synonym. Replace every occurrence of "${word}" with "${term}"?`,
						'Replace word',
					);
					if (confirmed) {
						approvedWords.add(word.toLowerCase());
					}
				}

				const changedFiles = scan.files.filter(({ content }) =>
					replaceSynonymWords(content, rules, approvedWords) !== content,
				);
				if (changedFiles.length === 0) {
					new Notice('No matching words were found to refactor.');
					return;
				}

				const confirmed = await confirmAction(
					this.app,
					'Confirm refactor',
					`Replace matching synonyms in ${changedFiles.length} Markdown file(s)? Exact synonym matches and approved larger words will be replaced.`,
					'Refactor files',
				);
				if (!confirmed) {
					return;
				}

				let updatedFiles = 0;
				try {
					for (const { file } of changedFiles) {
						progress.setText(`Refactoring Markdown files (${updatedFiles + 1}/${changedFiles.length})...`);
						const currentContent = await this.app.vault.read(file);
						const updatedContent = replaceSynonymWords(currentContent, rules, approvedWords);
						if (updatedContent !== currentContent) {
							await this.app.vault.modify(file, updatedContent);
						}
						updatedFiles++;
					}
				} catch (error) {
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
		};
		saveButton.onclick = async () => {
			// Keep the existing comma-delimited file format and omit entirely blank rows.
			const rowsData = entries
				.map(entry => [
					entry.term.value,
					entry.definition.value,
					entry.synonyms.map(synonym => synonym.value).filter(synonym => synonym.trim() !== '').join('; '),
				].map(value => value.replace(/,/g, '')))
				.filter(values => values.some(value => value.trim() !== ''))
				.map(values => values.join(', '));

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

	onClose() {
		this.contentEl.empty();
	}
}
