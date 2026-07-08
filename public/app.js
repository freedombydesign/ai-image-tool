// Style Presets - Prompt Engineering for each visual style
const STYLE_PRESETS = {
  'cinematic-2d': {
    name: 'Cinematic 2D Animation',
    prompt: 'cinematic 2D animated style, high quality animation, smooth gradients, professional animated movie aesthetic, vibrant colors, clean lines, Disney/Pixar inspired 2D look',
  },
  'hand-drawn': {
    name: 'Hand-Drawn Sketch',
    prompt: 'hand-drawn pencil sketch style, artistic sketchy lines, crosshatching shading, illustration on paper texture, artistic and organic feel',
  },
  'stickman': {
    name: 'Stickman Style',
    prompt: 'simple stickman figure style, minimalist black line art on white background, stick figure characters, basic geometric shapes, whiteboard animation aesthetic',
  },
  'pixel-art': {
    name: '8-Bit Pixel Art',
    prompt: '8-bit retro pixel art style, pixelated graphics, limited color palette, nostalgic video game aesthetic, blocky characters and environments',
  },
  'soft-cartoon': {
    name: 'Soft Cartoon Explainer',
    prompt: 'soft pastel cartoon style, rounded friendly shapes, gentle gradients, explainer video aesthetic, warm colors, approachable and clean design',
  },
  'yellow-character': {
    name: 'Yellow Character Style',
    prompt: 'yellow-skinned cartoon character style like Simpsons, bold outlines, flat colors, animated sitcom aesthetic, expressive characters',
  },
  '3d-cinematic': {
    name: '3D Cinematic Style',
    prompt: '3D rendered cinematic style, photorealistic lighting, depth of field, movie-quality CGI, dramatic camera angles, high production value',
  },
  'minimalist': {
    name: 'Minimalist Flat',
    prompt: 'minimalist flat design style, simple geometric shapes, limited color palette, clean and modern aesthetic, no gradients, corporate illustration style',
  },
  'gta-style': {
    name: 'GTA / Modern Game Style',
    prompt: 'GTA VI art style, modern open-world video game aesthetic, stylized realism, bold saturated colors, neon accents, cinematic lighting, urban street art influence, Rockstar Games visual style, high contrast shadows',
  },
  'anime': {
    name: 'Anime Style',
    prompt: 'anime art style, Japanese animation aesthetic, expressive characters, vibrant colors, dynamic poses, Studio Ghibli and modern anime influence, clean line art with cel shading',
  }
};

// Thumbnail Style Presets - Optimized for YouTube thumbnails
const THUMBNAIL_STYLES = {
  'dramatic': {
    name: 'Dramatic & Bold',
    prompt: 'dramatic YouTube thumbnail style, bold colors, high contrast, intense lighting, eye-catching composition, professional quality, attention-grabbing, viral thumbnail aesthetic',
  },
  'minimal-clean': {
    name: 'Minimal Clean',
    prompt: 'minimalist clean YouTube thumbnail, simple composition, plenty of negative space, modern aesthetic, subtle gradients, professional and sleek, premium quality',
  },
  '3d-render': {
    name: '3D Rendered',
    prompt: '3D rendered YouTube thumbnail, high quality CGI, realistic lighting, depth and dimension, professional 3D graphics, modern and polished look',
  },
  'comic-pop': {
    name: 'Comic Pop Art',
    prompt: 'comic book pop art style thumbnail, bold outlines, halftone dots, vibrant primary colors, action-packed, energetic composition, retro comic aesthetic',
  },
  'cinematic': {
    name: 'Cinematic Dark',
    prompt: 'cinematic dark moody YouTube thumbnail, dramatic shadows, film noir lighting, movie poster quality, professional cinematography style, mysterious atmosphere',
  },
  'neon-glow': {
    name: 'Neon Glow',
    prompt: 'neon glow YouTube thumbnail, cyberpunk aesthetic, glowing neon lights, vibrant pink purple blue colors, futuristic style, high contrast dark background with bright neon accents',
  }
};

// Tab Navigation
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const tabId = tab.dataset.tab;

    tabs.forEach(t => t.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));

    tab.classList.add('active');
    document.getElementById(tabId).classList.add('active');
  });
});

