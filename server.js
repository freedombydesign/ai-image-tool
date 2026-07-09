require('dotenv').config();
const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenAI (trim to remove any accidental whitespace/newlines from env vars)
const openai = new OpenAI({
  apiKey: (process.env.OPENAI_API_KEY || '').trim()
});

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

if (supabase) {
  console.log('Supabase connected');
} else {
  console.log('Supabase not configured - using localStorage fallback');
}

// Model configurations with pricing info
const MODEL_CONFIG = {
  'dall-e-3': {
    provider: 'openai',
    costPerImage: { standard: 0.04, hd: 0.08 },
    sizes: ['1024x1024', '1536x1024', '1024x1536'],
    description: 'GPT Image 2 - Best prompt adherence, highest quality'
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
      'Authorization': `Bearer ${apiKey}`,
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
      headers: { 'Authorization': `Bearer ${apiKey}` }
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

// Check if running on Vercel (serverless with read-only filesystem)
const IS_VERCEL = process.env.VERCEL === '1' || process.env.VERCEL === 'true' || !!process.env.VERCEL_ENV;

// Use /tmp for Vercel (only writable directory) or local uploads folder
const UPLOAD_DIR = IS_VERCEL ? '/tmp/uploads' : path.join(__dirname, 'uploads');

// Ensure upload directory exists (only for local development, not Vercel startup)
if (!IS_VERCEL && !fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  console.log('Created uploads directory');
}

app.use('/uploads', express.static(UPLOAD_DIR));

// Configure multer for file uploads
// Use memory storage on Vercel (we convert to base64 anyway), disk storage locally
const storage = IS_VERCEL
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => {
        if (!fs.existsSync(UPLOAD_DIR)) {
          fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        }
        cb(null, UPLOAD_DIR);
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

// Helper: Get file buffer from multer file (handles both memory and disk storage)
function getFileBuffer(file) {
  if (file.buffer) {
    // Memory storage (Vercel)
    return file.buffer;
  } else if (file.path) {
    // Disk storage (local)
    return fs.readFileSync(file.path);
  }
  throw new Error('No file data available');
}

// Helper: Convert multer file to base64 data URI
function fileToBase64DataUri(file) {
  const buffer = getFileBuffer(file);
  const mimeType = file.mimetype || 'image/png';
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

// Helper: Cleanup file if it exists on disk (only for disk storage)
function cleanupFile(file) {
  if (file && file.path && fs.existsSync(file.path)) {
    fs.unlinkSync(file.path);
  }
}

// Helper: Cleanup path directly
function cleanupPath(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

// Helper: Ensure we have a file path (for endpoints that need sharp processing)
// If using memory storage, writes buffer to temp file first
async function ensureFilePath(file) {
  if (file.path && fs.existsSync(file.path)) {
    // Disk storage - already have path
    return file.path;
  }
  if (file.buffer) {
    // Memory storage - write to temp file
    const tempDir = '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const tempPath = path.join(tempDir, `${Date.now()}-${file.originalname || 'upload.png'}`);
    fs.writeFileSync(tempPath, file.buffer);
    return tempPath;
  }
  throw new Error('No file data available');
}

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
        // Using gpt-image-2 (DALL-E 3 was retired May 2026)
        // Supported sizes: 1024x1024, 1536x1024, 1024x1536
        let openaiSize = size;
        if (size === '1792x1024') openaiSize = '1536x1024';  // Map old thumbnail size
        if (size === '1024x1792') openaiSize = '1024x1536';  // Map old portrait size

        const response = await openai.images.generate({
          model: 'gpt-image-2',
          prompt,
          n: 1,
          size: openaiSize
        });

        // gpt-image-2 returns base64 by default, convert to data URL
        let imageUrl;
        if (response.data[0].url) {
          imageUrl = response.data[0].url;
        } else if (response.data[0].b64_json) {
          imageUrl = `data:image/png;base64,${response.data[0].b64_json}`;
        } else {
          throw new Error('No image data in response');
        }

        result = {
          image: imageUrl,
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
  let filePath = null;
  let preparedImage = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required' });
    }

    // Get file path (writes to temp if using memory storage)
    filePath = await ensureFilePath(req.file);
    console.log('Creating variations for:', filePath);

    // Prepare image for DALL-E (must be PNG, square)
    preparedImage = await prepareImageForDalle(filePath);

    const response = await openai.images.createVariation({
      model: 'dall-e-2',
      image: fs.createReadStream(preparedImage),
      n: 1,
      size: '1024x1024'
    });

    // Cleanup temp files
    cleanupPath(filePath);
    cleanupPath(preparedImage);

    res.json({
      success: true,
      image: response.data[0].url
    });
  } catch (error) {
    console.error('Variation error:', error);
    cleanupPath(filePath);
    cleanupPath(preparedImage);
    res.status(500).json({ error: error.message });
  }
});

// Edit/inpaint an image
app.post('/api/edit', upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'mask', maxCount: 1 }
]), async (req, res) => {
  let imagePath = null;
  let maskFilePath = null;
  let preparedImage = null;
  let maskPath = null;

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

    // Get file paths (writes to temp if using memory storage)
    imagePath = await ensureFilePath(imageFile);
    preparedImage = await prepareImageForDalle(imagePath);

    // Use provided mask or create default center mask
    if (maskFile) {
      maskFilePath = await ensureFilePath(maskFile);
      maskPath = await prepareImageForDalle(maskFilePath);
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
    cleanupPath(imagePath);
    cleanupPath(preparedImage);
    cleanupPath(maskPath);
    cleanupPath(maskFilePath);

    res.json({
      success: true,
      image: response.data[0].url
    });
  } catch (error) {
    console.error('Edit error:', error);
    cleanupPath(imagePath);
    cleanupPath(preparedImage);
    cleanupPath(maskPath);
    cleanupPath(maskFilePath);
    res.status(500).json({ error: error.message });
  }
});

