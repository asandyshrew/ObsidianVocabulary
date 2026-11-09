import { App, Modal, Notice } from 'obsidian';

export class TableModal extends Modal {
    private fileName: string;

    constructor(app: App, fileName: string = 'vocabulary.lexicon') {
        super(app);
        this.fileName = fileName;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: 'Lexicon Loaded Data Table' });

        const loadingIndicator = contentEl.createEl('p', { text: 'Loading vocabulary items from root...', cls: 'loading-text' });
        let rawContent = '';

        try {
            if (await this.app.vault.adapter.exists(this.fileName)) {
                rawContent = await this.app.vault.adapter.read(this.fileName);
            } else {
                new Notice(`File "${this.fileName}" not found at the root. Initializing empty table.`);
            }
        } catch (error) {
            console.error('Failed to read lexicon file:', error);
            new Notice('Error parsing lexicon data.');
        }

        loadingIndicator.remove();

        const table = contentEl.createEl('table', { cls: 'modal-table' });
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        table.style.marginBottom = '1rem';

        const thead = table.createTHead();
        const headerRow = thead.insertRow();
        ['Term', 'Definition', 'Context / Tag'].forEach(text => {
            const th = headerRow.createEl('th');
            th.textContent = text;
            th.style.border = '1px solid var(--background-modifier-border)';
            th.style.padding = '8px';
            th.style.backgroundColor = 'var(--background-secondary)';
        });

        const tbody = table.createTBody();

        const addRow = (initialValues: string[] = ['', '', '']) => {
            const row = tbody.insertRow();
            for (let i = 0; i < 3; i++) {
                const cell = row.insertCell();
                cell.style.border = '1px solid var(--background-modifier-border)';
                cell.style.padding = '4px';

                const input = document.createElement('input');
                input.type = 'text';
                input.value = initialValues[i] || '';
                input.style.width = '100%';
                input.style.background = 'transparent';
                input.style.border = 'none';
                input.style.color = 'var(--text-normal)';
                cell.appendChild(input);
            }
        };

        if (rawContent.trim().length > 0) {
            const lines = rawContent.split(/\r?\n/).filter(line => line.trim().length > 0);
            lines.forEach(line => {
                const fields = line.split(',').map(f => f.trim());
                addRow([fields[0] || '', fields[1] || '', fields[2] || '']);
            });
        } else {
            addRow();
            addRow();
        }

        const actionsDiv = contentEl.createDiv({ cls: 'modal-actions' });
        actionsDiv.style.marginTop = '15px';

        const addButton = actionsDiv.createEl('button', { text: '+ Add Row' });
        addButton.style.marginRight = '8px';
        addButton.onclick = () => addRow();

        const saveButton = actionsDiv.createEl('button', { text: 'Save Updates', cls: 'mod-cta' });
        saveButton.onclick = async () => {
            const rowsData: string[] = [];
            
            Array.from(tbody.rows).forEach(tr => {
                const rowValues = Array.from(tr.cells).map(cell => {
                    const input = cell.querySelector('input');
                    return input ? input.value.replace(/,/g, '') : '';
                });
                
                if (rowValues.some(val => val.trim() !== '')) {
                    rowsData.push(rowValues.join(', '));
                }
            });

            const newContent = rowsData.join('\n');
            
            try {
                await this.app.vault.adapter.write(this.fileName, newContent);
                new Notice('Lexicon data successfully overwritten!');
                this.close();
            } catch (err) {
                console.error('Error writing lexicon back to vault:', err);
                new Notice('Failed to export changes.');
            }
        };
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}