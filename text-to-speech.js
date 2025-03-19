#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { program } = require('commander');
const OpenAI = require('openai');
const PDFParser = require('pdf-parse');
const readline = require('readline');
const { spawn } = require('child_process');
const os = require('os');
const { execSync } = require('child_process');

// Load environment variables from .env file
dotenv.config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Define CLI options
program
  .name('text-to-speech')
  .description('Convert text to speech using OpenAI API')
  .version('1.0.0')
  .option('-f, --file <path>', 'Input file path (txt, pdf)')
  .option('-o, --output <path>', 'Output audio file path (default: output.mp3)')
  .option('-v, --voice <name>', 'Voice to use (default from .env or "nova")')
  .option('-m, --model <name>', 'Model to use (default from .env or "tts-1-hd")')
  .option('-r, --response-format <format>', 'Audio format (mp3, opus, aac, flac, wav, pcm)', 'mp3')
  .option('-s, --speed <factor>', 'Speed factor (0.25 to 4.0)', parseFloat, 1)
  .option('--no-ffmpeg', 'Disable ffmpeg for merging audio chunks')
  .parse(process.argv);

const options = program.opts();

// Default values with fallbacks
const outputPath = options.output || 'output.mp3';
const voice = options.voice || process.env.DEFAULT_VOICE || 'nova';
const model = options.model || process.env.DEFAULT_MODEL || 'tts-1-hd';
const responseFormat = options.responseFormat || 'mp3';
const speed = options.speed;
const useFFmpeg = options.ffmpeg !== false;

// Available voices for validation
const availableVoices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'coral', 'ash', 'sage'];
const availableFormats = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'];

// Validate parameters
if (!availableVoices.includes(voice)) {
  console.error(`Error: Voice "${voice}" is not available. Available voices: ${availableVoices.join(', ')}`);
  process.exit(1);
}

if (!availableFormats.includes(responseFormat)) {
  console.error(`Error: Format "${responseFormat}" is not available. Available formats: ${availableFormats.join(', ')}`);
  process.exit(1);
}

if (speed < 0.25 || speed > 4.0) {
  console.error('Error: Speed factor must be between 0.25 and 4.0');
  process.exit(1);
}

// Check if ffmpeg is installed when needed
function checkFFmpeg() {
  if (useFFmpeg) {
    try {
      execSync('ffmpeg -version', { stdio: 'ignore' });
      return true;
    } catch (e) {
      console.warn('Warning: ffmpeg is not installed. Multiple audio files will be generated instead of a single merged file.');
      return false;
    }
  }
  return false;
}

// Function to extract text from PDF file
async function extractTextFromPDF(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await PDFParser(dataBuffer);
    return data.text;
  } catch (error) {
    console.error('Error extracting text from PDF:', error.message);
    process.exit(1);
  }
}

// Function to read text from a file
async function readTextFromFile(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf') {
      return await extractTextFromPDF(filePath);
    } else {
      return fs.readFileSync(filePath, 'utf8');
    }
  } catch (error) {
    console.error(`Error reading file: ${error.message}`);
    process.exit(1);
  }
}

// Function to read text from stdin
async function readFromStdin() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    let text = '';
    
    rl.on('line', (line) => {
      text += line + '\n';
    });
    
    rl.on('close', () => {
      resolve(text);
    });

    // If no data is provided within 1 second (for interactive mode)
    setTimeout(() => {
      if (!text) {
        console.log('Enter text to convert to speech (press Ctrl+D when finished):');
      }
    }, 1000);
  });
}

// Function to handle OCR for images using OpenAI Vision
async function handleOCR(filePath) {
  try {
    console.log('Performing OCR using OpenAI Vision...');
    
    // Read the image file as base64
    const imageBuffer = fs.readFileSync(filePath);
    const base64Image = imageBuffer.toString('base64');
    
    // Call OpenAI Vision API for OCR
    const response = await openai.chat.completions.create({
      model: "gpt-4-vision-preview",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Extract all the text content from this image. Return only the extracted text, no additional explanations." },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      max_tokens: 4096,
    });
    
    return response.choices[0].message.content;
  } catch (error) {
    console.error('Error performing OCR:', error.message);
    process.exit(1);
  }
}