// UI Elements
const loading = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const loadingProgress = document.getElementById('loading-progress');
const resultSection = document.getElementById('result');
const resultImage = document.getElementById('result-image');
const revisedPrompt = document.getElementById('revised-prompt');
const downloadBtn = document.getElementById('download-btn');
const regenerateBtn = document.getElementById('regenerate-btn');

// Batch Scene Elements
const scriptInput = document.getElementById('script-input');
const sceneCount = document.getElementById('scene-count');
const charCount = document.getElementById('char-count');
const costEstimate = document.getElementById('cost-estimate');
const scenesContainer = document.getElementById('scenes-container');
const scenesGrid = document.getElementById('scenes-grid');
const generateBatchBtn = document.getElementById('generate-batch-btn');
const downloadAllBtn = document.getElementById('download-all-btn');

// Style Selection
const styleOptions = document.querySelectorAll('.style-option');
let selectedStyle = 'cinematic-2d';

styleOptions.forEach(option => {
  option.addEventListener('click', () => {
    styleOptions.forEach(o => o.classList.remove('selected'));
    option.classList.add('selected');
    selectedStyle = option.dataset.style;
  });
});

// Generated scenes storage
let generatedScenes = [];
let lastGenerateParams = null;
let isPreviewMode = false;

// Video Settings Elements
const videoLengthSlider = document.getElementById('video-length');
const videoLengthDisplay = document.getElementById('video-length-display');
const sceneModeSelect = document.getElementById('scene-mode');
const manualSceneCountInput = document.getElementById('manual-scene-count');
const sceneHelpText = document.getElementById('scene-help');
const previewBtn = document.getElementById('preview-btn');
const previewCostDisplay = document.getElementById('preview-cost');

// Video Length Slider Handler
if (videoLengthSlider) {
  videoLengthSlider.addEventListener('input', () => {
    const minutes = videoLengthSlider.value;
    videoLengthDisplay.textContent = `${minutes} min`;
    updateScriptStats();
  });
}

// Scene Mode Toggle Handler
if (sceneModeSelect) {
  sceneModeSelect.addEventListener('change', () => {
    const isManual = sceneModeSelect.value === 'manual';
    manualSceneCountInput.disabled = !isManual;

    if (isManual) {
      sceneHelpText.textContent = 'Script will be evenly divided into your specified number of scenes';
    } else {
      sceneHelpText.textContent = 'Scenes will be split by line breaks in your script';
    }
    updateScriptStats();
  });
}

// Manual Scene Count Handler
if (manualSceneCountInput) {
  manualSceneCountInput.addEventListener('input', updateScriptStats);
}

// Utility Functions
function showLoading(text = 'Creating your image...', progress = '') {
  loadingText.textContent = text;
  loadingProgress.textContent = progress;
  loading.removeAttribute('hidden');
  loading.style.display = 'flex';
}

function updateLoadingProgress(current, total) {
  loadingProgress.textContent = `${current} of ${total} scenes`;
}

function hideLoading() {
  loading.setAttribute('hidden', '');
  loading.style.display = 'none';
}

function showResult(imageUrl, prompt = null) {
  resultImage.src = imageUrl;
  resultSection.hidden = false;

  if (prompt) {
    revisedPrompt.textContent = `Revised prompt: ${prompt}`;
    revisedPrompt.hidden = false;
  } else {
    revisedPrompt.hidden = true;
  }

  resultSection.scrollIntoView({ behavior: 'smooth' });
}

