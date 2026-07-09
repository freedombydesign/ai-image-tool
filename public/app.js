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
const convertScriptBtn = document.getElementById('convert-script-btn');
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

// YouTube inspiration reference for scene generation
let sceneInspirationUrl = null;

// Style Anchor for consistent visual style across scenes
let styleAnchor = null; // { sceneIndex, imageUrl, style, prompt }

// Style Anchor Functions
function setStyleAnchor(sceneIndex) {
  const scene = generatedScenes[sceneIndex];
  if (!scene || !scene.imageUrl) {
    showToast('Cannot set anchor - scene has no image');
    return;
  }

  styleAnchor = {
    sceneIndex: sceneIndex,
    imageUrl: scene.imageUrl,
    style: document.getElementById('batch-style')?.value || 'cinematic-2d',
    prompt: scene.text,
    revisedPrompt: scene.revisedPrompt
  };

  // Update UI
  updateAnchorPanel();
  updateSceneCardAnchorStates();
  showToast(`Scene ${String(sceneIndex + 1).padStart(2, '0')} set as style anchor`);
}

function clearStyleAnchor() {
  styleAnchor = null;
  updateAnchorPanel();
  updateSceneCardAnchorStates();
  showToast('Style anchor cleared');
}

function updateAnchorPanel() {
  const panel = document.getElementById('style-anchor-panel');
  if (!panel) return;

  if (styleAnchor) {
    panel.hidden = false;
    document.getElementById('anchor-preview-image').src = styleAnchor.imageUrl;
    document.getElementById('anchor-scene-label').textContent = `Scene ${String(styleAnchor.sceneIndex + 1).padStart(2, '0')}`;
  } else {
    panel.hidden = true;
  }
}

function updateSceneCardAnchorStates() {
  // Remove anchor state from all cards
  document.querySelectorAll('.scene-card').forEach(card => {
    card.classList.remove('is-style-anchor');
  });
  document.querySelectorAll('.scene-anchor-btn').forEach(btn => {
    btn.classList.remove('is-anchor');
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="5" r="3"/>
        <line x1="12" y1="8" x2="12" y2="21"/>
        <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
      </svg>
      Set as Anchor
    `;
  });

  // Add anchor state to current anchor
  if (styleAnchor !== null) {
    const anchorCard = document.getElementById(`scene-card-${styleAnchor.sceneIndex}`);
    if (anchorCard) {
      anchorCard.classList.add('is-style-anchor');
      const anchorBtn = anchorCard.querySelector('.scene-anchor-btn');
      if (anchorBtn) {
        anchorBtn.classList.add('is-anchor');
        anchorBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="5" r="3"/>
            <line x1="12" y1="8" x2="12" y2="21"/>
            <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
          </svg>
          Style Anchor
        `;
      }
    }
  }
}

// Character Lock for consistent recurring characters
let lockedCharacters = []; // Array of { name, description }

function toggleCharacterPanel() {
  const panel = document.getElementById('character-lock-panel');
  const content = document.getElementById('character-panel-content');
  if (panel && content) {
    panel.classList.toggle('expanded');
    content.hidden = !content.hidden;
  }
}

function addCharacter() {
  const nameInput = document.getElementById('char-name');
  const descInput = document.getElementById('char-description');

  const name = nameInput.value.trim();
  const description = descInput.value.trim();

  if (!name) {
    showToast('Please enter a character name');
    return;
  }

  if (!description) {
    showToast('Please enter a character description');
    return;
  }

  // Check for duplicate names
  if (lockedCharacters.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    showToast('A character with this name already exists');
    return;
  }

  lockedCharacters.push({ name, description });
  nameInput.value = '';
  descInput.value = '';

  renderCharactersList();
  showToast(`Character "${name}" added`);
}

function removeCharacter(index) {
  const char = lockedCharacters[index];
  if (char) {
    lockedCharacters.splice(index, 1);
    renderCharactersList();
    showToast(`Character "${char.name}" removed`);
  }
}

function renderCharactersList() {
  const list = document.getElementById('characters-list');
  const countEl = document.getElementById('character-count');

  if (!list) return;

  if (lockedCharacters.length === 0) {
    list.innerHTML = '';
  } else {
    list.innerHTML = lockedCharacters.map((char, index) => `
      <div class="character-item">
        <div class="character-avatar">${char.name.charAt(0).toUpperCase()}</div>
        <div class="character-details">
          <div class="character-name">${char.name}</div>
          <div class="character-desc">${char.description}</div>
        </div>
        <button class="character-remove" onclick="removeCharacter(${index})" title="Remove character">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    `).join('');
  }

  if (countEl) {
    countEl.textContent = `${lockedCharacters.length} character${lockedCharacters.length !== 1 ? 's' : ''}`;
  }
}

function getCharacterInstructions(sceneText) {
  if (lockedCharacters.length === 0) return '';

  // Check which characters are mentioned in the scene
  const mentionedChars = lockedCharacters.filter(char => {
    const regex = new RegExp(char.name, 'i');
    return regex.test(sceneText);
  });

  if (mentionedChars.length === 0) return '';

  // Build character consistency instructions
  const charInstructions = mentionedChars.map(char =>
    `"${char.name}": ${char.description}`
  ).join('; ');

  return `. CHARACTER CONSISTENCY - these characters must match their exact descriptions: ${charInstructions}`;
}

// Brand Block for consistent brand styling rules
let brandBlockEnabled = false;

function toggleBrandPanel() {
  const panel = document.getElementById('brand-block-panel');
  const content = document.getElementById('brand-panel-content');
  if (panel && content) {
    panel.classList.toggle('expanded');
    content.hidden = !content.hidden;
  }
}

function toggleBrandBlock() {
  const checkbox = document.getElementById('brand-enabled');
  const statusEl = document.getElementById('brand-status');

  brandBlockEnabled = checkbox?.checked || false;

  if (statusEl) {
    statusEl.textContent = brandBlockEnabled ? 'Active' : 'Off';
    statusEl.classList.toggle('active', brandBlockEnabled);
  }

  showToast(brandBlockEnabled ? 'Brand rules enabled' : 'Brand rules disabled');
}

