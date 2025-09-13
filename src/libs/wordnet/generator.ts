import fs from 'fs'
import path from 'path'
import * as tar from 'tar'
import { getStorage as getAdminStorage, getDb } from '@/libs/firebase/admin'
import { logger } from '../utils/logger'
import { WordSense, WordNetJson } from '@/types/wordnet'

const DATA_DIR = path.join(process.cwd(), 'data')
const WORDNET_DIR = path.join(DATA_DIR, 'wordnet', 'dict')
const OUTPUT_FILE = path.join(DATA_DIR, 'wordnet.json')
const CSV_FILE = path.join(DATA_DIR, 'wordnet.csv')

// WordNet data files we need
const WORDNET_DATA_FILES = ['data.noun', 'data.verb', 'data.adj', 'data.adv']
const WORDNET_INDEX_FILES = ['index.noun', 'index.verb', 'index.adj', 'index.adv']
const WORDNET_FILES = [...WORDNET_DATA_FILES, ...WORDNET_INDEX_FILES]

async function downloadAndExtractWordNet(): Promise<void> {
  logger.info('📥 Downloading WordNet 3.0 from Princeton...')
  
  const wordnetUrl = 'https://wordnetcode.princeton.edu/3.0/WordNet-3.0.tar.gz'
  const tempDir = path.join(DATA_DIR, 'temp')
  const tarPath = path.join(tempDir, 'wordnet.tar.gz')
  
  try {
    // Create temp directory
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }
    
    // Download the tar.gz file
    const response = await fetch(wordnetUrl)
    if (!response.ok) {
      throw new Error(`Failed to download WordNet: ${response.statusText}`)
    }
    
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    fs.writeFileSync(tarPath, buffer)
    
    logger.info('📦 Extracting WordNet files...')
    
    // Extract the tar.gz file
    await tar.extract({
      file: tarPath,
      cwd: tempDir,
      filter: (path) => {
        // Only extract the dict files we need
        return path.includes('dict/data.noun') || 
               path.includes('dict/data.verb') || 
               path.includes('dict/data.adj') || 
               path.includes('dict/data.adv') ||
               path.includes('dict/index.noun') || 
               path.includes('dict/index.verb') || 
               path.includes('dict/index.adj') || 
               path.includes('dict/index.adv')
      }
    })
    
    // Move the extracted files to our target directory
    if (!fs.existsSync(WORDNET_DIR)) {
      fs.mkdirSync(WORDNET_DIR, { recursive: true })
    }
    
    // Find the extracted dict directory
    const extractedDirs = fs.readdirSync(tempDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)
    
    let dictPath = ''
    for (const dir of extractedDirs) {
      const potentialDictPath = path.join(tempDir, dir, 'dict')
      if (fs.existsSync(potentialDictPath)) {
        dictPath = potentialDictPath
        break
      }
    }
    
    if (!dictPath) {
      throw new Error('Could not find dict directory in extracted files')
    }
    
    // Copy the files we need
    for (const filename of WORDNET_FILES) {
      const sourcePath = path.join(dictPath, filename)
      const targetPath = path.join(WORDNET_DIR, filename)
      
      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, targetPath)
        logger.info(`✅ Extracted ${filename}`)
      } else {
        logger.warn(`⚠️  File not found in archive: ${filename}`)
      }
    }
    
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true })
    
    logger.info('✅ WordNet files extracted successfully')
    
  } catch (error) {
    logger.error('Failed to download/extract WordNet:', error instanceof Error ? error : new Error(String(error)))
    // Clean up on error
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
    throw error
  }
}

