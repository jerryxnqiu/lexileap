#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const PUBLIC_DATA_DIR = path.join(process.cwd(), 'public', 'data');
const WORDNET_DIR = path.join(DATA_DIR, 'wordnet', 'dict');
const OUTPUT_FILE = path.join(PUBLIC_DATA_DIR, 'wordnet.json');
const CSV_FILE = path.join(DATA_DIR, 'wordnet.csv');

interface WordSense {
  word: string;
  definition: string;
  examples: string[];
  synonyms: string[];
  lexFileNum: string;
  synsetOffset: string;
}

interface WordData {
  wordId: string;
  word: string;
  pos: string;
  senses: WordSense[];
  antonyms: string[];
  relatedWords: string[];
}

interface WordNetJson {
  [wordId: string]: WordData;
}

function isValidWord(word: string): boolean {
  if (!word || word.length === 0) return false;
  if (/^\d+$/.test(word)) return false; // Pure numbers
  if (/^[0-9a-f]{8}$/i.test(word)) return false; // Synset offsets
  if (word.length === 1 && !/[a-zA-Z]/.test(word)) return false; // Single non-letter chars
  if (word.includes('(') || word.includes(')')) return false; // Skip entries with parentheses
  if (word.includes(';') || word.includes(',')) return false; // Skip entries with punctuation
  // Allow words with spaces, hyphens, and underscores, but must start with letter
  return /^[a-zA-Z][a-zA-Z0-9\s_-]*$/.test(word) && word.length >= 2;
}

function parseGloss(gloss: string): { definition: string; examples: string[] } {
  if (!gloss) return { definition: '', examples: [] };
  
  // WordNet format: definition; "example1"; "example2"
  const parts = gloss.split(';');
  const definition = parts[0]?.trim() || '';
  
  const examples: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    let example = parts[i]?.trim();
    if (example) {
      // Remove quotes if present
      if (example.startsWith('"') && example.endsWith('"')) {
        example = example.slice(1, -1);
      }
      // Skip if it looks like a synset offset or is too short
      if (example.length > 3 && !example.match(/^[0-9a-f]{8}/)) {
        examples.push(example);
      }
    }
  }
  
  return { definition, examples };
}


async function processDataFile(filename: string, expectedPos: string, wordNetData: WordNetJson) {
  const filepath = path.join(WORDNET_DIR, filename);
  
  if (!fs.existsSync(filepath)) {
    console.log(`⚠️  File not found: ${filename}`);
    return;
  }

  console.log(`📖 Processing ${filename}...`);
  
  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.split('\n');
  
  let count = 0;
  let validEntries = 0;
  
  for (const line of lines) {
    if (!line.trim() || line.startsWith(' ')) continue;
    
    // Skip license and header lines
    if (line.includes('LICENSE') || line.includes('Princeton') || line.includes('LICENSEE')) continue;
    
    const parts = line.split(' ');
    if (parts.length < 4) continue;
    
    // Check if line starts with a synset offset (8 hex digits)
    if (!/^[0-9a-f]{8}$/i.test(parts[0])) continue;

    const synset_offset = parts[0];
    const lex_filenum = parts[1];
    const ss_type = parts[2]; // Synset type: n, v, a, s, r
    const w_cnt = parts[3]; // Word count (hexadecimal)
    
    // Parse words
    const wordCount = parseInt(w_cnt, 16);
    const words: string[] = [];
    let wordIndex = 4;
    
    for (let i = 0; i < wordCount; i++) {
      if (wordIndex + 1 < parts.length) {
        const word = parts[wordIndex];
        const lexId = parts[wordIndex + 1];
        
        // Clean word: remove underscores and handle syntactic markers
        let cleanWord = word.replace(/_/g, ' ');
        
        // Remove syntactic markers for adjectives (e.g., "good(a)" -> "good")
        if (ss_type === 'a' || ss_type === 's') {
          cleanWord = cleanWord.replace(/\([^)]*\)$/, '');
        }
        
        if (isValidWord(cleanWord)) {
          words.push(cleanWord);
        }
        wordIndex += 2; // Skip lex_id
      }
    }

    // Skip entries with no valid words
    if (words.length === 0) {
      count++;
      continue;
    }

    // Parse pointers (p_cnt is a 3-digit decimal integer)
    const p_cnt = parts[wordIndex]; // Pointer count
    const ptrCount = parseInt(p_cnt, 10);
    wordIndex++; // Move past pointer count
    
    // Skip pointer data for now (we can enhance this later)
    for (let i = 0; i < ptrCount; i++) {
      if (wordIndex + 3 < parts.length) {
        wordIndex += 4; // Skip pointer: symbol synset_offset pos source/target
      }
    }
    
    // Skip frames (verb-specific, format: f_cnt + f_num w_num...)
    if (ss_type === 'v' && wordIndex < parts.length && parts[wordIndex] === '+') {
      // Skip frame data
      while (wordIndex < parts.length && parts[wordIndex] !== '|') {
        wordIndex++;
      }
    }

    // Find the gloss (everything after the '|')
    let gloss = '';
    const pipeIndex = parts.indexOf('|');
    if (pipeIndex !== -1 && pipeIndex + 1 < parts.length) {
      gloss = parts.slice(pipeIndex + 1).join(' ').trim();
    }

    const { definition, examples } = parseGloss(gloss);
    
    // Process each word in the synset
    for (const word of words) {
      // Use lowercase word as the key to group different cases
      const wordId = word.toLowerCase();

      // Initialize word data if not exists
      if (!wordNetData[wordId]) {
        // Map synset type to part of speech
        const pos = ss_type === 's' ? 'a' : ss_type; // Adjective satellites are still adjectives
        
        wordNetData[wordId] = {
          wordId,
          word: wordId, // Use lowercase as the main word
          pos,
          senses: [],
          antonyms: [],
          relatedWords: []
        };
      }

      // Create a new sense for this word form
      const newSense: WordSense = {
        word: word, // Preserve original case
        definition: definition || '',
        examples: [...examples],
        synonyms: words.filter(synonym => synonym !== word && isValidWord(synonym)),
        lexFileNum: lex_filenum,
        synsetOffset: synset_offset
      };

      // Check if we already have this exact sense (same word form and definition)
      const existingSense = wordNetData[wordId].senses?.find(sense => 
        sense.word === word && sense.definition === definition
      );

      if (!existingSense) {
        if (!wordNetData[wordId].senses) {
          wordNetData[wordId].senses = [];
        }
        wordNetData[wordId].senses.push(newSense);
      } else {
        // Merge examples and synonyms if sense exists
        examples.forEach(example => {
          if (example.length > 5 && !existingSense.examples.includes(example)) {
            existingSense.examples.push(example);
          }
        });
        newSense.synonyms.forEach(synonym => {
          if (!existingSense.synonyms.includes(synonym)) {
            existingSense.synonyms.push(synonym);
          }
        });
      }
    }

    count++;
    validEntries++;
    if (count % 1000 === 0) {
      console.log(`  Processed ${count} entries, ${validEntries} valid...`);
    }
  }

  console.log(`✅ Processed ${count} entries, ${validEntries} valid from ${filename}`);
}

