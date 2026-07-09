// Style Presets - Prompt Engineering for each visual style
const STYLE_PRESETS = {
  'photorealistic': {
    name: 'Photorealistic Film',
    prompt: 'cinematic film scene, professional movie production, dramatic lighting, shallow depth of field, high quality cinematography, movie scene aesthetic, Hollywood film look, professional color grading, feature film quality',
  },
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

// Scene Persistence Functions
function saveSceneHistory() {
  try {
    const validScenes = generatedScenes.filter(s => s && s.imageUrl);
    if (validScenes.length === 0) return;

    const sceneData = {
      scenes: validScenes.map(s => ({
        text: s.text,
        imageUrl: s.imageUrl,
        revisedPrompt: s.revisedPrompt || ''
      })),
      script: scriptInput?.value || '',
      timestamp: Date.now()
    };

    localStorage.setItem('sceneHistory', JSON.stringify(sceneData));
    console.log('Scene history saved:', validScenes.length, 'scenes');
  } catch (e) {
    console.error('Failed to save scene history:', e);
  }
}

function loadSceneHistory() {
  try {
    const saved = localStorage.getItem('sceneHistory');
    if (!saved) return null;
    return JSON.parse(saved);
  } catch (e) {
    console.error('Failed to load scene history:', e);
    return null;
  }
}

function restoreSceneHistory() {
  const sceneData = loadSceneHistory();
  if (!sceneData || !sceneData.scenes || sceneData.scenes.length === 0) return;

  // Restore script if present
  if (sceneData.script && scriptInput) {
    scriptInput.value = sceneData.script;
  }

  // Restore scenes
  generatedScenes = sceneData.scenes.map((s, i) => ({
    text: s.text,
    imageUrl: s.imageUrl,
    revisedPrompt: s.revisedPrompt || ''
  }));

  // Render the scene cards
  const gallery = document.getElementById('scene-gallery');
  if (!gallery) return;

  gallery.innerHTML = '';
  gallery.hidden = false;

  generatedScenes.forEach((scene, index) => {
    const card = createSceneCard(index, scene.text, scene.imageUrl);
    gallery.appendChild(card);
  });

  // Show the gallery section
  const gallerySection = document.querySelector('.batch-results');
  if (gallerySection) gallerySection.hidden = false;

  console.log('Restored', generatedScenes.length, 'scenes from history');
}

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
// USER ID & SUPABASE SYNC
// ============================================

// Get or create a persistent user ID
function getUserId() {
  let userId = localStorage.getItem('ai_tool_user_id');
  if (!userId) {
    userId = 'user_' + crypto.randomUUID();
    localStorage.setItem('ai_tool_user_id', userId);
  }
  return userId;
}

const USER_ID = getUserId();
let supabaseConnected = false;

// Check Supabase connection on load
async function checkSupabaseConnection() {
  try {
    const response = await fetch('/api/db/status');
    const data = await response.json();
    supabaseConnected = data.connected;
    console.log('Supabase connected:', supabaseConnected);
    return supabaseConnected;
  } catch (e) {
    console.log('Supabase not available, using localStorage');
    return false;
  }
}

// ============================================
// AVATAR UPLOAD FEATURE
// For consistent character appearance across all scenes
// ============================================

// Load avatar state from localStorage first (fast), then sync from Supabase
const savedAvatar = loadAvatarStateLocal();
let avatarEnabled = savedAvatar.enabled;
let avatarImageData = savedAvatar.imageData;
let avatarDescription = savedAvatar.description;
let useCharacterRef = savedAvatar.useCharacterRef || false;

// Load from localStorage (synchronous, for initial render)
function loadAvatarStateLocal() {
  try {
    const saved = localStorage.getItem('avatarState');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load avatar state:', e);
  }
  return { enabled: false, imageData: null, description: '', useCharacterRef: false };
}

// Toggle Character Reference mode (full character matching)
function toggleCharacterRef() {
  const checkbox = document.getElementById('use-character-ref');
  useCharacterRef = checkbox?.checked || false;
  saveAvatarState();

  if (useCharacterRef && !avatarImageData) {
    showToast('Please upload an avatar photo first');
    checkbox.checked = false;
    useCharacterRef = false;
  } else if (useCharacterRef) {
    showToast('Character Reference enabled - scenes will match your full appearance!', false);
  }
}

// Make toggleCharacterRef available globally
window.toggleCharacterRef = toggleCharacterRef;

// Load from Supabase (async, called on page load)
async function loadAvatarStateFromDB() {
  if (!supabaseConnected) return null;

  try {
    const response = await fetch(`/api/db/avatar/${USER_ID}`);
    const data = await response.json();

    if (data.success && data.avatar) {
      return {
        enabled: data.avatar.enabled,
        imageData: data.avatar.image_url,
        description: data.avatar.description || ''
      };
    }
  } catch (e) {
    console.error('Failed to load avatar from DB:', e);
  }
  return null;
}

// Save to both localStorage and Supabase
async function saveAvatarState() {
  // Always save to localStorage (fast, offline support)
  try {
    localStorage.setItem('avatarState', JSON.stringify({
      enabled: avatarEnabled,
      imageData: avatarImageData,
      description: avatarDescription,
      useCharacterRef: useCharacterRef
    }));
  } catch (e) {
    console.error('Failed to save avatar state to localStorage:', e);
  }

  // Also sync to Supabase if connected
  if (supabaseConnected && avatarImageData) {
    try {
      await fetch('/api/db/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: USER_ID,
          imageData: avatarImageData,
          description: avatarDescription,
          enabled: avatarEnabled
        })
      });
      console.log('Avatar synced to Supabase');
    } catch (e) {
      console.error('Failed to sync avatar to Supabase:', e);
    }
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

async function handleAvatarUpload(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('Please upload a valid image file');
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    avatarImageData = e.target.result;

    // Show preview
    const placeholder = document.getElementById('avatar-placeholder');
    const preview = document.getElementById('avatar-preview');
    const avatarImage = document.getElementById('avatar-image');
    const descSection = document.getElementById('avatar-description-section');
    const statusEl = document.getElementById('avatar-status');
    const descInput = document.getElementById('avatar-description');

    if (placeholder) placeholder.hidden = true;
    if (preview) {
      preview.hidden = false;
      if (avatarImage) avatarImage.src = avatarImageData;
    }
    if (descSection) descSection.hidden = false;

    // Update status to analyzing
    if (statusEl) {
      statusEl.textContent = 'Analyzing...';
      statusEl.classList.add('active');
    }

    // Enable by default when uploaded
    const checkbox = document.getElementById('avatar-enabled');
    if (checkbox) {
      checkbox.checked = true;
      avatarEnabled = true;
    }

    updateAvatarStatusIndicators();
    showToast('Analyzing your avatar with AI...');

    // Auto-analyze the avatar with GPT-4 Vision
    try {
      const formData = new FormData();
      formData.append('image', file);

      console.log('Sending avatar for analysis, file size:', file.size, 'type:', file.type);

      const response = await fetch('/api/analyze-avatar', {
        method: 'POST',
        body: formData
      });

      console.log('Analysis response status:', response.status);
      const data = await response.json();
      console.log('Analysis response data:', data);

      if (data.success && data.description) {
        // Fill in the description automatically
        avatarDescription = data.description;
        if (descInput) {
          descInput.value = data.description;
        }

        if (statusEl) {
          statusEl.textContent = 'Ready';
        }

        saveAvatarState();
        updateAvatarStatusIndicators();
        showToast('Avatar analyzed! Your appearance has been captured.', false);
        console.log('Avatar description:', data.description);
      } else {
        const errorMsg = data.error || 'Analysis failed';
        console.error('Analysis returned error:', errorMsg);
        throw new Error(errorMsg);
      }
    } catch (error) {
      console.error('Avatar analysis failed:', error.message || error);
      if (statusEl) {
        statusEl.textContent = 'Describe manually';
      }
      // Show actual error to help debug
      showToast(`Analysis failed: ${error.message || 'Unknown error'}. Please describe manually.`);
    }
  };
  reader.readAsDataURL(file);
}

function removeAvatar() {
  avatarImageData = null;
  avatarDescription = '';
  avatarEnabled = false;

  const placeholder = document.getElementById('avatar-placeholder');
  const preview = document.getElementById('avatar-preview');
  const avatarImage = document.getElementById('avatar-image');
  const descSection = document.getElementById('avatar-description-section');
  const statusEl = document.getElementById('avatar-status');
  const descInput = document.getElementById('avatar-description');
  const checkbox = document.getElementById('avatar-enabled');
  const fileInput = document.getElementById('avatar-file');

  if (placeholder) placeholder.hidden = false;
  if (preview) preview.hidden = true;
  if (avatarImage) avatarImage.src = ''; // Clear the image source
  if (descSection) descSection.hidden = true;
  if (statusEl) {
    statusEl.textContent = 'No avatar';
    statusEl.classList.remove('active');
  }
  if (descInput) descInput.value = '';
  if (checkbox) checkbox.checked = false;
  if (fileInput) fileInput.value = ''; // Reset file input

  updateAvatarStatusIndicators(); // Update status across all tabs
  saveAvatarState(); // Auto-save to localStorage
  showToast('Avatar removed');
}

