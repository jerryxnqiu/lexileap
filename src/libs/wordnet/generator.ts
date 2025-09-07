import fs from 'fs'
import path from 'path'
import { getStorage as getAdminStorage } from '@/libs/firebase/admin'

const DATA_DIR = path.join(process.cwd(), 'data')
const WORDNET_DIR = path.join(DATA_DIR, 'wordnet', 'dict')
const OUTPUT_FILE = path.join(DATA_DIR, 'wordnet.json')
const CSV_FILE = path.join(DATA_DIR, 'wordnet.csv')

interface WordSense {
  word: string
  definition: string
  examples: string[]
  synonyms: string[]
  lexFileNum: string
  synsetOffset: string
}

interface WordData {
  wordId: string
  word: string
  pos: string
  senses: WordSense[]
  antonyms: string[]
  relatedWords: string[]
}

interface WordNetJson {
  [wordId: string]: WordData
}

function isValidWord(word: string): boolean {
  if (!word || word.length === 0) return false
  if (/^\d+$/.test(word)) return false
  if (/^[0-9a-f]{8}$/i.test(word)) return false
  if (word.length === 1 && !/[a-zA-Z]/.test(word)) return false
  if (word.includes('(') || word.includes(')')) return false
  if (word.includes(';') || word.includes(',')) return false
  return /^[a-zA-Z][a-zA-Z0-9\s_-]*$/.test(word) && word.length >= 2
}

function parseGloss(gloss: string): { definition: string; examples: string[] } {
  if (!gloss) return { definition: '', examples: [] }
  const parts = gloss.split(';')
  const definition = parts[0]?.trim() || ''
  const examples: string[] = []
  for (let i = 1; i < parts.length; i++) {
    let example = parts[i]?.trim()
    if (example) {
      if (example.startsWith('"') && example.endsWith('"')) {
        example = example.slice(1, -1)
      }
      if (example.length > 3 && !example.match(/^[0-9a-f]{8}/)) {
        examples.push(example)
      }
    }
  }
  return { definition, examples }
}

async function processDataFile(filename: string, expectedPos: string, wordNetData: WordNetJson) {
  const filepath = path.join(WORDNET_DIR, filename)
  if (!fs.existsSync(filepath)) {
    console.log(`⚠️  File not found: ${filename}`)
    return
  }
  console.log(`📖 Processing ${filename}...`)
  const content = fs.readFileSync(filepath, 'utf-8')
  const lines = content.split('\n')
  let count = 0
  let validEntries = 0
  for (const line of lines) {
    if (!line.trim() || line.startsWith(' ')) continue
    if (line.includes('LICENSE') || line.includes('Princeton') || line.includes('LICENSEE')) continue
    const parts = line.split(' ')
    if (parts.length < 4) continue
    if (!/^[0-9a-f]{8}$/i.test(parts[0])) continue
    const synset_offset = parts[0]
    const lex_filenum = parts[1]
    const ss_type = parts[2]
    const w_cnt = parts[3]
    const wordCount = parseInt(w_cnt, 16)
    const words: string[] = []
    let wordIndex = 4
    for (let i = 0; i < wordCount; i++) {
      if (wordIndex + 1 < parts.length) {
        const word = parts[wordIndex]
        let cleanWord = word.replace(/_/g, ' ')
        if (ss_type === 'a' || ss_type === 's') {
          cleanWord = cleanWord.replace(/\([^)]*\)$/,'')
        }
        if (isValidWord(cleanWord)) {
          words.push(cleanWord)
        }
        wordIndex += 2
      }
    }
    if (words.length === 0) { count++; continue }
    const p_cnt = parts[wordIndex]
    const ptrCount = parseInt(p_cnt, 10)
    wordIndex++
    for (let i = 0; i < ptrCount; i++) {
      if (wordIndex + 3 < parts.length) {
        wordIndex += 4
      }
    }
    if (ss_type === 'v' && wordIndex < parts.length && parts[wordIndex] === '+') {
      while (wordIndex < parts.length && parts[wordIndex] !== '|') {
        wordIndex++
      }
    }
    let gloss = ''
    const pipeIndex = parts.indexOf('|')
    if (pipeIndex !== -1 && pipeIndex + 1 < parts.length) {
      gloss = parts.slice(pipeIndex + 1).join(' ').trim()
    }
    const { definition, examples } = parseGloss(gloss)
    for (const word of words) {
      const wordId = word.toLowerCase()
      if (!wordNetData[wordId]) {
        const pos = ss_type === 's' ? 'a' : ss_type
        wordNetData[wordId] = {
          wordId,
          word: wordId,
          pos,
          senses: [],
          antonyms: [],
          relatedWords: []
        }
      }
      const newSense: WordSense = {
        word: word,
        definition: definition || '',
        examples: [...examples],
        synonyms: words.filter(s => s !== word && isValidWord(s)),
        lexFileNum: lex_filenum,
        synsetOffset: synset_offset
      }
      const existingSense = wordNetData[wordId].senses?.find(s => s.word === word && s.definition === definition)
      if (!existingSense) {
        if (!wordNetData[wordId].senses) {
          wordNetData[wordId].senses = []
        }
        wordNetData[wordId].senses.push(newSense)
      } else {
        examples.forEach(example => {
          if (example.length > 5 && !existingSense.examples.includes(example)) {
            existingSense.examples.push(example)
          }
        })
        newSense.synonyms.forEach(synonym => {
          if (!existingSense.synonyms.includes(synonym)) {
            existingSense.synonyms.push(synonym)
          }
        })
      }
    }
    count++
    validEntries++
    if (count % 1000 === 0) {
      console.log(`  Processed ${count} entries, ${validEntries} valid...`)
    }
  }
  console.log(`✅ Processed ${count} entries, ${validEntries} valid from ${filename}`)
}