function getBrandInstructions() {
  if (!brandBlockEnabled) return '';

  const mood = document.getElementById('brand-mood')?.value.trim() || '';
  const lighting = document.getElementById('brand-lighting')?.value.trim() || '';
  const colors = document.getElementById('brand-colors')?.value.trim() || '';
  const avoid = document.getElementById('brand-avoid')?.value.trim() || '';

  const parts = [];

  if (mood) {
    parts.push(`BRAND MOOD: ${mood}`);
  }

  if (lighting) {
    parts.push(`LIGHTING: ${lighting}`);
  }

  if (colors) {
    parts.push(`COLOR PALETTE: ${colors}`);
  }

  if (avoid) {
    parts.push(`ABSOLUTELY AVOID: ${avoid}`);
  }

  if (parts.length === 0) return '';

  return `. BRAND STYLING RULES - ${parts.join('. ')}`;
}

// ============================================
// AVATAR UPLOAD FEATURE
// For consistent character appearance across all scenes
// ============================================

// Load avatar state from localStorage
const savedAvatar = loadAvatarState();
let avatarEnabled = savedAvatar.enabled;
let avatarImageData = savedAvatar.imageData;
let avatarDescription = savedAvatar.description;

function loadAvatarState() {
  try {
    const saved = localStorage.getItem('avatarState');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load avatar state:', e);
  }
  return { enabled: false, imageData: null, description: '' };
}

function saveAvatarState() {
  try {
    localStorage.setItem('avatarState', JSON.stringify({
      enabled: avatarEnabled,
      imageData: avatarImageData,
      description: avatarDescription
    }));
  } catch (e) {
    console.error('Failed to save avatar state:', e);
  }
}

function toggleAvatarPanel() {
  const panel = document.getElementById('avatar-upload-panel');
  const content = document.getElementById('avatar-panel-content');
  if (panel && content) {
    panel.classList.toggle('expanded');
    content.hidden = !content.hidden;
  }
}

function toggleAvatarUsage() {
  const checkbox = document.getElementById('avatar-enabled');
  const statusEl = document.getElementById('avatar-status');

  avatarEnabled = checkbox?.checked || false;

  if (statusEl && avatarImageData) {
    statusEl.textContent = avatarEnabled ? 'Active' : 'Uploaded';
    statusEl.classList.toggle('active', avatarEnabled);
  }

  updateAvatarStatusIndicators(); // Update status across all tabs
  saveAvatarState(); // Auto-save to localStorage
  showToast(avatarEnabled ? 'Avatar will be used in generation' : 'Avatar disabled');
}

function handleAvatarUpload(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('Please upload a valid image file');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    avatarImageData = e.target.result;

    // Show preview
    const placeholder = document.getElementById('avatar-placeholder');
    const preview = document.getElementById('avatar-preview');
    const avatarImage = document.getElementById('avatar-image');
    const descSection = document.getElementById('avatar-description-section');
    const statusEl = document.getElementById('avatar-status');

    if (placeholder) placeholder.hidden = true;
    if (preview) {
      preview.hidden = false;
      if (avatarImage) avatarImage.src = avatarImageData;
    }
    if (descSection) descSection.hidden = false;

    // Update status
    if (statusEl) {
      statusEl.textContent = 'Uploaded';
      statusEl.classList.add('active');
    }

    // Enable by default when uploaded
    const checkbox = document.getElementById('avatar-enabled');
    if (checkbox) {
      checkbox.checked = true;
      avatarEnabled = true;
    }

    updateAvatarStatusIndicators(); // Update status across all tabs
    saveAvatarState(); // Auto-save to localStorage
    showToast('Avatar uploaded! Describe your character for best results.');
  };
  reader.readAsDataURL(file);
}

function removeAvatar() {
  avatarImageData = null;
  avatarDescription = '';
  avatarEnabled = false;

  const placeholder = document.getElementById('avatar-placeholder');
  const preview = document.getElementById('avatar-preview');
  const descSection = document.getElementById('avatar-description-section');
  const statusEl = document.getElementById('avatar-status');
  const descInput = document.getElementById('avatar-description');
  const checkbox = document.getElementById('avatar-enabled');

  if (placeholder) placeholder.hidden = false;
  if (preview) preview.hidden = true;
  if (descSection) descSection.hidden = true;
  if (statusEl) {
    statusEl.textContent = 'No avatar';
    statusEl.classList.remove('active');
  }
  if (descInput) descInput.value = '';
  if (checkbox) checkbox.checked = false;

  updateAvatarStatusIndicators(); // Update status across all tabs
  saveAvatarState(); // Auto-save to localStorage
  showToast('Avatar removed');
}

function getAvatarInstructions() {
  if (!avatarEnabled || !avatarImageData) return '';

  const descInput = document.getElementById('avatar-description');
  const description = descInput?.value.trim() || '';

  if (!description) {
    // Basic instruction if no description provided
    return `. MAIN CHARACTER: Include a person as the main focus of the scene, maintaining consistent appearance throughout all scenes`;
  }

  // Detailed instruction with user's description
  return `. MAIN CHARACTER APPEARANCE (CRITICAL - maintain exact consistency): ${description}. This character MUST appear in every scene with IDENTICAL physical features, clothing, and style. The character should be the focal point of the scene`;
}

