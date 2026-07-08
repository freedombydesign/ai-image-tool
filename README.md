# AI Image Studio

A web-based AI image tool powered by OpenAI DALL-E for generating, editing, and transforming images.

## Features

- **Generate**: Create images from text descriptions using DALL-E 3
- **Edit**: Modify parts of existing images with AI
- **Variations**: Generate similar versions of uploaded images
- **Character Swap**: Replace people in images with different characters

## Setup

1. **Get an OpenAI API key**
   - Go to https://platform.openai.com/api-keys
   - Create a new API key

2. **Configure the API key**
   ```bash
   cp .env.example .env
   # Edit .env and add your API key
   ```

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Start the server**
   ```bash
   npm start
   ```

5. **Open in browser**
   - Go to http://localhost:3000

## Usage

### Generate New Images
1. Go to the "Generate" tab
2. Enter a detailed description of the image you want
3. Choose size, style, and quality options
4. Click "Generate Image"

### Edit Images
1. Go to the "Edit" tab
2. Upload an image
3. Optionally upload a mask (white areas will be edited)
4. Describe what you want to change
5. Click "Apply Edit"

### Create Variations
1. Go to the "Variations" tab
2. Upload an image
3. Click "Create Variation"

### Character Swap
1. Go to the "Character Swap" tab
2. Upload an image with a person
3. Describe the new character
4. Click "Swap Character"

## API Costs

This tool uses the OpenAI API which has usage-based pricing:
- DALL-E 3: ~$0.04-0.08 per image
- DALL-E 2 (edits/variations): ~$0.02 per image

## Tech Stack

- Node.js + Express
- OpenAI API
- Sharp (image processing)
- Vanilla JavaScript frontend
