import { App, Modal, Notice } from 'obsidian';

interface LexiconEntryInputs {
	term: HTMLInputElement;
	definition: HTMLInputElement;
	tags: HTMLInputElement[];
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

		const loadingIndicator = contentEl.createEl('p', {
			text: 'Loading vocabulary items...',
			cls: 'loading-text',
		});
		let rawContent = '';

		try {
			if (await this.app.vault.adapter.exists(this.fileName)) {
				rawContent = await this.app.vault.adapter.read(this.fileName);
			} else {
				new Notice(`File "${this.fileName}" not found at the root. Initializing an empty list.`);
			}
		} catch (error) {
			console.error('Failed to read lexicon file:', error);
			new Notice('Error loading vocabulary data.');
		}

		loadingIndicator.remove();

		const entriesEl = contentEl.createDiv({ cls: 'lexicon-entries' });
		const entries: LexiconEntryInputs[] = [];

		const addEntry = (
			initialValues: string[] = ['', '', ''],
			expanded = true,
			initialTags?: string[],
		) => {
			const entry = entriesEl.createEl('details', { cls: 'lexicon-entry' });
			entry.open = expanded;

			const summary = entry.createEl('summary', {
				text: initialValues[0] || 'New vocabulary item',
				cls: 'lexicon-entry-summary',
			});
			const fieldsEl = entry.createDiv({ cls: 'lexicon-entry-fields' });
			const entryIndex = entries.length;
			const createField = (label: string, value: string, index: number) => {
				const field = fieldsEl.createDiv({ cls: 'lexicon-entry-field' });
				const inputId = `lexicon-field-${entryIndex}-${index}`;
				field.createEl('label', { text: label, attr: { for: inputId } });
				return field.createEl('input', {
					type: 'text',
					value,
					placeholder: label,
					attr: { id: inputId },
				});
			};

			const rowInputs: LexiconEntryInputs = {
				term: createField('Term', initialValues[0] || '', 0),
				definition: createField('Definition', initialValues[1] || '', 1),
				tags: [],
			};
			entries.push(rowInputs);

			rowInputs.term.addEventListener('input', () => {
				summary.textContent = rowInputs.term.value || 'New vocabulary item';
			});

			const tagField = fieldsEl.createDiv({ cls: 'lexicon-entry-field' });
			tagField.createEl('label', { text: 'Context / tags' });
			const tagList = tagField.createDiv({ cls: 'lexicon-tag-list' });

			const addTag = (value = '') => {
				const tagRow = tagList.createDiv({ cls: 'lexicon-tag-row' });
				const input = tagRow.createEl('input', {
					type: 'text',
					value,
					placeholder: 'Tag',
					attr: { 'aria-label': 'Tag' },
				});
				const swapButton = tagRow.createEl('button', {
					text: 'Swap with term',
					attr: { type: 'button', 'aria-label': 'Swap tag with term' },
				});
				swapButton.addEventListener('click', () => {
					const term = rowInputs.term.value;
					rowInputs.term.value = input.value;
					input.value = term;
					rowInputs.term.dispatchEvent(new Event('input'));
				});
				const removeButton = tagRow.createEl('button', {
					text: 'Remove',
					attr: { type: 'button', 'aria-label': 'Remove tag' },
				});
				removeButton.addEventListener('click', () => {
					tagRow.remove();
					const inputIndex = rowInputs.tags.indexOf(input);
					if (inputIndex !== -1) {
						rowInputs.tags.splice(inputIndex, 1);
					}
				});
				rowInputs.tags.push(input);
			};

			const tags = initialTags ?? (
				initialValues[2]
					? initialValues[2].split(';').map(tag => tag.trim()).filter(Boolean)
					: ['']
			);
			tags.forEach(tag => addTag(tag));

			const addTagButton = tagField.createEl('button', {
				text: 'Add tag',
				attr: { type: 'button' },
			});
			addTagButton.addEventListener('click', () => addTag());
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
		saveButton.onclick = async () => {
			const rowsData = entries
				.map(entry => [
					entry.term.value,
					entry.definition.value,
					entry.tags.map(tag => tag.value).filter(tag => tag.trim() !== '').join('; '),
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