function showToast(message, isError = true) {
  const toast = document.createElement('div');
  toast.className = `toast ${isError ? '' : 'success'}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 5000);
}

// Script Parsing - Split into scenes
function parseScriptToScenes(script, forceCount = null) {
  // If manual count is specified, split script evenly
  if (forceCount && forceCount > 0) {
    const words = script.trim().split(/\s+/);
    const wordsPerScene = Math.ceil(words.length / forceCount);
    const scenes = [];

    for (let i = 0; i < forceCount; i++) {
      const start = i * wordsPerScene;
      const end = Math.min(start + wordsPerScene, words.length);
      const sceneWords = words.slice(start, end);
      if (sceneWords.length > 0) {
        scenes.push(sceneWords.join(' '));
      }
    }

    return scenes;
  }

  // Auto-detect: Split by double newlines, numbered lists, or "Scene X" markers
  const scenes = script
    .split(/\n\s*\n|\n(?=\d+[\.\)]\s)|(?=Scene\s*\d+)/gi)
    .map(s => s.trim())
    .filter(s => s.length > 10); // Filter out too-short segments

  return scenes;
}

// Get current scene count based on mode
function getCurrentSceneCount() {
  const script = scriptInput.value;
  const sceneMode = sceneModeSelect ? sceneModeSelect.value : 'auto';

  if (sceneMode === 'manual' && manualSceneCountInput) {
    return parseInt(manualSceneCountInput.value) || 10;
  }

  return parseScriptToScenes(script).length;
}

// Get scenes based on current mode
function getScenesForGeneration() {
  const script = scriptInput.value.trim();
  const sceneMode = sceneModeSelect ? sceneModeSelect.value : 'auto';

  if (sceneMode === 'manual' && manualSceneCountInput) {
    const manualCount = parseInt(manualSceneCountInput.value) || 10;
    return parseScriptToScenes(script, manualCount);
  }

  return parseScriptToScenes(script);
}

// Update scene count and cost estimate
function updateScriptStats() {
  const script = scriptInput.value;
  const chars = script.length;
  const numScenes = getCurrentSceneCount();

  charCount.textContent = `${chars.toLocaleString()}/20,000`;

  const sceneMode = sceneModeSelect ? sceneModeSelect.value : 'auto';
  if (sceneMode === 'manual') {
    sceneCount.textContent = `${numScenes} scene${numScenes !== 1 ? 's' : ''} (manual)`;
  } else {
    sceneCount.textContent = `${numScenes} scene${numScenes !== 1 ? 's' : ''} detected`;
  }

  // Calculate cost estimate
  const quality = document.getElementById('batch-quality').value;
  const size = document.getElementById('batch-size').value;

  let costPerImage = 0.04; // Standard 1024x1024
  if (quality === 'hd') {
    costPerImage = size === '1024x1024' ? 0.08 : 0.12;
  } else {
    costPerImage = size === '1024x1024' ? 0.04 : 0.08;
  }

  const totalCost = numScenes * costPerImage;
  costEstimate.textContent = `$${totalCost.toFixed(2)}`;

  // Update preview cost (3 scenes)
  const previewSceneCount = Math.min(3, numScenes);
  const previewCost = previewSceneCount * costPerImage;
  if (previewCostDisplay) {
    previewCostDisplay.textContent = `(Preview: ~$${previewCost.toFixed(2)})`;
  }
}

scriptInput.addEventListener('input', updateScriptStats);
document.getElementById('batch-quality').addEventListener('change', updateScriptStats);
document.getElementById('batch-size').addEventListener('change', updateScriptStats);

// File Upload Handling
function setupUploadArea(uploadAreaId, fileInputId, previewId) {
  const uploadArea = document.getElementById(uploadAreaId);
  const fileInput = document.getElementById(fileInputId);
  const preview = document.getElementById(previewId);

  if (!uploadArea || !fileInput) return;

  uploadArea.addEventListener('click', () => {
    fileInput.click();
  });

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');

    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleFile(file, fileInput, preview, uploadArea);
    }
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      handleFile(file, fileInput, preview, uploadArea);
    }
  });
}

function handleFile(file, input, preview, uploadArea) {
  const reader = new FileReader();
  reader.onload = (e) => {
    preview.src = e.target.result;
    preview.hidden = false;
    uploadArea.querySelector('.upload-placeholder').style.display = 'none';
  };
  reader.readAsDataURL(file);

  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
}

// Initialize upload areas
setupUploadArea('edit-upload', 'edit-file', 'edit-preview');
setupUploadArea('variations-upload', 'variations-file', 'variations-preview');

// Build prompt with style
function buildStyledPrompt(sceneDescription, style) {
  const styleInfo = STYLE_PRESETS[style];
  if (!styleInfo) {
    return sceneDescription;
  }

  return `${sceneDescription}. Style: ${styleInfo.prompt}. No text, no faces visible, faceless characters suitable for faceless YouTube videos.`;
}

// API Functions
async function generateImage() {
  const prompt = document.getElementById('generate-prompt').value.trim();
  const size = document.getElementById('generate-size').value;
  const style = document.getElementById('single-style').value;
  const quality = document.getElementById('generate-quality').value;

  if (!prompt) {
    showToast('Please enter a prompt');
    return;
  }

  showLoading();

  try {
    const styledPrompt = style ? buildStyledPrompt(prompt, style) : prompt;

    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: styledPrompt, size, quality })
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    lastGenerateParams = { prompt: styledPrompt, size, quality };
    showResult(data.image, data.revised_prompt);
    showToast('Image generated successfully!', false);
  } catch (error) {
    showToast(error.message);
  } finally {
    hideLoading();
  }
}

// Preview Mode - Generate only 3 test scenes
async function generatePreviewScenes() {
  const script = scriptInput.value.trim();
  let allScenes = getScenesForGeneration();

  if (allScenes.length === 0) {
    showToast('Please enter a script with at least one scene');
    return;
  }

  // Pick 3 representative scenes: first, middle, and last (or less if fewer scenes)
  let previewIndices = [];
  if (allScenes.length === 1) {
    previewIndices = [0];
  } else if (allScenes.length === 2) {
    previewIndices = [0, 1];
  } else {
    const middle = Math.floor(allScenes.length / 2);
    previewIndices = [0, middle, allScenes.length - 1];
  }

  const previewScenes = previewIndices.map(i => ({
    index: i,
    text: allScenes[i]
  }));

  isPreviewMode = true;
  const size = document.getElementById('batch-size').value;
  const quality = document.getElementById('batch-quality').value;

  generatedScenes = [];
  scenesGrid.innerHTML = '';
  scenesContainer.hidden = false;

  // Add a preview header
  const previewHeader = document.createElement('div');
  previewHeader.className = 'preview-header';
  previewHeader.innerHTML = `
    <div class="preview-notice">
      <span class="preview-badge">Preview Mode</span>
      <p>Testing ${previewScenes.length} sample scenes (beginning, middle, end). Adjust style if needed, then generate all.</p>
    </div>
  `;
  scenesGrid.before(previewHeader);

  // Create placeholder cards for preview scenes
  previewScenes.forEach(({index, text}) => {
    const card = createSceneCard(index, text, null, true);
    scenesGrid.appendChild(card);
  });

  showLoading('Generating preview...', `0 of ${previewScenes.length} scenes`);

  let successCount = 0;
  let failCount = 0;

  // Generate preview scenes sequentially
  for (let i = 0; i < previewScenes.length; i++) {
    const { index, text } = previewScenes[i];
    const styledPrompt = buildStyledPrompt(text, selectedStyle);

    updateLoadingProgress(i + 1, previewScenes.length);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: styledPrompt, size, quality })
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      generatedScenes[index] = {
        index: index,
        text: text,
        imageUrl: data.image,
        prompt: styledPrompt,
        revisedPrompt: data.revised_prompt,
        isPreview: true
      };

      updateSceneCard(index, data.image);
      successCount++;

    } catch (error) {
      console.error(`Failed to generate preview scene ${index + 1}:`, error);
      markSceneError(index);
      failCount++;
    }

    if (i < previewScenes.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  hideLoading();

  if (successCount > 0) {
    showToast(`Preview: ${successCount} scene${successCount !== 1 ? 's' : ''} generated. Review and adjust style before generating all.`, false);
  }

  scenesContainer.scrollIntoView({ behavior: 'smooth' });
}

// Batch Scene Generation
async function generateBatchScenes() {
  const script = scriptInput.value.trim();
  const scenes = getScenesForGeneration();

  if (scenes.length === 0) {
    showToast('Please enter a script with at least one scene');
    return;
  }

  // Remove any preview header
  const previewHeader = document.querySelector('.preview-header');
  if (previewHeader) previewHeader.remove();
  isPreviewMode = false;

  const size = document.getElementById('batch-size').value;
  const quality = document.getElementById('batch-quality').value;

  generatedScenes = [];
  scenesGrid.innerHTML = '';
  scenesContainer.hidden = false;

  // Create placeholder cards for all scenes
  scenes.forEach((scene, index) => {
    const card = createSceneCard(index, scene, null, true);
    scenesGrid.appendChild(card);
  });

  showLoading('Generating scenes...', `0 of ${scenes.length} scenes`);

  let successCount = 0;
  let failCount = 0;

  // Generate scenes sequentially to avoid rate limits
  for (let i = 0; i < scenes.length; i++) {
    const sceneText = scenes[i];
    const styledPrompt = buildStyledPrompt(sceneText, selectedStyle);

    updateLoadingProgress(i + 1, scenes.length);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: styledPrompt, size, quality })
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      generatedScenes[i] = {
        index: i,
        text: sceneText,
        imageUrl: data.image,
        prompt: styledPrompt,
        revisedPrompt: data.revised_prompt
      };

      // Update the card with the generated image
      updateSceneCard(i, data.image);
      successCount++;

    } catch (error) {
      console.error(`Failed to generate scene ${i + 1}:`, error);
      markSceneError(i);
      failCount++;
    }

    // Small delay between requests to avoid rate limits
    if (i < scenes.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  hideLoading();

  if (successCount > 0) {
    showToast(`Generated ${successCount} scene${successCount !== 1 ? 's' : ''} successfully!`, false);
  }
  if (failCount > 0) {
    showToast(`${failCount} scene${failCount !== 1 ? 's' : ''} failed to generate`);
  }

  scenesContainer.scrollIntoView({ behavior: 'smooth' });
}

// Scene Card Management
function createSceneCard(index, text, imageUrl, isLoading = false) {
  const card = document.createElement('div');
  card.className = `scene-card ${isLoading ? 'loading' : ''}`;
  card.id = `scene-card-${index}`;

  const truncatedText = text.length > 100 ? text.substring(0, 100) + '...' : text;

  card.innerHTML = `
    ${isLoading ? `
      <div class="scene-loading">
        <div class="spinner"></div>
      </div>
    ` : ''}
    <img src="${imageUrl || ''}" alt="Scene ${index + 1}" ${isLoading || !imageUrl ? 'hidden' : ''}>
    <div class="scene-info">
      <div class="scene-number">Scene ${String(index + 1).padStart(2, '0')}</div>
      <div class="scene-text">${truncatedText}</div>
    </div>
    <div class="scene-actions">
      <button class="btn secondary" onclick="regenerateScene(${index})">Regenerate</button>
      <button class="btn secondary" onclick="downloadScene(${index})">Download</button>
    </div>
  `;

  return card;
}

function updateSceneCard(index, imageUrl) {
  const card = document.getElementById(`scene-card-${index}`);
  if (!card) return;

  card.classList.remove('loading');
  const loadingDiv = card.querySelector('.scene-loading');
  if (loadingDiv) loadingDiv.remove();

  const img = card.querySelector('img');
  img.src = imageUrl;
  img.hidden = false;
}

function markSceneError(index) {
  const card = document.getElementById(`scene-card-${index}`);
  if (!card) return;

  card.classList.remove('loading');
  card.classList.add('error');

  const loadingDiv = card.querySelector('.scene-loading');
  if (loadingDiv) {
    loadingDiv.innerHTML = '<span style="color: var(--error);">Failed to generate</span>';
  }
}

// Regenerate a single scene
async function regenerateScene(index) {
  const scene = generatedScenes[index];
  if (!scene) {
    showToast('Scene data not found');
    return;
  }

  const card = document.getElementById(`scene-card-${index}`);
  card.classList.add('loading');
  card.classList.remove('error');

  // Add loading spinner
  const img = card.querySelector('img');
  img.hidden = true;

  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'scene-loading';
  loadingDiv.innerHTML = '<div class="spinner"></div>';
  card.insertBefore(loadingDiv, card.firstChild);

  const size = document.getElementById('batch-size').value;
  const quality = document.getElementById('batch-quality').value;

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: scene.prompt, size, quality })
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    generatedScenes[index].imageUrl = data.image;
    generatedScenes[index].revisedPrompt = data.revised_prompt;

    updateSceneCard(index, data.image);
    showToast('Scene regenerated!', false);

  } catch (error) {
    markSceneError(index);
    showToast(error.message);
  }
}

// Download single scene
async function downloadScene(index) {
  const scene = generatedScenes[index];
  if (!scene || !scene.imageUrl) {
    showToast('No image to download');
    return;
  }

  try {
    const response = await fetch(scene.imageUrl);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `scene-${String(index + 1).padStart(2, '0')}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Scene downloaded!', false);
  } catch (error) {
    showToast('Failed to download scene');
  }
}

