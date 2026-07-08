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
const resultSection = document.getElementById('result');
const resultImage = document.getElementById('result-image');
const revisedPrompt = document.getElementById('revised-prompt');
const downloadBtn = document.getElementById('download-btn');

// Utility Functions
function showLoading() {
  loading.removeAttribute('hidden');
  loading.style.display = 'flex';
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

// File Upload Handling
function setupUploadArea(uploadAreaId, fileInputId, previewId) {
  const uploadArea = document.getElementById(uploadAreaId);
  const fileInput = document.getElementById(fileInputId);
  const preview = document.getElementById(previewId);

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

  // Create a new DataTransfer to set the file
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
}

// Initialize upload areas
setupUploadArea('edit-upload', 'edit-file', 'edit-preview');
setupUploadArea('mask-upload', 'mask-file', 'mask-preview');
setupUploadArea('variations-upload', 'variations-file', 'variations-preview');
setupUploadArea('swap-upload', 'swap-file', 'swap-preview');

// API Functions
async function generateImage() {
  const prompt = document.getElementById('generate-prompt').value.trim();
  const size = document.getElementById('generate-size').value;
  const style = document.getElementById('generate-style').value;
  const quality = document.getElementById('generate-quality').value;

  if (!prompt) {
    showToast('Please enter a prompt');
    return;
  }

  showLoading();

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, size, style, quality })
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    showResult(data.image, data.revised_prompt);
    showToast('Image generated successfully!', false);
  } catch (error) {
    showToast(error.message);
  } finally {
    hideLoading();
  }
}

async function editImage() {
  const fileInput = document.getElementById('edit-file');
  const maskInput = document.getElementById('mask-file');
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

    if (maskInput.files[0]) {
      formData.append('mask', maskInput.files[0]);
    }

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

async function swapCharacter() {
  const fileInput = document.getElementById('swap-file');
  const prompt = document.getElementById('swap-prompt').value.trim();

  if (!fileInput.files[0]) {
    showToast('Please upload an image');
    return;
  }

  if (!prompt) {
    showToast('Please describe the new character');
    return;
  }

  showLoading();

  try {
    const formData = new FormData();
    formData.append('image', fileInput.files[0]);
    formData.append('prompt', prompt);

    const response = await fetch('/api/character-swap', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    showResult(data.image);
    showToast('Character swapped successfully!', false);
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
document.getElementById('swap-btn').addEventListener('click', swapCharacter);

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