// Initialize avatar upload area
function initAvatarUpload() {
  const uploadArea = document.getElementById('avatar-upload-area');
  const fileInput = document.getElementById('avatar-file');
  const placeholder = document.getElementById('avatar-placeholder');
  const removeBtn = document.getElementById('remove-avatar-btn');
  const descInput = document.getElementById('avatar-description');
  const preview = document.getElementById('avatar-preview');
  const avatarImage = document.getElementById('avatar-image');
  const descSection = document.getElementById('avatar-description-section');
  const statusEl = document.getElementById('avatar-status');
  const checkbox = document.getElementById('avatar-enabled');

  // Restore saved avatar state on page load
  if (avatarImageData) {
    if (placeholder) placeholder.hidden = true;
    if (preview) {
      preview.hidden = false;
      if (avatarImage) avatarImage.src = avatarImageData;
    }
    if (descSection) descSection.hidden = false;
    if (descInput) descInput.value = avatarDescription;
    if (checkbox) checkbox.checked = avatarEnabled;
    if (statusEl) {
      statusEl.textContent = avatarEnabled ? 'Active' : 'Uploaded';
      statusEl.classList.toggle('active', avatarEnabled);
    }
    updateAvatarStatusIndicators();
  }

  if (placeholder) {
    placeholder.addEventListener('click', () => {
      fileInput?.click();
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleAvatarUpload(e.target.files[0]);
      }
    });
  }

  if (uploadArea) {
    // Drag and drop support
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      placeholder?.classList.add('drag-over');
    });

    uploadArea.addEventListener('dragleave', (e) => {
      e.preventDefault();
      placeholder?.classList.remove('drag-over');
    });

    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      placeholder?.classList.remove('drag-over');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleAvatarUpload(e.dataTransfer.files[0]);
      }
    });
  }

  if (removeBtn) {
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeAvatar();
    });
  }

  if (descInput) {
    descInput.addEventListener('input', () => {
      avatarDescription = descInput.value.trim();
      saveAvatarState(); // Auto-save description changes
    });
  }
}

