/**
 * YouTube Banner Creator
 * Creates channel art with proper safe zones for all devices
 * Full size: 2560 x 1440
 * Mobile safe area: 1546 x 423 (centered)
 */

class BannerCreator {
  constructor() {
    // Canvas dimensions (YouTube recommended)
    this.width = 2560;
    this.height = 1440;

    // Safe zones
    this.safeZones = {
      mobile: { width: 1546, height: 423 },
      tablet: { width: 1855, height: 423 },
      desktop: { width: 2560, height: 423 },
      tv: { width: 2560, height: 1440 }
    };

    // State
    this.backgroundImage = null;
    this.backgroundType = 'color'; // 'ai', 'upload', 'color', 'gradient'
    this.backgroundColor = '#1a1a2e';
    this.gradientStart = '#667eea';
    this.gradientEnd = '#764ba2';
    this.gradientDirection = 'to-right';

    this.logoImage = null;
    this.logoPosition = 'center';
    this.logoSize = 150;

    this.channelName = '';
    this.channelNameColor = '#ffffff';
    this.channelNameFont = 'Inter';
    this.channelNameSize = 80;
    this.channelNamePosition = 'center';
    this.channelNameY = -50;

    this.tagline = '';
    this.taglineColor = '#cccccc';
    this.taglineFont = 'Inter';
    this.taglineSize = 32;
    this.taglinePosition = 'center';
    this.taglineY = 50;

    this.currentDevice = 'full';

    this.init();
  }

  init() {
    // Get canvas and context
    this.canvas = document.getElementById('banner-canvas');
    if (!this.canvas) return;

    this.ctx = this.canvas.getContext('2d');
    this.canvasWrapper = document.querySelector('.banner-canvas-wrapper');

    // Initialize all elements
    this.initElements();
    this.bindEvents();
    this.render();
  }

  initElements() {
    // Device preview buttons
    this.deviceBtns = document.querySelectorAll('.device-btn');

    // Background tabs
    this.bgTabs = document.querySelectorAll('.bg-tab');
    this.bgPanels = document.querySelectorAll('.bg-panel');

    // AI background
    this.bgPromptInput = document.getElementById('banner-bg-prompt');
    this.generateBgBtn = document.getElementById('generate-banner-bg-btn');

    // Upload background
    this.bgUploadArea = document.getElementById('banner-bg-upload');
    this.bgFileInput = document.getElementById('banner-bg-file');

    // Solid color
    this.bgColorInput = document.getElementById('banner-bg-color');
    this.bgColorHex = document.getElementById('banner-bg-color-hex');

    // Gradient
    this.gradientStartInput = document.getElementById('banner-gradient-start');
    this.gradientStartHex = document.getElementById('banner-gradient-start-hex');
    this.gradientEndInput = document.getElementById('banner-gradient-end');
    this.gradientEndHex = document.getElementById('banner-gradient-end-hex');
    this.gradientDirectionSelect = document.getElementById('banner-gradient-direction');

    // Channel name
    this.channelNameInput = document.getElementById('banner-channel-name');
    this.nameColorInput = document.getElementById('banner-name-color');
    this.nameFontSelect = document.getElementById('banner-name-font');
    this.nameSizeSelect = document.getElementById('banner-name-size');
    this.namePositionSelect = document.getElementById('banner-name-position');
    this.nameYSlider = document.getElementById('banner-name-y');

    // Tagline
    this.taglineInput = document.getElementById('banner-tagline');
    this.taglineColorInput = document.getElementById('banner-tagline-color');
    this.taglineFontSelect = document.getElementById('banner-tagline-font');
    this.taglineSizeSelect = document.getElementById('banner-tagline-size');
    this.taglinePositionSelect = document.getElementById('banner-tagline-position');
    this.taglineYSlider = document.getElementById('banner-tagline-y');

    // Logo
    this.logoUploadArea = document.getElementById('banner-logo-upload');
    this.logoFileInput = document.getElementById('banner-logo-file');
    this.logoSettings = document.getElementById('logo-settings');
    this.logoPreview = document.getElementById('banner-logo-preview');
    this.removeLogoBtn = document.getElementById('remove-banner-logo');
    this.logoPositionSelect = document.getElementById('banner-logo-position');
    this.logoSizeSlider = document.getElementById('banner-logo-size');
    this.logoSizeDisplay = document.getElementById('banner-logo-size-display');

    // Export
    this.exportBtn = document.getElementById('export-banner-btn');
    this.copyBtn = document.getElementById('copy-banner-btn');
  }