function getAvatarInstructions() {
  if (!avatarEnabled || !avatarImageData) return '';

  // Use stored variable first, fallback to DOM input
  const descInput = document.getElementById('avatar-description');
  const description = avatarDescription || descInput?.value.trim() || '';

  console.log('Avatar description being used:', description);

  if (!description) {
    // Basic instruction if no description provided
    return `. MAIN CHARACTER: Include a person as the main focus of the scene, maintaining consistent appearance throughout all scenes`;
  }

  // Detailed instruction with user's description - emphasize hair/appearance consistency
  return `. MAIN CHARACTER APPEARANCE (EXACT MATCH REQUIRED): ${description}. CRITICAL: This exact character with these EXACT physical features (especially hair color, hair style, skin tone) MUST appear consistently in every single scene. Do not vary the hair color or style.`;
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
    // Restore Character Reference checkbox
    const charRefCheckbox = document.getElementById('use-character-ref');
    if (charRefCheckbox) charRefCheckbox.checked = useCharacterRef;
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
    saveSceneHistory(); // Persist scenes to localStorage
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

  // Only add faceless instructions if avatar is NOT enabled
  if (avatarEnabled && avatarImageData) {
    return `${basePrompt}. No text or watermarks.`;
  } else {
    return `${basePrompt}. No text, no faces visible, faceless characters suitable for faceless YouTube videos.`;
  }
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

// Preview Mode - Generate test scenes based on selected count
async function generatePreviewScenes() {
  const script = scriptInput.value.trim();
  let allScenes = getScenesForGeneration();

  if (allScenes.length === 0) {
    showToast('Please enter a script with at least one scene');
    return;
  }

  // Get selected preview count from dropdown (1, 2, or 3)
  const previewCountSelect = document.getElementById('preview-count');
  const requestedCount = previewCountSelect ? parseInt(previewCountSelect.value) : 3;

  // Pick representative scenes based on requested count
  let previewIndices = [];
  const maxPreviews = Math.min(requestedCount, allScenes.length);

  if (maxPreviews === 1) {
    // Just the first scene
    previewIndices = [0];
  } else if (maxPreviews === 2) {
    // First and last scenes
    previewIndices = [0, allScenes.length - 1];
  } else {
    // First, middle, and last scenes
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

  // Add a preview header with dynamic description
  const previewHeader = document.createElement('div');
  previewHeader.className = 'preview-header';
  const scenePositions = previewScenes.length === 1 ? 'first scene' :
                         previewScenes.length === 2 ? 'first and last scenes' :
                         'beginning, middle, and end scenes';
  previewHeader.innerHTML = `
    <div class="preview-notice">
      <span class="preview-badge">Preview Mode</span>
      <p>Testing ${previewScenes.length} sample ${previewScenes.length === 1 ? 'scene' : 'scenes'} (${scenePositions}). Adjust style if needed, then generate all.</p>
    </div>
  `;
  scenesGrid.before(previewHeader);

  // Create placeholder cards for preview scenes
  previewScenes.forEach(({index, text}) => {
    const card = createSceneCard(index, text, null, true);
    scenesGrid.appendChild(card);
  });

  // Check if using Character Reference for face matching
  const shouldUseCharacterRef = useCharacterRef && avatarImageData;
  if (shouldUseCharacterRef) {
    showLoading('Generating preview with your face (Character Reference)...', `0 of ${previewScenes.length} scenes`);
  } else {
    showLoading('Generating preview...', `0 of ${previewScenes.length} scenes`);
  }

  let successCount = 0;
  let failCount = 0;

  // Generate preview scenes sequentially
  for (let i = 0; i < previewScenes.length; i++) {
    const { index, text } = previewScenes[i];
    const styledPrompt = buildStyledPrompt(text, selectedStyle);

    updateLoadingProgress(i + 1, previewScenes.length);

    try {
      const model = document.getElementById('batch-model')?.value || 'dall-e-3';
      let data;

      if (shouldUseCharacterRef) {
        // Use character reference to generate with user's full appearance
        const avatarBlob = await fetch(avatarImageData).then(r => r.blob());
        const [width, height] = size.split('x').map(Number);

        const formData = new FormData();
        formData.append('referenceImage', avatarBlob, 'avatar.png');
        formData.append('prompt', styledPrompt);
        formData.append('width', width);
        formData.append('height', height);

        const response = await fetch('/api/generate-with-reference', {
          method: 'POST',
          body: formData
        });
        data = await response.json();
      } else {
        // Use regular generation
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: styledPrompt, size, quality, model })
        });
        data = await response.json();
      }

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
    saveSceneHistory(); // Persist scenes to localStorage
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

  // Keep already generated scenes from preview, only clear the grid
  const existingScenes = [...generatedScenes];
  scenesGrid.innerHTML = '';
  scenesContainer.hidden = false;

  // Count how many scenes we need to generate (skip already generated ones)
  const scenesToGenerate = scenes.filter((_, i) => !existingScenes[i]?.imageUrl).length;

  // Create cards for all scenes - show existing images or placeholders
  scenes.forEach((scene, index) => {
    const existingImage = existingScenes[index]?.imageUrl || null;
    const card = createSceneCard(index, scene, existingImage, !existingImage);
    scenesGrid.appendChild(card);
  });

  // Restore existing scenes to the array
  generatedScenes = existingScenes;

  if (scenesToGenerate === 0) {
    showToast('All scenes already generated!');
    return;
  }

  showLoading('Generating scenes...', `0 of ${scenesToGenerate} scenes`);

  let successCount = 0;
  let failCount = 0;

  // Get selected model
  const model = document.getElementById('batch-model')?.value || 'dall-e-3';

  // Check if using Character Reference for face matching
  const shouldUseCharacterRef = useCharacterRef && avatarImageData;
  if (shouldUseCharacterRef) {
    showLoading('Generating scenes with your face (Character Reference)...', `0 of ${scenesToGenerate} scenes`);
  }

  // Generate scenes sequentially to avoid rate limits
  let generatedCount = 0;
  for (let i = 0; i < scenes.length; i++) {
    // Skip already generated scenes (from preview)
    if (generatedScenes[i]?.imageUrl) {
      console.log(`Skipping scene ${i + 1} - already generated`);
      continue;
    }

    const sceneText = scenes[i];
    const styledPrompt = buildStyledPrompt(sceneText, selectedStyle);

    generatedCount++;
    updateLoadingProgress(generatedCount, scenesToGenerate);

    try {
      let data;

      if (shouldUseCharacterRef) {
        // Use character reference to generate with user's full appearance
        const avatarBlob = await fetch(avatarImageData).then(r => r.blob());
        const [width, height] = size.split('x').map(Number);

        const formData = new FormData();
        formData.append('referenceImage', avatarBlob, 'avatar.png');
        formData.append('prompt', styledPrompt);
        formData.append('width', width);
        formData.append('height', height);

        const response = await fetch('/api/generate-with-reference', {
          method: 'POST',
          body: formData
        });
        data = await response.json();
      } else {
        // Use regular generation
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: styledPrompt, size, quality, model })
        });
        data = await response.json();
      }

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
    if (generatedCount < scenesToGenerate) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  hideLoading();

  const skippedCount = scenes.length - scenesToGenerate;
  if (successCount > 0) {
    const skippedMsg = skippedCount > 0 ? ` (${skippedCount} already done)` : '';
    showToast(`Generated ${successCount} scene${successCount !== 1 ? 's' : ''} successfully!${skippedMsg}`, false);
    saveSceneHistory(); // Persist scenes to localStorage
  }
  if (failCount > 0) {
    showToast(`${failCount} scene${failCount !== 1 ? 's' : ''} failed to generate`);
  }

  // Auto face-swap newly generated scenes if any previews were face-swapped
  const hasFaceSwappedPreviews = existingScenes.some(s => s?.faceSwapped);
  if (hasFaceSwappedPreviews && avatarImageData && successCount > 0) {
    await autoFaceSwapNewScenes();
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
      <button class="btn preview-single-btn" onclick="previewSingleScene(${index})" title="Generate only this scene">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        Preview
      </button>
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

// Preview a single scene (generate only this one scene)
async function previewSingleScene(index) {
  const scenes = getScenesForGeneration();
  if (index >= scenes.length) {
    showToast('Scene not found');
    return;
  }

  const sceneText = scenes[index];
  const card = document.getElementById(`scene-card-${index}`);

  if (!card) {
    showToast('Scene card not found');
    return;
  }

  // Show loading state
  card.classList.add('loading');
  card.classList.remove('error');

  const img = card.querySelector('img');
  if (img) img.hidden = true;

  // Remove any existing loading div and add new one
  let loadingDiv = card.querySelector('.scene-loading');
  if (!loadingDiv) {
    loadingDiv = document.createElement('div');
    loadingDiv.className = 'scene-loading';
    card.insertBefore(loadingDiv, card.firstChild);
  }
  loadingDiv.innerHTML = '<div class="spinner"></div>';

  const size = document.getElementById('batch-size').value;
  const quality = document.getElementById('batch-quality').value;
  const model = document.getElementById('batch-model')?.value || 'dall-e-3';
  const styledPrompt = buildStyledPrompt(sceneText, selectedStyle);

  try {
    showToast(`Generating scene ${index + 1}...`, false);

    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: styledPrompt, size, quality, model })
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    // Store the generated scene
    generatedScenes[index] = {
      index: index,
      text: sceneText,
      imageUrl: data.image,
      prompt: styledPrompt,
      revisedPrompt: data.revised_prompt
    };

    updateSceneCard(index, data.image);
    showToast(`Scene ${index + 1} generated!`, false);

  } catch (error) {
    console.error(`Failed to preview scene ${index + 1}:`, error);
    markSceneError(index);
    showToast(`Failed: ${error.message}`);
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

// Face Swap All Button Handler
const faceSwapAllBtn = document.getElementById('face-swap-all-btn');
if (faceSwapAllBtn) {
  faceSwapAllBtn.addEventListener('click', faceSwapAllScenes);
}

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
document.addEventListener('DOMContentLoaded', async function() {
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

  // Initialize Supabase connection and load data
  await initSupabaseSync();

  // Restore saved scenes from localStorage
  restoreSceneHistory();

  // Initialize avatar upload functionality
  initAvatarUpload();

  // Initialize thumbnail gallery from localStorage on page load
  if (thumbnailHistory && thumbnailHistory.length > 0) {
    updateThumbnailGallery();
  }
});

// Initialize Supabase sync on page load
async function initSupabaseSync() {
  // Check Supabase connection
  await checkSupabaseConnection();

  if (supabaseConnected) {
    console.log('Supabase connected - loading data from database');

    // Load avatar from Supabase (may override localStorage)
    const dbAvatar = await loadAvatarStateFromDB();
    if (dbAvatar && dbAvatar.imageData) {
      avatarEnabled = dbAvatar.enabled;
      avatarImageData = dbAvatar.imageData;
      avatarDescription = dbAvatar.description;

      // Update UI with avatar from DB
      const avatarImage = document.getElementById('avatar-image');
      const placeholder = document.getElementById('avatar-placeholder');
      const preview = document.getElementById('avatar-preview');

      if (avatarImage && avatarImageData) {
        avatarImage.src = avatarImageData;
        if (placeholder) placeholder.hidden = true;
        if (preview) preview.hidden = false;
      }

      // Update description display
      const descEl = document.getElementById('avatar-description');
      if (descEl && avatarDescription) {
        descEl.value = avatarDescription;
      }

      // Update checkbox
      const checkbox = document.getElementById('avatar-enabled');
      if (checkbox) checkbox.checked = avatarEnabled;

      console.log('Avatar loaded from Supabase');
    }

    // Load thumbnail history from Supabase
    const dbThumbnails = await loadThumbnailHistoryFromDB();
    if (dbThumbnails && dbThumbnails.length > 0) {
      thumbnailHistory = dbThumbnails;
      updateThumbnailGallery();
      console.log(`Loaded ${dbThumbnails.length} thumbnails from Supabase`);
    }
  }
}

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

// Load thumbnail history from Supabase
async function loadThumbnailHistoryFromDB() {
  if (!supabaseConnected) return [];

  try {
    const response = await fetch(`/api/db/thumbnails/${USER_ID}`);
    const data = await response.json();

    if (data.success && data.thumbnails) {
      // Convert DB format to local format
      return data.thumbnails.map(t => ({
        id: t.id,
        imageUrl: t.image_url,
        prompt: t.prompt,
        style: t.style,
        model: t.model,
        referenceUsed: t.reference_used,
        avatarUsed: t.avatar_used,
        timestamp: new Date(t.created_at).getTime()
      }));
    }
  } catch (e) {
    console.error('Failed to load thumbnails from DB:', e);
  }
  return [];
}

// Convert URL to base64 data URI (for persisting external URLs that may expire)
async function urlToBase64(url) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error('Failed to convert URL to base64:', e);
    return null;
  }
}

