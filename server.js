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
  // Ensure storage bucket exists
  (async () => {
    try {
      const { data: buckets } = await supabase.storage.listBuckets();
      const bucketExists = buckets?.some(b => b.name === 'ai-tool-images');
      if (!bucketExists) {
        const { error } = await supabase.storage.createBucket('ai-tool-images', {
          public: true,
          fileSizeLimit: 52428800 // 50MB
        });
        if (error) {
          console.log('Bucket creation note:', error.message);
        } else {
          console.log('Created ai-tool-images bucket');
        }
      } else {
        console.log('ai-tool-images bucket ready');
      }
    } catch (e) {
      console.log('Bucket check skipped:', e.message);
    }
  })();
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
// Increase JSON limit to handle base64-encoded images (up to 10MB)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
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

    // Use Replicate face-swap model (xiankgx/face-swap)
    const FACESWAP_VERSION = 'cff87316e31787df12002c9e20a78a017a36cb31fde9862d8dedd15ab29b7288';

    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: FACESWAP_VERSION,
        input: {
          local_target: sourceBase64,  // The image to modify (scene)
          local_source: faceBase64,    // The face to swap IN (user's avatar)
          weight: 1.0,                 // Full face replacement to preserve unique features
          det_thresh: 0.1              // Face detection threshold
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

    // xiankgx/face-swap returns {image: "url", msg: "succeed", ...}
    const outputImage = prediction.output?.image || prediction.output;

    res.json({
      success: true,
      image: outputImage,
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

    // Use p-video-avatar - ONLY model allowed (fast & cheap)
    // SadTalker REMOVED - cost $18+ in failed runs
    const PVIDEO_VERSION = '8a54bb678ef43a7a40950731bad3f33f4ac904267fecebd2186c826a6da6f5a5';

    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: PVIDEO_VERSION,
        input: {
          image: avatarBase64,
          audio: audioBase64,
          resolution: "720p",
          // Smooth motion prompt to reduce bouncy/jerky movements
          video_prompt: "Smooth, natural head movements. Subtle, gentle motion. Professional presenter style. Minimal head bobbing. Calm and steady posture. No sudden movements.",
          negative_prompt: "jerky movements, bouncing, shaking, twitching, rapid motion, jittery"
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

// Animate avatar with lip-sync using URLs (bypasses Vercel payload limit)
// VERSION: v4 - Download files and convert to base64 data URIs
app.post('/api/animate-avatar-url', async (req, res) => {
  console.log('*** AVATAR ENDPOINT VERSION: v4-base64 ***');
  try {
    let { avatarUrl, audioUrl } = req.body;

    if (!avatarUrl || !audioUrl) {
      return res.status(400).json({ error: 'Avatar URL and Audio URL are required' });
    }

    // Trim whitespace
    avatarUrl = String(avatarUrl).trim();
    audioUrl = String(audioUrl).trim();

    console.log('Avatar URL:', JSON.stringify(avatarUrl));
    console.log('Audio URL:', JSON.stringify(audioUrl));
    console.log('Avatar URL valid:', /^https?:\/\//.test(avatarUrl));
    console.log('Audio URL valid:', /^https?:\/\//.test(audioUrl));

    const apiKey = (process.env.REPLICATE_API_TOKEN || '').trim();
    if (!apiKey) {
      return res.status(400).json({ error: 'REPLICATE_API_TOKEN not configured' });
    }

    // Use p-video-avatar - fastest lip sync model (accepts URLs directly)
    // Make sure URLs are clean
    avatarUrl = avatarUrl.replace(/[\n\r]/g, '').trim();
    audioUrl = audioUrl.replace(/[\n\r]/g, '').trim();
    const PVIDEO_VERSION = '8a54bb678ef43a7a40950731bad3f33f4ac904267fecebd2186c826a6da6f5a5';

    const requestBody = {
      version: PVIDEO_VERSION,
      input: {
        image: avatarUrl,      // Uses URL directly (not base64)
        audio: audioUrl,       // Uses URL directly (not base64)
        resolution: "720p",
        // Smooth motion prompt to reduce bouncy/jerky movements
        video_prompt: "Smooth, natural head movements. Subtle, gentle motion. Professional presenter style. Minimal head bobbing. Calm and steady posture. No sudden movements.",
        negative_prompt: "jerky movements, bouncing, shaking, twitching, rapid motion, jittery"
      }
    };
    console.log('Sending to p-video-avatar with smooth motion settings...');

    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Replicate error (v4-base64):', response.status, errorText);
      throw new Error(`[v4] ${errorText}`);
    }

    let prediction = await response.json();
    console.log('Animation prediction started:', prediction.id, 'status:', prediction.status);

    // Return prediction ID immediately - frontend will poll for completion
    // p-video-avatar is fast (~2-3 min) but we still poll to avoid timeout
    res.json({
      success: true,
      predictionId: prediction.id,
      status: prediction.status,
      pollUrl: `/api/prediction-status/${prediction.id}`
    });

  } catch (error) {
    console.error('Animation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// MuseTalk endpoint - MUCH CHEAPER alternative (~$0.05 vs $2.25 per segment)
app.post('/api/animate-avatar-musetalk', async (req, res) => {
  console.log('*** MUSETALK ENDPOINT - CHEAP MODE ***');
  try {
    let { avatarUrl, audioUrl } = req.body;

    if (!avatarUrl || !audioUrl) {
      return res.status(400).json({ error: 'Avatar URL and Audio URL are required' });
    }

    avatarUrl = String(avatarUrl).trim().replace(/[\n\r]/g, '');
    audioUrl = String(audioUrl).trim().replace(/[\n\r]/g, '');

    console.log('MuseTalk - Avatar URL:', avatarUrl);
    console.log('MuseTalk - Audio URL:', audioUrl);

    const apiKey = (process.env.REPLICATE_API_TOKEN || '').trim();
    if (!apiKey) {
      return res.status(400).json({ error: 'REPLICATE_API_TOKEN not configured' });
    }

    // MuseTalk model (tmappdev/lipsync) - much cheaper and real-time speed
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: 'ab4afd0ce992de82b862fa4a9132fba4dbe849f4a629f0e1f3638f81fa81bfe1', // tmappdev/lipsync (MuseTalk)
        input: {
          face: avatarUrl,
          audio: audioUrl
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('MuseTalk error:', response.status, errorText);
      throw new Error(`MuseTalk: ${errorText}`);
    }

    let prediction = await response.json();
    console.log('MuseTalk prediction started:', prediction.id, 'status:', prediction.status);

    res.json({
      success: true,
      predictionId: prediction.id,
      status: prediction.status,
      model: 'musetalk',
      pollUrl: `/api/prediction-status/${prediction.id}`
    });

  } catch (error) {
    console.error('MuseTalk error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Poll for prediction status (for avatar generation)
app.get('/api/prediction-status/:predictionId', async (req, res) => {
  try {
    const { predictionId } = req.params;
    const apiKey = (process.env.REPLICATE_API_TOKEN || '').trim();

    const response = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (!response.ok) {
      throw new Error(`Failed to get prediction status: ${response.status}`);
    }

    const prediction = await response.json();

    res.json({
      status: prediction.status,
      output: prediction.output,
      error: prediction.error,
      logs: prediction.logs ? prediction.logs.slice(-500) : null
    });
  } catch (error) {
    console.error('Prediction status error:', error);
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
          num_steps: 20,
          guidance_scale: 3.5,
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

// Generate image with InstantID (character reference) - maintains identity while preserving art style
app.post('/api/generate-with-reference', upload.single('referenceImage'), async (req, res) => {
  try {
    const { prompt, negativePrompt, width, height, styleStrength } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'Reference image is required' });
    }

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const apiKey = (process.env.REPLICATE_API_TOKEN || '').trim();
    if (!apiKey) {
      return res.status(400).json({ error: 'REPLICATE_API_TOKEN not configured' });
    }

    console.log('Generating with InstantID reference, prompt:', prompt);

    // Convert reference image to base64 data URI
    const refBase64 = fileToBase64DataUri(req.file);

    // InstantID works best at 1024x1024 or similar SDXL dimensions
    let finalWidth = parseInt(width) || 1024;
    let finalHeight = parseInt(height) || 1024;
    // Cap to 1280 max for InstantID (SDXL-based)
    if (finalWidth > 1280) {
      const ratio = 1280 / finalWidth;
      finalWidth = 1280;
      finalHeight = Math.round(finalHeight * ratio);
    }
    if (finalHeight > 1280) {
      const ratio = 1280 / finalHeight;
      finalHeight = 1280;
      finalWidth = Math.round(finalWidth * ratio);
    }
    // Ensure dimensions are multiples of 8
    finalWidth = Math.round(finalWidth / 8) * 8;
    finalHeight = Math.round(finalHeight / 8) * 8;
    console.log(`InstantID dimensions: ${finalWidth}x${finalHeight} (requested: ${width}x${height})`);

    // Using InstantID which better preserves artistic style while maintaining identity
    // Lower ip_adapter_scale and controlnet_conditioning_scale = more style preservation
    const INSTANTID_VERSION = '491ddf5be6b827f8931f088ef10c6d015f6d99685e6454e6f04c8ac298979686';

    // Style strength: 'high' = prioritize identity, 'low' = prioritize style
    // For illustrated/animated avatars, lower values preserve art style better
    const identityStrength = styleStrength === 'high' ? 0.8 : 0.35;

    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: INSTANTID_VERSION,
        input: {
          image: refBase64,
          prompt: prompt,
          negative_prompt: negativePrompt || 'blurry, low quality, distorted, bad anatomy, ugly, deformed',
          width: finalWidth,
          height: finalHeight,
          num_inference_steps: 30,
          guidance_scale: 5,
          ip_adapter_scale: identityStrength,  // Lower = more style preservation
          controlnet_conditioning_scale: identityStrength,  // Lower = more artistic freedom
          enhance_nonface_region: true,  // Keep artistic style in body/background
          enable_pose_controlnet: false,  // Don't force pose from reference
          num_outputs: 1,
          output_format: 'png',
          output_quality: 90,
          disable_safety_checker: true
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('InstantID API error:', response.status, errorText);
      throw new Error(`Replicate API error (${response.status}): ${errorText}`);
    }

    let prediction = await response.json();
    console.log('InstantID prediction started:', prediction.id);

    // Poll for completion
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const pollResponse = await fetch(prediction.urls.get, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      prediction = await pollResponse.json();
      console.log('InstantID status:', prediction.status);
    }

    cleanupFile(req.file);

    if (prediction.status === 'failed') {
      console.error('InstantID failed:', prediction.error);
      throw new Error(prediction.error || 'InstantID generation failed');
    }

    console.log('InstantID succeeded');

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

// Upload audio to Supabase Storage
app.post('/api/upload-audio', audioUpload.single('audio'), async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file is required' });
    }

    const fileBuffer = fs.readFileSync(req.file.path);
    const fileName = `audio_${Date.now()}_${req.file.originalname || 'audio.mp3'}`;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('ai-tool-images')
      .upload(`audio/${fileName}`, fileBuffer, {
        contentType: req.file.mimetype || 'audio/mpeg',
        upsert: true
      });

    // Cleanup local file
    fs.unlinkSync(req.file.path);

    if (error) throw error;

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('ai-tool-images')
      .getPublicUrl(`audio/${fileName}`);

    res.json({ success: true, url: urlData.publicUrl, path: data.path });
  } catch (error) {
    console.error('Audio upload error:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: error.message });
  }
});

// Transcribe audio from URL (for large files uploaded to Supabase)
app.post('/api/transcribe-url', async (req, res) => {
  try {
    const { audioUrl } = req.body;

    if (!audioUrl) {
      return res.status(400).json({ error: 'audioUrl is required' });
    }

    console.log('Transcribing audio from URL:', audioUrl);

    // Download audio from URL
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error('Failed to download audio from URL');
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Detect file extension from URL or content-type
    let ext = 'm4a'; // Default to m4a
    const urlPath = new URL(audioUrl).pathname;
    console.log('Audio URL path:', urlPath);

    // Try to get extension from URL path
    const urlParts = urlPath.split('.');
    const urlExt = urlParts.length > 1 ? urlParts.pop()?.toLowerCase() : null;
    console.log('Detected URL extension:', urlExt);

    if (urlExt && ['m4a', 'mp3', 'wav', 'ogg', 'flac', 'webm', 'mp4', 'mpeg', 'mpga', 'oga'].includes(urlExt)) {
      ext = urlExt;
    } else {
      // Try content-type header
      const contentType = response.headers.get('content-type') || '';
      console.log('Content-Type header:', contentType);
      if (contentType.includes('m4a') || contentType.includes('mp4') || contentType.includes('x-m4a')) ext = 'm4a';
      else if (contentType.includes('wav') || contentType.includes('wave')) ext = 'wav';
      else if (contentType.includes('ogg') || contentType.includes('oga')) ext = 'ogg';
      else if (contentType.includes('webm')) ext = 'webm';
      else if (contentType.includes('mpeg') || contentType.includes('mp3')) ext = 'mp3';
      else if (contentType.includes('flac')) ext = 'flac';
      // Otherwise keep m4a default
    }

    // Save to temp file with correct extension
    const tempPath = `/tmp/audio_${Date.now()}.${ext}`;
    fs.writeFileSync(tempPath, buffer);
    console.log('Saved audio to temp file:', tempPath, 'extension:', ext, 'size:', buffer.length);

    // Transcribe with Whisper - force English to avoid wrong language detection
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: 'whisper-1',
      language: 'en',  // Force English
      response_format: 'verbose_json',
      timestamp_granularities: ['segment', 'word']
    });

    // Cleanup
    fs.unlinkSync(tempPath);

    res.json({
      success: true,
      transcription: transcription.text,
      segments: transcription.segments,
      words: transcription.words
    });

  } catch (error) {
    console.error('Transcription error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Transcribe audio using base64 (more reliable on Vercel)
app.post('/api/transcribe-base64', express.json({ limit: '50mb' }), async (req, res) => {
  let tempPath = null;
  try {
    const { audio, extension, scenes } = req.body;

    if (!audio) {
      return res.status(400).json({ error: 'audio (base64) is required' });
    }

    console.log('Transcribing base64 audio, extension:', extension, 'scenes:', scenes?.length);

    // Decode base64 to buffer
    const base64Data = audio.replace(/^data:audio\/\w+;base64,/, '');
    const fileBuffer = Buffer.from(base64Data, 'base64');
    console.log('Decoded buffer length:', fileBuffer.length);

    // Save to temp file
    const ext = extension || 'mp3';
    tempPath = `/tmp/transcribe_${Date.now()}.${ext}`;
    fs.writeFileSync(tempPath, fileBuffer);
    console.log('Saved to temp file:', tempPath);

    // Transcribe with Whisper
    console.log('Calling OpenAI Whisper API...');
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: 'whisper-1',
      language: 'en',
      response_format: 'verbose_json'
    });
    console.log('Transcription received, segments:', transcription.segments?.length);

    // Cleanup temp file
    if (tempPath && fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }

    // Parse scenes if provided
    const sceneList = scenes || [];

    // If no scenes provided, just return the transcription
    if (sceneList.length === 0) {
      return res.json({
        success: true,
        transcription: transcription.text,
        segments: transcription.segments
      });
    }

    // Match scenes to transcription
    const sceneTimings = matchScenesToTranscription(sceneList, transcription);

    res.json({
      success: true,
      transcription: transcription.text,
      segments: transcription.segments,
      sceneTimings
    });

  } catch (error) {
    console.error('Transcription error:', error.message);
    if (tempPath && fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    res.status(500).json({ error: error.message });
  }
});

// Transcribe audio using Whisper API with timestamps (file upload version)
app.post('/api/transcribe', audioUpload.single('audio'), async (req, res) => {
  let tempPath = null;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file is required' });
    }

    console.log('Transcribing audio:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      hasBuffer: !!req.file.buffer,
      bufferLength: req.file.buffer?.length,
      hasPath: !!req.file.path
    });

    // Get scene descriptions from request body
    const scenes = req.body.scenes ? JSON.parse(req.body.scenes) : [];

    // Get file buffer (works for both local disk and Vercel memory storage)
    const fileBuffer = getFileBuffer(req.file);
    console.log('File buffer obtained, length:', fileBuffer.length);

    // Determine extension from originalname or mimetype
    let extension = 'mp3';
    if (req.file.originalname) {
      const match = req.file.originalname.match(/\.(\w+)$/);
      if (match) extension = match[1];
    } else if (req.file.mimetype) {
      if (req.file.mimetype.includes('wav')) extension = 'wav';
      else if (req.file.mimetype.includes('webm')) extension = 'webm';
      else if (req.file.mimetype.includes('m4a')) extension = 'm4a';
      else if (req.file.mimetype.includes('ogg')) extension = 'ogg';
    }

    // Save to temp file (required for OpenAI SDK on serverless)
    tempPath = `/tmp/transcribe_${Date.now()}.${extension}`;
    fs.writeFileSync(tempPath, fileBuffer);
    console.log('Saved audio to temp file:', tempPath, 'size:', fileBuffer.length);

    // Transcribe with Whisper - request segment timestamps, force English
    console.log('Calling OpenAI Whisper API...');
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: 'whisper-1',
      language: 'en',
      response_format: 'verbose_json'
    });
    console.log('Transcription received, segments:', transcription.segments?.length);

    // Cleanup temp file
    if (tempPath && fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    // Cleanup original upload if on disk
    if (req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

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
    console.error('Transcription error:', error.message);
    console.error('Full error:', JSON.stringify(error, null, 2));
    // Cleanup temp file on error
    if (tempPath && fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    // Cleanup original upload if on disk
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({
      error: error.message,
      details: error.response?.data || error.code || 'Unknown error'
    });
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
      // Apply anticipation offset - show scene BEFORE the words are spoken
      // This creates a more natural viewing experience where you see the image
      // just before or as the narrator talks about it
      const anticipationOffset = 1.0; // seconds before speech
      const adjustedStart = Math.max(0, bestMatch.start - anticipationOffset);
      sceneTimings.push({
        sceneIndex,
        startTime: adjustedStart,
        endTime: bestMatch.end,
        duration: bestMatch.end - adjustedStart,
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

  // Ensure scenes are contiguous - each scene ends when the next one starts
  const totalDuration = transcription.duration || (segments.length > 0 ? segments[segments.length - 1].end : 0);

  // First pass: fill in unmatched scenes with interpolated start times
  let lastKnownTime = 0;
  sceneTimings.forEach((timing, index) => {
    if (timing.startTime === null) {
      // Find next matched scene to interpolate
      let nextMatchedIndex = index + 1;
      while (nextMatchedIndex < sceneTimings.length && sceneTimings[nextMatchedIndex].startTime === null) {
        nextMatchedIndex++;
      }

      const nextStartTime = nextMatchedIndex < sceneTimings.length ? sceneTimings[nextMatchedIndex].startTime : totalDuration;
      const gapDuration = nextStartTime - lastKnownTime;
      const unmatchedCount = nextMatchedIndex - index;
      const durationPerScene = gapDuration / unmatchedCount;

      timing.startTime = lastKnownTime + (durationPerScene * (index - (nextMatchedIndex - unmatchedCount)));
    }
    lastKnownTime = timing.startTime;
  });

  // Second pass: make scenes contiguous (each ends when next starts)
  // This ensures no gaps or overlaps
  for (let i = 0; i < sceneTimings.length; i++) {
    if (i < sceneTimings.length - 1) {
      // Scene ends when next scene starts
      sceneTimings[i].endTime = sceneTimings[i + 1].startTime;
    } else {
      // Last scene ends at audio end
      sceneTimings[i].endTime = totalDuration;
    }
    sceneTimings[i].duration = sceneTimings[i].endTime - sceneTimings[i].startTime;
  }

  // Log for debugging
  console.log('Scene timings:', sceneTimings.map(t => ({
    scene: t.sceneIndex + 1,
    start: t.startTime?.toFixed(2),
    end: t.endTime?.toFixed(2),
    duration: t.duration?.toFixed(2),
    matched: t.matchedText?.substring(0, 30)
  })));

  return sceneTimings;
}

// Convert script text to visual scene descriptions using GPT
app.post('/api/script-to-scenes', async (req, res) => {
  try {
    const { script, sceneCount = 10, brandRules = null, style = 'professional', includeAvatarInScenes = false, avatarDescription = null } = req.body;

    if (!script) {
      return res.status(400).json({ error: 'Script text is required' });
    }

    console.log(`Converting script to ${sceneCount} visual scenes... (Avatar in scenes: ${includeAvatarInScenes})`);

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
7. Focus on emotions, body language, and visual metaphors for abstract concepts

DEFAULT CONTENT TO AVOID (unless specifically requested):
- Tarot cards, oracle cards, divination tools
- Crystals, gemstones, healing stones
- Occult symbols, pentagrams, mystical sigils
- Astrology symbols, zodiac imagery
- Magic, witchcraft, spellcasting imagery
- New age spirituality aesthetics
Instead use: professional business settings, modern technology, nature metaphors, human connection moments`;

    // Add avatar as main character if included
    if (includeAvatarInScenes && avatarDescription) {
      systemPrompt += `

MAIN CHARACTER - FEATURE THIS PERSON IN EVERY SCENE:
${avatarDescription}

CRITICAL - CHARACTER INTEGRATION RULES:
1. This character is the MAIN SUBJECT of every scene - they should be ACTING OUT the concepts
2. Do NOT show static poses or portrait shots - show the character IN ACTION
3. Match scenes to script content:
   - If script mentions "sales conversation" → show character talking to a client, gesturing, presenting
   - If script mentions "closing a deal" → show character shaking hands, celebrating, signing papers
   - If script mentions "overcoming objections" → show character listening intently, nodding, responding
   - If script mentions "building rapport" → show character laughing with someone, mirroring body language
   - If script mentions "following up" → show character on phone, at computer, writing notes
4. Use visual metaphors WITH the character:
   - "Breaking through barriers" → character pushing through a door/wall
   - "Building trust" → character building something, constructing
   - "Climbing the ladder" → character actually climbing, ascending stairs
5. Vary the character's position, pose, and action in each scene - no repetition
6. Show the character from different angles: front, side, over-shoulder, medium shots, close-ups of hands/expressions
7. The character should express emotions matching the script: confident, empathetic, excited, thoughtful`;
    }

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

// Expand scene descriptor beats into detailed scene variations using AI
app.post('/api/expand-scene-beats', async (req, res) => {
  try {
    const { sceneDescriptor, avatarDescription, targetSceneCount = 46 } = req.body;

    if (!sceneDescriptor) {
      return res.status(400).json({ error: 'Scene descriptor is required' });
    }

    console.log(`Expanding scene beats to ${targetSceneCount} scenes with AI...`);

    const systemPrompt = `You are a visual director expanding concept beats into detailed image prompts.

The user has provided HIGH-LEVEL CONCEPT BEATS (like S1, S2, etc.) that describe the narrative flow of their video.
Your job is to expand these into EXACTLY ${targetSceneCount} individual scene descriptions, distributed across the concept beats.

RULES:
1. Distribute scenes proportionally across the beats (more scenes for longer/more complex beats)
2. Each scene must be a unique, specific visual moment - NO duplicates
3. For each beat, create variations: different camera angles, moments in time, focus points
4. Replace [AVATAR] with: ${avatarDescription || 'the main character'}
5. Remove [METAPHOR], [TEXT], [CTA] tags but honor their intent in the visuals
6. Each scene description should be 1-3 sentences, highly specific and visual
7. Vary shot types: wide establishing shots, medium shots, close-ups, over-shoulder, detail shots
8. Progress the action within each beat - show the sequence of moments

OUTPUT FORMAT - Return a JSON object:
{
  "beatsCount": <number of concept beats parsed>,
  "scenes": [
    {
      "sceneNumber": 1,
      "beatNumber": 1,
      "visualDescription": "Detailed visual description...",
      "mood": "warm|tense|calm|conceptual|closing"
    }
  ]
}

Only output the JSON, no other text.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Expand these concept beats into exactly ${targetSceneCount} scene descriptions:\n\n${sceneDescriptor}` }
      ],
      temperature: 0.7,
      max_tokens: 8000
    });

    let result;
    try {
      const responseText = completion.choices[0].message.content.trim();
      const jsonText = responseText.replace(/^```json\n?|\n?```$/g, '').trim();
      result = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('Failed to parse AI response:', completion.choices[0].message.content);
      throw new Error('Failed to parse scene expansions from AI response');
    }

    // Post-process: Ensure [AVATAR] is replaced in all scene descriptions
    const avatarReplacement = avatarDescription || 'the main character';
    if (result.scenes && Array.isArray(result.scenes)) {
      result.scenes = result.scenes.map(scene => ({
        ...scene,
        visualDescription: scene.visualDescription
          ? scene.visualDescription.replace(/\[AVATAR\]/gi, avatarReplacement)
          : scene.visualDescription
      }));
      console.log(`Post-processed ${result.scenes.length} scenes, replaced [AVATAR] with avatar description`);
    }

    res.json({
      success: true,
      scenes: result.scenes,
      beatsCount: result.beatsCount,
      totalScenes: result.scenes.length
    });

  } catch (error) {
    console.error('Expand scene beats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// AI-powered scene-to-audio synchronization using GPT-4o
// This endpoint analyzes scene descriptions and transcript to intelligently place scenes
app.post('/api/ai-sync-scenes', async (req, res) => {
  try {
    const { scenes, segments, totalDuration } = req.body;

    if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
      return res.status(400).json({ error: 'Scenes array is required' });
    }
    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return res.status(400).json({ error: 'Transcript segments are required' });
    }
    if (!totalDuration || totalDuration <= 0) {
      return res.status(400).json({ error: 'Valid totalDuration is required' });
    }

    console.log(`AI Sync: ${scenes.length} scenes to ${segments.length} segments over ${totalDuration.toFixed(1)}s`);

    // Build a condensed transcript with timestamps
    const transcriptSummary = segments.map((seg, i) => {
      const start = seg.start?.toFixed(1) || '0';
      const end = seg.end?.toFixed(1) || start;
      return `[${start}s-${end}s]: "${seg.text?.trim() || ''}"`;
    }).join('\n');

    // Build scene descriptions
    const sceneDescriptions = scenes.map((scene, i) => {
      const text = [
        scene.text || '',
        scene.caption || '',
        scene.prompt || '',
        scene.description || ''
      ].filter(t => t).join(' | ');
      return `Scene ${i + 1}: ${text.substring(0, 200)}`;
    }).join('\n');

    // Calculate base duration per scene
    const baseDuration = totalDuration / scenes.length;
    const minDuration = Math.max(3, totalDuration * 0.008);

    const systemPrompt = `Match ${scenes.length} video scenes to their spoken lines in this ${totalDuration.toFixed(1)}-second audio.

IMPORTANT: Each scene was GENERATED FROM the script. The scene's text IS the script excerpt that should be spoken at that moment.

TRANSCRIPT (with timestamps):
${transcriptSummary}

SCENES (each contains its SCRIPT TEXT):
${sceneDescriptions}

YOUR TASK - For each scene:
1. Find where the scene's TEXT appears (or is paraphrased) in the transcript
2. Return the EXACT timestamp where those words BEGIN to be spoken
3. We will automatically shift scenes earlier - just give us the spoken time
4. Scenes MUST stay in order: Scene 1, then 2, then 3, etc.

MATCHING TIPS:
- Scene text "financial cushion" → find when "cushion" or "financial" is spoken
- Scene text "emergency fund" → find when "emergency" or "fund" is spoken
- Match KEY WORDS from scene text to transcript timestamps

RULES:
- Scene 1 MUST start at 0.0s
- Each scene ends when the next begins (no gaps)
- Keep scenes in SEQUENTIAL order (1,2,3,4... never skip around)
- Last scene ends at ${totalDuration.toFixed(1)}s
- Min duration: ${minDuration.toFixed(1)}s

OUTPUT - JSON array (scenes in order 0 to ${scenes.length - 1}):
[
  { "sceneIndex": 0, "startTime": 0.0, "duration": X, "reason": "text matches at Xs" },
  { "sceneIndex": 1, "startTime": X, "duration": Y, "reason": "text matches at Ys" }
]

Return ONLY the JSON array.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a professional video editor with expertise in timing visual content to audio narratives. Always respond with valid JSON only.' },
        { role: 'user', content: systemPrompt }
      ],
      temperature: 0.3, // Lower temperature for more consistent timing
      max_tokens: 4000
    });

    let timings;
    try {
      const responseText = completion.choices[0].message.content.trim();
      // Handle potential markdown code blocks
      const jsonText = responseText.replace(/^```json\n?|\n?```$/g, '').trim();
      timings = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('Failed to parse AI response:', completion.choices[0].message.content);
      throw new Error('Failed to parse scene timings from AI response');
    }

    // Validate and fix timings
    if (!Array.isArray(timings) || timings.length === 0) {
      throw new Error('AI returned invalid timings format');
    }

    // ENFORCE SEQUENTIAL ORDER: Scenes must go 0, 1, 2, 3... not reordered
    // minDuration and baseDuration already declared above
    const ANTICIPATION = 3.0; // Show scene 3 seconds BEFORE words are spoken
    const validatedTimings = [];

    // First pass: Use AI's startTime but shift earlier by anticipation
    for (let i = 0; i < scenes.length; i++) {
      const aiTiming = timings.find(t => t.sceneIndex === i);

      // Get AI's suggested time (when words are spoken) and shift EARLIER
      let startTime;
      if (aiTiming && typeof aiTiming.startTime === 'number') {
        // Shift earlier by anticipation, but not before 0
        startTime = Math.max(0, aiTiming.startTime - ANTICIPATION);
      } else {
        // Fallback to proportional
        startTime = (i / scenes.length) * totalDuration;
      }

      validatedTimings.push({
        sceneIndex: i,
        startTime: startTime,
        duration: aiTiming?.duration || baseDuration,
        reason: aiTiming?.reason || 'Sequential placement'
      });
    }

    // Second pass: Keep AI's startTime (when words are spoken), but extend duration to fill gaps
    // Sort by startTime so scenes are in chronological order
    validatedTimings.sort((a, b) => a.startTime - b.startTime);

    // Each scene's duration extends until the NEXT scene starts (fills gaps naturally)
    for (let i = 0; i < validatedTimings.length; i++) {
      const timing = validatedTimings[i];

      if (i < validatedTimings.length - 1) {
        // Duration extends until next scene starts
        const nextStart = validatedTimings[i + 1].startTime;
        timing.duration = Math.max(minDuration, nextStart - timing.startTime);
      } else {
        // Last scene extends to end of audio
        timing.duration = Math.max(minDuration, totalDuration - timing.startTime);
      }
    }

    // Re-sort by sceneIndex for consistent output
    validatedTimings.sort((a, b) => a.sceneIndex - b.sceneIndex);

    // Log to verify order
    console.log('Scene order check:', validatedTimings.slice(0, 5).map(t =>
      `S${t.sceneIndex}@${t.startTime.toFixed(1)}s`
    ).join(' → '));

    // Adjust if we exceed total duration
    const totalUsed = validatedTimings.reduce((sum, t) => sum + t.duration, 0);
    if (totalUsed > totalDuration) {
      const scale = totalDuration / totalUsed;
      let runningTime = 0;
      for (const timing of validatedTimings) {
        timing.startTime = runningTime;
        timing.duration = Math.max(minDuration, timing.duration * scale);
        runningTime += timing.duration;
      }
    }

    // Ensure last scene ends at total duration
    const lastScene = validatedTimings[validatedTimings.length - 1];
    if (lastScene) {
      lastScene.duration = totalDuration - lastScene.startTime;
    }

    console.log('AI Sync complete. Sample timings:', validatedTimings.slice(0, 3).map(t =>
      `Scene ${t.sceneIndex}: ${t.startTime.toFixed(1)}s (${t.reason})`
    ));

    res.json({
      success: true,
      timings: validatedTimings,
      totalScenes: validatedTimings.length
    });

  } catch (error) {
    console.error('AI sync scenes error:', error);
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

    // DOWNLOAD VIDEO AND STORE IN SUPABASE STORAGE (permanent URL)
    let permanentUrl = videoUrl;
    try {
      console.log('Downloading video from Replicate:', videoUrl);
      const videoResponse = await fetch(videoUrl);
      if (videoResponse.ok) {
        const videoBuffer = await videoResponse.arrayBuffer();
        const videoPath = `avatar-videos/${userId}/${audioHash}.mp4`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('ai-tool-images')
          .upload(videoPath, Buffer.from(videoBuffer), {
            contentType: 'video/mp4',
            upsert: true
          });

        if (!uploadError) {
          permanentUrl = `${supabaseUrl}/storage/v1/object/public/ai-tool-images/${videoPath}`;
          console.log('Video stored permanently:', permanentUrl);
        } else {
          console.error('Storage upload error:', uploadError);
        }
      }
    } catch (downloadErr) {
      console.error('Video download error:', downloadErr);
      // Fall back to storing original URL
    }

    const { data, error } = await supabase
      .from('avatar_video_cache')
      .upsert({
        user_id: userId,
        audio_hash: audioHash,
        avatar_photo_hash: avatarPhotoHash,
        video_url: permanentUrl,
        original_url: videoUrl,
        duration: duration || 0,
        created_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,audio_hash'
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, cache: data, permanentUrl });
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

// ============================================
// AVATAR SEGMENTS STORAGE (SUPABASE)
// ============================================

// Save avatar segment to Supabase
app.post('/api/db/avatar-segments', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { userId, segmentNum, videoUrl, fileName } = req.body;

    if (!userId || segmentNum === undefined || !videoUrl) {
      return res.status(400).json({ error: 'userId, segmentNum, and videoUrl are required' });
    }

    const { data, error } = await supabase
      .from('avatar_segments')
      .upsert({
        user_id: userId,
        segment_num: segmentNum,
        video_url: videoUrl,
        file_name: fileName || `segment-${segmentNum}.mp4`,
        created_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,segment_num'
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, segment: data });
  } catch (error) {
    console.error('Save avatar segment error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all avatar segments for user
app.get('/api/db/avatar-segments/:userId', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from('avatar_segments')
      .select('*')
      .eq('user_id', userId)
      .order('segment_num', { ascending: true });

    if (error) throw error;

    res.json({ success: true, segments: data || [] });
  } catch (error) {
    console.error('Get avatar segments error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete all avatar segments for user (for cleanup)
app.delete('/api/db/avatar-segments/:userId', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { userId } = req.params;

    const { error } = await supabase
      .from('avatar_segments')
      .delete()
      .eq('user_id', userId);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error('Delete avatar segments error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// BRAND RULES STORAGE (SUPABASE)
// ============================================

// Save brand rules to Supabase
app.post('/api/db/brand-rules', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { userId, mood, lighting, colors, avoid, enabled } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const { data, error } = await supabase
      .from('brand_rules')
      .upsert({
        user_id: userId,
        mood: mood || '',
        lighting: lighting || '',
        colors: colors || '',
        avoid: avoid || '',
        enabled: enabled || false,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, brandRules: data });
  } catch (error) {
    console.error('Save brand rules error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get brand rules for user
app.get('/api/db/brand-rules/:userId', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from('brand_rules')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    res.json({ success: true, brandRules: data || null });
  } catch (error) {
    console.error('Get brand rules error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// BATCH SCENES STORAGE (SUPABASE)
// ============================================

// Save batch scenes to Supabase
app.post('/api/db/batch-scenes', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { userId, batchId, scenes, audioUrl, audioFileName } = req.body;

    if (!userId || !batchId || !scenes || !Array.isArray(scenes)) {
      return res.status(400).json({ error: 'userId, batchId, and scenes array required' });
    }

    // Prepare scene records (store audioUrl in first scene's style field as JSON for retrieval)
    const sceneRecords = scenes.map((scene, index) => ({
      user_id: userId,
      batch_id: batchId,
      scene_index: index,
      image_url: scene.imageUrl,
      prompt: scene.text || scene.prompt || '',
      style: index === 0 && audioUrl ? JSON.stringify({ audioUrl, audioFileName, originalStyle: scene.style || '' }) : (scene.style || ''),
      model: scene.model || 'unknown'
    }));

    // Insert all scenes
    const { data, error } = await supabase
      .from('ai_tool_batch_scenes')
      .insert(sceneRecords)
      .select();

    if (error) throw error;

    console.log(`Saved ${sceneRecords.length} scenes to Supabase for batch ${batchId}`);
    res.json({ success: true, count: sceneRecords.length });
  } catch (error) {
    console.error('Save batch scenes error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get batch scenes history for user
app.get('/api/db/batch-scenes/:userId', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from('ai_tool_batch_scenes')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Group by batch_id
    const batches = {};
    (data || []).forEach(scene => {
      if (!batches[scene.batch_id]) {
        batches[scene.batch_id] = {
          batchId: scene.batch_id,
          createdAt: scene.created_at,
          scenes: []
        };
      }
      batches[scene.batch_id].scenes.push({
        index: scene.scene_index,
        imageUrl: scene.image_url,
        text: scene.prompt,
        style: scene.style,
        model: scene.model
      });
    });

    // Sort scenes within each batch by index
    Object.values(batches).forEach(batch => {
      batch.scenes.sort((a, b) => a.index - b.index);
    });

    res.json({ success: true, batches: Object.values(batches) });
  } catch (error) {
    console.error('Get batch scenes error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get specific batch
app.get('/api/db/batch-scenes/:userId/:batchId', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { userId, batchId } = req.params;

    const { data, error } = await supabase
      .from('ai_tool_batch_scenes')
      .select('*')
      .eq('user_id', userId)
      .eq('batch_id', batchId)
      .order('scene_index', { ascending: true });

    if (error) throw error;

    // Extract audioUrl from first scene's style field if it's JSON
    let audioUrl = null;
    let audioFileName = null;
    if (data && data.length > 0 && data[0].style) {
      try {
        const styleData = JSON.parse(data[0].style);
        if (styleData.audioUrl) {
          audioUrl = styleData.audioUrl;
          audioFileName = styleData.audioFileName;
          // Restore original style
          data[0].style = styleData.originalStyle || '';
        }
      } catch (e) {
        // Not JSON, that's fine - just regular style
      }
    }

    const scenes = (data || []).map(scene => ({
      index: scene.scene_index,
      imageUrl: scene.image_url,
      text: scene.prompt,
      style: scene.style,
      model: scene.model
    }));

    res.json({ success: true, scenes, audioUrl, audioFileName });
  } catch (error) {
    console.error('Get batch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete a batch
app.delete('/api/db/batch-scenes/:userId/:batchId', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { userId, batchId } = req.params;

    const { error } = await supabase
      .from('ai_tool_batch_scenes')
      .delete()
      .eq('user_id', userId)
      .eq('batch_id', batchId);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error('Delete batch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cleanup duplicates - keep only the most recent batch
app.post('/api/db/batch-scenes/:userId/cleanup', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const { userId } = req.params;

    // Get all batches for user
    const { data: allScenes, error: fetchError } = await supabase
      .from('ai_tool_batch_scenes')
      .select('batch_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (fetchError) throw fetchError;

    // Group by batch_id and find unique batches
    const batches = {};
    (allScenes || []).forEach(scene => {
      if (!batches[scene.batch_id]) {
        batches[scene.batch_id] = scene.created_at;
      }
    });

    const batchIds = Object.keys(batches);

    if (batchIds.length <= 1) {
      return res.json({ success: true, message: 'No duplicates to clean', kept: batchIds[0] || null, deleted: 0 });
    }

    // Keep the most recent batch, delete the rest
    const mostRecentBatch = batchIds[0]; // Already sorted by created_at desc
    const batchesToDelete = batchIds.slice(1);

    let deletedCount = 0;
    for (const batchId of batchesToDelete) {
      const { error: deleteError } = await supabase
        .from('ai_tool_batch_scenes')
        .delete()
        .eq('user_id', userId)
        .eq('batch_id', batchId);

      if (!deleteError) deletedCount++;
    }

    console.log(`Cleaned up ${deletedCount} old batches for user ${userId}, kept ${mostRecentBatch}`);
    res.json({ success: true, kept: mostRecentBatch, deleted: deletedCount });
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// IMAGE-TO-VIDEO GENERATION
// ============================================

// Generate video from static image using AI
app.post('/api/image-to-video', async (req, res) => {
  try {
    const { imageUrl, prompt, duration = 5 } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: 'imageUrl is required' });
    }

    const apiKey = (process.env.REPLICATE_API_TOKEN || '').trim();
    if (!apiKey) {
      return res.status(400).json({ error: 'REPLICATE_API_TOKEN not configured' });
    }

    console.log('Generating video from image, prompt:', prompt || 'subtle motion');

    // Using minimax/video-01 for good quality image-to-video
    // Alternative: stability-ai/stable-video-diffusion
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: 'c8bcc4751328608bb75043b3af7bed539aa2c165d8dcf45987f7cc002482f8e4', // minimax/video-01
        input: {
          prompt: prompt || 'cinematic motion, subtle movement, camera pan, professional video',
          first_frame_image: imageUrl,
          prompt_optimizer: true
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Video API error:', response.status, errorText);
      throw new Error(`Replicate API error (${response.status}): ${errorText}`);
    }

    let prediction = await response.json();
    console.log('Video generation started:', prediction.id);

    // Poll for completion
    const maxAttempts = 120; // 10 minutes max (video takes longer)
    let attempts = 0;

    while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Check every 5 seconds
      attempts++;

      const pollResponse = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });

      if (!pollResponse.ok) {
        throw new Error(`Poll request failed: ${pollResponse.status}`);
      }

      prediction = await pollResponse.json();
      console.log(`Video generation status: ${prediction.status} (attempt ${attempts})`);
    }

    if (prediction.status === 'failed') {
      throw new Error(prediction.error || 'Video generation failed');
    }

    if (prediction.status !== 'succeeded') {
      throw new Error('Video generation timed out');
    }

    console.log('Video generated successfully:', prediction.output);

    res.json({
      success: true,
      videoUrl: prediction.output,
      predictionId: prediction.id
    });

  } catch (error) {
    console.error('Image-to-video error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Batch generate videos from multiple images
app.post('/api/image-to-video/batch', async (req, res) => {
  try {
    const { scenes, motionPrompt } = req.body;

    if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
      return res.status(400).json({ error: 'scenes array is required' });
    }

    const apiKey = (process.env.REPLICATE_API_TOKEN || '').trim();
    if (!apiKey) {
      return res.status(400).json({ error: 'REPLICATE_API_TOKEN not configured' });
    }

    console.log(`Starting batch video generation for ${scenes.length} scenes`);

    // Start all predictions in parallel
    const predictions = await Promise.all(scenes.map(async (scene, index) => {
      const response = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          version: 'c8bcc4751328608bb75043b3af7bed539aa2c165d8dcf45987f7cc002482f8e4',
          input: {
            prompt: motionPrompt || 'cinematic motion, subtle camera movement, professional video',
            first_frame_image: scene.imageUrl,
            prompt_optimizer: true
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Scene ${index + 1} failed: ${errorText}`);
      }

      const prediction = await response.json();
      return { index, predictionId: prediction.id, sceneId: scene.id };
    }));

    console.log(`Started ${predictions.length} video predictions`);

    res.json({
      success: true,
      message: `Started ${predictions.length} video generations`,
      predictions: predictions
    });

  } catch (error) {
    console.error('Batch video generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Check video generation status
app.get('/api/image-to-video/status/:predictionId', async (req, res) => {
  try {
    const { predictionId } = req.params;

    const apiKey = (process.env.REPLICATE_API_TOKEN || '').trim();
    if (!apiKey) {
      return res.status(400).json({ error: 'REPLICATE_API_TOKEN not configured' });
    }

    const response = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (!response.ok) {
      throw new Error(`Status check failed: ${response.status}`);
    }

    const prediction = await response.json();

    res.json({
      status: prediction.status,
      videoUrl: prediction.output,
      error: prediction.error
    });

  } catch (error) {
    console.error('Video status check error:', error);
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
// RECOVER VIDEO URLS FROM REPLICATE HISTORY
app.get('/api/recover-videos', async (req, res) => {
  try {
    const apiKey = (process.env.REPLICATE_API_TOKEN || '').trim();
    if (!apiKey) {
      return res.status(400).json({ error: 'No Replicate API key' });
    }

    // Get recent predictions
    const response = await fetch('https://api.replicate.com/v1/predictions?limit=50', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    const data = await response.json();

    // Filter for p-video-avatar predictions with output
    const videos = data.results
      .filter(p => p.status === 'succeeded' && p.output)
      .map(p => ({
        id: p.id,
        created: p.created_at,
        url: p.output,
        model: p.version?.substring(0, 20)
      }));

    res.json({ success: true, videos });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', hasApiKey: !!process.env.OPENAI_API_KEY, hasSupabase: !!supabase });
});

// Get Supabase config for client-side direct uploads (bypasses Vercel size limits)
app.get('/api/supabase-config', (req, res) => {
  if (!supabaseUrl || !supabaseKey) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }
  res.json({
    url: supabaseUrl.trim(),        // Remove any newlines/whitespace
    anonKey: supabaseKey.trim(),    // Remove any newlines/whitespace
    bucket: 'ai-tool-images'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🎨 AI Image Tool running at http://localhost:${PORT}`);
  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️  Warning: OPENAI_API_KEY not set. Add it to .env file.');
  }
});