  bindEvents() {
    // Device preview
    this.deviceBtns.forEach(btn => {
      btn.addEventListener('click', () => this.setDevicePreview(btn.dataset.device));
    });

    // Background tabs
    this.bgTabs.forEach(tab => {
      tab.addEventListener('click', () => this.switchBackgroundTab(tab.dataset.bgType));
    });

    // AI Background generation
    if (this.generateBgBtn) {
      this.generateBgBtn.addEventListener('click', () => this.generateAIBackground());
    }

    // Upload background
    if (this.bgUploadArea) {
      this.bgUploadArea.addEventListener('click', () => this.bgFileInput?.click());
    }
    if (this.bgFileInput) {
      this.bgFileInput.addEventListener('change', (e) => this.handleBackgroundUpload(e));
    }

    // Solid color
    if (this.bgColorInput) {
      this.bgColorInput.addEventListener('input', (e) => {
        this.backgroundColor = e.target.value;
        this.bgColorHex.textContent = e.target.value;
        this.backgroundType = 'color';
        this.backgroundImage = null;
        this.render();
      });
    }

    // Gradient
    if (this.gradientStartInput) {
      this.gradientStartInput.addEventListener('input', (e) => {
        this.gradientStart = e.target.value;
        this.gradientStartHex.textContent = e.target.value;
        this.backgroundType = 'gradient';
        this.backgroundImage = null;
        this.render();
      });
    }
    if (this.gradientEndInput) {
      this.gradientEndInput.addEventListener('input', (e) => {
        this.gradientEnd = e.target.value;
        this.gradientEndHex.textContent = e.target.value;
        this.backgroundType = 'gradient';
        this.backgroundImage = null;
        this.render();
      });
    }
    if (this.gradientDirectionSelect) {
      this.gradientDirectionSelect.addEventListener('change', (e) => {
        this.gradientDirection = e.target.value;
        this.render();
      });
    }

    // Channel name
    if (this.channelNameInput) {
      this.channelNameInput.addEventListener('input', (e) => {
        this.channelName = e.target.value;
        this.render();
      });
    }
    if (this.nameColorInput) {
      this.nameColorInput.addEventListener('input', (e) => {
        this.channelNameColor = e.target.value;
        this.render();
      });
    }
    if (this.nameFontSelect) {
      this.nameFontSelect.addEventListener('change', (e) => {
        this.channelNameFont = e.target.value;
        this.render();
      });
    }
    if (this.nameSizeSelect) {
      this.nameSizeSelect.addEventListener('change', (e) => {
        this.channelNameSize = parseInt(e.target.value);
        this.render();
      });
    }
    if (this.namePositionSelect) {
      this.namePositionSelect.addEventListener('change', (e) => {
        this.channelNamePosition = e.target.value;
        this.render();
      });
    }
    if (this.nameYSlider) {
      this.nameYSlider.addEventListener('input', (e) => {
        this.channelNameY = parseInt(e.target.value);
        this.render();
      });
    }

    // Tagline
    if (this.taglineInput) {
      this.taglineInput.addEventListener('input', (e) => {
        this.tagline = e.target.value;
        this.render();
      });
    }
    if (this.taglineColorInput) {
      this.taglineColorInput.addEventListener('input', (e) => {
        this.taglineColor = e.target.value;
        this.render();
      });
    }
    if (this.taglineFontSelect) {
      this.taglineFontSelect.addEventListener('change', (e) => {
        this.taglineFont = e.target.value;
        this.render();
      });
    }
    if (this.taglineSizeSelect) {
      this.taglineSizeSelect.addEventListener('change', (e) => {
        this.taglineSize = parseInt(e.target.value);
        this.render();
      });
    }
    if (this.taglinePositionSelect) {
      this.taglinePositionSelect.addEventListener('change', (e) => {
        this.taglinePosition = e.target.value;
        this.render();
      });
    }
    if (this.taglineYSlider) {
      this.taglineYSlider.addEventListener('input', (e) => {
        this.taglineY = parseInt(e.target.value);
        this.render();
      });
    }

    // Logo
    if (this.logoUploadArea) {
      this.logoUploadArea.addEventListener('click', () => this.logoFileInput?.click());
    }
    if (this.logoFileInput) {
      this.logoFileInput.addEventListener('change', (e) => this.handleLogoUpload(e));
    }
    if (this.removeLogoBtn) {
      this.removeLogoBtn.addEventListener('click', () => this.removeLogo());
    }
    if (this.logoPositionSelect) {
      this.logoPositionSelect.addEventListener('change', (e) => {
        this.logoPosition = e.target.value;
        this.render();
      });
    }
    if (this.logoSizeSlider) {
      this.logoSizeSlider.addEventListener('input', (e) => {
        this.logoSize = parseInt(e.target.value);
        this.logoSizeDisplay.textContent = `${e.target.value}px`;
        this.render();
      });
    }

    // Export
    if (this.exportBtn) {
      this.exportBtn.addEventListener('click', () => this.exportBanner());
    }
    if (this.copyBtn) {
      this.copyBtn.addEventListener('click', () => this.copyToClipboard());
    }
  }

