require('dotenv').config();
const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenAI (trim to remove any accidental whitespace/newlines from env vars)
const openai = new OpenAI({
  apiKey: (process.env.OPENAI_API_KEY || '').trim()
});

// Model configurations with pricing info
const MODEL_CONFIG = {
  'dall-e-3': {
    provider: 'openai',
    costPerImage: { standard: 0.04, hd: 0.08 },
    sizes: ['1024x1024', '1792x1024', '1024x1792'],
    description: 'Best prompt adherence, highest quality'
  },
  'flux-schnell': {
    provider: 'replicate',
    model: 'black-forest-labs/flux-schnell',
    costPerImage: 0.003,
    sizes: ['1024x1024', '1024x768', '768x1024'],
    description: 'Fast, affordable, great quality'
  },
  'flux-pro': {
    provider: 'replicate',
    model: 'black-forest-labs/flux-pro',
    costPerImage: 0.05,
    sizes: ['1024x1024', '1024x768', '768x1024'],
    description: 'Highest quality Flux model'
  },
  'stable-diffusion-xl': {
    provider: 'stability',
    engine: 'stable-diffusion-xl-1024-v1-0',
    costPerImage: 0.002,
    sizes: ['1024x1024', '1152x896', '896x1152'],
    description: 'Very affordable, good quality'
  },
  'stable-diffusion-3': {
    provider: 'stability',
    engine: 'sd3-large',
    costPerImage: 0.065,
    sizes: ['1024x1024'],
    description: 'Latest Stable Diffusion, excellent quality'
  }
};

// Helper: Generate with Replicate (Flux)
async function generateWithReplicate(prompt, model, options = {}) {
  const apiKey = (process.env.REPLICATE_API_TOKEN || '').trim();
  if (!apiKey) {
    throw new Error('REPLICATE_API_TOKEN not configured. Add it to your .env file.');
  }

  const modelConfig = MODEL_CONFIG[model];

  // Flux models use aspect_ratio, not pixel dimensions
  // Map common dimensions to aspect ratios
  let aspectRatio = options.aspectRatio || '16:9';
  if (options.width && options.height) {
    const ratio = options.width / options.height;
    if (ratio > 1.6) aspectRatio = '16:9';      // Wide (1792x1024, etc.)
    else if (ratio > 1.2) aspectRatio = '4:3';  // Standard wide
    else if (ratio > 0.9) aspectRatio = '1:1';  // Square
    else if (ratio > 0.7) aspectRatio = '3:4';  // Portrait
    else aspectRatio = '9:16';                  // Tall
  }

  // Start the prediction
  const response = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      version: model === 'flux-schnell'
        ? '5599ed30703defd1d160a25a63321b4dec97101d98b4674bcc56e41f62f35637'
        : 'latest', // flux-pro uses latest
      input: {
        prompt: prompt,
        num_outputs: 1,
        aspect_ratio: aspectRatio,
        output_format: 'png'
      }
    })
  });

  const prediction = await response.json();

  if (prediction.error) {
    throw new Error(prediction.error);
  }

  // Poll for completion
  let result = prediction;
  while (result.status !== 'succeeded' && result.status !== 'failed') {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const pollResponse = await fetch(result.urls.get, {
      headers: { 'Authorization': `Token ${apiKey}` }
    });
    result = await pollResponse.json();
  }

  if (result.status === 'failed') {
    throw new Error(result.error || 'Generation failed');
  }

  return {
    url: result.output[0],
    model: model
  };
}

// Helper: Generate with Stability AI
async function generateWithStability(prompt, model, options = {}) {
  const apiKey = (process.env.STABILITY_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('STABILITY_API_KEY not configured. Add it to your .env file.');
  }

  const modelConfig = MODEL_CONFIG[model];
  const engine = modelConfig.engine;

  // Map requested dimensions to closest supported sizes
  // SDXL supports: 1024x1024, 1152x896, 896x1152
  // SD3 supports: 1024x1024
  let width = options.width || 1024;
  let height = options.height || 1024;

  if (model === 'stable-diffusion-3') {
    // SD3 only supports 1024x1024
    width = 1024;
    height = 1024;
  } else {
    // SDXL - pick closest aspect ratio
    const ratio = width / height;
    if (ratio > 1.1) {
      // Landscape - use 1152x896 (1.29 ratio)
      width = 1152;
      height = 896;
    } else if (ratio < 0.9) {
      // Portrait - use 896x1152
      width = 896;
      height = 1152;
    } else {
      // Square-ish - use 1024x1024
      width = 1024;
      height = 1024;
    }
  }

  const response = await fetch(`https://api.stability.ai/v1/generation/${engine}/text-to-image`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      text_prompts: [{ text: prompt, weight: 1 }],
      cfg_scale: 7,
      width: width,
      height: height,
      samples: 1,
      steps: 30
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Stability AI generation failed');
  }

  const data = await response.json();

  // Stability returns base64, we need to convert to data URL
  const base64 = data.artifacts[0].base64;
  return {
    url: `data:image/png;base64,${base64}`,
    model: model
  };
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PNG, JPEG, and WebP images are allowed'));
    }
  }
});