// Download all scenes as ZIP
async function downloadAllScenes() {
  const validScenes = generatedScenes.filter(s => s && s.imageUrl);

  if (validScenes.length === 0) {
    showToast('No scenes to download');
    return;
  }

  showLoading('Creating ZIP file...', `0 of ${validScenes.length} images`);

  try {
    const zip = new JSZip();
    const imgFolder = zip.folder('scenes');

    for (let i = 0; i < validScenes.length; i++) {
      const scene = validScenes[i];
      updateLoadingProgress(i + 1, validScenes.length);

      const response = await fetch(scene.imageUrl);
      const blob = await response.blob();
      const filename = `scene-${String(scene.index + 1).padStart(2, '0')}.png`;
      imgFolder.file(filename, blob);
    }

    loadingText.textContent = 'Compressing...';
    loadingProgress.textContent = '';

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);

    const a = document.createElement('a');
    a.href = url;
    a.download = `batch-scenes-${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    hideLoading();
    showToast(`Downloaded ${validScenes.length} scenes as ZIP!`, false);

  } catch (error) {
    hideLoading();
    showToast('Failed to create ZIP file');
  }
}

// Regenerate last single image
async function regenerateLastImage() {
  if (!lastGenerateParams) {
    showToast('No previous generation to regenerate');
    return;
  }

  showLoading();

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lastGenerateParams)
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    showResult(data.image, data.revised_prompt);
    showToast('Image regenerated!', false);
  } catch (error) {
    showToast(error.message);
  } finally {
    hideLoading();
  }
}

async function editImage() {
  const fileInput = document.getElementById('edit-file');
  const prompt = document.getElementById('edit-prompt').value.trim();

  if (!fileInput.files[0]) {
    showToast('Please upload an image');
    return;
  }

  if (!prompt) {
    showToast('Please describe the changes');
    return;
  }

  showLoading();

  try {
    const formData = new FormData();
    formData.append('image', fileInput.files[0]);
    formData.append('prompt', prompt);

    const response = await fetch('/api/edit', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    showResult(data.image);
    showToast('Image edited successfully!', false);
  } catch (error) {
    showToast(error.message);
  } finally {
    hideLoading();
  }
}

async function createVariation() {
  const fileInput = document.getElementById('variations-file');

  if (!fileInput.files[0]) {
    showToast('Please upload an image');
    return;
  }

  showLoading();

  try {
    const formData = new FormData();
    formData.append('image', fileInput.files[0]);

    const response = await fetch('/api/variations', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    showResult(data.image);
    showToast('Variation created successfully!', false);
  } catch (error) {
    showToast(error.message);
  } finally {
    hideLoading();
  }
}

// Download Result
downloadBtn.addEventListener('click', async () => {
  const imageUrl = resultImage.src;

  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-image-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Image downloaded!', false);
  } catch (error) {
    showToast('Failed to download image');
  }
});

// Button Event Listeners
document.getElementById('generate-btn').addEventListener('click', generateImage);
document.getElementById('edit-btn').addEventListener('click', editImage);
document.getElementById('variations-btn').addEventListener('click', createVariation);
generateBatchBtn.addEventListener('click', generateBatchScenes);
downloadAllBtn.addEventListener('click', downloadAllScenes);
regenerateBtn.addEventListener('click', regenerateLastImage);

// Preview Button Handler
if (previewBtn) {
  previewBtn.addEventListener('click', generatePreviewScenes);
}

// Make functions globally available for onclick handlers
window.regenerateScene = regenerateScene;
window.downloadScene = downloadScene;

// Check API status on load
async function checkApiStatus() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();

    if (!data.hasApiKey) {
      showToast('Warning: OpenAI API key not configured. Add it to .env file.');
    }
  } catch (error) {
    showToast('Could not connect to server');
  }
}

checkApiStatus();

// ============================================
// THUMBNAIL MAKER
// ============================================

// Thumbnail Elements
const thumbnailStyleOptions = document.querySelectorAll('.thumbnail-style-option');
const thumbnailPromptInput = document.getElementById('thumbnail-prompt');
const thumbnailHookInput = document.getElementById('thumbnail-hook');
const thumbnailQualitySelect = document.getElementById('thumbnail-quality');
const generateThumbnailBtn = document.getElementById('generate-thumbnail-btn');
const thumbnailResult = document.getElementById('thumbnail-result');
const thumbnailImage = document.getElementById('thumbnail-image');
const downloadThumbnailBtn = document.getElementById('download-thumbnail-btn');
const regenerateThumbnailBtn = document.getElementById('regenerate-thumbnail-btn');

let selectedThumbnailStyle = 'dramatic';
let lastThumbnailParams = null;
let thumbnailHistory = [];

// Thumbnail Style Selection
if (thumbnailStyleOptions) {
  thumbnailStyleOptions.forEach(option => {
    option.addEventListener('click', () => {
      thumbnailStyleOptions.forEach(o => o.classList.remove('selected'));
      option.classList.add('selected');
      selectedThumbnailStyle = option.dataset.thumbStyle;
    });
  });
}

// Build Thumbnail Prompt
function buildThumbnailPrompt(description, style, textHook = '') {
  const styleInfo = THUMBNAIL_STYLES[style];
  let prompt = description;

  if (styleInfo) {
    prompt += `. Style: ${styleInfo.prompt}`;
  }

  if (textHook) {
    prompt += `. Include bold readable text saying "${textHook}" as part of the composition`;
  }

  prompt += '. YouTube thumbnail format, 16:9 aspect ratio, designed to get clicks, no small details that won\'t be visible at thumbnail size.';

  return prompt;
}

// Generate Thumbnail
async function generateThumbnail() {
  const description = thumbnailPromptInput ? thumbnailPromptInput.value.trim() : '';
  const textHook = thumbnailHookInput ? thumbnailHookInput.value.trim() : '';
  const quality = thumbnailQualitySelect ? thumbnailQualitySelect.value : 'hd';

  if (!description) {
    showToast('Please describe your thumbnail');
    return;
  }

  const prompt = buildThumbnailPrompt(description, selectedThumbnailStyle, textHook);

  showLoading('Creating your thumbnail...');

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt,
        size: '1792x1024', // YouTube thumbnail aspect ratio
        quality: quality
      })
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    // Store params for regeneration
    lastThumbnailParams = { prompt, size: '1792x1024', quality };

    // Show result
    if (thumbnailImage) {
      thumbnailImage.src = data.image;
    }
    if (thumbnailResult) {
      thumbnailResult.hidden = false;
    }

    // Add to history
    thumbnailHistory.unshift({
      imageUrl: data.image,
      prompt: prompt,
      timestamp: Date.now()
    });

    // Keep only last 10
    if (thumbnailHistory.length > 10) {
      thumbnailHistory = thumbnailHistory.slice(0, 10);
    }

    updateThumbnailGallery();

    showToast('Thumbnail generated!', false);
    thumbnailResult.scrollIntoView({ behavior: 'smooth' });

  } catch (error) {
    showToast(error.message);
  } finally {
    hideLoading();
  }
}

// Regenerate Thumbnail
async function regenerateThumbnail() {
  if (!lastThumbnailParams) {
    showToast('No thumbnail to regenerate. Generate one first.');
    return;
  }

  showLoading('Regenerating thumbnail...');

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lastThumbnailParams)
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    if (thumbnailImage) {
      thumbnailImage.src = data.image;
    }

    // Add to history
    thumbnailHistory.unshift({
      imageUrl: data.image,
      prompt: lastThumbnailParams.prompt,
      timestamp: Date.now()
    });

    if (thumbnailHistory.length > 10) {
      thumbnailHistory = thumbnailHistory.slice(0, 10);
    }

    updateThumbnailGallery();

    showToast('Thumbnail regenerated!', false);

  } catch (error) {
    showToast(error.message);
  } finally {
    hideLoading();
  }
}

// Download Thumbnail
async function downloadThumbnail() {
  if (!thumbnailImage || !thumbnailImage.src) {
    showToast('No thumbnail to download');
    return;
  }

  try {
    const response = await fetch(thumbnailImage.src);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `thumbnail-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Thumbnail downloaded!', false);
  } catch (error) {
    showToast('Failed to download thumbnail');
  }
}