// Function to split text into chunks of at most 4096 characters at natural boundaries
function splitTextIntoChunks(text, maxLength = 4096) {
  const chunks = [];
  
  // First, try splitting by paragraphs
  const paragraphs = text.split(/\n\s*\n/);
  let currentChunk = '';
  
  for (const paragraph of paragraphs) {
    // If this paragraph would exceed the limit by itself
    if (paragraph.length > maxLength) {
      // If we have content in the current chunk, add it first
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      
      // Now split the large paragraph by sentences
      const sentences = paragraph.match(/[^.!?]+[.!?]+/g) || [];
      
      if (sentences.length > 0) {
        for (const sentence of sentences) {
          if (sentence.length > maxLength) {
            // If a single sentence is too long, split by words
            const words = sentence.split(' ');
            let wordChunk = '';
            
            for (const word of words) {
              if ((wordChunk.length + word.length + 1) > maxLength) {
                chunks.push(wordChunk.trim());
                wordChunk = word;
              } else {
                wordChunk += (wordChunk ? ' ' : '') + word;
              }
            }
            
            if (wordChunk) {
              chunks.push(wordChunk.trim());
            }
          } else {
            // Normal sentence handling
            if ((currentChunk.length + sentence.length) > maxLength) {
              chunks.push(currentChunk.trim());
              currentChunk = sentence;
            } else {
              currentChunk += sentence;
            }
          }
        }
      } else {
        // If no sentences are found, split by characters with word boundaries
        let remainingText = paragraph;
        while (remainingText.length > 0) {
          let chunkEnd = Math.min(maxLength, remainingText.length);
          
          // Try to find a space to break at
          if (remainingText.length > maxLength) {
            const lastSpace = remainingText.substring(0, maxLength).lastIndexOf(' ');
            if (lastSpace > 0) {
              chunkEnd = lastSpace + 1; // Include the space
            }
          }
          
          chunks.push(remainingText.substring(0, chunkEnd).trim());
          remainingText = remainingText.substring(chunkEnd).trim();
        }
      }
    } else {
      // This paragraph fits in the limit, check if adding it exceeds the limit
      if ((currentChunk.length + paragraph.length + 2) > maxLength) {
        chunks.push(currentChunk.trim());
        currentChunk = paragraph;
      } else {
        if (currentChunk) {
          currentChunk += '\n\n' + paragraph;
        } else {
          currentChunk = paragraph;
        }
      }
    }
  }
  
  // Add the last chunk if it's not empty
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }
  
  // If no chunks were created (rare case), fall back to character splitting
  if (chunks.length === 0) {
    for (let i = 0; i < text.length; i += maxLength) {
      chunks.push(text.substring(i, i + maxLength));
    }
  }
  
  return chunks;
}