// Switch to a tab and open the avatar panel
function switchToTabAndOpenAvatar(tabId) {
  // Switch to the tab
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');

  tabs.forEach(t => t.classList.remove('active'));
  tabContents.forEach(tc => tc.classList.remove('active'));

  const targetTab = document.querySelector(`.tab[data-tab="${tabId}"]`);
  const targetContent = document.getElementById(tabId);

  if (targetTab) targetTab.classList.add('active');
  if (targetContent) targetContent.classList.add('active');

  // Open the avatar panel
  setTimeout(() => {
    const panel = document.getElementById('avatar-upload-panel');
    const content = document.getElementById('avatar-panel-content');
    if (panel && content) {
      panel.classList.add('expanded');
      content.hidden = false;
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 100);
}

// Update avatar status indicators across all tabs
function updateAvatarStatusIndicators() {
  const isConfigured = avatarImageData !== null;
  const isActive = avatarEnabled && isConfigured;

  // Update thumbnail tab indicator
  const thumbStatus = document.getElementById('thumbnail-avatar-status');
  const thumbText = document.getElementById('thumbnail-avatar-text');
  if (thumbStatus && thumbText) {
    thumbStatus.classList.toggle('active', isActive);
    thumbText.textContent = isActive ? 'Avatar active' : (isConfigured ? 'Avatar disabled' : 'No avatar configured');
  }

  // Update single image tab indicator
  const singleStatus = document.getElementById('single-avatar-status');
  const singleText = document.getElementById('single-avatar-text');
  if (singleStatus && singleText) {
    singleStatus.classList.toggle('active', isActive);
    singleText.textContent = isActive ? 'Avatar active' : (isConfigured ? 'Avatar disabled' : 'No avatar configured');
  }
}

// ============================================
// TEXT OVERLAY LAYER
// Programmatic text overlay (not AI-generated)
// ============================================

let textOverlayState = {
  sceneIndex: null,
  imageUrl: null,
  originalImage: null
};

function openTextOverlay(sceneIndex) {
  const scene = generatedScenes[sceneIndex];
  if (!scene || !scene.imageUrl) {
    showToast('Cannot add text - scene has no image');
    return;
  }

  textOverlayState.sceneIndex = sceneIndex;
  textOverlayState.imageUrl = scene.imageUrl;

  const modal = document.getElementById('text-overlay-modal');
  const canvas = document.getElementById('text-overlay-canvas');
  const ctx = canvas.getContext('2d');

  // Load the image
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = function() {
    // Set canvas size to match image aspect ratio
    const maxWidth = 600;
    const maxHeight = 400;
    let width = img.width;
    let height = img.height;

    if (width > maxWidth) {
      height = (maxWidth / width) * height;
      width = maxWidth;
    }
    if (height > maxHeight) {
      width = (maxHeight / height) * width;
      height = maxHeight;
    }

    canvas.width = width;
    canvas.height = height;
    textOverlayState.originalImage = img;

    // Draw image
    ctx.drawImage(img, 0, 0, width, height);

    // Show modal
    modal.hidden = false;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Initial text render
    updateTextOverlay();
  };

  img.onerror = function() {
    showToast('Failed to load image for text overlay');
  };

  img.src = scene.imageUrl;
}

function closeTextOverlay() {
  const modal = document.getElementById('text-overlay-modal');
  modal.hidden = true;
  modal.style.display = 'none';
  document.body.style.overflow = '';
  textOverlayState = { sceneIndex: null, imageUrl: null, originalImage: null };

  // Reset form
  document.getElementById('overlay-text').value = '';
  document.getElementById('overlay-font-size').value = 48;
  document.getElementById('font-size-value').textContent = '48px';
}

function updateTextOverlay() {
  const canvas = document.getElementById('text-overlay-canvas');
  const ctx = canvas.getContext('2d');

  if (!textOverlayState.originalImage) return;

  // Clear and redraw image
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(textOverlayState.originalImage, 0, 0, canvas.width, canvas.height);

  // Get text settings
  const text = document.getElementById('overlay-text').value;
  if (!text.trim()) return;

  const fontSize = parseInt(document.getElementById('overlay-font-size').value) || 48;
  const fontFamily = document.getElementById('overlay-font').value || 'Arial Black';
  const position = document.getElementById('overlay-position').value || 'center';
  const textColor = document.getElementById('overlay-text-color').value || '#ffffff';
  const strokeColor = document.getElementById('overlay-stroke-color').value || '#000000';
  const strokeWidth = parseInt(document.getElementById('overlay-stroke-width').value) || 3;

  // Update font size display
  document.getElementById('font-size-value').textContent = `${fontSize}px`;
  document.getElementById('stroke-width-value').textContent = `${strokeWidth}px`;

  // Set font
  ctx.font = `bold ${fontSize}px "${fontFamily}"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Calculate position
  const lines = text.split('\n');
  const lineHeight = fontSize * 1.2;
  const totalHeight = lines.length * lineHeight;

  let startY;
  switch (position) {
    case 'top':
      startY = fontSize + 20;
      break;
    case 'bottom':
      startY = canvas.height - totalHeight - 20 + (lineHeight / 2);
      break;
    case 'center':
    default:
      startY = (canvas.height - totalHeight) / 2 + (lineHeight / 2);
  }

  // Draw each line
  lines.forEach((line, i) => {
    const y = startY + (i * lineHeight);
    const x = canvas.width / 2;

    // Draw stroke
    if (strokeWidth > 0) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth * 2;
      ctx.lineJoin = 'round';
      ctx.strokeText(line, x, y);
    }

    // Draw fill
    ctx.fillStyle = textColor;
    ctx.fillText(line, x, y);
  });
}

function downloadWithTextOverlay() {
  const canvas = document.getElementById('text-overlay-canvas');
  const text = document.getElementById('overlay-text').value;

  if (!textOverlayState.originalImage) {
    showToast('No image loaded');
    return;
  }

  // Create a full-resolution canvas for download
  const downloadCanvas = document.createElement('canvas');
  const downloadCtx = downloadCanvas.getContext('2d');
  const img = textOverlayState.originalImage;

  downloadCanvas.width = img.naturalWidth || img.width;
  downloadCanvas.height = img.naturalHeight || img.height;

  // Draw original image at full resolution
  downloadCtx.drawImage(img, 0, 0, downloadCanvas.width, downloadCanvas.height);

  // If there's text, render it at full resolution
  if (text.trim()) {
    const scaleFactor = downloadCanvas.width / canvas.width;

    const fontSize = (parseInt(document.getElementById('overlay-font-size').value) || 48) * scaleFactor;
    const fontFamily = document.getElementById('overlay-font').value || 'Arial Black';
    const position = document.getElementById('overlay-position').value || 'center';
    const textColor = document.getElementById('overlay-text-color').value || '#ffffff';
    const strokeColor = document.getElementById('overlay-stroke-color').value || '#000000';
    const strokeWidth = (parseInt(document.getElementById('overlay-stroke-width').value) || 3) * scaleFactor;

    downloadCtx.font = `bold ${fontSize}px "${fontFamily}"`;
    downloadCtx.textAlign = 'center';
    downloadCtx.textBaseline = 'middle';

    const lines = text.split('\n');
    const lineHeight = fontSize * 1.2;
    const totalHeight = lines.length * lineHeight;

    let startY;
    switch (position) {
      case 'top':
        startY = fontSize + (20 * scaleFactor);
        break;
      case 'bottom':
        startY = downloadCanvas.height - totalHeight - (20 * scaleFactor) + (lineHeight / 2);
        break;
      case 'center':
      default:
        startY = (downloadCanvas.height - totalHeight) / 2 + (lineHeight / 2);
    }

    lines.forEach((line, i) => {
      const y = startY + (i * lineHeight);
      const x = downloadCanvas.width / 2;

      if (strokeWidth > 0) {
        downloadCtx.strokeStyle = strokeColor;
        downloadCtx.lineWidth = strokeWidth * 2;
        downloadCtx.lineJoin = 'round';
        downloadCtx.strokeText(line, x, y);
      }

      downloadCtx.fillStyle = textColor;
      downloadCtx.fillText(line, x, y);
    });
  }

  // Download
  const link = document.createElement('a');
  link.download = `scene-${textOverlayState.sceneIndex + 1}-with-text-${Date.now()}.png`;
  link.href = downloadCanvas.toDataURL('image/png');
  link.click();

  showToast('Image with text overlay downloaded!', false);
}

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

// Store converted visual scene descriptions
let convertedVisualScenes = null;

// Convert script to visual scene descriptions using AI
async function convertScriptToVisualScenes() {
  const script = scriptInput.value.trim();
  if (!script) {
    showToast('Please enter a script first');
    return null;
  }

  const sceneCount = getCurrentSceneCount();

  // Gather brand rules if enabled
  let brandRules = null;
  const brandEnabled = document.getElementById('brand-rules-enabled')?.checked;
  if (brandEnabled) {
    brandRules = {
      mood: document.getElementById('brand-mood')?.value || '',
      lighting: document.getElementById('brand-lighting')?.value || '',
      colors: document.getElementById('brand-colors')?.value || '',
      avoid: document.getElementById('brand-avoid')?.value || ''
    };
  }

  showLoading('Converting script to visual scenes...', 'AI is analyzing your script');

  try {
    const response = await fetch('/api/script-to-scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        script,
        sceneCount,
        brandRules
      })
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    // Store the converted scenes
    convertedVisualScenes = data.scenes;

    hideLoading();
    showToast(`Script converted to ${data.scenes.length} visual scenes!`, false);

    // Show a preview of the converted scenes
    showConvertedScenesPreview(data.scenes);

    return data.scenes;

  } catch (error) {
    hideLoading();
    console.error('Script conversion error:', error);
    showToast(`Conversion failed: ${error.message}`);
    return null;
  }
}

// Show preview of converted visual scenes before generation
function showConvertedScenesPreview(scenes) {
  const previewContainer = document.getElementById('converted-scenes-preview');
  if (!previewContainer) return;

  previewContainer.innerHTML = `
    <div class="converted-preview-header">
      <h4>Visual Scene Descriptions</h4>
      <p>Review and edit before generating images</p>
    </div>
    <div class="converted-scenes-list">
      ${scenes.map((scene, i) => `
        <div class="converted-scene-item">
          <div class="scene-number">Scene ${scene.sceneNumber || i + 1}</div>
          <div class="scene-mood">${scene.mood || ''}</div>
          <textarea class="scene-visual-input" data-scene-index="${i}" rows="3">${scene.visualDescription}</textarea>
          <div class="scene-excerpt">"${scene.scriptExcerpt || ''}"</div>
        </div>
      `).join('')}
    </div>
    <div class="converted-preview-actions">
      <button class="btn secondary" onclick="clearConvertedScenes()">Clear & Re-convert</button>
      <button class="btn primary" onclick="generateFromVisualScenes()">Generate Images</button>
    </div>
  `;
  previewContainer.hidden = false;
  previewContainer.scrollIntoView({ behavior: 'smooth' });
}

// Clear converted scenes
function clearConvertedScenes() {
  convertedVisualScenes = null;
  const previewContainer = document.getElementById('converted-scenes-preview');
  if (previewContainer) {
    previewContainer.innerHTML = '';
    previewContainer.hidden = true;
  }
}

// Get visual scenes (either from conversion or fallback to raw script)
function getVisualScenesForGeneration() {
  // If we have converted visual scenes, use them
  if (convertedVisualScenes && convertedVisualScenes.length > 0) {
    // Check if user edited any scenes
    const editedScenes = [];
    document.querySelectorAll('.scene-visual-input').forEach((input, i) => {
      editedScenes[i] = {
        ...convertedVisualScenes[i],
        visualDescription: input.value
      };
    });
    return editedScenes.length > 0 ? editedScenes : convertedVisualScenes;
  }

  // Fallback to raw script parsing (old behavior)
  return getScenesForGeneration().map((text, i) => ({
    sceneNumber: i + 1,
    visualDescription: text,
    scriptExcerpt: text.substring(0, 50),
    mood: ''
  }));
}

// Generate images from visual scene descriptions
async function generateFromVisualScenes() {
  const visualScenes = getVisualScenesForGeneration();

  if (visualScenes.length === 0) {
    showToast('No scenes to generate');
    return;
  }

  // Hide the preview
  const previewContainer = document.getElementById('converted-scenes-preview');
  if (previewContainer) previewContainer.hidden = true;

  const size = document.getElementById('batch-size').value;
  const quality = document.getElementById('batch-quality').value;
  const model = document.getElementById('batch-model')?.value || 'dall-e-3';

  generatedScenes = [];
  scenesGrid.innerHTML = '';
  scenesContainer.hidden = false;

  // Create placeholder cards
  visualScenes.forEach((scene, index) => {
    const displayText = scene.scriptExcerpt || scene.visualDescription.substring(0, 100);
    const card = createSceneCard(index, displayText, null, true);
    scenesGrid.appendChild(card);
  });

  showLoading('Generating scenes...', `0 of ${visualScenes.length} scenes`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < visualScenes.length; i++) {
    const scene = visualScenes[i];
    const styledPrompt = buildStyledPrompt(scene.visualDescription, selectedStyle);

    updateLoadingProgress(i + 1, visualScenes.length);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: styledPrompt, size, quality, model })
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      generatedScenes[i] = {
        index: i,
        text: scene.scriptExcerpt || scene.visualDescription,
        visualDescription: scene.visualDescription,
        imageUrl: data.image,
        prompt: styledPrompt,
        revisedPrompt: data.revised_prompt
      };

      updateSceneCard(i, data.image);
      successCount++;

    } catch (error) {
      console.error(`Failed to generate scene ${i + 1}:`, error);
      markSceneError(i);
      failCount++;
    }

    if (i < visualScenes.length - 1) {
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

// Make functions globally available
window.convertScriptToVisualScenes = convertScriptToVisualScenes;
window.clearConvertedScenes = clearConvertedScenes;
window.generateFromVisualScenes = generateFromVisualScenes;

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

  // Calculate cost estimate based on selected model
  const model = document.getElementById('batch-model').value;
  const quality = document.getElementById('batch-quality').value;
  const size = document.getElementById('batch-size').value;

  let costPerImage = 0.04; // Default DALL-E standard

  switch (model) {
    case 'dall-e-3':
      if (quality === 'hd') {
        costPerImage = size === '1024x1024' ? 0.08 : 0.12;
      } else {
        costPerImage = size === '1024x1024' ? 0.04 : 0.08;
      }
      break;
    case 'flux-schnell':
      costPerImage = 0.003;
      break;
    case 'flux-pro':
      costPerImage = 0.05;
      break;
    case 'stable-diffusion-xl':
      costPerImage = 0.002;
      break;
    case 'stable-diffusion-3':
      costPerImage = 0.065;
      break;
    default:
      costPerImage = 0.04;
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
document.getElementById('batch-model').addEventListener('change', updateScriptStats);
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
function buildStyledPrompt(sceneDescription, style, includeInspiration = true) {
  const styleInfo = STYLE_PRESETS[style];
  let basePrompt = sceneDescription;

  if (styleInfo) {
    basePrompt = `${sceneDescription}. Style: ${styleInfo.prompt}`;
  }

  // Add style anchor consistency instructions if an anchor is set
  if (styleAnchor && styleAnchor.revisedPrompt) {
    // Extract key visual elements from the anchor's revised prompt
    basePrompt += `. CRITICAL STYLE CONSISTENCY: Match the exact visual style, lighting, color palette, and mood of this reference - ${styleAnchor.revisedPrompt.substring(0, 200)}. Maintain identical art direction, same color grading, same lighting setup, same level of detail`;
  } else if (styleAnchor) {
    // Fallback if no revised prompt available
    basePrompt += `. CRITICAL STYLE CONSISTENCY: Match the exact visual style, lighting, color palette, and artistic approach used in the anchor scene. Maintain identical art direction across all scenes for visual continuity`;
  }

  // Add character consistency instructions if locked characters are mentioned
  const charInstructions = getCharacterInstructions(sceneDescription);
  if (charInstructions) {
    basePrompt += charInstructions;
  }

  // Add brand styling rules if enabled
  const brandInstructions = getBrandInstructions();
  if (brandInstructions) {
    basePrompt += brandInstructions;
  }

  // Add avatar/character instructions if enabled
  const avatarInstructions = getAvatarInstructions();
  if (avatarInstructions) {
    basePrompt += avatarInstructions;
  }

  // Add inspiration reference note if available
  // Note: DALL-E can't see images, but we add context about wanting similar aesthetic
  if (includeInspiration && typeof sceneInspirationUrl !== 'undefined' && sceneInspirationUrl) {
    basePrompt += '. Create with a polished, professional YouTube video aesthetic, eye-catching visuals optimized for video content';
  }

  return `${basePrompt}. No text, no faces visible, faceless characters suitable for faceless YouTube videos.`;
}

// API Functions
async function generateImage() {
  const prompt = document.getElementById('generate-prompt').value.trim();
  const size = document.getElementById('generate-size').value;
  const style = document.getElementById('single-style').value;
  const quality = document.getElementById('generate-quality').value;
  const model = document.getElementById('generate-model')?.value || 'dall-e-3';

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
      body: JSON.stringify({ prompt: styledPrompt, size, quality, model })
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    lastGenerateParams = { prompt: styledPrompt, size, quality, model };
    showResult(data.image, data.revised_prompt);
    showToast('Image generated successfully!', false);

    // Save to history
    if (typeof generationHistory !== 'undefined') {
      generationHistory.add({
        type: 'single',
        prompt: styledPrompt,
        imageUrl: data.image,
        model: model,
        size: size,
        quality: quality,
        style: style || null
      });
    }
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
      const model = document.getElementById('batch-model')?.value || 'dall-e-3';
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: styledPrompt, size, quality, model })
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

      // Save to history
      if (typeof generationHistory !== 'undefined') {
        generationHistory.add({
          type: 'batch',
          prompt: styledPrompt,
          imageUrl: data.image,
          model: model,
          size: size,
          quality: quality,
          style: selectedStyle
        });
      }

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

  // Get selected model
  const model = document.getElementById('batch-model')?.value || 'dall-e-3';

  // Generate scenes sequentially to avoid rate limits
  for (let i = 0; i < scenes.length; i++) {
    const sceneText = scenes[i];
    const styledPrompt = buildStyledPrompt(sceneText, selectedStyle);

    updateLoadingProgress(i + 1, scenes.length);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: styledPrompt, size, quality, model })
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

  const isAnchor = styleAnchor && styleAnchor.sceneIndex === index;
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
      <button class="scene-anchor-btn ${isAnchor ? 'is-anchor' : ''}" onclick="setStyleAnchor(${index})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="5" r="3"/>
          <line x1="12" y1="8" x2="12" y2="21"/>
          <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
        </svg>
        ${isAnchor ? 'Style Anchor' : 'Set as Anchor'}
      </button>
      <button class="btn secondary" onclick="regenerateScene(${index})">Regenerate</button>
      <button class="btn secondary" onclick="downloadScene(${index})">Download</button>
      <button class="btn secondary text-overlay-btn" onclick="openTextOverlay(${index})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <path d="M4 7V4h16v3"/>
          <path d="M9 20h6"/>
          <path d="M12 4v16"/>
        </svg>
        Add Text
      </button>
    </div>
  `;

  if (isAnchor) {
    card.classList.add('is-style-anchor');
  }

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
  const model = document.getElementById('batch-model')?.value || 'dall-e-3';

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: scene.prompt, size, quality, model })
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    generatedScenes[index].imageUrl = data.image;
    generatedScenes[index].revisedPrompt = data.revised_prompt;

    updateSceneCard(index, data.image);
    showToast('Scene regenerated!', false);

    // Save to history
    if (typeof generationHistory !== 'undefined') {
      generationHistory.add({
        type: 'batch',
        prompt: scene.prompt,
        imageUrl: data.image,
        model: model,
        size: size,
        quality: quality
      });
    }

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

// Convert Script Button Handler
if (convertScriptBtn) {
  convertScriptBtn.addEventListener('click', convertScriptToVisualScenes);
}

// Make functions globally available for onclick handlers
window.regenerateScene = regenerateScene;
window.downloadScene = downloadScene;
window.setStyleAnchor = setStyleAnchor;
window.clearStyleAnchor = clearStyleAnchor;
window.toggleCharacterPanel = toggleCharacterPanel;
window.addCharacter = addCharacter;
window.removeCharacter = removeCharacter;
window.toggleBrandPanel = toggleBrandPanel;
window.toggleBrandBlock = toggleBrandBlock;
window.toggleAvatarPanel = toggleAvatarPanel;
window.toggleAvatarUsage = toggleAvatarUsage;
window.switchToTabAndOpenAvatar = switchToTabAndOpenAvatar;
window.openTextOverlay = openTextOverlay;
window.closeTextOverlay = closeTextOverlay;
window.updateTextOverlay = updateTextOverlay;
window.downloadWithTextOverlay = downloadWithTextOverlay;

// Text Overlay Control Event Listeners
document.addEventListener('DOMContentLoaded', function() {
  const overlayText = document.getElementById('overlay-text');
  const overlayFontSize = document.getElementById('overlay-font-size');
  const overlayFont = document.getElementById('overlay-font');
  const overlayPosition = document.getElementById('overlay-position');
  const overlayTextColor = document.getElementById('overlay-text-color');
  const overlayStrokeColor = document.getElementById('overlay-stroke-color');
  const overlayStrokeWidth = document.getElementById('overlay-stroke-width');

  if (overlayText) overlayText.addEventListener('input', updateTextOverlay);
  if (overlayFontSize) overlayFontSize.addEventListener('input', updateTextOverlay);
  if (overlayFont) overlayFont.addEventListener('change', updateTextOverlay);
  if (overlayPosition) overlayPosition.addEventListener('change', updateTextOverlay);
  if (overlayTextColor) overlayTextColor.addEventListener('input', updateTextOverlay);
  if (overlayStrokeColor) overlayStrokeColor.addEventListener('input', updateTextOverlay);
  if (overlayStrokeWidth) overlayStrokeWidth.addEventListener('input', updateTextOverlay);

  // Initialize avatar upload functionality
  initAvatarUpload();

  // Initialize thumbnail gallery from localStorage on page load
  if (thumbnailHistory && thumbnailHistory.length > 0) {
    updateThumbnailGallery();
  }
});

// Clear Anchor Button Handler
const clearAnchorBtn = document.getElementById('clear-anchor-btn');
if (clearAnchorBtn) {
  clearAnchorBtn.addEventListener('click', clearStyleAnchor);
}

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

// Reference Thumbnail Elements
const refThumbUploadArea = document.getElementById('reference-thumb-upload');
const refThumbFileInput = document.getElementById('reference-thumb-file');
const refThumbPlaceholder = document.getElementById('reference-placeholder');
const refThumbPreview = document.getElementById('reference-thumb-preview');
const refThumbImage = document.getElementById('reference-thumb-image');
const refTypeButtons = document.querySelectorAll('.ref-type-btn');
const clearRefThumbBtn = document.getElementById('clear-reference-thumb');

let selectedThumbnailStyle = 'dramatic';
let lastThumbnailParams = null;
let thumbnailHistory = loadThumbnailHistory(); // Load from localStorage
let referenceThumbData = null; // Stores { type: 'do-this' | 'dont-do-this', imageDescription: string }

// Load thumbnail history from localStorage
function loadThumbnailHistory() {
  try {
    const saved = localStorage.getItem('thumbnailHistory');
    return saved ? JSON.parse(saved) : [];
  } catch (e) {
    console.error('Failed to load thumbnail history:', e);
    return [];
  }
}

// Save thumbnail history to localStorage
function saveThumbnailHistory() {
  try {
    localStorage.setItem('thumbnailHistory', JSON.stringify(thumbnailHistory));
  } catch (e) {
    console.error('Failed to save thumbnail history:', e);
  }
}

// Note: Thumbnail gallery initialization moved to DOMContentLoaded handler

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
function buildThumbnailPrompt(description, style, textHook = '', referenceData = null) {
  const styleInfo = THUMBNAIL_STYLES[style];
  let prompt = description;

  if (styleInfo) {
    prompt += `. Style: ${styleInfo.prompt}`;
  }

  if (textHook) {
    prompt += `. Include bold readable text saying "${textHook}" as part of the composition`;
  }

  // Add avatar/character instructions if enabled
  const avatarInstructions = getAvatarInstructions();
  if (avatarInstructions) {
    prompt += avatarInstructions;
  }

  // Add reference guidance if provided
  if (referenceData && referenceData.type) {
    if (referenceData.type === 'do-this') {
      prompt += `. IMPORTANT: Create something similar in style and approach to this successful thumbnail concept. Follow the visual patterns, color schemes, and composition techniques that make it effective`;
    } else if (referenceData.type === 'dont-do-this') {
      prompt += `. IMPORTANT: Avoid the approach shown in the reference. Do NOT use similar colors, composition, or style. Create the OPPOSITE - make it more eye-catching, professional, and engaging. Avoid these common thumbnail mistakes`;
    }
  }

  prompt += '. YouTube thumbnail format, 16:9 aspect ratio, designed to get clicks, no small details that won\'t be visible at thumbnail size.';

  return prompt;
}

// Generate Thumbnail
async function generateThumbnail() {
  const description = thumbnailPromptInput ? thumbnailPromptInput.value.trim() : '';
  const textHook = thumbnailHookInput ? thumbnailHookInput.value.trim() : '';
  const quality = thumbnailQualitySelect ? thumbnailQualitySelect.value : 'hd';
  const model = document.getElementById('thumbnail-model')?.value || 'dall-e-3';

  if (!description) {
    showToast('Please describe your thumbnail');
    return;
  }

  const prompt = buildThumbnailPrompt(description, selectedThumbnailStyle, textHook, referenceThumbData);

  const loadingMsg = referenceThumbData
    ? `Creating your thumbnail (using reference: ${referenceThumbData.type === 'do-this' ? 'DO this' : "DON'T do this"})...`
    : 'Creating your thumbnail...';
  showLoading(loadingMsg);

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt,
        size: '1792x1024', // YouTube thumbnail aspect ratio
        quality: quality,
        model: model
      })
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    // Store params for regeneration
    lastThumbnailParams = { prompt, size: '1792x1024', quality, model };

    // Show result
    if (thumbnailImage) {
      thumbnailImage.src = data.image;
    }
    if (thumbnailResult) {
      thumbnailResult.hidden = false;
    }

    // Add to session history
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
    saveThumbnailHistory(); // Persist to localStorage

    // Save to persistent history
    if (typeof generationHistory !== 'undefined') {
      generationHistory.add({
        type: 'thumbnail',
        prompt: prompt,
        imageUrl: data.image,
        model: model,
        size: '1792x1024',
        quality: quality,
        style: selectedThumbnailStyle
      });
    }

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

    // Add to session history
    thumbnailHistory.unshift({
      imageUrl: data.image,
      prompt: lastThumbnailParams.prompt,
      timestamp: Date.now()
    });

    if (thumbnailHistory.length > 10) {
      thumbnailHistory = thumbnailHistory.slice(0, 10);
    }

    updateThumbnailGallery();
    saveThumbnailHistory(); // Persist to localStorage

    // Save to persistent history
    if (typeof generationHistory !== 'undefined') {
      generationHistory.add({
        type: 'thumbnail',
        prompt: lastThumbnailParams.prompt,
        imageUrl: data.image,
        model: 'dall-e-3',
        size: lastThumbnailParams.size,
        quality: lastThumbnailParams.quality
      });
    }

    showToast('Thumbnail regenerated!', false);

  } catch (error) {
    showToast(error.message);
  } finally {
    hideLoading();
  }
}