// Audio upload config for transcription (25MB limit for Whisper)
const audioUpload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['audio/webm', 'audio/mp3', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/m4a', 'audio/ogg'];
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(webm|mp3|mp4|wav|m4a|ogg)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Audio file format not supported'));
    }
  }
});

// Helper: Convert image to PNG and ensure correct size for DALL-E
async function prepareImageForDalle(imagePath) {
  const outputPath = imagePath.replace(/\.[^.]+$/, '-prepared.png');

  await sharp(imagePath)
    .resize(1024, 1024, { fit: 'cover' })
    .png()
    .toFile(outputPath);

  return outputPath;
}

// Helper: Create mask with transparent area (for inpainting)
async function createMask(imagePath, maskData) {
  const outputPath = imagePath.replace(/\.[^.]+$/, '-mask.png');

  // Create a white image with black area where editing should happen
  // For simplicity, create a center mask - in production you'd use actual mask data
  const image = sharp(imagePath);
  const metadata = await image.metadata();

  // Create mask buffer
  const maskBuffer = await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
  .composite([{
    input: Buffer.from(
      `<svg width="1024" height="1024">
        <rect x="256" y="256" width="512" height="512" fill="white"/>
      </svg>`
    ),
    top: 0,
    left: 0
  }])
  .png()
  .toFile(outputPath);

  return outputPath;
}

// API Routes

// Get available models and their configurations
app.get('/api/models', (req, res) => {
  const models = Object.entries(MODEL_CONFIG).map(([id, config]) => ({
    id,
    ...config,
    available: checkModelAvailability(id)
  }));
  res.json({ models });
});

// Check which models have API keys configured
function checkModelAvailability(modelId) {
  const config = MODEL_CONFIG[modelId];
  if (!config) return false;

  switch (config.provider) {
    case 'openai':
      return !!process.env.OPENAI_API_KEY;
    case 'replicate':
      return !!process.env.REPLICATE_API_TOKEN;
    case 'stability':
      return !!process.env.STABILITY_API_KEY;
    default:
      return false;
  }
}

