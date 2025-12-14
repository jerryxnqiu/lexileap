export interface WordData {
  gram: string
  freq: number
}

// Vocabulary item with optional definition, synonyms, and antonyms
// Used for vocabulary items loaded from JSON files that may or may not have definitions yet
export interface VocabularyItem extends WordData {
  definition?: string
  synonyms?: string[]
  antonyms?: string[]
}

export interface DictionaryEntry {
  word: string
  definition?: string
  synonyms: string[]
  antonyms: string[]
  frequency: number
  lastUpdated: Date
  synonymsProcessed?: boolean // Flag to track if Stands4 processing is complete
}

export interface DictionaryProgress {
  processed: number
  total: number
  status: 'not_started' | 'in_progress' | 'completed' | 'failed'
  lastUpdated: Date
}

export interface DailyUsage {
  date: string
  stands4Calls: number
}