// Refine Thumbnail with Feedback
async function refineThumbnail() {
  const feedbackInput = document.getElementById('thumbnail-feedback');
  const feedback = feedbackInput ? feedbackInput.value.trim() : '';

  if (!lastThumbnailParams) {
    showToast('No thumbnail to refine. Generate one first.');
    return;
  }

  if (!feedback) {
    showToast('Please describe what to change');
    return;
  }

  showLoading('Refining thumbnail with your feedback...');

  try {
    // Append feedback to the original prompt
    const refinedPrompt = `${lastThumbnailParams.prompt}\n\nIMPORTANT ADJUSTMENTS: ${feedback}`;

    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...lastThumbnailParams,
        prompt: refinedPrompt
      })
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    // Update the stored params with the refined prompt
    lastThumbnailParams.prompt = refinedPrompt;

    if (thumbnailImage) {
      thumbnailImage.src = data.image;
    }

    // Add to session history
    thumbnailHistory.unshift({
      imageUrl: data.image,
      prompt: refinedPrompt,
      timestamp: Date.now()
    });

    if (thumbnailHistory.length > 10) {
      thumbnailHistory = thumbnailHistory.slice(0, 10);
    }

    updateThumbnailGallery();
    saveThumbnailHistory(); // Persist to localStorage

    // Save to persistent history
    if (typeof generationHistory !== 'undefined') {
      generationHistory.add({
        type: 'thumbnail',
        prompt: refinedPrompt,
        imageUrl: data.image,
        model: lastThumbnailParams.model || 'dall-e-3',
        size: lastThumbnailParams.size,
        quality: lastThumbnailParams.quality
      });
    }

    // Clear feedback input
    if (feedbackInput) feedbackInput.value = '';

    showToast('Thumbnail refined!', false);

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