// Generate new image from text prompt (supports multiple models)
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, size = '1024x1024', style = 'vivid', quality = 'standard', model = 'dall-e-3' } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const modelConfig = MODEL_CONFIG[model];
    if (!modelConfig) {
      return res.status(400).json({ error: `Unknown model: ${model}` });
    }

    console.log(`Generating image with ${model}:`, prompt);

    // Parse size
    const [width, height] = size.split('x').map(Number);

    let result;

    switch (modelConfig.provider) {
      case 'openai':
        const response = await openai.images.generate({
          model: 'dall-e-3',
          prompt,
          n: 1,
          size,
          style,
          quality
        });
        result = {
          image: response.data[0].url,
          revised_prompt: response.data[0].revised_prompt,
          model: model
        };
        break;

      case 'replicate':
        const replicateResult = await generateWithReplicate(prompt, model, {
          width,
          height,
          aspectRatio: width > height ? '16:9' : height > width ? '9:16' : '1:1'
        });
        result = {
          image: replicateResult.url,
          model: model
        };
        break;

      case 'stability':
        const stabilityResult = await generateWithStability(prompt, model, {
          width,
          height
        });
        result = {
          image: stabilityResult.url,
          model: model
        };
        break;

      default:
        throw new Error(`Provider ${modelConfig.provider} not supported`);
    }

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create variations of an uploaded image
app.post('/api/variations', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required' });
    }

    console.log('Creating variations for:', req.file.path);

    // Prepare image for DALL-E (must be PNG, square)
    const preparedImage = await prepareImageForDalle(req.file.path);

    const response = await openai.images.createVariation({
      model: 'dall-e-2',
      image: fs.createReadStream(preparedImage),
      n: 1,
      size: '1024x1024'
    });

    // Cleanup temp files
    fs.unlinkSync(req.file.path);
    fs.unlinkSync(preparedImage);

    res.json({
      success: true,
      image: response.data[0].url
    });
  } catch (error) {
    console.error('Variation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Edit/inpaint an image
app.post('/api/edit', upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'mask', maxCount: 1 }
]), async (req, res) => {
  try {
    const { prompt } = req.body;
    const imageFile = req.files['image']?.[0];
    const maskFile = req.files['mask']?.[0];

    if (!imageFile) {
      return res.status(400).json({ error: 'Image file is required' });
    }

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required for editing' });
    }

    console.log('Editing image with prompt:', prompt);

    // Prepare image
    const preparedImage = await prepareImageForDalle(imageFile.path);

    // Use provided mask or create default center mask
    let maskPath;
    if (maskFile) {
      maskPath = await prepareImageForDalle(maskFile.path);
    } else {
      maskPath = await createMask(preparedImage, null);
    }

    const response = await openai.images.edit({
      model: 'dall-e-2',
      image: fs.createReadStream(preparedImage),
      mask: fs.createReadStream(maskPath),
      prompt,
      n: 1,
      size: '1024x1024'
    });

    // Cleanup temp files
    fs.unlinkSync(imageFile.path);
    fs.unlinkSync(preparedImage);
    fs.unlinkSync(maskPath);
    if (maskFile) fs.unlinkSync(maskFile.path);

    res.json({
      success: true,
      image: response.data[0].url
    });
  } catch (error) {
    console.error('Edit error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Character swap - combines variation + editing
app.post('/api/character-swap', upload.single('image'), async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required' });
    }

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt describing the new character is required' });
    }

    console.log('Character swap with prompt:', prompt);

    // Prepare image
    const preparedImage = await prepareImageForDalle(req.file.path);

    // Create a mask for the character area (center region)
    const maskPath = await createMask(preparedImage, null);

    // Use edit endpoint with character description
    const response = await openai.images.edit({
      model: 'dall-e-2',
      image: fs.createReadStream(preparedImage),
      mask: fs.createReadStream(maskPath),
      prompt: `Replace the person with: ${prompt}. Keep the same pose, background, and composition.`,
      n: 1,
      size: '1024x1024'
    });

    // Cleanup
    fs.unlinkSync(req.file.path);
    fs.unlinkSync(preparedImage);
    fs.unlinkSync(maskPath);

    res.json({
      success: true,
      image: response.data[0].url
    });
  } catch (error) {
    console.error('Character swap error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Transcribe audio using Whisper API with timestamps
app.post('/api/transcribe', audioUpload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file is required' });
    }

    console.log('Transcribing audio:', req.file.path);

    // Get scene descriptions from request body
    const scenes = req.body.scenes ? JSON.parse(req.body.scenes) : [];

    // Transcribe with Whisper - request word-level timestamps
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment', 'word']
    });

    // Cleanup audio file
    fs.unlinkSync(req.file.path);

    // If no scenes provided, just return the transcription
    if (scenes.length === 0) {
      return res.json({
        success: true,
        transcription: transcription.text,
        segments: transcription.segments,
        words: transcription.words
      });
    }

    // Intelligent scene matching
    const sceneTimings = matchScenesToTranscription(scenes, transcription);

    res.json({
      success: true,
      transcription: transcription.text,
      segments: transcription.segments,
      sceneTimings
    });

  } catch (error) {
    console.error('Transcription error:', error);
    // Cleanup on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: error.message });
  }
});

