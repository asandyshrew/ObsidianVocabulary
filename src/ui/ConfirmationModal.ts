import { App, Modal } from 'obsidian';

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