// Refine button
const refineThumbnailBtn = document.getElementById('refine-thumbnail-btn');
if (refineThumbnailBtn) {
  refineThumbnailBtn.addEventListener('click', refineThumbnail);
}

// Allow Enter key in feedback input to trigger refine
const thumbnailFeedbackInput = document.getElementById('thumbnail-feedback');
if (thumbnailFeedbackInput) {
  thumbnailFeedbackInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      refineThumbnail();
    }
  });
}

// ============================================
// REFERENCE THUMBNAIL UPLOAD
// ============================================

// Handle reference thumbnail upload area click
if (refThumbUploadArea) {
  refThumbUploadArea.addEventListener('click', (e) => {
    // Only trigger file input if clicking on the upload area, not on buttons
    if (!e.target.closest('.reference-controls') && !e.target.closest('.ref-type-btn')) {
      refThumbFileInput?.click();
    }
  });

  // Drag and drop support
  refThumbUploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    refThumbUploadArea.classList.add('dragover');
  });

  refThumbUploadArea.addEventListener('dragleave', () => {
    refThumbUploadArea.classList.remove('dragover');
  });

  refThumbUploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    refThumbUploadArea.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleReferenceThumbUpload(file);
    }
  });
}

// Handle file input change
if (refThumbFileInput) {
  refThumbFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      handleReferenceThumbUpload(file);
    }
  });
}