async function ensureWordNetFiles() {
  logger.info('📥 Ensuring WordNet data files are available...')
  
  // Check if files already exist locally
  const allFilesExist = WORDNET_FILES.every(file => 
    fs.existsSync(path.join(WORDNET_DIR, file))
  )
  
  if (allFilesExist) {
    logger.info('✅ WordNet files already exist locally')
    return
  }
  
  // Download and extract WordNet from the internet
  await downloadAndExtractWordNet()
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

// Parse index file to get word-to-synset mappings
function parseIndexFile(filename: string): Map<string, string[]> {
  const filepath = path.join(WORDNET_DIR, filename)
  const wordToSynsets = new Map<string, string[]>()
  
  if (!fs.existsSync(filepath)) {
    logger.warn(`⚠️  Index file not found: ${filename}`)
    return wordToSynsets
  }
  
  const content = fs.readFileSync(filepath, 'utf-8')
  const lines = content.split('\n')
  
  for (const line of lines) {
    if (!line.trim() || line.startsWith(' ')) continue
    if (line.includes('LICENSE') || line.includes('Princeton')) continue
    
    const parts = line.split(' ')
    if (parts.length < 2) continue
    
    const word = parts[0]
    const synsetOffsets = parts.slice(1).filter(part => /^[0-9a-f]{8}$/i.test(part))
    
    if (isValidWord(word) && synsetOffsets.length > 0) {
      wordToSynsets.set(word.toLowerCase(), synsetOffsets)
    }
  }
  
  return wordToSynsets
}

async function processDataFileWithIndex(
  filename: string,
  wordNetData: WordNetJson,
  wordToSynsets: Map<string, string[]>
) {
  const filepath = path.join(WORDNET_DIR, filename)
  if (!fs.existsSync(filepath)) {
    logger.warn(`⚠️  File not found: ${filename}`)
    return
  }
  
  logger.info(`📖 Processing ${filename} with index...`)
  const content = fs.readFileSync(filepath, 'utf-8')
  const lines = content.split('\n')
  
  let count = 0
  let validEntries = 0
  
  // Create a map of synset offset to line for faster lookup
  const synsetMap = new Map<string, string>()
  
  for (const line of lines) {
    if (!line.trim() || line.startsWith(' ')) continue
    if (line.includes('LICENSE') || line.includes('Princeton') || line.includes('LICENSEE')) continue
    
    const parts = line.split(' ')
    if (parts.length < 4) continue
    if (!/^[0-9a-f]{8}$/i.test(parts[0])) continue
    
    const synsetOffset = parts[0]
    synsetMap.set(synsetOffset, line)
  }
  
  // Process each word from the index
  for (const [, synsetOffsets] of wordToSynsets) {
    for (const synsetOffset of synsetOffsets) {
      const line = synsetMap.get(synsetOffset)
      if (!line) continue
      
      const parts = line.split(' ')
      if (parts.length < 4) continue
      
      const lex_filenum = parts[1]
      const ss_type = parts[2]
      const w_cnt = parts[3]
      
      // Parse words
      const wordCount = parseInt(w_cnt, 16)
      const words: string[] = []
      let wordIndex = 4
      
      for (let i = 0; i < wordCount; i++) {
        if (wordIndex + 1 < parts.length) {
          const wordInSynset = parts[wordIndex]
          let cleanWord = wordInSynset.replace(/_/g, ' ')
          
          if (ss_type === 'a' || ss_type === 's') {
            cleanWord = cleanWord.replace(/\([^)]*\)$/, '')
          }
          
          if (isValidWord(cleanWord)) {
            words.push(cleanWord)
          }
          wordIndex += 2
        }
      }
      
      if (words.length === 0) continue
      
      // Skip pointer data
      const p_cnt = parts[wordIndex]
      const ptrCount = parseInt(p_cnt, 10)
      wordIndex++
      
      for (let i = 0; i < ptrCount; i++) {
        if (wordIndex + 3 < parts.length) {
          wordIndex += 4
        }
      }
      
      // Skip frames for verbs
      if (ss_type === 'v' && wordIndex < parts.length && parts[wordIndex] === '+') {
        while (wordIndex < parts.length && parts[wordIndex] !== '|') {
          wordIndex++
        }
      }
      
      // Find the gloss
      let gloss = ''
      const pipeIndex = parts.indexOf('|')
      if (pipeIndex !== -1 && pipeIndex + 1 < parts.length) {
        gloss = parts.slice(pipeIndex + 1).join(' ').trim()
      }
      
      const { definition, examples } = parseGloss(gloss)
      
      // Process each word in the synset
      for (const wordInSynset of words) {
        const wordId = wordInSynset.toLowerCase()
        
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
          word: wordInSynset,
          definition: definition || '',
          examples: [...examples],
          synonyms: words.filter(s => s !== wordInSynset && isValidWord(s)),
          lexFileNum: lex_filenum,
          synsetOffset: synsetOffset
        }
        
        const existingSense = wordNetData[wordId].senses?.find(s => 
          s.word === wordInSynset && s.definition === definition
        )
        
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
        logger.info(`  Processed ${count} synsets, ${validEntries} valid...`)
      }
    }
  }
  
  logger.info(`✅ Processed ${count} synsets, ${validEntries} valid from ${filename}`)
}

