import { WordNetJson } from '../types/wordnet';

export class WordNetService {
  private static cache: WordNetJson | null = null;

  static async getAllData(): Promise<WordNetJson> {
    if (this.cache) {
      return this.cache;
    }

    try {
      const response = await fetch('/data/wordnet.json');
      if (!response.ok) {
        throw new Error('Failed to load WordNet data');
      }
      const data = await response.json();
      this.cache = data;
      return data;
    } catch (error) {
      console.error('Error loading WordNet data:', error);
      throw error;
    }
  }
}