// Update Thumbnail Gallery
function updateThumbnailGallery() {
  const gallery = document.getElementById('thumbnail-gallery');
  const grid = document.getElementById('thumbnail-gallery-grid');

  if (!gallery || !grid || thumbnailHistory.length === 0) return;

  gallery.hidden = false;
  grid.innerHTML = '';

  thumbnailHistory.forEach((item, index) => {
    const img = document.createElement('img');
    img.src = item.imageUrl;
    img.alt = `Thumbnail ${index + 1}`;
    img.title = 'Click to use this thumbnail';
    img.addEventListener('click', () => {
      if (thumbnailImage) {
        thumbnailImage.src = item.imageUrl;
      }
      if (thumbnailResult) {
        thumbnailResult.hidden = false;
        thumbnailResult.scrollIntoView({ behavior: 'smooth' });
      }
    });
    grid.appendChild(img);
  });
}

// Thumbnail Event Listeners
if (generateThumbnailBtn) {
  generateThumbnailBtn.addEventListener('click', generateThumbnail);
}

if (downloadThumbnailBtn) {
  downloadThumbnailBtn.addEventListener('click', downloadThumbnail);
}

if (regenerateThumbnailBtn) {
  regenerateThumbnailBtn.addEventListener('click', regenerateThumbnail);
}