// Compress image to reduce size for storage
async function compressImage(base64, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      // Scale down if too large
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(base64); // Return original on error
    img.src = base64;
  });
}

// Save thumbnail history to localStorage and Supabase
async function saveThumbnailHistory(newThumbnail = null) {
  // If a new thumbnail was added, convert external URL to base64 first
  if (newThumbnail && newThumbnail.imageUrl) {
    // Convert external URLs to base64 to persist them (Replicate URLs expire)
    if (newThumbnail.imageUrl.startsWith('http') && !newThumbnail.imageUrl.startsWith('data:')) {
      console.log('Converting external URL to base64 for persistence...');
      try {
        let base64 = await urlToBase64(newThumbnail.imageUrl);
        if (base64) {
          // Compress if too large (> 300KB)
          if (base64.length > 300000) {
            console.log('Compressing image for storage...');
            base64 = await compressImage(base64, 800, 0.7);
          }
          newThumbnail.imageUrl = base64;
          console.log('Image converted to base64, size:', base64.length);

          // Update the thumbnail in the history array too
          const idx = thumbnailHistory.findIndex(t => t.timestamp === newThumbnail.timestamp);
          if (idx >= 0) {
            thumbnailHistory[idx].imageUrl = base64;
          }
        }
      } catch (e) {
        console.error('Failed to convert URL to base64:', e);
      }
    }
  }

  // Always save to localStorage
  try {
    localStorage.setItem('thumbnailHistory', JSON.stringify(thumbnailHistory));
    console.log('Thumbnail history saved to localStorage, count:', thumbnailHistory.length);
  } catch (e) {
    console.error('Failed to save thumbnail history to localStorage:', e);
    // If localStorage is full, try to remove oldest items
    if (e.name === 'QuotaExceededError') {
      console.log('localStorage full, removing oldest thumbnails...');
      while (thumbnailHistory.length > 5) {
        thumbnailHistory.pop();
      }
      try {
        localStorage.setItem('thumbnailHistory', JSON.stringify(thumbnailHistory));
      } catch (e2) {
        console.error('Still failed after removing items:', e2);
      }
    }
  }

  // If a new thumbnail was added, sync it to Supabase
  if (newThumbnail) {
    console.log('New thumbnail to save:', {
      hasImage: !!newThumbnail.imageUrl,
      imageLength: newThumbnail.imageUrl?.length || 0,
      isBase64: newThumbnail.imageUrl?.startsWith('data:'),
      supabaseConnected: supabaseConnected
    });
  }

  if (supabaseConnected && newThumbnail) {
    try {
      let imageUrlToStore = newThumbnail.imageUrl;

      // Skip if no image URL
      if (!imageUrlToStore) {
        console.log('No image URL to store, skipping Supabase sync');
        return;
      }

      // Skip only extremely large images (over 1MB)
      if (imageUrlToStore.startsWith('data:') && imageUrlToStore.length > 1000000) {
        console.log('Base64 image too large for Supabase storage, keeping in localStorage only');
        return;
      }

      console.log('Syncing thumbnail to Supabase, URL type:',
        imageUrlToStore.startsWith('data:') ? 'base64' :
        imageUrlToStore.startsWith('http') ? 'URL' : 'unknown');

      const response = await fetch('/api/db/thumbnails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: USER_ID,
          imageUrl: imageUrlToStore,
          prompt: newThumbnail.prompt,
          style: newThumbnail.style,
          model: newThumbnail.model || 'gpt-image-2',
          referenceUsed: newThumbnail.referenceUsed || false,
          avatarUsed: newThumbnail.avatarUsed || false
        })
      });

      const data = await response.json();
      if (data.success) {
        console.log('Thumbnail synced to Supabase successfully, id:', data.thumbnail?.id);
      } else {
        console.error('Supabase sync failed:', data.error);
      }
    } catch (e) {
      console.error('Failed to sync thumbnail to Supabase:', e);
    }
  } else if (!supabaseConnected) {
    console.log('Supabase not connected, using localStorage only');
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

  // Add reference guidance if provided (now with AI analysis)
  if (referenceData && referenceData.type) {
    if (referenceData.analysis) {
      // Use the AI-analyzed style description
      if (referenceData.type === 'do-this') {
        prompt += `. CRITICAL STYLE REFERENCE - MATCH THIS STYLE: ${referenceData.analysis}. Replicate these visual elements, colors, composition, and mood as closely as possible`;
      } else if (referenceData.type === 'dont-do-this') {
        prompt += `. AVOID THIS STYLE: The following describes what NOT to do - ${referenceData.analysis}. Create the OPPOSITE - use contrasting colors, different composition, and a more professional/engaging approach`;
      }
    } else {
      // Fallback if no analysis available
      if (referenceData.type === 'do-this') {
        prompt += `. IMPORTANT: Create something similar in style and approach to this successful thumbnail concept. Follow the visual patterns, color schemes, and composition techniques that make it effective`;
      } else if (referenceData.type === 'dont-do-this') {
        prompt += `. IMPORTANT: Avoid the approach shown in the reference. Do NOT use similar colors, composition, or style. Create the OPPOSITE - make it more eye-catching, professional, and engaging. Avoid these common thumbnail mistakes`;
      }
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
    const newThumbnail = {
      imageUrl: data.image,
      prompt: prompt,
      style: selectedThumbnailStyle,
      model: model,
      referenceUsed: !!referenceThumbData,
      avatarUsed: avatarEnabled && !!avatarImageData,
      timestamp: Date.now()
    };
    thumbnailHistory.unshift(newThumbnail);

    // Keep only last 10
    if (thumbnailHistory.length > 10) {
      thumbnailHistory = thumbnailHistory.slice(0, 10);
    }

    updateThumbnailGallery();
    saveThumbnailHistory(newThumbnail); // Persist to localStorage & Supabase

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
    const newThumbnail = {
      imageUrl: data.image,
      prompt: lastThumbnailParams.prompt,
      style: lastThumbnailParams.style || selectedThumbnailStyle,
      model: 'dall-e-3',
      referenceUsed: lastThumbnailParams.referenceUsed || false,
      avatarUsed: lastThumbnailParams.avatarUsed || false,
      timestamp: Date.now()
    };
    thumbnailHistory.unshift(newThumbnail);

    if (thumbnailHistory.length > 10) {
      thumbnailHistory = thumbnailHistory.slice(0, 10);
    }

    updateThumbnailGallery();
    saveThumbnailHistory(newThumbnail); // Persist to localStorage & Supabase

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
    const newThumbnail = {
      imageUrl: data.image,
      prompt: refinedPrompt,
      style: selectedThumbnailStyle,
      model: 'dall-e-3',
      referenceUsed: !!referenceThumbData,
      avatarUsed: avatarEnabled && !!avatarImageData,
      timestamp: Date.now()
    };
    thumbnailHistory.unshift(newThumbnail);

    if (thumbnailHistory.length > 10) {
      thumbnailHistory = thumbnailHistory.slice(0, 10);
    }

    updateThumbnailGallery();
    saveThumbnailHistory(newThumbnail); // Persist to localStorage & Supabase

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

// Generate with Face (Character Reference) button
const generateThumbnailWithFaceBtn = document.getElementById('generate-thumbnail-with-face-btn');
if (generateThumbnailWithFaceBtn) {
  generateThumbnailWithFaceBtn.addEventListener('click', generateThumbnailWithFace);
}

// Generate thumbnail with user's face using Character Reference
async function generateThumbnailWithFace() {
  // Check if avatar is uploaded
  if (!avatarImageData) {
    showToast('Please upload your avatar photo first');
    switchToTabAndOpenAvatar('batch-scenes');
    return;
  }

  const description = thumbnailPromptInput ? thumbnailPromptInput.value.trim() : '';
  const textHook = thumbnailHookInput ? thumbnailHookInput.value.trim() : '';

  if (!description) {
    showToast('Please describe your thumbnail');
    return;
  }

  showLoading('Generating thumbnail with your face (Character Reference)...');

  try {
    // Build the prompt
    let prompt = description;
    if (selectedThumbnailStyle) {
      const styleInfo = THUMBNAIL_STYLES[selectedThumbnailStyle];
      if (styleInfo) {
        prompt += `. Style: ${styleInfo.prompt}`;
      }
    }
    if (textHook) {
      prompt += `. Include bold readable text saying "${textHook}"`;
    }
    prompt += '. YouTube thumbnail, 16:9, eye-catching, professional';

    // Convert avatar to blob for character reference
    const avatarBlob = await fetch(avatarImageData).then(r => r.blob());

    const formData = new FormData();
    formData.append('referenceImage', avatarBlob, 'avatar.png');
    formData.append('prompt', prompt);
    formData.append('width', '1792');
    formData.append('height', '1024');

    const response = await fetch('/api/generate-with-reference', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (data.success && data.image) {
      // Show result
      if (thumbnailImage) {
        thumbnailImage.src = data.image;
      }
      if (thumbnailResult) {
        thumbnailResult.hidden = false;
      }

      // Add to history
      const newThumbnail = {
        imageUrl: data.image,
        prompt: prompt,
        style: selectedThumbnailStyle,
        model: 'instantid',
        referenceUsed: false,
        avatarUsed: true,
        timestamp: Date.now()
      };
      thumbnailHistory.unshift(newThumbnail);

      if (thumbnailHistory.length > 10) {
        thumbnailHistory = thumbnailHistory.slice(0, 10);
      }

      updateThumbnailGallery();
      saveThumbnailHistory(newThumbnail);

      showToast('Thumbnail generated with your face!', false);
      thumbnailResult.scrollIntoView({ behavior: 'smooth' });
    } else {
      throw new Error(data.error || 'Generation failed');
    }
  } catch (error) {
    console.error('Character Reference generation error:', error);
    showToast(`Generation failed: ${error.message}`);
  } finally {
    hideLoading();
  }
}

// Banner with Face generation
const generateBannerWithFaceBtn = document.getElementById('generate-banner-with-face-btn');
if (generateBannerWithFaceBtn) {
  generateBannerWithFaceBtn.addEventListener('click', generateBannerWithFace);
}

async function generateBannerWithFace() {
  // Check if avatar is uploaded
  if (!avatarImageData) {
    showToast('Please upload your avatar photo first');
    switchToTabAndOpenAvatar('batch-scenes');
    return;
  }

  const promptInput = document.getElementById('banner-bg-prompt');
  const description = promptInput ? promptInput.value.trim() : '';

  if (!description) {
    showToast('Please describe your banner background');
    return;
  }

  showLoading('Generating banner with your face (Character Reference)...');

  try {
    const prompt = `${description}. YouTube channel banner, wide format, professional, featuring a person prominently`;

    // Convert avatar to blob for character reference
    const avatarBlob = await fetch(avatarImageData).then(r => r.blob());

    const formData = new FormData();
    formData.append('referenceImage', avatarBlob, 'avatar.png');
    formData.append('prompt', prompt);
    formData.append('width', '1536');
    formData.append('height', '1024');

    const response = await fetch('/api/generate-with-reference', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (data.success && data.image) {
      // Load the generated image onto the banner canvas
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.getElementById('banner-canvas');
        if (canvas) {
          const ctx = canvas.getContext('2d');
          // Scale to fit the banner canvas (2560x1440)
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        }
        showToast('Banner generated with your face!', false);
      };
      img.src = data.image;
    } else {
      throw new Error(data.error || 'Generation failed');
    }
  } catch (error) {
    console.error('Banner Character Reference error:', error);
    showToast(`Generation failed: ${error.message}`);
  } finally {
    hideLoading();
  }
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

// Face Swap All Scenes - swaps avatar face onto all generated scenes
async function faceSwapAllScenes() {
  // Check if avatar is uploaded
  if (!avatarImageData) {
    showToast('Please upload your avatar photo first');
    return;
  }

  // Check if there are scenes to swap
  const scenesWithImages = generatedScenes.filter(s => s && s.imageUrl);
  if (scenesWithImages.length === 0) {
    showToast('No generated scenes to face swap');
    return;
  }

  showLoading(`Swapping your face onto all scenes...`, `0 of ${scenesWithImages.length}`);

  let successCount = 0;
  let failCount = 0;

  // Convert avatar to blob once
  const avatarBlob = await fetch(avatarImageData).then(r => r.blob());

  for (let i = 0; i < scenesWithImages.length; i++) {
    const scene = scenesWithImages[i];
    updateLoadingProgress(i + 1, scenesWithImages.length);

    try {
      // Fetch scene image as blob
      const sceneBlob = await fetch(scene.imageUrl).then(r => r.blob());

      const formData = new FormData();
      formData.append('sourceImage', sceneBlob, 'scene.png');
      formData.append('faceImage', avatarBlob, 'avatar.png');

      const response = await fetch('/api/face-swap', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      // Update the scene with the face-swapped image
      scene.imageUrl = data.image;
      scene.faceSwapped = true;

      // Update the scene card in the UI
      updateSceneCard(scene.index, data.image);
      successCount++;

    } catch (error) {
      console.error(`Failed to face swap scene ${scene.index + 1}:`, error);
      failCount++;
    }

    // Small delay between requests
    if (i < scenesWithImages.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  hideLoading();

  if (failCount === 0) {
    showToast(`Face swapped ${successCount} scenes successfully!`);
  } else {
    showToast(`Face swapped ${successCount} scenes, ${failCount} failed`);
  }
}

// Auto Face Swap - only swaps newly generated scenes (not already face-swapped)
async function autoFaceSwapNewScenes() {
  // Get scenes that need face swapping (have image but not yet swapped)
  const scenesToSwap = generatedScenes.filter(s => s && s.imageUrl && !s.faceSwapped);

  if (scenesToSwap.length === 0) {
    return;
  }

  showLoading(`Auto face-swapping new scenes...`, `0 of ${scenesToSwap.length}`);

  let successCount = 0;
  let failCount = 0;

  // Convert avatar to blob once
  const avatarBlob = await fetch(avatarImageData).then(r => r.blob());

  for (let i = 0; i < scenesToSwap.length; i++) {
    const scene = scenesToSwap[i];
    updateLoadingProgress(i + 1, scenesToSwap.length);

    try {
      const sceneBlob = await fetch(scene.imageUrl).then(r => r.blob());

      const formData = new FormData();
      formData.append('sourceImage', sceneBlob, 'scene.png');
      formData.append('faceImage', avatarBlob, 'avatar.png');

      const response = await fetch('/api/face-swap', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      scene.imageUrl = data.image;
      scene.faceSwapped = true;
      updateSceneCard(scene.index, data.image);
      successCount++;

    } catch (error) {
      console.error(`Auto face swap failed for scene ${scene.index + 1}:`, error);
      failCount++;
    }

    if (i < scenesToSwap.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  hideLoading();
  saveSceneHistory();

  if (successCount > 0) {
    showToast(`Auto face-swapped ${successCount} new scenes!`);
  }
}

// Face Swap Button
const faceSwapThumbnailBtn = document.getElementById('face-swap-thumbnail-btn');
if (faceSwapThumbnailBtn) {
  faceSwapThumbnailBtn.addEventListener('click', faceSwapThumbnail);
}

// Face Swap Function - swaps user's avatar face into the thumbnail
async function faceSwapThumbnail() {
  // Check if avatar is uploaded
  if (!avatarImageData) {
    showToast('Please upload your avatar photo first in the Batch Scenes tab');
    switchToTabAndOpenAvatar('batch-scenes');
    return;
  }

  // Check if there's a thumbnail to swap
  const thumbnailImg = document.getElementById('thumbnail-image');
  if (!thumbnailImg || !thumbnailImg.src) {
    showToast('Please generate a thumbnail first');
    return;
  }

  showLoading('Swapping your face into the thumbnail...');

  try {
    // Convert both images to blobs for upload
    const thumbnailBlob = await fetch(thumbnailImg.src).then(r => r.blob());
    const avatarBlob = await fetch(avatarImageData).then(r => r.blob());

    const formData = new FormData();
    formData.append('sourceImage', thumbnailBlob, 'thumbnail.png');
    formData.append('faceImage', avatarBlob, 'avatar.png');

    const response = await fetch('/api/face-swap', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (data.success && data.image) {
      // Update the thumbnail with the face-swapped version
      thumbnailImg.src = data.image;

      // Add to history
      const newThumbnail = {
        imageUrl: data.image,
        prompt: 'Face swapped thumbnail',
        style: 'face-swap',
        model: 'face-swap',
        referenceUsed: false,
        avatarUsed: true,
        timestamp: Date.now()
      };
      thumbnailHistory.unshift(newThumbnail);

      if (thumbnailHistory.length > 10) {
        thumbnailHistory = thumbnailHistory.slice(0, 10);
      }

      updateThumbnailGallery();
      saveThumbnailHistory(newThumbnail);

      showToast('Face swap complete!', false);
    } else {
      throw new Error(data.error || 'Face swap failed');
    }
  } catch (error) {
    console.error('Face swap error:', error);
    showToast(`Face swap failed: ${error.message}`);
  } finally {
    hideLoading();
  }
}

// ============================================
// FACE SWAP UPLOAD (Upload existing image to swap face)
// ============================================

let faceSwapImageData = null;

// Face Swap Upload Elements
const faceSwapUploadArea = document.getElementById('face-swap-upload');
const faceSwapFileInput = document.getElementById('face-swap-file');
const faceSwapPlaceholder = document.getElementById('face-swap-placeholder');
const faceSwapPreview = document.getElementById('face-swap-preview');
const faceSwapImage = document.getElementById('face-swap-image');
const doFaceSwapBtn = document.getElementById('do-face-swap-btn');
const clearFaceSwapBtn = document.getElementById('clear-face-swap');
const faceSwapResult = document.getElementById('face-swap-result');
const faceSwapResultImage = document.getElementById('face-swap-result-image');
const downloadFaceSwapBtn = document.getElementById('download-face-swap-btn');
const clearFaceSwapResultBtn = document.getElementById('clear-face-swap-result');

// Handle face swap upload area click
if (faceSwapUploadArea) {
  faceSwapUploadArea.addEventListener('click', (e) => {
    if (!e.target.closest('.face-swap-controls')) {
      faceSwapFileInput?.click();
    }
  });

  // Drag and drop
  faceSwapUploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    faceSwapUploadArea.classList.add('dragover');
  });

  faceSwapUploadArea.addEventListener('dragleave', () => {
    faceSwapUploadArea.classList.remove('dragover');
  });

  faceSwapUploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    faceSwapUploadArea.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleFaceSwapUpload(file);
    }
  });
}

// Handle face swap file selection
if (faceSwapFileInput) {
  faceSwapFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      handleFaceSwapUpload(file);
    }
  });
}

// Process face swap image upload
function handleFaceSwapUpload(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    faceSwapImageData = e.target.result;

    // Show preview
    if (faceSwapImage) faceSwapImage.src = faceSwapImageData;
    if (faceSwapPlaceholder) faceSwapPlaceholder.hidden = true;
    if (faceSwapPreview) faceSwapPreview.hidden = false;

    // Hide any previous result
    if (faceSwapResult) faceSwapResult.hidden = true;
  };
  reader.readAsDataURL(file);
}

// Clear face swap upload
if (clearFaceSwapBtn) {
  clearFaceSwapBtn.addEventListener('click', () => {
    faceSwapImageData = null;
    if (faceSwapImage) faceSwapImage.src = '';
    if (faceSwapPreview) faceSwapPreview.hidden = true;
    if (faceSwapPlaceholder) faceSwapPlaceholder.hidden = false;
    if (faceSwapFileInput) faceSwapFileInput.value = '';
  });
}

// Clear face swap result
if (clearFaceSwapResultBtn) {
  clearFaceSwapResultBtn.addEventListener('click', () => {
    if (faceSwapResult) faceSwapResult.hidden = true;
    if (faceSwapResultImage) faceSwapResultImage.src = '';
  });
}

// Perform face swap on uploaded image
if (doFaceSwapBtn) {
  doFaceSwapBtn.addEventListener('click', performFaceSwapOnUpload);
}

async function performFaceSwapOnUpload() {
  // Check if avatar is uploaded
  if (!avatarImageData) {
    showToast('Please upload your avatar photo first in the Batch Scenes tab');
    switchToTabAndOpenAvatar('batch-scenes');
    return;
  }

  // Check if there's an image to swap
  if (!faceSwapImageData) {
    showToast('Please upload an image first');
    return;
  }

  showLoading('Swapping your face into the image...');

  try {
    // Convert both images to blobs for upload
    const sourceBlob = await fetch(faceSwapImageData).then(r => r.blob());
    const avatarBlob = await fetch(avatarImageData).then(r => r.blob());

    const formData = new FormData();
    formData.append('sourceImage', sourceBlob, 'source.png');
    formData.append('faceImage', avatarBlob, 'avatar.png');

    const response = await fetch('/api/face-swap', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (data.success && data.image) {
      // Show result
      if (faceSwapResultImage) faceSwapResultImage.src = data.image;
      if (faceSwapResult) faceSwapResult.hidden = false;

      // Add to thumbnail history
      const newThumbnail = {
        imageUrl: data.image,
        prompt: 'Face swapped (uploaded image)',
        style: 'face-swap',
        model: 'face-swap',
        referenceUsed: false,
        avatarUsed: true,
        timestamp: Date.now()
      };
      thumbnailHistory.unshift(newThumbnail);

      if (thumbnailHistory.length > 10) {
        thumbnailHistory = thumbnailHistory.slice(0, 10);
      }

      updateThumbnailGallery();
      saveThumbnailHistory(newThumbnail);

      showToast('Face swap complete!', false);
    } else {
      throw new Error(data.error || 'Face swap failed');
    }
  } catch (error) {
    console.error('Face swap error:', error);
    showToast(`Face swap failed: ${error.message}`);
  } finally {
    hideLoading();
  }
}

// Download face swap result
if (downloadFaceSwapBtn) {
  downloadFaceSwapBtn.addEventListener('click', () => {
    if (faceSwapResultImage && faceSwapResultImage.src) {
      const a = document.createElement('a');
      a.href = faceSwapResultImage.src;
      a.download = `face-swap-${Date.now()}.png`;
      a.click();
    }
  });
}

// ============================================
// SINGLE IMAGE TAB - FACE SWAP UPLOAD
// ============================================

let singleFaceSwapImageData = null;

// Single Image Face Swap Elements
const singleFaceSwapUploadArea = document.getElementById('single-face-swap-upload');
const singleFaceSwapFileInput = document.getElementById('single-face-swap-file');
const singleFaceSwapPlaceholder = document.getElementById('single-face-swap-placeholder');
const singleFaceSwapPreview = document.getElementById('single-face-swap-preview');
const singleFaceSwapImage = document.getElementById('single-face-swap-image');
const singleDoFaceSwapBtn = document.getElementById('single-do-face-swap-btn');
const singleClearFaceSwapBtn = document.getElementById('single-clear-face-swap');
const singleFaceSwapResult = document.getElementById('single-face-swap-result');
const singleFaceSwapResultImage = document.getElementById('single-face-swap-result-image');
const singleDownloadFaceSwapBtn = document.getElementById('single-download-face-swap-btn');
const singleClearFaceSwapResultBtn = document.getElementById('single-clear-face-swap-result');

// Handle single image face swap upload area click
if (singleFaceSwapUploadArea) {
  singleFaceSwapUploadArea.addEventListener('click', (e) => {
    if (!e.target.closest('.face-swap-controls')) {
      singleFaceSwapFileInput?.click();
    }
  });

  // Drag and drop
  singleFaceSwapUploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    singleFaceSwapUploadArea.classList.add('dragover');
  });

  singleFaceSwapUploadArea.addEventListener('dragleave', () => {
    singleFaceSwapUploadArea.classList.remove('dragover');
  });

  singleFaceSwapUploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    singleFaceSwapUploadArea.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleSingleFaceSwapUpload(file);
    }
  });
}

