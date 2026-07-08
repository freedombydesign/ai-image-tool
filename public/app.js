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
function parseScriptToScenes(script) {
  // Split by double newlines, numbered lists, or "Scene X" markers
  const scenes = script
    .split(/\n\s*\n|\n(?=\d+[\.\)]\s)|(?=Scene\s*\d+)/gi)
    .map(s => s.trim())
    .filter(s => s.length > 10); // Filter out too-short segments

  return scenes;
}

// Update scene count and cost estimate
function updateScriptStats() {
  const script = scriptInput.value;
  const chars = script.length;
  const scenes = parseScriptToScenes(script);
  const numScenes = scenes.length;

  charCount.textContent = `${chars.toLocaleString()}/20,000`;
  sceneCount.textContent = `${numScenes} scene${numScenes !== 1 ? 's' : ''} detected`;

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

// Batch Scene Generation
async function generateBatchScenes() {
  const script = scriptInput.value.trim();
  const scenes = parseScriptToScenes(script);

  if (scenes.length === 0) {
    showToast('Please enter a script with at least one scene');
    return;
  }

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