// ============================================
// YOUTUBE INSPIRATION
// ============================================

// Extract YouTube video ID from URL
function extractYouTubeVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

// Get YouTube thumbnail URL (multiple quality options)
function getYouTubeThumbnailUrl(videoId, quality = 'maxresdefault') {
  // Try maxresdefault first, then fall back to hqdefault
  return `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
}

// Fetch YouTube Thumbnail for Thumbnail Maker
const fetchYoutubeThumbBtn = document.getElementById('fetch-youtube-thumb');
const thumbnailYoutubeUrl = document.getElementById('thumbnail-youtube-url');
const youtubeThumbPreview = document.getElementById('youtube-thumb-preview');
const youtubeThumbImage = document.getElementById('youtube-thumb-image');
const youtubeThumbTitle = document.getElementById('youtube-thumb-title');
const clearYoutubeThumbBtn = document.getElementById('clear-youtube-thumb');

if (fetchYoutubeThumbBtn && thumbnailYoutubeUrl) {
  fetchYoutubeThumbBtn.addEventListener('click', () => {
    const url = thumbnailYoutubeUrl.value.trim();

    if (!url) {
      showToast('Please enter a YouTube URL');
      return;
    }

    const videoId = extractYouTubeVideoId(url);

    if (!videoId) {
      showToast('Invalid YouTube URL. Please paste a valid YouTube video link.');
      return;
    }

    // Get high-quality thumbnail
    const thumbUrl = getYouTubeThumbnailUrl(videoId, 'maxresdefault');

    // Test if maxresdefault exists, fall back to hqdefault if not
    const img = new Image();
    img.onload = function() {
      if (youtubeThumbImage) youtubeThumbImage.src = thumbUrl;
      if (youtubeThumbTitle) youtubeThumbTitle.textContent = `Video ID: ${videoId}`;
      if (youtubeThumbPreview) youtubeThumbPreview.hidden = false;
      showToast('Thumbnail loaded! Use it as inspiration.', false);
    };
    img.onerror = function() {
      // Fall back to hqdefault
      const fallbackUrl = getYouTubeThumbnailUrl(videoId, 'hqdefault');
      if (youtubeThumbImage) youtubeThumbImage.src = fallbackUrl;
      if (youtubeThumbTitle) youtubeThumbTitle.textContent = `Video ID: ${videoId}`;
      if (youtubeThumbPreview) youtubeThumbPreview.hidden = false;
      showToast('Thumbnail loaded! Use it as inspiration.', false);
    };
    img.src = thumbUrl;
  });
}

if (clearYoutubeThumbBtn) {
  clearYoutubeThumbBtn.addEventListener('click', () => {
    if (thumbnailYoutubeUrl) thumbnailYoutubeUrl.value = '';
    if (youtubeThumbImage) youtubeThumbImage.src = '';
    if (youtubeThumbPreview) youtubeThumbPreview.hidden = true;
  });
}

// Allow pressing Enter in YouTube URL field to fetch
if (thumbnailYoutubeUrl) {
  thumbnailYoutubeUrl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      fetchYoutubeThumbBtn?.click();
    }
  });
}
