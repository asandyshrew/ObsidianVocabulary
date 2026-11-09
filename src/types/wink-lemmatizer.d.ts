declare module 'wink-lemmatizer' {
	interface EnglishLemmatizer {
		adjective(word: string): string;
		noun(word: string): string;
		verb(word: string): string;
	}

	const lemmatizer: EnglishLemmatizer;
	export = lemmatizer;
}