// Character swap - combines variation + editing
app.post('/api/character-swap', upload.single('image'), async (req, res) => {
  let filePath = null;
  let preparedImage = null;
  let maskPath = null;

  try {
    const { prompt } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required' });
    }

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt describing the new character is required' });
    }

    console.log('Character swap with prompt:', prompt);

    // Get file path (writes to temp if using memory storage)
    filePath = await ensureFilePath(req.file);
    preparedImage = await prepareImageForDalle(filePath);

    // Create a mask for the character area (center region)
    maskPath = await createMask(preparedImage, null);

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
    cleanupPath(filePath);
    cleanupPath(preparedImage);
    cleanupPath(maskPath);

    res.json({
      success: true,
      image: response.data[0].url
    });
  } catch (error) {
    console.error('Character swap error:', error);
    cleanupPath(filePath);
    cleanupPath(preparedImage);
    cleanupPath(maskPath);
    res.status(500).json({ error: error.message });
  }
});

// Analyze image using GPT-4o Vision
app.post('/api/analyze-image', upload.single('image'), async (req, res) => {
  try {
    const { analysisType } = req.body; // 'style', 'thumbnail', 'general'

    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required' });
    }

    console.log('Analyzing image with GPT-4o Vision, type:', analysisType);

    // Convert image to base64 (works with both memory and disk storage)
    const imageBuffer = getFileBuffer(req.file);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/png';

    // Build analysis prompt based on type
    let systemPrompt;
    if (analysisType === 'thumbnail') {
      systemPrompt = `Analyze this YouTube thumbnail and provide a detailed description that could be used to recreate a similar style. Include:
1. Color palette (specific colors used, dominant colors)
2. Composition (where elements are placed, layout)
3. Text style (if any - font style, size, colors, effects)
4. Lighting and mood
5. Subject matter and pose (if people are present)
6. Visual effects or filters used
7. Overall style category (minimalist, bold, dramatic, etc.)

Provide the description in a concise format that could be used as style guidance for AI image generation.`;
    } else if (analysisType === 'style') {
      systemPrompt = `Analyze the visual style of this image. Describe:
1. Art style (realistic, cartoon, illustration, etc.)
2. Color grading and palette
3. Lighting setup
4. Mood and atmosphere
5. Any distinctive visual techniques

Keep it concise and usable for recreating similar styles.`;
    } else {
      systemPrompt = `Describe this image in detail, including:
1. What's depicted (subjects, objects, setting)
2. Visual style and colors
3. Mood and atmosphere
4. Composition and framing

Be specific and detailed.`;
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: systemPrompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
                detail: 'high'
              }
            }
          ]
        }
      ],
      max_tokens: 1000
    });

    // Cleanup (only if using disk storage)
    cleanupFile(req.file);

    const analysis = response.choices[0].message.content;

    res.json({
      success: true,
      analysis: analysis,
      analysisType: analysisType || 'general'
    });

  } catch (error) {
    console.error('Image analysis error:', error);
    cleanupFile(req.file);
    res.status(500).json({ error: error.message });
  }
});

