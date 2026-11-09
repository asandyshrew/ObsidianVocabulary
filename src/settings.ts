export interface VocabularyPluginSettings {
	/** Normalized common-word terms already approved by the user. */
	confirmedCommonTerms: string[];
}

/** Default persisted settings for a new or reset plugin installation. */
export const DEFAULT_SETTINGS: VocabularyPluginSettings = {
	confirmedCommonTerms: [],
};
