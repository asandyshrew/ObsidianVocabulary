import { App, Modal } from 'obsidian';

/**
 * Presents a yes/no question and resolves unanswered dismissals as cancellation.
 */
class ConfirmationModal extends Modal {
	/** Prevents button clicks and modal dismissal from resolving twice. */
	private settled = false;

	constructor(
		app: App,
		/** Heading shown above the question. */
		private title: string,
		/** The decision prompt shown to the user. */
		private message: string,
		/** Label for the affirmative action. */
		private confirmLabel: string,
		/** Receives true for confirmation and false for cancellation. */
		private onDecision: (confirmed: boolean) => void,
	) {
		super(app);
	}

	/** Render the question and its explicit cancel and confirm actions. */
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

	/** Resolve a dismissal as cancellation and clear the rendered contents. */
	onClose() {
		if (!this.settled) {
			this.settled = true;
			this.onDecision(false);
		}
		this.contentEl.empty();
	}

	/** Resolve the user's choice at most once, then close the modal. */
	private finish(confirmed: boolean) {
		if (this.settled) {
			return;
		}
		this.settled = true;
		this.onDecision(confirmed);
		this.close();
	}
}

/**
 * Opens a confirmation dialog and returns the user's decision.
 *
 * @param app Obsidian application used to create the modal.
 * @param title Heading displayed in the dialog.
 * @param message Explanation or question displayed below the heading.
 * @param confirmLabel Text for the affirmative button.
 * @returns True when confirmed; false when cancelled or dismissed.
 */
export function confirmAction(
	app: App,
	title: string,
	message: string,
	confirmLabel: string,
): Promise<boolean> {
	return new Promise(resolve => {
		new ConfirmationModal(app, title, message, confirmLabel, resolve).open();
	});
}
