import { App } from 'obsidian';
import { createUsageCounter } from './linguistics';
import type { UsageCounter } from './linguistics';

type UsageIndexResult =
	| { counter: UsageCounter }
	| { error: unknown };

/**
 * Owns the vault-wide usage scan for the plugin session.
 *
 * The initial scan begins when this service is constructed. Consumers can wait
 * for that scan and subscribe to its progress without starting a duplicate scan.
 * The index can be rebuilt after operations that modify Markdown content.
 */
export class UsageIndex {
	private scanPromise: Promise<UsageIndexResult>;
	private progressListeners = new Set<(completed: number, total: number) => void>();

	constructor(private app: App) {
		this.scanPromise = this.scan();
	}

	/**
	 * Returns the current usage counter, waiting for the active scan if needed.
	 *
	 * @param onProgress Optional progress callback for the active scan.
	 * @returns A reusable counter backed by the latest completed vault scan.
	 * @throws The error from the scan if a Markdown file could not be read.
	 */
	async getCounter(
		onProgress?: (completed: number, total: number) => void,
	): Promise<UsageCounter> {
		if (onProgress) {
			this.progressListeners.add(onProgress);
		}

		try {
			const result = await this.scanPromise;
			if ('error' in result) {
				throw result.error;
			}
			return result.counter;
		} finally {
			if (onProgress) {
				this.progressListeners.delete(onProgress);
			}
		}
	}

	/**
	 * Rebuilds the index from all current Markdown files and returns its counter.
	 *
	 * @param onProgress Optional progress callback for this refresh scan.
	 * @returns The refreshed usage counter.
	 * @throws The error from the scan if a Markdown file could not be read.
	 */
	async refresh(
		onProgress?: (completed: number, total: number) => void,
	): Promise<UsageCounter> {
		this.scanPromise = this.scan();
		return this.getCounter(onProgress);
	}

	/** Capture scan failures so an early startup scan cannot reject unobserved. */
	private async scan(): Promise<UsageIndexResult> {
		try {
			const counter = await createUsageCounter(this.app, (completed, total) => {
				this.progressListeners.forEach(listener => listener(completed, total));
			});
			return { counter };
		} catch (error) {
			return { error };
		}
	}
}