function escapeCsvField(field: string): string {
  // Escape quotes and wrap in quotes if contains comma, quote, or newline
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

function exportToCsv(wordNetData: WordNetJson): void {
  console.log('📊 Exporting to CSV...');
  
  const headers = [
    'wordId',
    'word', 
    'pos',
    'senses',
    'antonyms',
    'relatedWords'
  ];
  
  const csvLines = [headers.join(',')];
  
  Object.values(wordNetData).forEach(wordData => {
    // Format senses as: "word1: definition1; word2: definition2"
    const sensesText = wordData.senses.map(sense => 
      `${sense.word}: ${sense.definition}`
    ).join('; ');
    
    const row = [
      escapeCsvField(wordData.wordId),
      escapeCsvField(wordData.word),
      escapeCsvField(wordData.pos),
      escapeCsvField(sensesText),
      escapeCsvField(wordData.antonyms.join('; ')),
      escapeCsvField(wordData.relatedWords.join('; '))
    ];
    csvLines.push(row.join(','));
  });
  
  fs.writeFileSync(CSV_FILE, csvLines.join('\n'));
  console.log(`✅ CSV exported to: ${CSV_FILE}`);
}

async function main() {
  try {
    console.log('🚀 Starting clean WordNet JSON generation...');
    
    const wordNetData: WordNetJson = {};
    
    // Process all data files
    await processDataFile('data.noun', 'n', wordNetData);
    await processDataFile('data.verb', 'v', wordNetData);
    await processDataFile('data.adj', 'a', wordNetData);
    await processDataFile('data.adv', 'r', wordNetData);
    
    // Ensure public/data directory exists
    if (!fs.existsSync(PUBLIC_DATA_DIR)) {
      fs.mkdirSync(PUBLIC_DATA_DIR, { recursive: true });
    }

    // Write to JSON file
    console.log('💾 Writing to wordnet.json...');
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(wordNetData, null, 2));
    
    // Export to CSV
    exportToCsv(wordNetData);
    
    // Generate statistics
    const totalWords = Object.keys(wordNetData).length;
    const posStats = {
      noun: 0,
      verb: 0,
      adj: 0,
      adv: 0
    };
    
    Object.values(wordNetData).forEach(wordData => {
      const posKey = {
        'n': 'noun',
        'v': 'verb',
        'a': 'adj',
        'r': 'adv'
      }[wordData.pos] as keyof typeof posStats;
      posStats[posKey]++;
    });
    
    console.log('\n📊 WordNet JSON Statistics:');
    console.log(`  Total words: ${totalWords}`);
    console.log(`  Nouns: ${posStats.noun}`);
    console.log(`  Verbs: ${posStats.verb}`);
    console.log(`  Adjectives: ${posStats.adj}`);
    console.log(`  Adverbs: ${posStats.adv}`);
    
    const fileSize = fs.statSync(OUTPUT_FILE).size;
    console.log(`  File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
    
    // Show sample entries
    const sampleWords = Object.keys(wordNetData).slice(0, 3);
    console.log('\n📝 Sample entries:');
    sampleWords.forEach(wordId => {
      const data = wordNetData[wordId];
      const totalSenses = data.senses.length;
      const wordForms = data.senses.map(s => s.word).join(', ');
      console.log(`  ${wordId}: "${wordForms}" (${data.pos}) - ${totalSenses} senses`);
    });
    
    console.log(`\n🎉 WordNet data successfully generated:`);
    console.log(`  JSON: ${OUTPUT_FILE}`);
    console.log(`  CSV:  ${CSV_FILE}`);
    console.log('You can now load the JSON file in your Next.js application!');
    console.log('Use the CSV file for easy cross-checking and analysis.');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