async function processDataFile(filename: string, wordNetData: WordNetJson) {
  const filepath = path.join(WORDNET_DIR, filename)
  if (!fs.existsSync(filepath)) {
    logger.warn(`⚠️  File not found: ${filename}`)
    return
  }
  logger.info(`📖 Processing ${filename}...`)
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
      logger.info(`  Processed ${count} entries, ${validEntries} valid...`)
    }
  }
  logger.info(`✅ Processed ${count} entries, ${validEntries} valid from ${filename}`)
}

function escapeCsvField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`
  }
  return field
}

function exportToCsv(wordNetData: WordNetJson): void {
  logger.info('📊 Exporting to CSV...')
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
  logger.info(`✅ CSV exported to: ${CSV_FILE}`)
}

export async function generateWordNet(): Promise<{ jsonPath: string; csvPath: string }> {
  logger.info('🚀 Starting WordNet generation (API)...')
  
  // Ensure WordNet source files are available
  await ensureWordNetFiles()
  
  const wordNetData: WordNetJson = {}
  
  // Process each part of speech using both index and data files
  const posMappings = [
    { dataFile: 'data.noun', indexFile: 'index.noun' },
    { dataFile: 'data.verb', indexFile: 'index.verb' },
    { dataFile: 'data.adj', indexFile: 'index.adj' },
    { dataFile: 'data.adv', indexFile: 'index.adv' }
  ]
  
  for (const { dataFile, indexFile } of posMappings) {
    logger.info(`📖 Processing (${dataFile} + ${indexFile})...`)
    
    // Parse index file to get word-to-synset mappings
    const wordToSynsets = parseIndexFile(indexFile)
    logger.info(`  Found ${wordToSynsets.size} words in index`)
    
    if (wordToSynsets.size > 0) {
      await processDataFileWithIndex(dataFile, wordNetData, wordToSynsets)
    } else {
      logger.warn(`  ⚠️ Index empty for ${indexFile}, scanning ${dataFile}`)
      await processDataFile(dataFile, wordNetData)
    }
  }
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
  logger.info('💾 Writing to wordnet.json...')
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(wordNetData, null, 2))
  exportToCsv(wordNetData)
  
  // Save 1000 random samples to Firestore for visualization
  logger.info('📊 Saving 1000 random samples to Firestore...')
  const allWords = Object.keys(wordNetData)
  const randomSamples = allWords
    .sort(() => Math.random() - 0.5) // Shuffle array
    .slice(0, 1000)
    .map(wordId => ({
      ...wordNetData[wordId]
    }))
  
  const db = await getDb()
  const batch = db.batch()
  
  // Clear existing samples
  const existingSamples = await db.collection('wordnet_samples').get()
  existingSamples.docs.forEach(doc => batch.delete(doc.ref))
  
  // Add new samples
  randomSamples.forEach((sample, index) => {
    const docRef = db.collection('wordnet_samples').doc(`sample_${index + 1}`)
    batch.set(docRef, {
      ...sample,
      createdAt: new Date(),
      totalWords: allWords.length
    })
  })
  
  await batch.commit()
  logger.info(`✅ Saved ${randomSamples.length} random samples to Firestore`)
  
  logger.info('☁️  Uploading files to Firebase Storage...')
  const storage = await getAdminStorage()
  const bucket = storage.bucket()
  await bucket.upload(OUTPUT_FILE, { destination: 'wordnet/wordnet.json', contentType: 'application/json' })
  await bucket.upload(CSV_FILE, { destination: 'wordnet/wordnet.csv', contentType: 'text/csv' })
  logger.info('✅ Upload complete.')
  return { jsonPath: OUTPUT_FILE, csvPath: CSV_FILE }
}


