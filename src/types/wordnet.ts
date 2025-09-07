export interface WordSense {
  word: string;
  definition: string;
  examples: string[];
  synonyms: string[];
  lexFileNum: string;
  synsetOffset: string;
}

export interface WordData {
  wordId: string;
  word: string;
  pos: string;
  senses: WordSense[];
  antonyms: string[];
  relatedWords: string[];
}

export interface WordNetJson {
  [wordId: string]: WordData;
}