// Face swap using Replicate
app.post('/api/face-swap', upload.fields([
  { name: 'sourceImage', maxCount: 1 },  // The image to modify (e.g., thumbnail)
  { name: 'faceImage', maxCount: 1 }     // The face to swap in (user's avatar)
]), async (req, res) => {
  try {
    const sourceFile = req.files['sourceImage']?.[0];
    const faceFile = req.files['faceImage']?.[0];

    if (!sourceFile || !faceFile) {
      return res.status(400).json({ error: 'Both source image and face image are required' });
    }

    const apiKey = (process.env.REPLICATE_API_TOKEN || '').trim();
    if (!apiKey) {
      return res.status(400).json({ error: 'REPLICATE_API_TOKEN not configured. Add it to your .env file.' });
    }

    console.log('Starting face swap...');
    console.log('Source file:', sourceFile.originalname, 'size:', sourceFile.size);
    console.log('Face file:', faceFile.originalname, 'size:', faceFile.size);

    // Convert images to base64 data URIs (works with both memory and disk storage)
    const sourceBase64 = fileToBase64DataUri(sourceFile);
    const faceBase64 = fileToBase64DataUri(faceFile);

    console.log('Source base64 length:', sourceBase64.length);
    console.log('Face base64 length:', faceBase64.length);

    // Use Replicate face-swap model (lucataco/facefusion) with versioned endpoint
    // Using versioned endpoint for reliability (similar fix to InstantID)
    const FACEFUSION_VERSION = 'b1b33e143a30ffdd4e5d62c27b1e60a6e9a6d4dc7c1c0a10c65a7c9c86f0fc27';

    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: FACEFUSION_VERSION,
        input: {
          target_path: sourceBase64,  // The thumbnail/image to modify
          source_path: faceBase64,    // The face to swap IN (user's avatar)
          face_enhancer_blend: 80,
          frame_enhancer_blend: 80
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Replicate API error:', response.status, errorText);
      throw new Error(`Replicate API error: ${errorText}`);
    }

    let prediction = await response.json();
    console.log('Face swap prediction started:', prediction.id, 'status:', prediction.status);

    // Poll for completion
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const pollResponse = await fetch(prediction.urls.get, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      prediction = await pollResponse.json();
      console.log('Face swap status:', prediction.status);
    }

    // Cleanup temp files (only if using disk storage)
    cleanupFile(sourceFile);
    cleanupFile(faceFile);

    if (prediction.status === 'failed') {
      console.error('Face swap failed:', prediction.error);
      throw new Error(prediction.error || 'Face swap failed');
    }

    console.log('Face swap succeeded, output:', prediction.output);

    res.json({
      success: true,
      image: prediction.output,
      predictionId: prediction.id
    });

  } catch (error) {
    console.error('Face swap error:', error);
    // Cleanup on error (only if using disk storage)
    if (req.files) {
      cleanupFile(req.files['sourceImage']?.[0]);
      cleanupFile(req.files['faceImage']?.[0]);
    }
    res.status(500).json({ error: error.message });
  }
});

