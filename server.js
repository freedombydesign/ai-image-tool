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

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

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

// Generate new image from text prompt
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, size = '1024x1024', style = 'vivid', quality = 'standard' } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    console.log('Generating image with prompt:', prompt);

    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size,
      style,
      quality
    });

    res.json({
      success: true,
      image: response.data[0].url,
      revised_prompt: response.data[0].revised_prompt
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