// Handle single image face swap file selection
if (singleFaceSwapFileInput) {
  singleFaceSwapFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      handleSingleFaceSwapUpload(file);
    }
  });
}

// Process single image face swap upload
function handleSingleFaceSwapUpload(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    singleFaceSwapImageData = e.target.result;

    // Show preview
    if (singleFaceSwapImage) singleFaceSwapImage.src = singleFaceSwapImageData;
    if (singleFaceSwapPlaceholder) singleFaceSwapPlaceholder.hidden = true;
    if (singleFaceSwapPreview) singleFaceSwapPreview.hidden = false;

    // Hide any previous result
    if (singleFaceSwapResult) singleFaceSwapResult.hidden = true;
  };
  reader.readAsDataURL(file);
}

// Clear single image face swap upload
if (singleClearFaceSwapBtn) {
  singleClearFaceSwapBtn.addEventListener('click', () => {
    singleFaceSwapImageData = null;
    if (singleFaceSwapImage) singleFaceSwapImage.src = '';
    if (singleFaceSwapPreview) singleFaceSwapPreview.hidden = true;
    if (singleFaceSwapPlaceholder) singleFaceSwapPlaceholder.hidden = false;
    if (singleFaceSwapFileInput) singleFaceSwapFileInput.value = '';
  });
}

