export interface WordData {
  gram: string
  freq: number
  rank?: number // Position in descending frequency order (1 = most frequent)
}

export interface DictionaryEntry {
  word: string
  definition?: string
  synonyms: string[]
  antonyms: string[]
  frequency: number
  rank?: number // Position in descending frequency order (1 = most frequent)
  lastUpdated: Date
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
