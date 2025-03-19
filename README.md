# OpenAI Text-to-Speech CLI

A command-line tool for converting text to speech using OpenAI's Text-to-Speech API. This tool supports text from standard input, text files, PDFs, and even images (using OpenAI's Vision API for OCR).

## Features

- Convert text from files (txt, pdf) to speech
- Convert text from standard input to speech
- Extract text from images using OpenAI Vision API
- Configure voice, model, output format, and speech speed
- Set default preferences in .env file

## Installation

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file with your OpenAI API key:
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   DEFAULT_VOICE=alloy
   DEFAULT_MODEL=tts-1
   ```

4. Make the script executable:
   ```
   chmod +x text-to-speech.js
   ```

## Usage

### Basic Usage

Convert text from stdin:
```
echo "Hello, world!" | node text-to-speech.js
```

Interactive mode:
```
node text-to-speech.js
Enter text to convert to speech (press Ctrl+D when finished):
Hello, this is a test of the text-to-speech system.
```

Convert text from a file:
```
node text-to-speech.js --file input.txt
```

Convert text from a PDF:
```
node text-to-speech.js --file document.pdf
```

Extract text from an image and convert to speech:
```
node text-to-speech.js --file screenshot.png
```

### Options

```
Usage: text-to-speech [options]

Convert text to speech using OpenAI API

Options:
  -V, --version                    output the version number
  -f, --file <path>                Input file path (txt, pdf)
  -o, --output <path>              Output audio file path (default: output.mp3)
  -v, --voice <n>                  Voice to use (default from .env or "alloy")
  -m, --model <n>                  Model to use (default from .env or "tts-1")
  -r, --response-format <format>   Audio format (mp3, opus, aac, flac, wav, pcm) (default: "mp3")
  -s, --speed <factor>             Speed factor (0.25 to 4.0) (default: 1.0)
  -h, --help                       display help for command
```

### Examples

Convert text with a specific voice:
```
node text-to-speech.js --file input.txt --voice nova
```

Convert text to a different audio format:
```
node text-to-speech.js --file input.txt --response-format wav
```

Adjust the speaking speed:
```
node text-to-speech.js --file input.txt --speed 1.5
```

Specify the output file:
```
node text-to-speech.js --file input.txt --output my-speech.mp3
```

Use the high-definition model:
```
node text-to-speech.js --file input.txt --model tts-1-hd
```

## Available Voices

The following voices are available:
- alloy
- echo
- fable
- onyx 
- nova
- shimmer
- coral
- ash
- sage

## Available Output Formats

The following audio formats are supported:
- mp3 (default)
- opus
- aac
- flac
- wav
- pcm

## Available Models

- tts-1 (standard quality, lower latency)
- tts-1-hd (higher quality, higher latency)

## Environment Variables

You can set the following environment variables in the `.env` file:

- `OPENAI_API_KEY` (required): Your OpenAI API key
- `DEFAULT_VOICE` (optional): Default voice to use (defaults to "alloy")
- `DEFAULT_MODEL` (optional): Default model to use (defaults to "tts-1")