// Animate avatar with lip-sync using LivePortrait
app.post('/api/animate-avatar', upload.fields([
  { name: 'avatarImage', maxCount: 1 },  // The avatar/face image
  { name: 'audioFile', maxCount: 1 }     // The audio file (mp3, wav, etc.)
]), async (req, res) => {
  try {
    const avatarFile = req.files['avatarImage']?.[0];
    const audioFile = req.files['audioFile']?.[0];

    if (!avatarFile) {
      return res.status(400).json({ error: 'Avatar image is required' });
    }
    if (!audioFile) {
      return res.status(400).json({ error: 'Audio file is required' });
    }

    const apiKey = (process.env.REPLICATE_API_TOKEN || '').trim();
    if (!apiKey) {
      return res.status(400).json({ error: 'REPLICATE_API_TOKEN not configured. Add it to your .env file.' });
    }

    console.log('Starting avatar animation with LivePortrait...');
    console.log('Avatar file:', avatarFile.originalname, 'size:', avatarFile.size);
    console.log('Audio file:', audioFile.originalname, 'size:', audioFile.size);

    // Convert files to base64 data URIs
    const avatarBase64 = fileToBase64DataUri(avatarFile);

    // For audio, we need to handle different mime types
    const audioBuffer = getFileBuffer(audioFile);
    const audioMimeType = audioFile.mimetype || 'audio/wav';
    const audioBase64 = `data:${audioMimeType};base64,${audioBuffer.toString('base64')}`;

    console.log('Avatar base64 length:', avatarBase64.length);
    console.log('Audio base64 length:', audioBase64.length);

    // Use LivePortrait model on Replicate
    // Model: lucataco/live-portrait - high quality lip-sync animation
    const LIVEPORTRAIT_VERSION = 'eaef9e673ab5c7e0e36f94be1c3e91321b0cf5820664c72c7c7dc48bbbb81add';

    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: LIVEPORTRAIT_VERSION,
        input: {
          face: avatarBase64,
          driving_audio: audioBase64,
          live_portrait_dsize: 512,
          live_portrait_scale: 2.3,
          video_frame_load_cap: 128,
          aniportrait_ref_image: avatarBase64,
          output_format: 'mp4',
          output_quality: 80
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Replicate API error:', response.status, errorText);
      throw new Error(`Replicate API error: ${errorText}`);
    }

    let prediction = await response.json();
    console.log('Animation prediction started:', prediction.id, 'status:', prediction.status);

    // Poll for completion (animations take longer than image generation)
    let pollCount = 0;
    const maxPolls = 300; // 5 minutes max
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && pollCount < maxPolls) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const pollResponse = await fetch(prediction.urls.get, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      prediction = await pollResponse.json();
      pollCount++;
      if (pollCount % 10 === 0) {
        console.log('Animation status:', prediction.status, `(poll ${pollCount})`);
      }
    }

    // Cleanup temp files
    cleanupFile(avatarFile);
    cleanupFile(audioFile);

    if (prediction.status === 'failed') {
      console.error('Animation failed:', prediction.error);
      throw new Error(prediction.error || 'Animation failed');
    }

    if (pollCount >= maxPolls) {
      throw new Error('Animation timed out after 5 minutes');
    }

    console.log('Animation succeeded, output:', prediction.output);

    res.json({
      success: true,
      video: prediction.output,
      predictionId: prediction.id
    });

  } catch (error) {
    console.error('Animation error:', error);
    // Cleanup on error
    if (req.files) {
      cleanupFile(req.files['avatarImage']?.[0]);
      cleanupFile(req.files['audioFile']?.[0]);
    }
    res.status(500).json({ error: error.message });
  }
});