  setDevicePreview(device) {
    this.currentDevice = device;
    this.deviceBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.device === device);
    });
    if (this.canvasWrapper) {
      this.canvasWrapper.dataset.device = device;
    }
  }

  switchBackgroundTab(type) {
    this.bgTabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.bgType === type);
    });

    document.getElementById('bg-ai-panel')?.classList.toggle('active', type === 'ai');
    document.getElementById('bg-upload-panel')?.classList.toggle('active', type === 'upload');
    document.getElementById('bg-color-panel')?.classList.toggle('active', type === 'color');
    document.getElementById('bg-gradient-panel')?.classList.toggle('active', type === 'gradient');

    // Update background type and render
    if (type === 'color') {
      this.backgroundType = 'color';
      this.backgroundImage = null;
      this.render();
    } else if (type === 'gradient') {
      this.backgroundType = 'gradient';
      this.backgroundImage = null;
      this.render();
    }
  }

  async generateAIBackground() {
    const prompt = this.bgPromptInput?.value.trim();
    if (!prompt) {
      showToast('Please enter a description for the background', true);
      return;
    }

    showLoading('Generating background...');

    try {
      // Enhance prompt for banner dimensions
      const enhancedPrompt = `${prompt}, wide panoramic composition suitable for a YouTube channel banner, 16:9 aspect ratio, no text or logos`;

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: enhancedPrompt,
          size: '1792x1024', // Closest DALL-E size to banner ratio
          quality: 'standard',
          style: 'vivid'
        })
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      // Load the generated image
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.backgroundImage = img;
        this.backgroundType = 'image';
        this.render();
        hideLoading();
        showToast('Background generated successfully!');

        // Save to persistent history
        if (typeof generationHistory !== 'undefined') {
          generationHistory.add({
            type: 'banner',
            prompt: enhancedPrompt,
            imageUrl: data.image,
            model: 'dall-e-3',
            size: '1792x1024',
            quality: 'standard'
          });
        }
      };
      img.onerror = () => {
        hideLoading();
        showToast('Failed to load generated image', true);
      };
      img.src = data.image;

    } catch (error) {
      hideLoading();
      showToast('Failed to generate background: ' + error.message, true);
    }
  }

  handleBackgroundUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        this.backgroundImage = img;
        this.backgroundType = 'image';
        this.render();
        showToast('Background uploaded!');
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  }

  handleLogoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        this.logoImage = img;
        if (this.logoPreview) {
          this.logoPreview.src = event.target.result;
        }
        if (this.logoSettings) {
          this.logoSettings.hidden = false;
        }
        this.render();
        showToast('Logo uploaded!');
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  }

  removeLogo() {
    this.logoImage = null;
    if (this.logoSettings) {
      this.logoSettings.hidden = true;
    }
    if (this.logoFileInput) {
      this.logoFileInput.value = '';
    }
    this.render();
    showToast('Logo removed');
  }

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Clear canvas
    ctx.clearRect(0, 0, w, h);

    // Draw background
    this.drawBackground();

    // Draw logo
    if (this.logoImage) {
      this.drawLogo();
    }

    // Draw text
    this.drawText();
  }

  drawBackground() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    if (this.backgroundType === 'image' && this.backgroundImage) {
      // Draw image to cover canvas
      const img = this.backgroundImage;
      const imgRatio = img.width / img.height;
      const canvasRatio = w / h;

      let drawWidth, drawHeight, offsetX, offsetY;

      if (imgRatio > canvasRatio) {
        // Image is wider - fit height
        drawHeight = h;
        drawWidth = h * imgRatio;
        offsetX = (w - drawWidth) / 2;
        offsetY = 0;
      } else {
        // Image is taller - fit width
        drawWidth = w;
        drawHeight = w / imgRatio;
        offsetX = 0;
        offsetY = (h - drawHeight) / 2;
      }

      ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

    } else if (this.backgroundType === 'gradient') {
      let gradient;

      switch (this.gradientDirection) {
        case 'to-right':
          gradient = ctx.createLinearGradient(0, 0, w, 0);
          break;
        case 'to-left':
          gradient = ctx.createLinearGradient(w, 0, 0, 0);
          break;
        case 'to-bottom':
          gradient = ctx.createLinearGradient(0, 0, 0, h);
          break;
        case 'to-top':
          gradient = ctx.createLinearGradient(0, h, 0, 0);
          break;
        case 'diagonal-1':
          gradient = ctx.createLinearGradient(0, 0, w, h);
          break;
        case 'diagonal-2':
          gradient = ctx.createLinearGradient(0, h, w, 0);
          break;
        case 'radial':
          gradient = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, Math.max(w, h) / 2);
          break;
        default:
          gradient = ctx.createLinearGradient(0, 0, w, 0);
      }

      gradient.addColorStop(0, this.gradientStart);
      gradient.addColorStop(1, this.gradientEnd);

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);

    } else {
      // Solid color
      ctx.fillStyle = this.backgroundColor;
      ctx.fillRect(0, 0, w, h);
    }
  }

  drawLogo() {
    const ctx = this.ctx;
    const img = this.logoImage;
    const size = this.logoSize;

    // Calculate aspect ratio
    const ratio = img.width / img.height;
    let drawWidth = size;
    let drawHeight = size / ratio;

    // If height is constrained
    if (drawHeight > size) {
      drawHeight = size;
      drawWidth = size * ratio;
    }

    // Calculate position
    const centerY = this.height / 2;
    let x;

    switch (this.logoPosition) {
      case 'left':
        x = 100;
        break;
      case 'right':
        x = this.width - drawWidth - 100;
        break;
      case 'center':
      default:
        x = (this.width - drawWidth) / 2;
    }

    const y = centerY - drawHeight / 2;

    ctx.drawImage(img, x, y, drawWidth, drawHeight);
  }

  drawText() {
    const ctx = this.ctx;
    const centerX = this.width / 2;
    const centerY = this.height / 2;

    // Draw channel name
    if (this.channelName) {
      ctx.font = `bold ${this.channelNameSize}px ${this.channelNameFont}`;
      ctx.fillStyle = this.channelNameColor;

      let textX;
      switch (this.channelNamePosition) {
        case 'left':
          ctx.textAlign = 'left';
          textX = 100;
          break;
        case 'right':
          ctx.textAlign = 'right';
          textX = this.width - 100;
          break;
        case 'center':
        default:
          ctx.textAlign = 'center';
          textX = centerX;
      }

      ctx.textBaseline = 'middle';

      // Add text shadow for better visibility
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;

      ctx.fillText(this.channelName, textX, centerY + this.channelNameY);

      // Reset shadow
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }

    // Draw tagline
    if (this.tagline) {
      ctx.font = `${this.taglineSize}px ${this.taglineFont}`;
      ctx.fillStyle = this.taglineColor;

      let textX;
      switch (this.taglinePosition) {
        case 'left':
          ctx.textAlign = 'left';
          textX = 100;
          break;
        case 'right':
          ctx.textAlign = 'right';
          textX = this.width - 100;
          break;
        case 'center':
        default:
          ctx.textAlign = 'center';
          textX = centerX;
      }

      ctx.textBaseline = 'middle';

      // Add text shadow
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 1;

      ctx.fillText(this.tagline, textX, centerY + this.taglineY);

      // Reset shadow
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
  }

  exportBanner() {
    // Create download link
    const link = document.createElement('a');
    link.download = 'youtube-banner-2560x1440.png';
    link.href = this.canvas.toDataURL('image/png');
    link.click();

    showToast('Banner downloaded!');
  }

  async copyToClipboard() {
    try {
      const blob = await new Promise(resolve => {
        this.canvas.toBlob(resolve, 'image/png');
      });

      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);

      showToast('Banner copied to clipboard!');
    } catch (error) {
      showToast('Failed to copy to clipboard: ' + error.message, true);
    }
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Only initialize if we're on a page with the banner creator
  if (document.getElementById('banner-canvas')) {
    window.bannerCreator = new BannerCreator();
  }
});

// Also initialize when tab becomes active (for lazy loading)
document.addEventListener('click', (e) => {
  if (e.target.matches('[data-tab="yt-banner"]')) {
    setTimeout(() => {
      if (!window.bannerCreator && document.getElementById('banner-canvas')) {
        window.bannerCreator = new BannerCreator();
      }
    }, 100);
  }
});
