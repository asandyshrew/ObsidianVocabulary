import { countTotalUsages } from '../utils/linguistics';
import type { UsageCounter } from '../utils/linguistics';

export interface LexiconEntryInputs {
	/** Details element containing this entry's editable fields. */
	container: HTMLDetailsElement;
	/** Input holding the canonical vocabulary term. */
	term: HTMLInputElement;
	/** Input holding the term's definition. */
	definition: HTMLInputElement;
	/** Inputs holding the entry's editable synonyms. */
	synonyms: HTMLInputElement[];
}

interface CreateLexiconEntryOptions {
	/** Parent element that receives the new details row. */
	container: HTMLElement;
	/** Initial term, definition, and serialized synonym values. */
	initialValues?: string[];
	/** Whether the row is expanded when rendered. */
	expanded?: boolean;
	/** Parsed synonyms, when available instead of the serialized field. */
	initialSynonyms?: string[];
	/** Stable index used to generate unique input and error IDs. */
	entryIndex: number;
	/** Counter used to populate term and synonym usage indicators. */
	getUsageCount: UsageCounter;
	/** Shared field-to-error mapping used by save-time validation. */
	saveErrors: Map<HTMLInputElement, HTMLSpanElement>;
	/** Invoked when the row's Refactor button is selected. */
	onRefactor: (entry: LexiconEntryInputs, button: HTMLButtonElement) => void;
}

/**
 * Renders one collapsible vocabulary item, including synonym controls and
 * usage counts, and returns the inputs used by saving and refactoring.
 *
 * Synonyms are stored as individual inputs in the UI. If only a serialized
 * synonym string is provided, semicolons are used to split it into inputs.
 *
 * @param options Parent, initial data, and callbacks for the row.
 * @returns References to the row's editable fields.
 */
export function createLexiconEntry({
	container,
	initialValues = ['', '', ''],
	expanded = true,
	initialSynonyms,
	entryIndex,
	getUsageCount,
	saveErrors,
	onRefactor,
}: CreateLexiconEntryOptions): LexiconEntryInputs {
	const entry = container.createEl('details', { cls: 'lexicon-entry' });
	entry.open = expanded;

	const summary = entry.createEl('summary', { cls: 'lexicon-entry-summary' });
	const summaryTerm = summary.createSpan({
		text: initialValues[0] || 'New vocabulary item',
		cls: 'lexicon-entry-title',
	});
	const summaryCounts = summary.createSpan({ cls: 'lexicon-entry-usage-group' });
	const summaryUsageCount = summaryCounts.createSpan({ cls: 'lexicon-entry-usage' });
	summaryCounts.createSpan({ text: '|', cls: 'lexicon-entry-usage-separator' });
	const summaryRowUsageCount = summaryCounts.createSpan({ cls: 'lexicon-entry-usage' });
	const fieldsEl = entry.createDiv({ cls: 'lexicon-entry-fields' });

	const createField = (label: string, value: string, index: number) => {
		const field = fieldsEl.createDiv({ cls: 'lexicon-entry-field' });
		const inputId = `lexicon-field-${entryIndex}-${index}`;
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
		container: entry,
		term: termField.input,
		definition: createField('Definition', initialValues[1] || '', 1).input,
		synonyms: [],
	};

	const updateSummaryRowUsageCount = () => {
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

	const addSynonym = (value = '') => {
		const synonymItem = synonymList.createDiv({ cls: 'lexicon-synonym-item' });
		const inputIndex = rowInputs.synonyms.length;
		const errorId = `lexicon-synonym-error-${entryIndex}-${inputIndex}`;
		const fieldError = synonymItem.createSpan({
			cls: 'lexicon-save-error',
			attr: { id: errorId, role: 'alert' },
		});
		fieldError.hide();
		const synonymRow = synonymItem.createDiv({ cls: 'lexicon-synonym-row' });
		const input = synonymRow.createEl('input', {
			type: 'text',
			value,
			placeholder: 'Synonym',
			attr: { 'aria-label': 'Synonym' },
		});
		input.setAttribute('aria-describedby', errorId);
		saveErrors.set(input, fieldError);
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
			synonymItem.remove();
			fieldError.remove();
			saveErrors.delete(input);
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

	const synonyms = initialSynonyms ?? (
		initialValues[2]
			? initialValues[2].split(';').map(synonym => synonym.trim()).filter(Boolean)
			: ['']
	);
	synonyms.forEach(synonym => addSynonym(synonym));

	const synonymActions = synonymField.createDiv({ cls: 'lexicon-synonym-actions' });
	const addSynonymButton = synonymActions.createEl('button', {
		text: 'Add synonym',
		attr: { type: 'button' },
	});
	addSynonymButton.addEventListener('click', () => addSynonym());

	const refactorEntryButton = synonymActions.createEl('button', {
		text: 'Refactor',
		attr: { type: 'button', 'aria-label': `Refactor ${rowInputs.term.value || 'this term'}` },
	});
	refactorEntryButton.addEventListener('click', () => onRefactor(rowInputs, refactorEntryButton));

	return rowInputs;
}