// Analyze avatar photo with GPT-4 Vision - generates detailed appearance description
app.post('/api/analyze-avatar', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Avatar image is required' });
    }

    console.log('Analyzing avatar with GPT-4 Vision...');

    // Convert image to base64 (works with both memory and disk storage)
    const imageBuffer = getFileBuffer(req.file);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/png';

    const systemPrompt = `You are an artistic reference assistant. Describe this person's visual appearance in detail as if writing a character description for an illustrator or concept artist.

Focus on visual characteristics that help recreate a consistent character:
- Hair: color, texture, length, style
- General complexion and skin tone
- Eye color and shape
- Face shape and structure
- Any distinctive visual features like glasses, facial hair, jewelry
- Apparent style or aesthetic

Write a single flowing paragraph suitable for use as an artistic reference. Be descriptive and specific about colors, shapes, and visual details. Start directly with the description.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: systemPrompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
                detail: 'high'
              }
            }
          ]
        }
      ],
      max_tokens: 500
    });

    // Cleanup (only if using disk storage)
    cleanupFile(req.file);

    const description = response.choices[0].message.content;

    res.json({
      success: true,
      description: description
    });

  } catch (error) {
    console.error('Avatar analysis error:', error.message);
    console.error('Full error:', JSON.stringify(error, null, 2));
    cleanupFile(req.file);
    // Return more specific error messages
    let errorMessage = error.message || 'Unknown error';
    if (error.code === 'insufficient_quota') {
      errorMessage = 'OpenAI API quota exceeded';
    } else if (error.code === 'invalid_api_key') {
      errorMessage = 'Invalid OpenAI API key';
    } else if (error.status === 400) {
      errorMessage = 'Image could not be processed';
    }
    res.status(500).json({ error: errorMessage });
  }
});

// Generate image with face using InstantID (Replicate)
app.post('/api/generate-with-face', upload.single('faceImage'), async (req, res) => {
  try {
    const { prompt, negativePrompt, width, height } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'Face image is required' });
    }

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const apiKey = (process.env.REPLICATE_API_TOKEN || '').trim();
    if (!apiKey) {
      return res.status(400).json({ error: 'REPLICATE_API_TOKEN not configured' });
    }

    console.log('Generating with InstantID, prompt:', prompt);
    console.log('Face file:', req.file.originalname, 'size:', req.file.size);

    // Convert face image to base64 data URI (works with both memory and disk storage)
    const faceBase64 = fileToBase64DataUri(req.file);
    console.log('Face base64 length:', faceBase64.length);

    // Use InstantID model on Replicate (zsxkib/instant-id)
    // Using the versioned predictions endpoint which is more reliable
    const INSTANT_ID_VERSION = 'c98b2e7a196828d00955767813b81fc05c5c9b294c670c6d147d545fed4ceecf';

    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: INSTANT_ID_VERSION,
        input: {
          image: faceBase64,
          prompt: prompt,
          negative_prompt: negativePrompt || 'blurry, low quality, distorted face, bad anatomy, ugly, disfigured, different person, changed face',
          width: parseInt(width) || 1024,
          height: parseInt(height) || 1024,
          num_steps: 30,
          guidance_scale: 3,
          ip_adapter_scale: 1.0,
          controlnet_conditioning_scale: 0.9,
          enable_safety_checker: false
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Replicate InstantID API error:', response.status, errorText);
      throw new Error(`Replicate API error (${response.status}): ${errorText}`);
    }

    let prediction = await response.json();
    console.log('InstantID prediction started:', prediction.id, 'status:', prediction.status);

    // Poll for completion
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const pollResponse = await fetch(prediction.urls.get, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      prediction = await pollResponse.json();
      console.log('InstantID status:', prediction.status);
    }

    // Cleanup (only if using disk storage)
    cleanupFile(req.file);

    if (prediction.status === 'failed') {
      console.error('InstantID failed:', prediction.error);
      throw new Error(prediction.error || 'InstantID generation failed');
    }

    console.log('InstantID succeeded, output:', prediction.output);

    res.json({
      success: true,
      image: Array.isArray(prediction.output) ? prediction.output[0] : prediction.output,
      predictionId: prediction.id
    });

  } catch (error) {
    console.error('InstantID generation error:', error);
    cleanupFile(req.file);
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

// ============================================================================
// SUPABASE API ENDPOINTS
// ============================================================================

// Save/Update Avatar
app.post('/api/db/avatar', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { userId, imageData, description, enabled } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Upsert avatar data
    const { data, error } = await supabase
      .from('ai_tool_avatars')
      .upsert({
        user_id: userId,
        image_url: imageData, // Store base64 or URL
        description: description || '',
        enabled: enabled !== false,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, avatar: data });
  } catch (error) {
    console.error('Save avatar error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Avatar
app.get('/api/db/avatar/:userId', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from('ai_tool_avatars')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found

    res.json({ success: true, avatar: data || null });
  } catch (error) {
    console.error('Get avatar error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete Avatar
app.delete('/api/db/avatar/:userId', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { userId } = req.params;

    const { error } = await supabase
      .from('ai_tool_avatars')
      .delete()
      .eq('user_id', userId);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error('Delete avatar error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Save Thumbnail to History
app.post('/api/db/thumbnails', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { userId, imageUrl, prompt, style, model, referenceUsed, avatarUsed } = req.body;

    if (!userId || !imageUrl) {
      return res.status(400).json({ error: 'userId and imageUrl are required' });
    }

    const { data, error } = await supabase
      .from('ai_tool_thumbnails')
      .insert({
        user_id: userId,
        image_url: imageUrl,
        prompt: prompt || '',
        style: style || '',
        model: model || 'dall-e-3',
        reference_used: referenceUsed || false,
        avatar_used: avatarUsed || false
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, thumbnail: data });
  } catch (error) {
    console.error('Save thumbnail error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Thumbnail History
app.get('/api/db/thumbnails/:userId', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 20;

    const { data, error } = await supabase
      .from('ai_tool_thumbnails')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    res.json({ success: true, thumbnails: data || [] });
  } catch (error) {
    console.error('Get thumbnails error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete Thumbnail
app.delete('/api/db/thumbnails/:id', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('ai_tool_thumbnails')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error('Delete thumbnail error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Save User Settings
app.post('/api/db/settings', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { userId, defaultModel, defaultStyle, theme, settingsJson } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const { data, error } = await supabase
      .from('ai_tool_settings')
      .upsert({
        user_id: userId,
        default_model: defaultModel || 'dall-e-3',
        default_style: defaultStyle || '',
        theme: theme || 'dark',
        settings_json: settingsJson || {},
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, settings: data });
  } catch (error) {
    console.error('Save settings error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get User Settings
app.get('/api/db/settings/:userId', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from('ai_tool_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    res.json({ success: true, settings: data || null });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// VIDEO EDITOR PERSISTENCE
// ============================================================================

// Save Video Editor Settings (including avatar config)
app.post('/api/db/video-editor-settings', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { userId, avatarPhotoUrl, avatarEnabled, avatarPosition, avatarSize, avatarShape } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const { data, error } = await supabase
      .from('video_editor_settings')
      .upsert({
        user_id: userId,
        avatar_photo_url: avatarPhotoUrl,
        avatar_enabled: avatarEnabled || false,
        avatar_position: avatarPosition || 'bottom-right',
        avatar_size: avatarSize || 'medium',
        avatar_shape: avatarShape || 'circle',
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, settings: data });
  } catch (error) {
    console.error('Save video editor settings error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Video Editor Settings
app.get('/api/db/video-editor-settings/:userId', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from('video_editor_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    res.json({ success: true, settings: data || null });
  } catch (error) {
    console.error('Get video editor settings error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Save Cached Avatar Video (for reuse)
app.post('/api/db/avatar-video-cache', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { userId, audioHash, videoUrl, avatarPhotoHash, duration } = req.body;

    if (!userId || !audioHash || !videoUrl) {
      return res.status(400).json({ error: 'userId, audioHash, and videoUrl are required' });
    }

    const { data, error } = await supabase
      .from('avatar_video_cache')
      .upsert({
        user_id: userId,
        audio_hash: audioHash,
        avatar_photo_hash: avatarPhotoHash,
        video_url: videoUrl,
        duration: duration || 0,
        created_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,audio_hash'
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, cache: data });
  } catch (error) {
    console.error('Save avatar video cache error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Cached Avatar Video by audio hash
app.get('/api/db/avatar-video-cache/:userId/:audioHash', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { userId, audioHash } = req.params;

    const { data, error } = await supabase
      .from('avatar_video_cache')
      .select('*')
      .eq('user_id', userId)
      .eq('audio_hash', audioHash)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    res.json({ success: true, cache: data || null });
  } catch (error) {
    console.error('Get avatar video cache error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all cached avatar videos for user
app.get('/api/db/avatar-video-cache/:userId', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from('avatar_video_cache')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ success: true, cache: data || [] });
  } catch (error) {
    console.error('Get avatar video cache error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Check Supabase connection
app.get('/api/db/status', (req, res) => {
  res.json({
    connected: !!supabase,
    url: supabaseUrl ? supabaseUrl.replace(/https?:\/\//, '').split('.')[0] + '...' : null
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', hasApiKey: !!process.env.OPENAI_API_KEY, hasSupabase: !!supabase });
});

// Start server
app.listen(PORT, () => {
  console.log(`🎨 AI Image Tool running at http://localhost:${PORT}`);
  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️  Warning: OPENAI_API_KEY not set. Add it to .env file.');
  }
});