function escapeCsvField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`
  }
  return field
}

function exportToCsv(wordNetData: WordNetJson): void {
  console.log('📊 Exporting to CSV...')
  const headers = ['wordId','word','pos','senses','antonyms','relatedWords']
  const csvLines = [headers.join(',')]
  Object.values(wordNetData).forEach(wordData => {
    const sensesText = wordData.senses.map(sense => `${sense.word}: ${sense.definition}`).join('; ')
    const row = [
      escapeCsvField(wordData.wordId),
      escapeCsvField(wordData.word),
      escapeCsvField(wordData.pos),
      escapeCsvField(sensesText),
      escapeCsvField(wordData.antonyms.join('; ')),
      escapeCsvField(wordData.relatedWords.join('; '))
    ]
    csvLines.push(row.join(','))
  })
  fs.writeFileSync(CSV_FILE, csvLines.join('\n'))
  console.log(`✅ CSV exported to: ${CSV_FILE}`)
}

export async function generateWordNet(): Promise<{ jsonPath: string; csvPath: string }> {
  console.log('🚀 Starting WordNet generation (API)...')
  const wordNetData: WordNetJson = {}
  await processDataFile('data.noun', 'n', wordNetData)
  await processDataFile('data.verb', 'v', wordNetData)
  await processDataFile('data.adj', 'a', wordNetData)
  await processDataFile('data.adv', 'r', wordNetData)
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
  console.log('💾 Writing to wordnet.json...')
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(wordNetData, null, 2))
  exportToCsv(wordNetData)
  console.log('☁️  Uploading files to Firebase Storage...')
  const storage = await getAdminStorage()
  const bucket = storage.bucket()
  await bucket.upload(OUTPUT_FILE, { destination: 'wordnet/wordnet.json', contentType: 'application/json' })
  await bucket.upload(CSV_FILE, { destination: 'wordnet/wordnet.csv', contentType: 'text/csv' })
  console.log('✅ Upload complete.')
  return { jsonPath: OUTPUT_FILE, csvPath: CSV_FILE }
}