// Clear single image face swap result
if (singleClearFaceSwapResultBtn) {
  singleClearFaceSwapResultBtn.addEventListener('click', () => {
    if (singleFaceSwapResult) singleFaceSwapResult.hidden = true;
    if (singleFaceSwapResultImage) singleFaceSwapResultImage.src = '';
  });
}

// Perform face swap on single uploaded image
if (singleDoFaceSwapBtn) {
  singleDoFaceSwapBtn.addEventListener('click', performSingleFaceSwap);
}

async function performSingleFaceSwap() {
  // Check if avatar is uploaded
  if (!avatarImageData) {
    showToast('Please upload your avatar photo first in the Batch Scenes tab');
    switchToTabAndOpenAvatar('batch-scenes');
    return;
  }

  // Check if there's an image to swap
  if (!singleFaceSwapImageData) {
    showToast('Please upload an image first');
    return;
  }

  showLoading('Swapping your face into the image...');

  try {
    // Convert both images to blobs for upload
    const sourceBlob = await fetch(singleFaceSwapImageData).then(r => r.blob());
    const avatarBlob = await fetch(avatarImageData).then(r => r.blob());

    const formData = new FormData();
    formData.append('sourceImage', sourceBlob, 'source.png');
    formData.append('faceImage', avatarBlob, 'avatar.png');

    const response = await fetch('/api/face-swap', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (data.success && data.image) {
      // Show result
      if (singleFaceSwapResultImage) singleFaceSwapResultImage.src = data.image;
      if (singleFaceSwapResult) singleFaceSwapResult.hidden = false;

      showToast('Face swap complete!', false);
    } else {
      throw new Error(data.error || 'Face swap failed');
    }
  } catch (error) {
    console.error('Face swap error:', error);
    showToast(`Face swap failed: ${error.message}`);
  } finally {
    hideLoading();
  }
}

// Download single image face swap result
if (singleDownloadFaceSwapBtn) {
  singleDownloadFaceSwapBtn.addEventListener('click', () => {
    if (singleFaceSwapResultImage && singleFaceSwapResultImage.src) {
      const a = document.createElement('a');
      a.href = singleFaceSwapResultImage.src;
      a.download = `face-swap-${Date.now()}.png`;
      a.click();
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
async function handleReferenceThumbUpload(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
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

    // Store the reference data initially
    referenceThumbData = {
      type: selectedType,
      hasImage: true,
      analysis: null,
      analyzing: true
    };

    showToast('Analyzing reference thumbnail with AI...', false);

    // Analyze the image with GPT-4o Vision
    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('analysisType', 'thumbnail');

      const response = await fetch('/api/analyze-image', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (data.success && data.analysis) {
        referenceThumbData.analysis = data.analysis;
        referenceThumbData.analyzing = false;
        showToast(`Reference analyzed! Style will be ${selectedType === 'do-this' ? 'matched' : 'avoided'}.`, false);
        console.log('Reference analysis:', data.analysis);
      } else {
        throw new Error(data.error || 'Analysis failed');
      }
    } catch (error) {
      console.error('Failed to analyze reference:', error);
      referenceThumbData.analyzing = false;
      showToast(`Reference uploaded (analysis failed: ${error.message})`, true);
    }
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

// ============================================
// AVATAR VIDEO - LIP SYNC ANIMATION
// ============================================

// Avatar Video state
let avatarVideoFile = null;
let avatarAudioFile = null;
let audioRecorder = null;
let audioChunks = [];
let isRecording = false;
let recentAvatarVideos = JSON.parse(localStorage.getItem('avatar_videos') || '[]');

// DOM elements for Avatar Video
const avatarVideoUploadArea = document.getElementById('avatar-video-upload');
const avatarVideoInput = document.getElementById('avatar-video-file');
const avatarVideoPreview = document.getElementById('avatar-video-preview');
const avatarVideoImage = document.getElementById('avatar-video-image');
const avatarVideoPlaceholder = document.getElementById('avatar-video-placeholder');
const clearAvatarVideoBtn = document.getElementById('clear-avatar-video');

const audioUploadArea = document.getElementById('audio-upload-area');
const audioFileInput = document.getElementById('animation-audio-file');
const audioPreview = document.getElementById('audio-upload-preview');
const audioPlayer = document.getElementById('animation-audio-player');
const audioFileName = document.getElementById('audio-filename');
const audioPlaceholder = document.getElementById('audio-upload-placeholder');
const clearAudioBtn = document.getElementById('clear-animation-audio');
const recordAudioBtn = document.getElementById('record-animation-audio-btn');

const generateAvatarVideoBtn = document.getElementById('generate-avatar-video-btn');
const avatarVideoProgress = document.getElementById('avatar-video-progress');
const avatarVideoProgressBar = document.getElementById('avatar-video-progress-bar');
const avatarVideoStatus = document.getElementById('avatar-video-status');

const avatarVideoResult = document.getElementById('avatar-video-result');
const avatarVideoPlayer = document.getElementById('avatar-video-output');
const downloadAvatarVideoBtn = document.getElementById('download-avatar-video-btn');
const newAvatarVideoBtn = document.getElementById('regenerate-avatar-video-btn');

const avatarVideoGallery = document.getElementById('avatar-video-gallery-grid');

// Initialize Avatar Video functionality
function initAvatarVideo() {
  if (!avatarVideoUploadArea) return;

  // Avatar image upload handlers
  avatarVideoUploadArea.addEventListener('click', () => avatarVideoInput?.click());

  avatarVideoUploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    avatarVideoUploadArea.classList.add('dragover');
  });

  avatarVideoUploadArea.addEventListener('dragleave', () => {
    avatarVideoUploadArea.classList.remove('dragover');
  });

  avatarVideoUploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    avatarVideoUploadArea.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleAvatarVideoFile(file);
    }
  });

  avatarVideoInput?.addEventListener('change', (e) => {
    if (e.target.files[0]) {
      handleAvatarVideoFile(e.target.files[0]);
    }
  });

  clearAvatarVideoBtn?.addEventListener('click', clearAvatarVideo);

  // Audio upload handlers
  audioUploadArea?.addEventListener('click', (e) => {
    if (e.target !== recordAudioBtn && !recordAudioBtn?.contains(e.target)) {
      audioFileInput?.click();
    }
  });

  audioUploadArea?.addEventListener('dragover', (e) => {
    e.preventDefault();
    audioUploadArea.classList.add('dragover');
  });

  audioUploadArea?.addEventListener('dragleave', () => {
    audioUploadArea.classList.remove('dragover');
  });

  audioUploadArea?.addEventListener('drop', (e) => {
    e.preventDefault();
    audioUploadArea.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) {
      handleAudioFile(file);
    }
  });

  audioFileInput?.addEventListener('change', (e) => {
    if (e.target.files[0]) {
      handleAudioFile(e.target.files[0]);
    }
  });

  clearAudioBtn?.addEventListener('click', clearAudio);
  recordAudioBtn?.addEventListener('click', toggleRecording);

  // Generate button
  generateAvatarVideoBtn?.addEventListener('click', generateAvatarVideo);

  // Result actions
  downloadAvatarVideoBtn?.addEventListener('click', downloadAvatarVideo);
  newAvatarVideoBtn?.addEventListener('click', resetAvatarVideo);

  // Render gallery
  renderAvatarVideoGallery();
}