// Helper: Match scenes to transcription segments using text similarity
function matchScenesToTranscription(scenes, transcription) {
  const segments = transcription.segments || [];
  const sceneTimings = [];

  // Tokenize and normalize text for comparison
  const normalize = (text) => {
    return text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2); // Remove tiny words
  };

  // Calculate similarity between two texts (Jaccard-like)
  const similarity = (text1, text2) => {
    const words1 = new Set(normalize(text1));
    const words2 = new Set(normalize(text2));
    const intersection = [...words1].filter(w => words2.has(w));
    const union = new Set([...words1, ...words2]);
    return union.size > 0 ? intersection.length / union.size : 0;
  };

  // For each scene, find the best matching segment(s)
  let usedSegments = new Set();

  scenes.forEach((scene, sceneIndex) => {
    let bestMatch = null;
    let bestScore = 0;
    let bestSegmentIndex = -1;

    // Find the segment that best matches this scene
    segments.forEach((segment, segIndex) => {
      if (usedSegments.has(segIndex)) return; // Skip already used segments

      const score = similarity(scene.text || scene.description || '', segment.text);

      // Prefer segments that come after previous scene's segment (maintain order)
      const orderBonus = (sceneIndex === 0 || segIndex > (sceneTimings[sceneIndex - 1]?.segmentIndex || -1)) ? 0.1 : 0;

      if (score + orderBonus > bestScore) {
        bestScore = score + orderBonus;
        bestMatch = segment;
        bestSegmentIndex = segIndex;
      }
    });

    if (bestMatch && bestScore > 0.05) {
      // Found a matching segment
      usedSegments.add(bestSegmentIndex);
      sceneTimings.push({
        sceneIndex,
        startTime: bestMatch.start,
        endTime: bestMatch.end,
        duration: bestMatch.end - bestMatch.start,
        matchedText: bestMatch.text,
        confidence: bestScore,
        segmentIndex: bestSegmentIndex
      });
    } else {
      // No good match found - will be handled by fallback distribution
      sceneTimings.push({
        sceneIndex,
        startTime: null,
        endTime: null,
        duration: null,
        matchedText: null,
        confidence: 0,
        segmentIndex: -1
      });
    }
  });

  // Fill in gaps for unmatched scenes using interpolation
  const totalDuration = transcription.duration || (segments.length > 0 ? segments[segments.length - 1].end : 0);
  let lastEndTime = 0;

  sceneTimings.forEach((timing, index) => {
    if (timing.startTime === null) {
      // Find next matched scene
      let nextMatchedIndex = index + 1;
      while (nextMatchedIndex < sceneTimings.length && sceneTimings[nextMatchedIndex].startTime === null) {
        nextMatchedIndex++;
      }

      const nextStartTime = nextMatchedIndex < sceneTimings.length ? sceneTimings[nextMatchedIndex].startTime : totalDuration;
      const gapDuration = nextStartTime - lastEndTime;
      const unmatchedCount = nextMatchedIndex - index;
      const durationPerScene = gapDuration / unmatchedCount;

      timing.startTime = lastEndTime;
      timing.endTime = lastEndTime + durationPerScene;
      timing.duration = durationPerScene;
    }

    lastEndTime = timing.endTime;
  });

  return sceneTimings;
}

// Convert script text to visual scene descriptions using GPT
app.post('/api/script-to-scenes', async (req, res) => {
  try {
    const { script, sceneCount = 10, brandRules = null, style = 'professional' } = req.body;

    if (!script) {
      return res.status(400).json({ error: 'Script text is required' });
    }

    console.log(`Converting script to ${sceneCount} visual scenes...`);

    // Build the system prompt for scene conversion
    let systemPrompt = `You are a visual director converting video scripts into image generation prompts.

Your job is to read a script and create ${sceneCount} distinct visual scene descriptions that would work as AI-generated images for a video.

CRITICAL RULES:
1. Output ONLY visual descriptions - describe what we SEE, not what we hear
2. Each scene should be a single, clear visual moment (not abstract concepts)
3. Include: subjects, actions, setting, lighting, mood, composition
4. Use professional video/photography terminology
5. NO text in images - text will be added separately with overlays
6. Make scenes visually distinct but thematically cohesive
7. Focus on emotions, body language, and visual metaphors for abstract concepts`;

    // Add brand rules if provided
    if (brandRules) {
      systemPrompt += `\n\nBRAND STYLING TO APPLY TO ALL SCENES:`;
      if (brandRules.mood) systemPrompt += `\n- Mood: ${brandRules.mood}`;
      if (brandRules.lighting) systemPrompt += `\n- Lighting: ${brandRules.lighting}`;
      if (brandRules.colors) systemPrompt += `\n- Colors: ${brandRules.colors}`;
      if (brandRules.avoid) systemPrompt += `\n- AVOID: ${brandRules.avoid}`;
    }

    systemPrompt += `\n\nOutput format - return a JSON array with exactly ${sceneCount} objects:
[
  {
    "sceneNumber": 1,
    "visualDescription": "Detailed image prompt describing what we see...",
    "scriptExcerpt": "Brief quote from script this scene represents",
    "mood": "emotional tone of this scene"
  }
]

Only output the JSON array, no other text.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Convert this script into ${sceneCount} visual scene descriptions:\n\n${script}` }
      ],
      temperature: 0.7,
      max_tokens: 4000
    });

    let scenes;
    try {
      // Parse the JSON response
      const responseText = completion.choices[0].message.content.trim();
      // Handle potential markdown code blocks
      const jsonText = responseText.replace(/^```json\n?|\n?```$/g, '').trim();
      scenes = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('Failed to parse GPT response:', completion.choices[0].message.content);
      throw new Error('Failed to parse scene descriptions from AI response');
    }

    res.json({
      success: true,
      scenes: scenes,
      totalScenes: scenes.length
    });

  } catch (error) {
    console.error('Script-to-scenes error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', hasApiKey: !!process.env.OPENAI_API_KEY });
});

// Start server
app.listen(PORT, () => {
  console.log(`🎨 AI Image Tool running at http://localhost:${PORT}`);
  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️  Warning: OPENAI_API_KEY not set. Add it to .env file.');
  }
});
