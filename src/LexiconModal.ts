import { App, Modal, Notice } from 'obsidian';

interface LexiconEntryInputs {
	term: HTMLInputElement;
	definition: HTMLInputElement;
	synonyms: HTMLInputElement[];
}

// Treat "#word" in a Markdown tag the same as "word" in a lexicon field.
function normalizeSynonym(synonym: string): string {
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

		// Keep hashtag counts separate from prose counts to avoid counting tags twice.
		const synonymUsages = new Map<string, number>();
		const regularText: string[] = [];
		const markdownFiles = this.app.vault.getMarkdownFiles();
		try {
			for (const [i, file] of markdownFiles.entries()) {
				loadingIndicator.setText(`Scanning Markdown files (${i + 1}/${markdownFiles.length})...`);
				const content = await this.app.vault.cachedRead(file);
				// Obsidian's cache identifies actual hashtags, including their source positions.
				const markdownTags = this.app.metadataCache.getFileCache(file)?.tags ?? [];

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
		} catch (error) {
			// Don't show partial counts; they would look complete but miss unreadable files.
			console.error('Failed to scan Markdown files for synonym usages:', error);
			loadingIndicator.setText('Unable to scan Markdown files. Close and reopen the modal to try again.');
			new Notice('Could not scan Markdown files for synonym usages.');
			return;
		}

		// Both term and synonym counters use the same tag-plus-prose matching rules.
		const getUsageCount = (value: string): number => {
			const normalizedValue = normalizeSynonym(value);
			return (synonymUsages.get(normalizedValue) ?? 0) + regularText.reduce(
				(total, text) => total + countOccurrences(text, normalizedValue),
				0,
			);
		};

		loadingIndicator.remove();
		const entriesEl = contentEl.createDiv({ cls: 'lexicon-entries' });
		// Keep the inputs together so additions, removals, and saving use the same rows.
		const entries: LexiconEntryInputs[] = [];

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
				const count = getUsageCount(rowInputs.term.value) +
					rowInputs.synonyms.reduce((total, synonym) => total + getUsageCount(synonym.value), 0);
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
				text: 'Add Synonym',
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
		actionsDiv.createEl('button', {
			text: 'Refactor',
			attr: { type: 'button' },
		});
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