// Handle avatar image file selection
function handleAvatarVideoFile(file) {
  avatarVideoFile = file;

  const reader = new FileReader();
  reader.onload = (e) => {
    if (avatarVideoImage) avatarVideoImage.src = e.target.result;
    if (avatarVideoPlaceholder) avatarVideoPlaceholder.hidden = true;
    if (avatarVideoPreview) avatarVideoPreview.hidden = false;
    avatarVideoUploadArea?.classList.add('has-file');
    updateGenerateButton();
  };
  reader.readAsDataURL(file);
}

// Clear avatar image
function clearAvatarVideo() {
  avatarVideoFile = null;
  if (avatarVideoImage) avatarVideoImage.src = '';
  if (avatarVideoPlaceholder) avatarVideoPlaceholder.hidden = false;
  if (avatarVideoPreview) avatarVideoPreview.hidden = true;
  if (avatarVideoInput) avatarVideoInput.value = '';
  avatarVideoUploadArea?.classList.remove('has-file');
  updateGenerateButton();
}

// Audio splitting settings
const SEGMENT_DURATION = 90; // 90 seconds per segment (1.5 min)
let audioDuration = 0;
let audioSegments = [];

// Handle audio file selection
function handleAudioFile(file) {
  avatarAudioFile = file;

  const url = URL.createObjectURL(file);
  if (audioPlayer) {
    audioPlayer.src = url;
    // Detect duration when metadata loads
    audioPlayer.onloadedmetadata = () => {
      audioDuration = audioPlayer.duration;
      updateAudioDurationDisplay();
      updateGenerateButton();
    };
  }
  if (audioFileName) {
    audioFileName.textContent = file.name;
  }
  if (audioPlaceholder) audioPlaceholder.hidden = true;
  if (audioPreview) audioPreview.hidden = false;
  audioUploadArea?.classList.add('has-file');
  updateGenerateButton();
}