// Handle reference type toggle buttons
refTypeButtons.forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent triggering upload area click
    refTypeButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (referenceThumbData) {
      referenceThumbData.type = btn.dataset.refType;
    }
  });
});

// Clear reference thumbnail
if (clearRefThumbBtn) {
  clearRefThumbBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent triggering upload area click
    clearReferenceThumbnail();
  });
}

// Handle reference thumbnail upload
function handleReferenceThumbUpload(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const imageData = e.target.result;

    // Set the preview image
    if (refThumbImage) {
      refThumbImage.src = imageData;
    }

    // Show preview, hide placeholder
    if (refThumbPlaceholder) refThumbPlaceholder.hidden = true;
    if (refThumbPreview) refThumbPreview.hidden = false;

    // Get currently selected type
    const activeTypeBtn = document.querySelector('.ref-type-btn.active');
    const selectedType = activeTypeBtn ? activeTypeBtn.dataset.refType : 'do-this';

    // Store the reference data
    referenceThumbData = {
      type: selectedType,
      hasImage: true
    };

    showToast(`Reference uploaded! Using as "${selectedType === 'do-this' ? 'Do This' : "Don't Do This"}" example.`, false);
  };
  reader.readAsDataURL(file);
}

// Clear reference thumbnail
function clearReferenceThumbnail() {
  referenceThumbData = null;

  if (refThumbImage) refThumbImage.src = '';
  if (refThumbPlaceholder) refThumbPlaceholder.hidden = false;
  if (refThumbPreview) refThumbPreview.hidden = true;
  if (refThumbFileInput) refThumbFileInput.value = '';

  // Reset to "Do This" as default
  refTypeButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.refType === 'do-this');
  });

  showToast('Reference thumbnail cleared', false);
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