// Function to convert text to speech with chunking support
async function textToSpeech(text) {
  try {
    console.log(`Converting text to speech using voice: ${voice}, model: ${model}`);
    
    // Split text into chunks if it exceeds the API limit
    const chunks = text.length > 4000 ? splitTextIntoChunks(text) : [text];
    console.log(`Text split into ${chunks.length} chunks`);
    
    if (chunks.length === 1) {
      // Handle single chunk directly
      const requestOptions = {
        model: model,
        voice: voice,
        input: chunks[0],
        response_format: responseFormat
      };
      
      if (speed !== 1.0) {
        requestOptions.speed = speed;
      }
      
      const mp3 = await openai.audio.speech.create(requestOptions);
      const buffer = Buffer.from(await mp3.arrayBuffer());
      fs.writeFileSync(outputPath, buffer);
      
      console.log(`Audio saved to ${outputPath}`);
    } else {
      // Handle multiple chunks
      const tmpDir = path.join(os.tmpdir(), 'text-to-speech-tmp');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      
      const chunkFiles = [];
      
      // Process each chunk and save as temporary file
      for (let i = 0; i < chunks.length; i++) {
        console.log(`Processing chunk ${i + 1}/${chunks.length} (${chunks[i].length} characters)`);
        
        const requestOptions = {
          model: model,
          voice: voice,
          input: chunks[i],
          response_format: responseFormat
        };
        
        if (speed !== 1.0) {
          requestOptions.speed = speed;
        }
        
        const audioResponse = await openai.audio.speech.create(requestOptions);
        const chunkPath = path.join(tmpDir, `chunk_${i}.${responseFormat}`);
        const buffer = Buffer.from(await audioResponse.arrayBuffer());
        fs.writeFileSync(chunkPath, buffer);
        chunkFiles.push(chunkPath);
      }
      
      // Check if ffmpeg is available and merge files if possible
      const ffmpegAvailable = checkFFmpeg();
      
      if (ffmpegAvailable) {
        // Create file list for ffmpeg
        const fileListPath = path.join(tmpDir, 'filelist.txt');
        let fileListContent = '';
        for (const file of chunkFiles) {
          fileListContent += `file '${file}'\n`;
        }
        fs.writeFileSync(fileListPath, fileListContent);
        
        // Merge audio files using ffmpeg (with force overwrite)
        await new Promise((resolve, reject) => {
          const ffmpeg = spawn('ffmpeg', [
            '-y', // Force overwrite without asking
            '-f', 'concat',
            '-safe', '0',
            '-i', fileListPath,
            '-c', 'copy',
            outputPath
          ]);
          
          ffmpeg.on('close', (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`ffmpeg exited with code ${code}`));
            }
          });
          
          ffmpeg.stderr.on('data', (data) => {
            console.log(`ffmpeg: ${data}`);
          });
        });
        
        console.log(`Merged audio saved to ${outputPath}`);
        
        // Clean up temporary files
        for (const file of chunkFiles) {
          fs.unlinkSync(file);
        }
        fs.unlinkSync(fileListPath);
      } else {
        // Just create multiple output files
        const baseOutput = path.parse(outputPath);
        
        for (let i = 0; i < chunkFiles.length; i++) {
          const outputFile = path.join(
            baseOutput.dir, 
            `${baseOutput.name}_part${i+1}${baseOutput.ext}`
          );
          fs.copyFileSync(chunkFiles[i], outputFile);
          console.log(`Chunk ${i+1} saved to ${outputFile}`);
        }
      }
      
      // Remove the tmp directory
      try {
        for (const file of fs.readdirSync(tmpDir)) {
          fs.unlinkSync(path.join(tmpDir, file));
        }
        fs.rmdirSync(tmpDir);
      } catch (err) {
        console.log(`Warning: Could not remove temporary directory: ${err.message}`);
      }
    }
  } catch (error) {
    console.error('Error converting text to speech:', error.message);
    process.exit(1);
  }
}

// Main function
async function main() {
  try {
    // Check if API key is set
    if (!process.env.OPENAI_API_KEY) {
      console.error('Error: OPENAI_API_KEY is not set in the .env file');
      process.exit(1);
    }

    let text;
    
    // Get text from file or stdin
    if (options.file) {
      const ext = path.extname(options.file).toLowerCase();
      const imageExts = ['.png', '.jpg', '.jpeg', '.bmp', '.tiff', '.webp'];
      
      if (ext === '.pdf') {
        text = await readTextFromFile(options.file);
      } else if (imageExts.includes(ext)) {
        text = await handleOCR(options.file);
      } else {
        text = await readTextFromFile(options.file);
      }
    } else {
      text = await readFromStdin();
    }
    
    // Trim and check if there's text to process
    text = text.trim();
    if (!text) {
      console.error('Error: No text provided');
      process.exit(1);
    }
    
    // Convert text to speech
    await textToSpeech(text);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run the main function
main();