// Update audio duration display and segment info
function updateAudioDurationDisplay() {
  const durationEl = document.getElementById('audio-duration');
  const segmentInfo = document.getElementById('segment-info');

  if (durationEl) {
    const mins = Math.floor(audioDuration / 60);
    const secs = Math.floor(audioDuration % 60);
    durationEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // Show segment info if audio is longer than SEGMENT_DURATION
  const numSegments = Math.ceil(audioDuration / SEGMENT_DURATION);
  if (segmentInfo) {
    if (audioDuration > SEGMENT_DURATION) {
      segmentInfo.hidden = false;
      segmentInfo.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="16" x2="12" y2="12"/>
          <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        Will be split into <strong>${numSegments} segments</strong> (~${SEGMENT_DURATION}s each)
      `;
    } else {
      segmentInfo.hidden = true;
    }
  }

  // Update cost estimate
  updateCostEstimate();
}

// Update cost estimate based on duration
function updateCostEstimate() {
  const costEl = document.querySelector('.cost-estimate strong');
  if (!costEl) return;

  const numSegments = Math.ceil(audioDuration / SEGMENT_DURATION) || 1;
  const minCost = (numSegments * 0.03).toFixed(2);
  const maxCost = (numSegments * 0.08).toFixed(2);

  costEl.textContent = `~$${minCost}-${maxCost}`;
}

// Clear audio
function clearAudio() {
  avatarAudioFile = null;
  audioDuration = 0;
  audioSegments = [];
  if (audioPlayer) audioPlayer.src = '';
  if (audioFileName) audioFileName.textContent = '';
  if (audioPlaceholder) audioPlaceholder.hidden = false;
  if (audioPreview) audioPreview.hidden = true;
  if (audioFileInput) audioFileInput.value = '';
  audioUploadArea?.classList.remove('has-file');

  // Reset segment info
  const segmentInfo = document.getElementById('segment-info');
  if (segmentInfo) segmentInfo.hidden = true;

  // Reset duration display
  const durationEl = document.getElementById('audio-duration');
  if (durationEl) durationEl.textContent = '';

  updateGenerateButton();
}

// Split audio file into segments using Web Audio API
async function splitAudioIntoSegments(file, segmentDuration) {
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  const sampleRate = audioBuffer.sampleRate;
  const numberOfChannels = audioBuffer.numberOfChannels;
  const totalDuration = audioBuffer.duration;

  const segments = [];
  let startTime = 0;

  while (startTime < totalDuration) {
    const endTime = Math.min(startTime + segmentDuration, totalDuration);
    const segmentLength = endTime - startTime;

    // Create a new buffer for this segment
    const segmentSamples = Math.floor(segmentLength * sampleRate);
    const segmentBuffer = audioContext.createBuffer(
      numberOfChannels,
      segmentSamples,
      sampleRate
    );

    // Copy the audio data for this segment
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const sourceData = audioBuffer.getChannelData(channel);
      const segmentData = segmentBuffer.getChannelData(channel);
      const startSample = Math.floor(startTime * sampleRate);

      for (let i = 0; i < segmentSamples; i++) {
        segmentData[i] = sourceData[startSample + i] || 0;
      }
    }

    // Convert to WAV blob
    const wavBlob = audioBufferToWav(segmentBuffer);
    const segmentFile = new File(
      [wavBlob],
      `segment-${segments.length + 1}.wav`,
      { type: 'audio/wav' }
    );

    segments.push({
      index: segments.length,
      file: segmentFile,
      startTime: startTime,
      endTime: endTime,
      duration: segmentLength
    });

    startTime = endTime;
  }

  await audioContext.close();
  return segments;
}

// Convert AudioBuffer to WAV format
function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const dataLength = buffer.length * blockAlign;
  const bufferLength = 44 + dataLength;

  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Write audio data
  const offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset + (i * blockAlign) + (channel * bytesPerSample), intSample, true);
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// Toggle audio recording
async function toggleRecording(e) {
  e.stopPropagation();

  if (isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

// Start recording audio
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioRecorder = new MediaRecorder(stream);
    audioChunks = [];

    audioRecorder.ondataavailable = (e) => {
      audioChunks.push(e.data);
    };

    audioRecorder.onstop = () => {
      const blob = new Blob(audioChunks, { type: 'audio/wav' });
      const file = new File([blob], `recording-${Date.now()}.wav`, { type: 'audio/wav' });
      handleAudioFile(file);

      // Stop all tracks
      stream.getTracks().forEach(track => track.stop());
    };

    audioRecorder.start();
    isRecording = true;

    if (recordAudioBtn) {
      recordAudioBtn.classList.add('recording');
      recordAudioBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <rect x="6" y="6" width="12" height="12" rx="2"/>
        </svg>
        Stop
      `;
    }

    showToast('Recording... Click Stop when done.', false);

  } catch (error) {
    console.error('Failed to start recording:', error);
    showToast('Could not access microphone. Please allow microphone access.');
  }
}

// Stop recording audio
function stopRecording() {
  if (audioRecorder && audioRecorder.state === 'recording') {
    audioRecorder.stop();
  }

  isRecording = false;

  if (recordAudioBtn) {
    recordAudioBtn.classList.remove('recording');
    recordAudioBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
      Record
    `;
  }

  showToast('Recording saved!', false);
}

// Update generate button state
function updateGenerateButton() {
  if (generateAvatarVideoBtn) {
    generateAvatarVideoBtn.disabled = !avatarVideoFile || !avatarAudioFile;
  }
}

// Generated video segments storage
let generatedVideoSegments = [];

// Generate avatar video with lip-sync
async function generateAvatarVideo() {
  if (!avatarVideoFile || !avatarAudioFile) {
    showToast('Please upload both an avatar image and audio file');
    return;
  }

  // Show progress
  if (avatarVideoProgress) avatarVideoProgress.hidden = false;
  if (avatarVideoResult) avatarVideoResult.hidden = true;
  if (generateAvatarVideoBtn) generateAvatarVideoBtn.disabled = true;
  generatedVideoSegments = [];

  // Check if we need to split the audio
  const needsSplitting = audioDuration > SEGMENT_DURATION;

  try {
    if (needsSplitting) {
      await generateWithSegments();
    } else {
      await generateSingleVideo();
    }
  } catch (error) {
    console.error('Avatar video generation failed:', error);
    if (avatarVideoProgress) avatarVideoProgress.hidden = true;
    if (generateAvatarVideoBtn) generateAvatarVideoBtn.disabled = false;
    showToast(error.message || 'Failed to generate avatar video');
  }
}

// Generate a single video (audio under 90 seconds)
async function generateSingleVideo() {
  updateAvatarVideoProgress(0, 'Uploading files...');

  const formData = new FormData();
  formData.append('avatarImage', avatarVideoFile);
  formData.append('audioFile', avatarAudioFile);

  updateAvatarVideoProgress(10, 'Processing with AI...');

  const response = await fetch('/api/animate-avatar', {
    method: 'POST',
    body: formData
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Failed to generate video');
  }

  updateAvatarVideoProgress(100, 'Complete!');

  // Show result
  setTimeout(() => {
    if (avatarVideoProgress) avatarVideoProgress.hidden = true;
    if (avatarVideoResult) avatarVideoResult.hidden = false;
    if (avatarVideoPlayer) avatarVideoPlayer.src = data.video;

    // Save to gallery
    saveAvatarVideo(data.video);

    showToast('Avatar video generated!', false);
  }, 500);
}

// Generate video with multiple segments
async function generateWithSegments() {
  updateAvatarVideoProgress(0, 'Splitting audio into segments...');

  // Split the audio
  const segments = await splitAudioIntoSegments(avatarAudioFile, SEGMENT_DURATION);
  const totalSegments = segments.length;

  updateAvatarVideoProgress(5, `Processing ${totalSegments} segments...`);

  // Show segments result area
  showSegmentsResultArea(totalSegments);

  // Process each segment
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const segmentNum = i + 1;
    const baseProgress = 5 + (90 * i / totalSegments);

    updateAvatarVideoProgress(baseProgress, `Generating segment ${segmentNum} of ${totalSegments}...`);
    updateSegmentStatus(i, 'processing');

    try {
      const formData = new FormData();
      formData.append('avatarImage', avatarVideoFile);
      formData.append('audioFile', segment.file);

      const response = await fetch('/api/animate-avatar', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || `Failed to generate segment ${segmentNum}`);
      }

      // Store the generated segment
      generatedVideoSegments.push({
        index: i,
        url: data.video,
        startTime: segment.startTime,
        endTime: segment.endTime,
        duration: segment.duration
      });

      updateSegmentStatus(i, 'complete', data.video);

    } catch (error) {
      console.error(`Segment ${segmentNum} failed:`, error);
      updateSegmentStatus(i, 'error', null, error.message);
      // Continue with other segments
    }
  }

  updateAvatarVideoProgress(100, 'All segments complete!');

  // Show completion
  setTimeout(() => {
    if (avatarVideoProgress) avatarVideoProgress.hidden = true;
    finishSegmentsGeneration();
  }, 500);
}

// Show segments result area
function showSegmentsResultArea(totalSegments) {
  const resultArea = document.getElementById('avatar-video-result');
  if (!resultArea) return;

  resultArea.hidden = false;
  resultArea.innerHTML = `
    <div class="card">
      <h3>Generating ${totalSegments} Video Segments</h3>
      <p class="segments-info">Each segment will be ready for download. Combine them in your video editor.</p>
      <div id="segments-grid" class="segments-grid">
        ${Array.from({length: totalSegments}, (_, i) => `
          <div class="segment-item" id="segment-item-${i}" data-index="${i}">
            <div class="segment-preview">
              <div class="segment-placeholder">
                <span class="segment-number">${i + 1}</span>
              </div>
              <video class="segment-video" hidden muted playsinline></video>
            </div>
            <div class="segment-info">
              <span class="segment-label">Segment ${i + 1}</span>
              <span class="segment-status pending">Waiting...</span>
            </div>
            <div class="segment-actions" hidden>
              <button class="btn small primary download-segment-btn">Download</button>
              <button class="btn small secondary play-segment-btn">Play</button>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="segments-complete-actions" id="segments-complete-actions" hidden>
        <button class="btn primary" id="download-all-segments-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" style="margin-right: 4px;">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download All as ZIP
        </button>
        <button class="btn secondary" id="new-segments-btn">Create New Video</button>
      </div>
    </div>
  `;

  // Add event listener for download all
  document.getElementById('download-all-segments-btn')?.addEventListener('click', downloadAllSegments);
  document.getElementById('new-segments-btn')?.addEventListener('click', resetAvatarVideo);
}

// Update segment status
function updateSegmentStatus(index, status, videoUrl = null, errorMsg = null) {
  const segmentItem = document.getElementById(`segment-item-${index}`);
  if (!segmentItem) return;

  const statusEl = segmentItem.querySelector('.segment-status');
  const placeholder = segmentItem.querySelector('.segment-placeholder');
  const video = segmentItem.querySelector('.segment-video');
  const actions = segmentItem.querySelector('.segment-actions');

  if (status === 'processing') {
    statusEl.className = 'segment-status processing';
    statusEl.innerHTML = '<span class="spinner-small"></span> Processing...';
  } else if (status === 'complete') {
    statusEl.className = 'segment-status complete';
    statusEl.textContent = 'Complete!';

    if (videoUrl && video) {
      video.src = videoUrl;
      video.hidden = false;
      if (placeholder) placeholder.hidden = true;
    }

    if (actions) {
      actions.hidden = false;
      const downloadBtn = actions.querySelector('.download-segment-btn');
      const playBtn = actions.querySelector('.play-segment-btn');

      downloadBtn?.addEventListener('click', () => downloadSegment(index, videoUrl));
      playBtn?.addEventListener('click', () => playSegment(index, videoUrl));
    }
  } else if (status === 'error') {
    statusEl.className = 'segment-status error';
    statusEl.textContent = errorMsg || 'Failed';
  }
}

// Finish segments generation
function finishSegmentsGeneration() {
  const completeActions = document.getElementById('segments-complete-actions');
  if (completeActions) completeActions.hidden = false;

  const successCount = generatedVideoSegments.length;
  const totalCount = document.querySelectorAll('.segment-item').length;

  if (successCount === totalCount) {
    showToast(`All ${successCount} segments generated!`, false);
  } else {
    showToast(`Generated ${successCount} of ${totalCount} segments`, false);
  }

  // Re-enable generate button
  if (generateAvatarVideoBtn) generateAvatarVideoBtn.disabled = false;
}

// Download a single segment
async function downloadSegment(index, videoUrl) {
  try {
    const response = await fetch(videoUrl);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `avatar-segment-${index + 1}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`Segment ${index + 1} downloaded!`, false);
  } catch (error) {
    showToast('Failed to download segment');
  }
}

// Play a segment
function playSegment(index, videoUrl) {
  const video = document.querySelector(`#segment-item-${index} .segment-video`);
  if (video) {
    video.muted = false;
    video.play();
  }
}

// Download all segments as ZIP
async function downloadAllSegments() {
  if (generatedVideoSegments.length === 0) {
    showToast('No segments to download');
    return;
  }

  showToast('Creating ZIP file...', false);

  try {
    const zip = new JSZip();
    const folder = zip.folder('avatar-video-segments');

    for (let i = 0; i < generatedVideoSegments.length; i++) {
      const segment = generatedVideoSegments[i];
      const response = await fetch(segment.url);
      const blob = await response.blob();
      folder.file(`segment-${String(i + 1).padStart(2, '0')}.mp4`, blob);
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);

    const a = document.createElement('a');
    a.href = url;
    a.download = `avatar-video-segments-${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`Downloaded ${generatedVideoSegments.length} segments as ZIP!`, false);
  } catch (error) {
    showToast('Failed to create ZIP file');
  }
}

// Update progress bar
function updateAvatarVideoProgress(percent, status) {
  if (avatarVideoProgressBar) {
    avatarVideoProgressBar.style.width = `${percent}%`;
  }
  if (avatarVideoStatus) {
    avatarVideoStatus.textContent = status;
  }
}

// Download avatar video
async function downloadAvatarVideo() {
  const videoUrl = avatarVideoPlayer?.src;
  if (!videoUrl) {
    showToast('No video to download');
    return;
  }

  try {
    const response = await fetch(videoUrl);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `avatar-video-${Date.now()}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Video downloaded!', false);
  } catch (error) {
    showToast('Failed to download video');
  }
}

// Reset for new video
function resetAvatarVideo() {
  clearAvatarVideo();
  clearAudio();
  if (avatarVideoResult) avatarVideoResult.hidden = true;
  if (avatarVideoPlayer) avatarVideoPlayer.src = '';
}

// Save video to gallery
function saveAvatarVideo(videoUrl) {
  const item = {
    id: Date.now().toString(),
    url: videoUrl,
    timestamp: new Date().toISOString()
  };

  recentAvatarVideos.unshift(item);

  // Keep only last 10
  if (recentAvatarVideos.length > 10) {
    recentAvatarVideos = recentAvatarVideos.slice(0, 10);
  }

  localStorage.setItem('avatar_videos', JSON.stringify(recentAvatarVideos));
  renderAvatarVideoGallery();
}

// Render avatar video gallery
function renderAvatarVideoGallery() {
  const galleryContainer = document.getElementById('avatar-video-gallery');
  if (!avatarVideoGallery) return;

  if (recentAvatarVideos.length === 0) {
    if (galleryContainer) galleryContainer.hidden = true;
    return;
  }

  if (galleryContainer) galleryContainer.hidden = false;

  avatarVideoGallery.innerHTML = recentAvatarVideos.map(item => `
    <div class="avatar-video-gallery-item" data-id="${item.id}">
      <video src="${item.url}" muted playsinline></video>
      <div class="overlay">
        <button class="play-btn" onclick="playGalleryVideo('${item.id}')">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        </button>
        <button class="delete-btn" onclick="deleteGalleryVideo('${item.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
      <span class="video-date">${formatDate(item.timestamp)}</span>
    </div>
  `).join('');
}

// Play video from gallery
function playGalleryVideo(id) {
  const item = recentAvatarVideos.find(v => v.id === id);
  if (!item) return;

  if (avatarVideoPlayer) avatarVideoPlayer.src = item.url;
  if (avatarVideoResult) avatarVideoResult.hidden = false;

  // Scroll to result
  avatarVideoResult?.scrollIntoView({ behavior: 'smooth' });
}

// Delete video from gallery
function deleteGalleryVideo(id) {
  if (!confirm('Delete this video?')) return;

  recentAvatarVideos = recentAvatarVideos.filter(v => v.id !== id);
  localStorage.setItem('avatar_videos', JSON.stringify(recentAvatarVideos));
  renderAvatarVideoGallery();
  showToast('Video deleted', false);
}

// Make functions globally available
window.playGalleryVideo = playGalleryVideo;
window.deleteGalleryVideo = deleteGalleryVideo;

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAvatarVideo);
} else {
  initAvatarVideo();
}