// ============================================
// YOUTUBE INSPIRATION FOR SCENE GENERATOR
// ============================================

const fetchSceneInspirationBtn = document.getElementById('fetch-scene-inspiration');
const sceneYoutubeUrl = document.getElementById('scene-youtube-url');
const sceneInspirationPreview = document.getElementById('scene-inspiration-preview');
const sceneInspirationImage = document.getElementById('scene-inspiration-image');
const sceneInspirationTitle = document.getElementById('scene-inspiration-title');
const clearSceneInspirationBtn = document.getElementById('clear-scene-inspiration');

if (fetchSceneInspirationBtn && sceneYoutubeUrl) {
  fetchSceneInspirationBtn.addEventListener('click', () => {
    const url = sceneYoutubeUrl.value.trim();

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
      if (sceneInspirationImage) sceneInspirationImage.src = thumbUrl;
      if (sceneInspirationTitle) sceneInspirationTitle.textContent = `Style Reference: ${videoId}`;
      if (sceneInspirationPreview) sceneInspirationPreview.hidden = false;
      sceneInspirationUrl = thumbUrl;
      showToast('Style reference loaded! Your scenes will draw inspiration from this style.', false);
    };
    img.onerror = function() {
      // Fall back to hqdefault
      const fallbackUrl = getYouTubeThumbnailUrl(videoId, 'hqdefault');
      if (sceneInspirationImage) sceneInspirationImage.src = fallbackUrl;
      if (sceneInspirationTitle) sceneInspirationTitle.textContent = `Style Reference: ${videoId}`;
      if (sceneInspirationPreview) sceneInspirationPreview.hidden = false;
      sceneInspirationUrl = fallbackUrl;
      showToast('Style reference loaded! Your scenes will draw inspiration from this style.', false);
    };
    img.src = thumbUrl;
  });
}

if (clearSceneInspirationBtn) {
  clearSceneInspirationBtn.addEventListener('click', () => {
    if (sceneYoutubeUrl) sceneYoutubeUrl.value = '';
    if (sceneInspirationImage) sceneInspirationImage.src = '';
    if (sceneInspirationPreview) sceneInspirationPreview.hidden = true;
    sceneInspirationUrl = null;
  });
}

// Allow pressing Enter in scene YouTube URL field to fetch
if (sceneYoutubeUrl) {
  sceneYoutubeUrl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      fetchSceneInspirationBtn?.click();
    }
  });
}
