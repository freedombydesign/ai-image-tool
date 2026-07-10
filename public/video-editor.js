// Video Editor Module
// Handles scene import, audio recording/upload, timeline, captions, effects, and video export

class VideoEditor {
  constructor() {
    // State
    this.scenes = [];
    this.audioBlob = null;
    this.audioBuffer = null;
    this.audioDuration = 0;
    this.isRecording = false;
    this.isPaused = false;
    this.mediaRecorder = null;
    this.recordingChunks = [];
    this.recordingStartTime = 0;
    this.recordingElapsed = 0;
    this.recordingInterval = null;

    // Background Music
    this.bgMusicBlob = null;
    this.bgMusicVolume = 0.3; // 30% default
    this.bgMusicLoop = true;
    this.bgMusicDuck = true; // Duck during voiceover

    // Talking Avatar
    this.avatarEnabled = false;
    this.avatarPhotoUrl = null;
    this.avatarPhotoBlob = null;
    this.avatarPosition = 'bottom-right';
    this.avatarSize = 'medium';
    this.avatarShape = 'circle';
    this.avatarVideos = []; // Generated avatar videos per scene

    // FFmpeg
    this.ffmpeg = null;
    this.ffmpegLoaded = false;

    // Playback
    this.isPlaying = false;
    this.playbackTime = 0;
    this.animationFrame = null;

    // User ID for persistence
    this.userId = this.getUserId();

    // Initialize
    this.initElements();
    this.initEventListeners();
    this.initFFmpeg();
    this.loadAvatarSettings(); // Restore saved avatar state
    this.loadSavedAudioFromPreview(); // Load audio from Batch Scenes if available
    this.loadScenesFromSupabase(); // Restore saved scenes
  }

  // Get or create a unique user ID for persistence
  getUserId() {
    let id = localStorage.getItem('video_editor_user_id');
    if (!id) {
      id = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('video_editor_user_id', id);
    }
    return id;
  }

  // Save avatar settings to localStorage and Supabase
  async saveAvatarSettings() {
    const settings = {
      avatarEnabled: this.avatarEnabled,
      avatarPhotoUrl: this.avatarPhotoUrl,
      avatarPosition: this.avatarPosition,
      avatarSize: this.avatarSize,
      avatarShape: this.avatarShape
    };

    // Save to localStorage (fast)
    try {
      localStorage.setItem('video_editor_avatar', JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to save avatar to localStorage:', e);
    }

    // Sync to Supabase (persistent)
    try {
      await fetch('/api/db/video-editor-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: this.userId,
          ...settings
        })
      });
      console.log('Avatar settings synced to Supabase');
    } catch (e) {
      console.error('Failed to sync avatar to Supabase:', e);
    }
  }

  // Save scenes to Supabase for persistence
  async saveScenesToSupabase() {
    if (this.scenes.length === 0) return;

    const userId = localStorage.getItem('ai_tool_user_id') || this.userId;
    if (!userId) {
      console.log('No user ID for scene persistence');
      return;
    }

    try {
      const response = await fetch('/api/db/batch-scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId,
          scenes: this.scenes.map(scene => ({
            imageUrl: scene.imageUrl,
            text: scene.text || scene.caption || '',
            duration: scene.duration,
            startTime: scene.startTime
          }))
        })
      });

      if (response.ok) {
        console.log(`Saved ${this.scenes.length} scenes to Supabase`);
      } else {
        const error = await response.json();
        console.error('Failed to save scenes:', error);
      }
    } catch (e) {
      console.error('Failed to save scenes to Supabase:', e);
    }
  }

  // Load scenes from Supabase on page load
  async loadScenesFromSupabase() {
    const userId = localStorage.getItem('ai_tool_user_id') || this.userId;
    if (!userId) return;

    try {
      const response = await fetch(`/api/db/batch-scenes/${userId}`);
      if (response.ok) {
        const data = await response.json();
        // API returns { batches: [...] }, get the most recent batch's scenes
        if (data.batches && data.batches.length > 0) {
          const mostRecentBatch = data.batches[0]; // Already sorted by created_at desc
          const scenes = mostRecentBatch.scenes || [];
          if (scenes.length > 0) {
            this.scenes = scenes.map((scene, index) => ({
              id: `scene-${Date.now()}-${index}`,
              imageUrl: scene.imageUrl || scene.image_url,
              text: scene.text || '',
              caption: scene.text || '',
              duration: scene.duration || 6,
              startTime: scene.startTime || scene.start_time || 0
            }));
            this.renderScenes();
            this.updateTotalDuration();
            console.log(`Loaded ${this.scenes.length} scenes from Supabase`);
            showToast(`Restored ${this.scenes.length} scenes`, 'success');
          }
        }
      }
    } catch (e) {
      console.error('Failed to load scenes from Supabase:', e);
    }
  }

  // Load avatar settings from localStorage (fast) then Supabase
  async loadAvatarSettings() {
    // Load from localStorage first (immediate)
    try {
      const saved = localStorage.getItem('video_editor_avatar');
      if (saved) {
        const settings = JSON.parse(saved);
        this.applyAvatarSettings(settings);
        console.log('Avatar loaded from localStorage');
      }
    } catch (e) {
      console.error('Failed to load avatar from localStorage:', e);
    }

    // Then sync from Supabase (may override)
    try {
      const response = await fetch(`/api/db/video-editor-settings/${this.userId}`);
      const result = await response.json();
      if (result.success && result.settings) {
        const settings = {
          avatarEnabled: result.settings.avatar_enabled,
          avatarPhotoUrl: result.settings.avatar_photo_url,
          avatarPosition: result.settings.avatar_position,
          avatarSize: result.settings.avatar_size,
          avatarShape: result.settings.avatar_shape
        };
        this.applyAvatarSettings(settings);
        console.log('Avatar loaded from Supabase');
      }
    } catch (e) {
      console.error('Failed to load avatar from Supabase:', e);
    }
  }

  // Apply loaded avatar settings to UI
  applyAvatarSettings(settings) {
    if (!settings) return;

    this.avatarEnabled = settings.avatarEnabled || false;
    this.avatarPhotoUrl = settings.avatarPhotoUrl || null;
    this.avatarPosition = settings.avatarPosition || 'bottom-right';
    this.avatarSize = settings.avatarSize || 'medium';
    this.avatarShape = settings.avatarShape || 'circle';

    // Update UI elements
    if (this.enableAvatarToggle) {
      this.enableAvatarToggle.checked = this.avatarEnabled;
    }
    if (this.avatarOverlayOptions) {
      this.avatarOverlayOptions.hidden = !this.avatarEnabled;
    }
    if (this.avatarPositionSelect) {
      this.avatarPositionSelect.value = this.avatarPosition;
    }
    if (this.avatarSizeSelect) {
      this.avatarSizeSelect.value = this.avatarSize;
    }
    if (this.avatarShapeSelect) {
      this.avatarShapeSelect.value = this.avatarShape;
    }

    // Load avatar photo if URL exists
    if (this.avatarPhotoUrl) {
      this.loadAvatarPhotoFromUrl(this.avatarPhotoUrl);
    }
  }

  // Load avatar photo from URL (for restoring saved state)
  async loadAvatarPhotoFromUrl(url) {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      this.avatarPhotoBlob = blob;
      this.avatarPhotoUrl = url;

      // Update UI
      if (this.editorAvatarImg) {
        this.editorAvatarImg.src = url;
      }
      if (this.editorAvatarPreview) {
        this.editorAvatarPreview.hidden = false;
      }
      if (this.editorAvatarPlaceholder) {
        this.editorAvatarPlaceholder.hidden = true;
      }

      this.updateAvatarCostEstimate();
      console.log('Avatar photo restored from URL');
    } catch (e) {
      console.error('Failed to load avatar photo from URL:', e);
    }
  }

  // Generate hash for audio segment (for caching)
  async generateAudioHash(blob) {
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
  }

  // Check cache for existing avatar video
  async getCachedAvatarVideo(audioHash) {
    try {
      const response = await fetch(`/api/db/avatar-video-cache/${this.userId}/${audioHash}`);
      const result = await response.json();
      if (result.success && result.cache && result.cache.video_url) {
        console.log('Found cached avatar video for hash:', audioHash);
        return result.cache.video_url;
      }
    } catch (e) {
      console.error('Cache lookup failed:', e);
    }
    return null;
  }

  // Save avatar video to cache
  async cacheAvatarVideo(audioHash, videoUrl, duration) {
    try {
      await fetch('/api/db/avatar-video-cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: this.userId,
          audioHash: audioHash,
          videoUrl: videoUrl,
          duration: duration
        })
      });
      console.log('Avatar video cached for hash:', audioHash);
    } catch (e) {
      console.error('Failed to cache avatar video:', e);
    }
  }

  initElements() {
    // Import
    this.importFromBatchBtn = document.getElementById('import-from-batch');
    this.sceneUploadArea = document.getElementById('scene-upload-area');
    this.sceneFilesInput = document.getElementById('scene-files');
    this.importedScenesGrid = document.getElementById('imported-scenes');

    // Audio
    this.recordAudioBtn = document.getElementById('record-audio-btn');
    this.recordIcon = document.getElementById('record-icon');
    this.recordingControls = document.getElementById('recording-controls');
    this.pauseRecordingBtn = document.getElementById('pause-recording-btn');
    this.stopRecordingBtn = document.getElementById('stop-recording-btn');
    this.recordingTime = document.getElementById('recording-time');
    this.uploadAudioBtn = document.getElementById('upload-audio-btn');
    this.audioFileInput = document.getElementById('audio-file');
    this.audioPreview = document.getElementById('audio-preview');
    this.audioPlayer = document.getElementById('audio-player');
    this.removeAudioBtn = document.getElementById('remove-audio-btn');
    this.trimAudioBtn = document.getElementById('trim-audio-btn');
    this.audioTrimSection = document.getElementById('audio-trim-section');
    this.trimStartInput = document.getElementById('trim-start');
    this.trimEndInput = document.getElementById('trim-end');
    this.trimDuration = document.getElementById('trim-duration');
    this.trimStartSlider = document.getElementById('trim-start-slider');
    this.trimEndSlider = document.getElementById('trim-end-slider');
    this.trimSelectedRegion = document.getElementById('trim-selected-region');
    this.previewTrimBtn = document.getElementById('preview-trim-btn');
    this.applyTrimBtn = document.getElementById('apply-trim-btn');
    this.cancelTrimBtn = document.getElementById('cancel-trim-btn');

    // Background Music
    this.bgMusicFileInput = document.getElementById('bg-music-file');
    this.uploadBgMusicBtn = document.getElementById('upload-bg-music-btn');
    this.bgMusicPreview = document.getElementById('bg-music-preview');
    this.bgMusicPlayer = document.getElementById('bg-music-player');
    this.bgMusicVolumeSlider = document.getElementById('bg-music-volume');
    this.bgMusicVolumeDisplay = document.getElementById('bg-music-volume-display');
    this.bgMusicLoopCheckbox = document.getElementById('bg-music-loop');
    this.bgMusicDuckCheckbox = document.getElementById('bg-music-duck');
    this.removeBgMusicBtn = document.getElementById('remove-bg-music-btn');

    // Timeline
    this.playPreviewBtn = document.getElementById('play-preview-btn');
    this.autoSyncBtn = document.getElementById('auto-sync-btn');
    this.totalDuration = document.getElementById('total-duration');
    this.waveformContainer = document.getElementById('waveform-container');
    this.timeline = document.getElementById('timeline');
    this.timelinePlayhead = document.getElementById('timeline-playhead');
    this.timelineScenes = document.getElementById('timeline-scenes');

    // Captions
    this.captionStyle = document.getElementById('caption-style');
    this.captionFontSize = document.getElementById('caption-font-size');
    this.captionsList = document.getElementById('captions-list');
    this.generateCaptionsBtn = document.getElementById('generate-captions-btn');
    this.clearCaptionsBtn = document.getElementById('clear-captions-btn');
    this.previewCaptionBtn = document.getElementById('preview-caption-btn');

    // Effects
    this.transitionType = document.getElementById('transition-type');
    this.transitionDuration = document.getElementById('transition-duration');
    this.zoomEffect = document.getElementById('zoom-effect');

    // Export
    this.exportResolution = document.getElementById('export-resolution');
    this.exportFps = document.getElementById('export-fps');
    this.exportProgress = document.getElementById('export-progress');
    this.exportProgressBar = document.getElementById('export-progress-bar');
    this.exportStatus = document.getElementById('export-status');
    this.exportVideoBtn = document.getElementById('export-video-btn');

    // Talking Avatar
    this.enableAvatarToggle = document.getElementById('enable-avatar-overlay');
    this.avatarOverlayOptions = document.getElementById('avatar-overlay-options');
    this.editorAvatarUpload = document.getElementById('editor-avatar-upload');
    this.editorAvatarFile = document.getElementById('editor-avatar-file');
    this.editorAvatarPreview = document.getElementById('editor-avatar-preview');
    this.editorAvatarImg = document.getElementById('editor-avatar-img');
    this.clearAvatarBtn = document.getElementById('clear-editor-avatar');
    this.avatarPositionSelect = document.getElementById('avatar-position');
    this.avatarSizeSelect = document.getElementById('avatar-size');
    this.avatarShapeSelect = document.getElementById('avatar-shape');
    this.avatarCostEstimate = document.getElementById('avatar-cost-estimate');
    this.avatarGenerationStatus = document.getElementById('avatar-generation-status');
    this.editorAvatarPlaceholder = document.getElementById('editor-avatar-placeholder');

    // Preview Modal
    this.previewModal = document.getElementById('video-preview-modal');
    this.closePreviewBtn = document.getElementById('close-preview');
    this.previewCanvas = document.getElementById('preview-canvas');
    this.previewPlayPauseBtn = document.getElementById('preview-play-pause');
    this.previewTime = document.getElementById('preview-time');

    // Canvas context
    this.ctx = this.previewCanvas.getContext('2d');
  }

  initEventListeners() {
    // Import
    this.importFromBatchBtn.addEventListener('click', () => this.importFromBatch());
    this.sceneUploadArea.addEventListener('click', () => this.sceneFilesInput.click());
    this.sceneFilesInput.addEventListener('change', (e) => this.handleSceneUpload(e));

    // Audio
    this.recordAudioBtn.addEventListener('click', () => this.startRecording());
    if (this.pauseRecordingBtn) {
      this.pauseRecordingBtn.addEventListener('click', () => this.togglePauseRecording());
    }
    if (this.stopRecordingBtn) {
      this.stopRecordingBtn.addEventListener('click', () => this.stopRecording());
    }
    this.uploadAudioBtn.addEventListener('click', () => this.audioFileInput.click());
    this.audioFileInput.addEventListener('change', (e) => this.handleAudioUpload(e));
    this.removeAudioBtn.addEventListener('click', () => this.removeAudio());

    // Audio Trim Controls
    if (this.trimAudioBtn) {
      this.trimAudioBtn.addEventListener('click', () => this.showTrimControls());
    }
    if (this.cancelTrimBtn) {
      this.cancelTrimBtn.addEventListener('click', () => this.hideTrimControls());
    }
    if (this.applyTrimBtn) {
      this.applyTrimBtn.addEventListener('click', () => this.applyTrim());
    }
    if (this.previewTrimBtn) {
      this.previewTrimBtn.addEventListener('click', () => this.previewTrim());
    }
    if (this.trimStartSlider) {
      this.trimStartSlider.addEventListener('input', () => this.updateTrimFromSliders());
    }
    if (this.trimEndSlider) {
      this.trimEndSlider.addEventListener('input', () => this.updateTrimFromSliders());
    }
    if (this.trimStartInput) {
      this.trimStartInput.addEventListener('change', () => this.updateTrimFromInputs());
    }
    if (this.trimEndInput) {
      this.trimEndInput.addEventListener('change', () => this.updateTrimFromInputs());
    }

    // Background Music
    if (this.uploadBgMusicBtn) {
      this.uploadBgMusicBtn.addEventListener('click', () => this.bgMusicFileInput.click());
    }
    if (this.bgMusicFileInput) {
      this.bgMusicFileInput.addEventListener('change', (e) => this.handleBgMusicUpload(e));
    }
    if (this.removeBgMusicBtn) {
      this.removeBgMusicBtn.addEventListener('click', () => this.removeBgMusic());
    }
    if (this.bgMusicVolumeSlider) {
      this.bgMusicVolumeSlider.addEventListener('input', (e) => this.updateBgMusicVolume(e.target.value));
    }
    if (this.bgMusicLoopCheckbox) {
      this.bgMusicLoopCheckbox.addEventListener('change', (e) => {
        this.bgMusicLoop = e.target.checked;
        if (this.bgMusicPlayer) this.bgMusicPlayer.loop = this.bgMusicLoop;
      });
    }
    if (this.bgMusicDuckCheckbox) {
      this.bgMusicDuckCheckbox.addEventListener('change', (e) => {
        this.bgMusicDuck = e.target.checked;
      });
    }

    // Timeline
    this.playPreviewBtn.addEventListener('click', () => this.openPreview());
    this.autoSyncBtn.addEventListener('click', () => this.autoSyncScenes());

    // Captions
    if (this.generateCaptionsBtn) {
      this.generateCaptionsBtn.addEventListener('click', () => this.generateCaptionsFromAudio());
    }
    if (this.clearCaptionsBtn) {
      this.clearCaptionsBtn.addEventListener('click', () => this.clearCaptions());
    }
    if (this.previewCaptionBtn) {
      this.previewCaptionBtn.addEventListener('click', () => this.previewCaptionStyle());
    }

    // Color picker + hex input sync
    this.setupColorSync('caption-text-color', 'caption-text-color-hex');
    this.setupColorSync('caption-highlight-color', 'caption-highlight-color-hex');

    // Export
    this.exportVideoBtn.addEventListener('click', () => this.exportVideo());

    // SRT Export for CapCut
    const exportSrtBtn = document.getElementById('export-srt-btn');
    if (exportSrtBtn) {
      exportSrtBtn.addEventListener('click', () => this.downloadSRT());
    }

    // ZIP Export
    const exportZipBtn = document.getElementById('export-zip-btn');
    if (exportZipBtn) {
      exportZipBtn.addEventListener('click', () => this.exportAsZip());
    }

    // Talking Avatar
    if (this.enableAvatarToggle) {
      this.enableAvatarToggle.addEventListener('change', (e) => this.toggleAvatarOverlay(e.target.checked));
    }
    if (this.editorAvatarUpload) {
      this.editorAvatarUpload.addEventListener('click', () => {
        if (this.editorAvatarFile) this.editorAvatarFile.click();
      });
    }
    if (this.editorAvatarFile) {
      this.editorAvatarFile.addEventListener('change', (e) => this.handleAvatarPhotoUpload(e));
    }
    if (this.clearAvatarBtn) {
      this.clearAvatarBtn.addEventListener('click', () => this.clearAvatarPhoto());
    }
    if (this.avatarPositionSelect) {
      this.avatarPositionSelect.addEventListener('change', (e) => {
        this.avatarPosition = e.target.value;
        this.saveAvatarSettings();
      });
    }
    if (this.avatarSizeSelect) {
      this.avatarSizeSelect.addEventListener('change', (e) => {
        this.avatarSize = e.target.value;
        this.saveAvatarSettings();
      });
    }
    if (this.avatarShapeSelect) {
      this.avatarShapeSelect.addEventListener('change', (e) => {
        this.avatarShape = e.target.value;
        this.saveAvatarSettings();
      });
    }

    // Preview Modal
    this.closePreviewBtn.addEventListener('click', () => this.closePreview());
    this.previewPlayPauseBtn.addEventListener('click', () => this.togglePlayback());
  }

  // Sync color picker with hex text input
  setupColorSync(colorId, hexId) {
    const colorInput = document.getElementById(colorId);
    const hexInput = document.getElementById(hexId);
    if (!colorInput || !hexInput) return;

    // Color picker changes -> update hex input
    colorInput.addEventListener('input', () => {
      hexInput.value = colorInput.value.toUpperCase();
    });

    // Hex input changes -> update color picker
    hexInput.addEventListener('input', () => {
      let hex = hexInput.value.trim();
      // Add # if missing
      if (hex && !hex.startsWith('#')) hex = '#' + hex;
      // Validate hex format
      if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
        colorInput.value = hex;
        hexInput.style.borderColor = '';
      } else if (hex.length > 0) {
        hexInput.style.borderColor = 'red';
      }
    });

    // On blur, format properly
    hexInput.addEventListener('blur', () => {
      let hex = hexInput.value.trim().toUpperCase();
      if (hex && !hex.startsWith('#')) hex = '#' + hex;
      if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
        hexInput.value = hex;
        colorInput.value = hex;
        hexInput.style.borderColor = '';
      }
    });
  }

  async initFFmpeg() {
    // CDN options to try
    const cdnOptions = [
      'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
      'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
    ];

    // Check for FFmpeg library - it may be exposed as FFmpegWASM or FFmpeg
    const FFmpegLib = window.FFmpegWASM || window.FFmpeg;
    if (!FFmpegLib) {
      console.error('FFmpeg library not loaded - script may not have loaded');
      // Try loading the script dynamically
      await this.loadFFmpegScript();
      return;
    }

    for (const coreURL of cdnOptions) {
      try {
        console.log('Trying FFmpeg from:', coreURL);
        const FFmpegClass = FFmpegLib.FFmpeg || FFmpegLib;
        this.ffmpeg = new FFmpegClass();

        this.ffmpeg.on('progress', ({ progress }) => {
          const percent = Math.round(progress * 100);
          if (this.exportProgressBar) {
            this.exportProgressBar.style.width = `${percent}%`;
          }
          if (this.exportStatus) {
            this.exportStatus.textContent = `Encoding: ${percent}%`;
          }
        });

        await this.ffmpeg.load({ coreURL });

        this.ffmpegLoaded = true;
        console.log('FFmpeg loaded successfully from:', coreURL);
        return; // Success - exit loop
      } catch (error) {
        console.error('Failed to load FFmpeg from', coreURL, error);
      }
    }

    // All CDNs failed - show error
    console.error('All FFmpeg CDNs failed');
    showToast('Video export unavailable. Will export as image slideshow instead.');
  }

  // Dynamically load FFmpeg script if not already loaded
  async loadFFmpegScript() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.7/dist/umd/ffmpeg.js';
      script.onload = async () => {
        console.log('FFmpeg script loaded dynamically');
        // Wait a moment for the library to initialize
        await new Promise(r => setTimeout(r, 500));
        // Try init again
        const FFmpegLib = window.FFmpegWASM || window.FFmpeg;
        if (FFmpegLib) {
          try {
            const FFmpegClass = FFmpegLib.FFmpeg || FFmpegLib;
            this.ffmpeg = new FFmpegClass();
            this.ffmpeg.on('progress', ({ progress }) => {
              const percent = Math.round(progress * 100);
              if (this.exportProgressBar) this.exportProgressBar.style.width = `${percent}%`;
              if (this.exportStatus) this.exportStatus.textContent = `Encoding: ${percent}%`;
            });
            await this.ffmpeg.load({
              coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js'
            });
            this.ffmpegLoaded = true;
            console.log('FFmpeg loaded after dynamic script load');
            resolve();
          } catch (e) {
            console.error('FFmpeg init failed after dynamic load:', e);
            reject(e);
          }
        } else {
          reject(new Error('FFmpeg still not available'));
        }
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // Import scenes from batch generator
  async importFromBatch() {
    let scenesToImport = [];

    // Try 1: Get from generatedScenes array
    if (typeof generatedScenes !== 'undefined' && generatedScenes.length > 0) {
      scenesToImport = generatedScenes.filter(s => s && s.imageUrl);
    }

    // Try 2: Recover from DOM scene cards if array is empty
    if (scenesToImport.length === 0) {
      const sceneCards = document.querySelectorAll('.scene-card img.scene-image');
      if (sceneCards.length > 0) {
        scenesToImport = Array.from(sceneCards).map((img, i) => ({
          imageUrl: img.src,
          text: ''
        }));
        console.log('Recovered', scenesToImport.length, 'scenes from DOM');
      }
    }

    // Try 3: Load from Supabase (most reliable after refresh)
    if (scenesToImport.length === 0) {
      try {
        showToast('Loading scenes from Supabase...', 'info');
        const userId = localStorage.getItem('ai_tool_user_id');
        if (userId) {
          const response = await fetch(`/api/db/batch-scenes/${userId}`);
          const data = await response.json();
          if (data.success && data.batches && data.batches.length > 0) {
            // Get most recent batch
            const latestBatch = data.batches[0];
            scenesToImport = latestBatch.scenes.filter(s => s && s.imageUrl);
            console.log('Loaded', scenesToImport.length, 'scenes from Supabase');
          }
        }
      } catch (e) {
        console.error('Failed to load from Supabase:', e);
      }
    }

    // Try 4: Recover from localStorage (fallback)
    if (scenesToImport.length === 0) {
      try {
        const saved = localStorage.getItem('sceneHistory');
        if (saved) {
          const data = JSON.parse(saved);
          if (data.scenes && data.scenes.length > 0) {
            scenesToImport = data.scenes.filter(s => s && s.imageUrl);
            console.log('Recovered', scenesToImport.length, 'scenes from localStorage');
          }
        }
      } catch (e) {
        console.error('Failed to recover from localStorage:', e);
      }
    }

    if (scenesToImport.length === 0) {
      showToast('No scenes available. Generate scenes in the Batch Scenes tab first.');
      return;
    }

    // Get scene duration from slider or default to 6 seconds
    const sceneDuration = typeof getSceneDuration === 'function'
      ? getSceneDuration()
      : (document.getElementById('scene-duration')?.value || 6);
    const duration = parseInt(sceneDuration);

    this.scenes = scenesToImport.map((scene, index) => ({
      id: index,
      imageUrl: scene.imageUrl,
      text: scene.text || '',
      duration: duration,
      caption: scene.text ? scene.text.substring(0, 100) : '',
      startTime: index * duration
    }));

    this.renderImportedScenes();
    this.renderTimeline();
    this.renderCaptions();
    this.updateTotalDuration();

    // Auto-save scenes to Supabase for persistence
    this.saveScenesToSupabase();

    showToast(`Imported ${this.scenes.length} scenes!`, false);
  }

  // Handle scene file upload
  handleSceneUpload(e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    files.forEach((file, index) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        this.scenes.push({
          id: this.scenes.length,
          imageUrl: event.target.result,
          text: '',
          duration: 3,
          caption: '',
          startTime: this.scenes.length * 3
        });

        if (index === files.length - 1) {
          this.renderImportedScenes();
          this.renderTimeline();
          this.renderCaptions();
          this.updateTotalDuration();
          // Auto-save uploaded scenes
          this.saveScenesToSupabase();
        }
      };
      reader.readAsDataURL(file);
    });
  }

  renderImportedScenes() {
    this.importedScenesGrid.innerHTML = this.scenes.map((scene, index) => `
      <div class="imported-scene" data-index="${index}" draggable="true">
        <img src="${scene.imageUrl}" alt="Scene ${index + 1}">
        <span class="scene-order">${index + 1}</span>
        <button class="remove-scene" onclick="videoEditor.removeScene(${index})">×</button>
      </div>
    `).join('');

    // Add drag and drop
    this.initDragAndDrop();
  }

  initDragAndDrop() {
    const scenes = this.importedScenesGrid.querySelectorAll('.imported-scene');

    scenes.forEach(scene => {
      scene.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', scene.dataset.index);
        scene.classList.add('dragging');
      });

      scene.addEventListener('dragend', () => {
        scene.classList.remove('dragging');
      });

      scene.addEventListener('dragover', (e) => {
        e.preventDefault();
        scene.classList.add('drag-over');
      });

      scene.addEventListener('dragleave', () => {
        scene.classList.remove('drag-over');
      });

      scene.addEventListener('drop', (e) => {
        e.preventDefault();
        scene.classList.remove('drag-over');

        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
        const toIndex = parseInt(scene.dataset.index);

        if (fromIndex !== toIndex) {
          this.reorderScenes(fromIndex, toIndex);
        }
      });
    });
  }

  reorderScenes(fromIndex, toIndex) {
    const [moved] = this.scenes.splice(fromIndex, 1);
    this.scenes.splice(toIndex, 0, moved);

    // Update IDs and start times
    this.recalculateTimings();
    this.renderImportedScenes();
    this.renderTimeline();
    this.renderCaptions();
    // Auto-save after reorder
    this.saveScenesToSupabase();
  }

  removeScene(index) {
    this.scenes.splice(index, 1);
    this.recalculateTimings();
    this.renderImportedScenes();
    this.renderTimeline();
    this.renderCaptions();
    this.updateTotalDuration();
    // Auto-save after removal
    this.saveScenesToSupabase();
  }

  recalculateTimings() {
    let startTime = 0;
    this.scenes.forEach((scene, index) => {
      scene.id = index;
      scene.startTime = startTime;
      startTime += scene.duration;
    });
  }

  // Audio Recording
  async startRecording() {
    // Don't start if already recording
    if (this.isRecording) {
      showToast('Already recording. Use pause or stop buttons.');
      return;
    }

    try {
      this.recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Try different audio formats - Safari prefers mp4/aac, Chrome prefers webm
      let options = {};
      const formatPriority = [
        'audio/mp4',
        'audio/aac',
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus'
      ];

      for (const format of formatPriority) {
        if (MediaRecorder.isTypeSupported(format)) {
          options = { mimeType: format };
          console.log('Using audio format:', format);
          break;
        }
      }

      // If no specific format supported, let browser choose default
      if (!options.mimeType) {
        console.log('Using browser default audio format');
      }

      this.mediaRecorder = new MediaRecorder(this.recordingStream, options);
      this.recordingChunks = [];
      this.recordingMimeType = this.mediaRecorder.mimeType;
      console.log('MediaRecorder initialized with mimeType:', this.recordingMimeType);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.recordingChunks.push(e.data);
          console.log('Audio chunk received:', e.data.size, 'bytes');
        }
      };

      this.mediaRecorder.onerror = (e) => {
        console.error('MediaRecorder error:', e);
        showToast('Recording error occurred. Please try again.');
        this.resetRecordingUI();
      };

      this.mediaRecorder.onstop = () => {
        console.log('Recording stopped, chunks:', this.recordingChunks.length);

        if (this.recordingChunks.length === 0) {
          showToast('No audio was captured. Please try again.');
          this.recordingStream.getTracks().forEach(track => track.stop());
          this.resetRecordingUI();
          return;
        }

        // Use the actual mimeType from the recorder
        const mimeType = this.recordingMimeType || 'audio/mp4';
        console.log('Creating blob with mimeType:', mimeType);

        this.audioBlob = new Blob(this.recordingChunks, { type: mimeType });
        console.log('Audio blob created:', this.audioBlob.size, 'bytes, type:', this.audioBlob.type);

        if (this.audioBlob.size === 0) {
          showToast('Recording was empty. Please try again.');
          this.recordingStream.getTracks().forEach(track => track.stop());
          this.resetRecordingUI();
          return;
        }

        this.loadAudioBlob(this.audioBlob);
        this.recordingStream.getTracks().forEach(track => track.stop());

        // Save recorded audio to IndexedDB for persistence
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        this.saveAudioToIndexedDB(`recording-${timestamp}.webm`, this.audioBlob);

        showToast('Recording saved!', false);
        this.resetRecordingUI();
      };

      // Request data when stopped (timeslice can cause issues on some browsers)
      this.mediaRecorder.start();
      this.isRecording = true;
      this.isPaused = false;
      this.recordingStartTime = Date.now();
      this.recordingElapsed = 0;

      // Show recording controls, hide record button
      if (this.recordAudioBtn) this.recordAudioBtn.hidden = true;
      if (this.recordingControls) this.recordingControls.hidden = false;
      if (this.recordingTime) {
        this.recordingTime.textContent = '00:00';
        this.recordingTime.classList.remove('paused');
      }

      this.recordingInterval = setInterval(() => {
        if (!this.isPaused) {
          const elapsed = this.recordingElapsed + Math.floor((Date.now() - this.recordingStartTime) / 1000);
          const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
          const secs = (elapsed % 60).toString().padStart(2, '0');
          if (this.recordingTime) this.recordingTime.textContent = `${mins}:${secs}`;
        }
      }, 1000);

      showToast('Recording started...', false);

    } catch (error) {
      console.error('Microphone access error:', error);
      if (error.name === 'NotAllowedError') {
        showToast('Microphone access denied. Please allow microphone permission in your browser.');
      } else if (error.name === 'NotFoundError') {
        showToast('No microphone found. Please connect a microphone.');
      } else {
        showToast('Could not access microphone: ' + error.message);
      }
    }
  }

  togglePauseRecording() {
    if (!this.mediaRecorder || !this.isRecording) return;

    if (this.isPaused) {
      // Resume
      this.mediaRecorder.resume();
      this.isPaused = false;
      this.recordingStartTime = Date.now();
      if (this.pauseRecordingBtn) this.pauseRecordingBtn.innerHTML = '⏸️ Pause';
      if (this.recordingTime) this.recordingTime.classList.remove('paused');
      showToast('Recording resumed', false);
    } else {
      // Pause
      this.mediaRecorder.pause();
      this.isPaused = true;
      this.recordingElapsed += Math.floor((Date.now() - this.recordingStartTime) / 1000);
      if (this.pauseRecordingBtn) this.pauseRecordingBtn.innerHTML = '▶️ Resume';
      if (this.recordingTime) this.recordingTime.classList.add('paused');
      showToast('Recording paused', false);
    }
  }

  stopRecording() {
    if (this.mediaRecorder && this.isRecording) {
      // If paused, resume briefly to ensure final data is captured
      if (this.isPaused) {
        this.mediaRecorder.resume();
      }

      // Request any remaining data before stopping
      if (this.mediaRecorder.state === 'recording') {
        this.mediaRecorder.requestData();
      }

      this.mediaRecorder.stop();
      this.isRecording = false;
      this.isPaused = false;
      clearInterval(this.recordingInterval);
    }
  }

  resetRecordingUI() {
    // Hide recording controls, show record button
    if (this.recordAudioBtn) this.recordAudioBtn.hidden = false;
    if (this.recordingControls) this.recordingControls.hidden = true;
    if (this.pauseRecordingBtn) this.pauseRecordingBtn.innerHTML = '⏸️ Pause';
    if (this.recordingTime) {
      this.recordingTime.textContent = '00:00';
      this.recordingTime.classList.remove('paused');
    }
    this.recordingElapsed = 0;
  }

  async handleAudioUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Read file as ArrayBuffer and create Blob for Safari compatibility
    try {
      const arrayBuffer = await file.arrayBuffer();
      this.audioBlob = new Blob([arrayBuffer], { type: file.type || 'audio/mpeg' });
      this.loadAudioBlob(this.audioBlob);

      // Save to IndexedDB for persistence across refreshes
      this.saveAudioToIndexedDB(file.name, this.audioBlob);
    } catch (error) {
      console.error('Error reading audio file:', error);
      // Fallback to using file directly
      this.audioBlob = file;
      this.loadAudioBlob(file);
    }
  }

  // Save audio to IndexedDB for persistence
  async saveAudioToIndexedDB(fileName, blob) {
    try {
      // Convert blob to base64 data URL
      const reader = new FileReader();
      reader.onload = async () => {
        const audioData = reader.result;

        // Use the saveAudioToDB function from app.js if available
        if (typeof saveAudioToDB === 'function') {
          await saveAudioToDB('previewAudio', {
            audioData: audioData,
            fileName: fileName,
            timestamp: Date.now()
          });
          console.log('Audio saved to IndexedDB:', fileName);
        }
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      console.warn('Could not save audio to IndexedDB:', error);
    }
  }

  async loadAudioBlob(blob) {
    try {
      // Revoke any previous URL to prevent memory leaks
      if (this.currentAudioUrl) {
        URL.revokeObjectURL(this.currentAudioUrl);
      }

      // Firefox fix: ensure correct MIME type
      let audioBlob = blob;
      if (!blob.type || blob.type === 'application/octet-stream') {
        // Try to detect type from file signature or default to mp3
        audioBlob = new Blob([blob], { type: 'audio/mpeg' });
      }

      const url = URL.createObjectURL(audioBlob);
      this.currentAudioUrl = url;

      // Set up audio player with error handling
      this.audioPlayer.onerror = (e) => {
        console.error('Audio player error:', e);
        const error = this.audioPlayer.error;
        if (error) {
          console.error('Audio error code:', error.code, 'message:', error.message);
        }
      };

      // Wait for the audio to be loadable
      this.audioPlayer.onloadedmetadata = () => {
        console.log('Audio metadata loaded, duration:', this.audioPlayer.duration);
        this.audioDuration = this.audioPlayer.duration;
        this.updateTotalDuration();
      };

      this.audioPlayer.oncanplay = () => {
        console.log('Audio can play');
      };

      this.audioPlayer.src = url;
      this.audioPlayer.load(); // Force reload

      // Show audio preview section - Firefox fix: use style directly
      if (this.audioPreview) {
        this.audioPreview.hidden = false;
        this.audioPreview.style.display = 'block';
        console.log('Audio preview shown');
      } else {
        console.error('audioPreview element not found!');
      }

      // Try to decode audio for waveform (may fail for some formats)
      try {
        const arrayBuffer = await blob.arrayBuffer();
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();

        this.audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        this.audioDuration = this.audioBuffer.duration;

        this.renderWaveform();
        this.updateTotalDuration();

        console.log('Audio decoded:', this.audioDuration, 'seconds');
      } catch (decodeError) {
        console.warn('Waveform decode failed, using player duration:', decodeError);
        // Still show the player, just without waveform
        // Duration will come from onloadedmetadata
      }

    } catch (error) {
      console.error('Audio load error:', error);
      showToast('Could not load audio. Try recording again or upload an MP3/WAV file.');
    }
  }

  // Load saved audio from Batch Scenes preview (IndexedDB)
  async loadSavedAudioFromPreview() {
    // Check if audio is already loaded
    if (this.audioBlob) return;

    try {
      // Access the IndexedDB functions from app.js
      if (typeof loadAudioFromDB !== 'function') {
        console.log('IndexedDB functions not available yet');
        return;
      }

      const saved = await loadAudioFromDB('previewAudio');
      if (saved && saved.audioData) {
        console.log('Found saved audio from Batch Scenes:', saved.fileName);

        // Convert base64 data URL to blob
        const response = await fetch(saved.audioData);
        const blob = await response.blob();

        this.audioBlob = blob;
        await this.loadAudioBlob(blob);

        showToast(`Loaded voiceover: ${saved.fileName}`, 'success');
      }
    } catch (err) {
      console.warn('Could not load saved audio:', err);
    }
  }

  removeAudio() {
    // Revoke any existing audio URL to prevent memory leaks
    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl);
      this.currentAudioUrl = null;
    }

    this.audioBlob = null;
    this.audioBuffer = null;
    this.audioDuration = 0;

    // Clear audio player without triggering error
    this.audioPlayer.pause();
    this.audioPlayer.removeAttribute('src');
    this.audioPlayer.load();

    this.audioPreview.hidden = true;
    this.waveformContainer.innerHTML = '';
    this.updateTotalDuration();
    showToast('Audio removed.', false);
  }

  // Audio Trim Methods
  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  parseTime(timeStr) {
    const parts = timeStr.split(':');
    if (parts.length === 2) {
      return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return parseFloat(timeStr) || 0;
  }

  showTrimControls() {
    if (!this.audioBlob || !this.audioDuration) {
      showToast('No audio to trim');
      return;
    }

    this.audioTrimSection.hidden = false;
    this.trimStartTime = 0;
    this.trimEndTime = this.audioDuration;

    // Set initial values
    this.trimStartInput.value = this.formatTime(0);
    this.trimEndInput.value = this.formatTime(this.audioDuration);
    this.trimDuration.textContent = this.formatTime(this.audioDuration);

    this.trimStartSlider.value = 0;
    this.trimEndSlider.value = 100;
    this.updateTrimRegion();
  }

  hideTrimControls() {
    this.audioTrimSection.hidden = true;
  }

  updateTrimFromSliders() {
    const startPercent = parseFloat(this.trimStartSlider.value);
    const endPercent = parseFloat(this.trimEndSlider.value);

    // Ensure start is always before end
    if (startPercent >= endPercent) {
      if (this.trimStartSlider === document.activeElement) {
        this.trimStartSlider.value = endPercent - 1;
      } else {
        this.trimEndSlider.value = startPercent + 1;
      }
      return;
    }

    this.trimStartTime = (startPercent / 100) * this.audioDuration;
    this.trimEndTime = (endPercent / 100) * this.audioDuration;

    this.trimStartInput.value = this.formatTime(this.trimStartTime);
    this.trimEndInput.value = this.formatTime(this.trimEndTime);
    this.trimDuration.textContent = this.formatTime(this.trimEndTime - this.trimStartTime);

    this.updateTrimRegion();
  }

  updateTrimFromInputs() {
    this.trimStartTime = this.parseTime(this.trimStartInput.value);
    this.trimEndTime = this.parseTime(this.trimEndInput.value);

    // Clamp values
    this.trimStartTime = Math.max(0, Math.min(this.trimStartTime, this.audioDuration));
    this.trimEndTime = Math.max(0, Math.min(this.trimEndTime, this.audioDuration));

    if (this.trimStartTime >= this.trimEndTime) {
      this.trimEndTime = Math.min(this.trimStartTime + 1, this.audioDuration);
    }

    this.trimStartSlider.value = (this.trimStartTime / this.audioDuration) * 100;
    this.trimEndSlider.value = (this.trimEndTime / this.audioDuration) * 100;
    this.trimDuration.textContent = this.formatTime(this.trimEndTime - this.trimStartTime);

    this.updateTrimRegion();
  }

  updateTrimRegion() {
    const startPercent = (this.trimStartTime / this.audioDuration) * 100;
    const endPercent = (this.trimEndTime / this.audioDuration) * 100;

    this.trimSelectedRegion.style.left = `${startPercent}%`;
    this.trimSelectedRegion.style.width = `${endPercent - startPercent}%`;
  }

  previewTrim() {
    if (!this.audioPlayer) return;

    this.audioPlayer.currentTime = this.trimStartTime;
    this.audioPlayer.play();

    // Stop at end time
    const checkEnd = () => {
      if (this.audioPlayer.currentTime >= this.trimEndTime) {
        this.audioPlayer.pause();
        this.audioPlayer.removeEventListener('timeupdate', checkEnd);
      }
    };
    this.audioPlayer.addEventListener('timeupdate', checkEnd);

    showToast(`Playing ${this.formatTime(this.trimStartTime)} to ${this.formatTime(this.trimEndTime)}`);
  }

  async applyTrim() {
    if (!this.audioBlob || !this.audioDuration) {
      showToast('No audio to trim');
      return;
    }

    const duration = this.trimEndTime - this.trimStartTime;
    if (duration < 1) {
      showToast('Selection must be at least 1 second');
      return;
    }

    showToast('Trimming audio...');

    try {
      // Use AudioContext to trim
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const arrayBuffer = await this.audioBlob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Calculate sample positions
      const sampleRate = audioBuffer.sampleRate;
      const startSample = Math.floor(this.trimStartTime * sampleRate);
      const endSample = Math.floor(this.trimEndTime * sampleRate);
      const newLength = endSample - startSample;

      // Create new buffer with trimmed audio
      const newBuffer = audioContext.createBuffer(
        audioBuffer.numberOfChannels,
        newLength,
        sampleRate
      );

      // Copy trimmed data for each channel
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const oldData = audioBuffer.getChannelData(channel);
        const newData = newBuffer.getChannelData(channel);
        for (let i = 0; i < newLength; i++) {
          newData[i] = oldData[startSample + i];
        }
      }

      // Convert to WAV blob
      const wavBlob = await this.audioBufferToWav(newBuffer);

      // Update audio
      this.audioBlob = wavBlob;
      this.audioDuration = duration;
      await this.loadAudioBlob(wavBlob);

      this.hideTrimControls();
      showToast(`Trimmed to ${this.formatTime(duration)}`, 'success');

    } catch (error) {
      console.error('Trim error:', error);
      showToast('Failed to trim audio');
    }
  }

  audioBufferToWav(audioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;

    const dataLength = audioBuffer.length * blockAlign;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);

    // WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);

    // Audio data
    let offset = 44;
    for (let i = 0; i < audioBuffer.length; i++) {
      for (let channel = 0; channel < numChannels; channel++) {
        const sample = audioBuffer.getChannelData(channel)[i];
        const clampedSample = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, clampedSample * 0x7FFF, true);
        offset += 2;
      }
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  // Background Music Methods
  handleBgMusicUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    this.bgMusicBlob = file;
    this.loadBgMusicBlob(file);
  }

  loadBgMusicBlob(blob) {
    try {
      // Revoke any previous URL
      if (this.currentBgMusicUrl) {
        URL.revokeObjectURL(this.currentBgMusicUrl);
      }

      const url = URL.createObjectURL(blob);
      this.currentBgMusicUrl = url;

      this.bgMusicPlayer.onerror = (e) => {
        console.error('Background music player error:', e);
        showToast('Could not load background music. Try a different audio file.');
      };

      this.bgMusicPlayer.onloadedmetadata = () => {
        console.log('Background music loaded, duration:', this.bgMusicPlayer.duration);
      };

      this.bgMusicPlayer.src = url;
      this.bgMusicPlayer.volume = this.bgMusicVolume;
      this.bgMusicPlayer.loop = this.bgMusicLoop;
      this.bgMusicPlayer.load();

      this.bgMusicPreview.hidden = false;
      showToast('Background music added!', false);
    } catch (error) {
      console.error('Background music load error:', error);
      showToast('Could not load background music.');
    }
  }

  updateBgMusicVolume(value) {
    this.bgMusicVolume = parseInt(value) / 100;
    if (this.bgMusicPlayer) {
      this.bgMusicPlayer.volume = this.bgMusicVolume;
    }
    if (this.bgMusicVolumeDisplay) {
      this.bgMusicVolumeDisplay.textContent = `${value}%`;
    }
  }

  removeBgMusic() {
    // Revoke URL to prevent memory leaks
    if (this.currentBgMusicUrl) {
      URL.revokeObjectURL(this.currentBgMusicUrl);
      this.currentBgMusicUrl = null;
    }

    this.bgMusicBlob = null;

    // Clear player without triggering error
    this.bgMusicPlayer.pause();
    this.bgMusicPlayer.removeAttribute('src');
    this.bgMusicPlayer.load();

    this.bgMusicPreview.hidden = true;
    showToast('Background music removed.', false);
  }

  // Talking Avatar Methods
  toggleAvatarOverlay(enabled) {
    this.avatarEnabled = enabled;
    if (this.avatarOverlayOptions) {
      this.avatarOverlayOptions.hidden = !enabled;
    }
    this.updateAvatarCostEstimate();
    this.saveAvatarSettings(); // Persist
  }

  async handleAvatarPhotoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Please upload an image file.');
      return;
    }

    this.avatarPhotoBlob = file;

    // Convert to base64 for persistence
    const base64 = await this.blobToBase64(file);
    this.avatarPhotoUrl = base64;

    // Update preview image
    if (this.editorAvatarImg) {
      this.editorAvatarImg.src = base64;
    }

    // Show preview container, hide placeholder
    if (this.editorAvatarPreview) {
      this.editorAvatarPreview.hidden = false;
    }

    if (this.editorAvatarPlaceholder) {
      this.editorAvatarPlaceholder.hidden = true;
    }

    this.updateAvatarCostEstimate();
    this.saveAvatarSettings(); // Persist
    showToast('Avatar photo saved!', false);
  }

  // Convert blob to base64 data URI
  blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  clearAvatarPhoto() {
    this.avatarPhotoUrl = null;
    this.avatarPhotoBlob = null;

    // Clear and hide preview
    if (this.editorAvatarImg) {
      this.editorAvatarImg.src = '';
    }

    if (this.editorAvatarPreview) {
      this.editorAvatarPreview.hidden = true;
    }

    // Show placeholder
    if (this.editorAvatarPlaceholder) {
      this.editorAvatarPlaceholder.hidden = false;
    }

    // Reset file input
    if (this.editorAvatarFile) {
      this.editorAvatarFile.value = '';
    }

    this.updateAvatarCostEstimate();
    this.saveAvatarSettings(); // Persist
    showToast('Avatar photo cleared.', false);
  }

  updateAvatarCostEstimate() {
    if (!this.avatarGenerationStatus) return;

    if (!this.avatarEnabled || !this.avatarPhotoBlob || this.scenes.length === 0) {
      this.avatarGenerationStatus.hidden = true;
      return;
    }

    // Calculate total audio duration to estimate cost
    // LivePortrait costs ~$0.05 per 90-second segment
    const totalDuration = this.audioDuration || this.getTotalDuration();
    const segmentLength = 90; // seconds per segment
    const numSegments = Math.ceil(totalDuration / segmentLength);
    const costPerSegment = 0.05;
    const estimatedCost = (numSegments * costPerSegment).toFixed(2);

    if (this.avatarCostEstimate) {
      this.avatarCostEstimate.textContent = `$${estimatedCost}`;
    }

    const sceneCountEl = document.getElementById('avatar-scene-count');
    if (sceneCountEl) {
      sceneCountEl.textContent = numSegments;
    }

    this.avatarGenerationStatus.hidden = false;
  }

  // Split audio into segments for avatar generation
  async splitAudioForAvatar() {
    if (!this.audioBlob) {
      throw new Error('No audio available to split');
    }

    const totalDuration = this.audioDuration || this.getTotalDuration();
    const segmentLength = 90; // 90 seconds max per LivePortrait call
    const segments = [];

    // If audio is short enough, use it as-is
    if (totalDuration <= segmentLength) {
      segments.push({
        blob: this.audioBlob,
        startTime: 0,
        endTime: totalDuration,
        index: 0
      });
      return segments;
    }

    // Need to split audio using Web Audio API
    if (!this.audioBuffer) {
      // Decode audio
      const arrayBuffer = await this.audioBlob.arrayBuffer();
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    }

    const sampleRate = this.audioBuffer.sampleRate;
    const numChannels = this.audioBuffer.numberOfChannels;

    let startTime = 0;
    let segmentIndex = 0;

    while (startTime < totalDuration) {
      const endTime = Math.min(startTime + segmentLength, totalDuration);
      const startSample = Math.floor(startTime * sampleRate);
      const endSample = Math.floor(endTime * sampleRate);
      const segmentSamples = endSample - startSample;

      // Create new audio buffer for this segment
      const offlineCtx = new OfflineAudioContext(numChannels, segmentSamples, sampleRate);
      const segmentBuffer = offlineCtx.createBuffer(numChannels, segmentSamples, sampleRate);

      // Copy samples
      for (let channel = 0; channel < numChannels; channel++) {
        const sourceData = this.audioBuffer.getChannelData(channel);
        const destData = segmentBuffer.getChannelData(channel);
        for (let i = 0; i < segmentSamples; i++) {
          destData[i] = sourceData[startSample + i];
        }
      }

      // Convert buffer to WAV blob
      const wavBlob = this.audioBufferToWav(segmentBuffer);

      segments.push({
        blob: wavBlob,
        startTime: startTime,
        endTime: endTime,
        index: segmentIndex
      });

      startTime = endTime;
      segmentIndex++;
    }

    return segments;
  }

  // Convert AudioBuffer to WAV blob
  audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = buffer.length * blockAlign;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;

    const arrayBuffer = new ArrayBuffer(totalSize);
    const view = new DataView(arrayBuffer);

    // WAV header
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, totalSize - 8, true);
    this.writeString(view, 8, 'WAVE');
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    this.writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Interleave channels and write samples
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let channel = 0; channel < numChannels; channel++) {
        const sample = buffer.getChannelData(channel)[i];
        const clipped = Math.max(-1, Math.min(1, sample));
        const int16 = clipped < 0 ? clipped * 0x8000 : clipped * 0x7FFF;
        view.setInt16(offset, int16, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  // Generate talking avatar videos for all scenes (with caching)
  async generateAvatarVideos() {
    if (!this.avatarEnabled || !this.avatarPhotoBlob || !this.audioBlob) {
      return [];
    }

    const statusEl = this.exportStatus;
    if (statusEl) statusEl.textContent = 'Splitting audio for avatar...';

    // Split audio into segments
    const audioSegments = await this.splitAudioForAvatar();
    console.log(`Split audio into ${audioSegments.length} segments`);

    this.avatarVideos = [];
    let cachedCount = 0;
    let generatedCount = 0;

    for (let i = 0; i < audioSegments.length; i++) {
      const segment = audioSegments[i];

      // Generate hash for this audio segment
      const audioHash = await this.generateAudioHash(segment.blob);

      if (statusEl) {
        statusEl.textContent = `Checking cache for segment ${i + 1}/${audioSegments.length}...`;
      }

      // Check cache first
      const cachedVideoUrl = await this.getCachedAvatarVideo(audioHash);

      if (cachedVideoUrl) {
        // Use cached video
        this.avatarVideos.push({
          videoUrl: cachedVideoUrl,
          startTime: segment.startTime,
          endTime: segment.endTime,
          index: segment.index
        });
        cachedCount++;
        console.log(`Avatar video ${i + 1} loaded from cache`);
        continue;
      }

      // Not cached - generate new video
      if (statusEl) {
        statusEl.textContent = `Generating avatar video ${i + 1}/${audioSegments.length}...`;
      }

      try {
        // Prepare form data for avatar generation
        const formData = new FormData();
        formData.append('avatarImage', this.avatarPhotoBlob, 'avatar.png');
        formData.append('audioFile', segment.blob, `segment_${i}.wav`);

        // Call the avatar generation API
        const response = await fetch('/api/animate-avatar', {
          method: 'POST',
          body: formData
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || 'Avatar generation failed');
        }

        // Cache the generated video
        const duration = segment.endTime - segment.startTime;
        await this.cacheAvatarVideo(audioHash, result.videoUrl, duration);

        this.avatarVideos.push({
          videoUrl: result.videoUrl,
          startTime: segment.startTime,
          endTime: segment.endTime,
          index: segment.index
        });

        generatedCount++;
        console.log(`Avatar video ${i + 1} generated and cached:`, result.videoUrl);

      } catch (error) {
        console.error(`Failed to generate avatar video ${i + 1}:`, error);
        showToast(`Avatar generation failed for segment ${i + 1}: ${error.message}`);
        // Continue with remaining segments
      }
    }

    console.log(`Avatar videos: ${cachedCount} from cache, ${generatedCount} newly generated`);
    if (cachedCount > 0) {
      showToast(`Reused ${cachedCount} cached avatar video(s)!`, false);
    }

    return this.avatarVideos;
  }

  // Get avatar video for a specific time
  getAvatarVideoAtTime(time) {
    return this.avatarVideos.find(video =>
      time >= video.startTime && time < video.endTime
    );
  }

  // Calculate avatar overlay position and size for canvas
  getAvatarOverlayRect(canvasWidth, canvasHeight) {
    // Size multipliers
    const sizeMap = {
      'small': 0.15,
      'medium': 0.25,
      'large': 0.35
    };

    const sizeFactor = sizeMap[this.avatarSize] || 0.25;
    const avatarWidth = Math.floor(canvasWidth * sizeFactor);
    const avatarHeight = Math.floor(avatarWidth * (9/16)); // 16:9 aspect ratio for video

    const padding = 20;
    let x, y;

    switch (this.avatarPosition) {
      case 'top-left':
        x = padding;
        y = padding;
        break;
      case 'top-right':
        x = canvasWidth - avatarWidth - padding;
        y = padding;
        break;
      case 'bottom-left':
        x = padding;
        y = canvasHeight - avatarHeight - padding;
        break;
      case 'bottom-right':
      default:
        x = canvasWidth - avatarWidth - padding;
        y = canvasHeight - avatarHeight - padding;
        break;
    }

    return { x, y, width: avatarWidth, height: avatarHeight };
  }

  renderWaveform() {
    if (!this.audioBuffer) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'waveform-canvas';
    canvas.width = this.waveformContainer.offsetWidth * 2;
    canvas.height = 120;

    const ctx = canvas.getContext('2d');
    const data = this.audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / canvas.width);
    const amp = canvas.height / 2;

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.beginPath();
    ctx.moveTo(0, amp);
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 1;

    for (let i = 0; i < canvas.width; i++) {
      let min = 1.0, max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = data[(i * step) + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      ctx.lineTo(i, (1 + min) * amp);
      ctx.lineTo(i, (1 + max) * amp);
    }

    ctx.stroke();

    this.waveformContainer.innerHTML = '';
    this.waveformContainer.appendChild(canvas);
  }

  // Auto-sync scenes to audio using intelligent speech recognition
  async autoSyncScenes() {
    if (!this.audioBlob || this.scenes.length === 0) {
      showToast('Need both audio and scenes to auto-sync.');
      return;
    }

    // Show syncing state
    this.autoSyncBtn.disabled = true;
    this.autoSyncBtn.innerHTML = '⏳ Analyzing Audio...';

    try {
      // Prepare scene descriptions for matching
      const sceneDescriptions = this.scenes.map((scene, index) => ({
        index,
        text: scene.text || scene.caption || `Scene ${index + 1}`,
        description: scene.text || scene.caption || ''
      }));

      // Upload audio to Supabase first to bypass Vercel limit
      const configResponse = await fetch('/api/supabase-config');
      if (!configResponse.ok) {
        throw new Error('Cannot get storage config');
      }
      const config = await configResponse.json();

      const mimeType = this.audioBlob.type || 'audio/mpeg';
      let ext = 'm4a';
      if (mimeType.includes('wav')) ext = 'wav';
      else if (mimeType.includes('mp3') || mimeType.includes('mpeg')) ext = 'mp3';
      else if (mimeType.includes('webm')) ext = 'webm';

      const fileName = `sync-audio-${Date.now()}.${ext}`;
      const filePath = `audio/${fileName}`;
      const uploadUrl = `${config.url}/storage/v1/object/${config.bucket}/${filePath}`;

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.anonKey}`,
          'apikey': config.anonKey,
          'Content-Type': mimeType,
          'x-upsert': 'true'
        },
        body: this.audioBlob
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload audio');
      }

      const publicUrl = `${config.url}/storage/v1/object/public/${config.bucket}/${filePath}`;

      // Call transcription API with URL
      const response = await fetch('/api/transcribe-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl: publicUrl })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Transcription failed');
      }

      console.log('Transcription result:', result);

      // Apply scene timings from intelligent matching
      if (result.sceneTimings && result.sceneTimings.length > 0) {
        result.sceneTimings.forEach((timing, index) => {
          if (this.scenes[index]) {
            this.scenes[index].startTime = timing.startTime;
            this.scenes[index].duration = timing.duration;

            // Log matching confidence for debugging
            if (timing.confidence > 0.1) {
              console.log(`Scene ${index + 1} matched to: "${timing.matchedText}" (confidence: ${(timing.confidence * 100).toFixed(1)}%)`);
            }
          }
        });

        this.renderTimeline();
        this.renderCaptions();
        this.updateTotalDuration();
        showToast(`Scenes synced using speech recognition! Transcription: "${result.transcription.substring(0, 50)}..."`, false);
      } else {
        // Fallback to basic transcription-based timing using segments
        this.applyBasicSegmentTiming(result.segments);
      }

    } catch (error) {
      console.error('Smart sync error:', error);

      // Fallback to silence-based sync
      showToast('Speech recognition unavailable, using pause detection...', false);
      this.fallbackSilenceSync();
    } finally {
      this.autoSyncBtn.disabled = false;
      this.autoSyncBtn.innerHTML = '🎯 Auto-Sync';
    }
  }

  // Apply basic timing from transcription segments (fallback)
  applyBasicSegmentTiming(segments) {
    if (!segments || segments.length === 0) {
      this.fallbackSilenceSync();
      return;
    }

    const totalDuration = this.audioDuration || segments[segments.length - 1].end;

    // Distribute scenes across segments
    if (segments.length >= this.scenes.length) {
      // More segments than scenes - group them
      const segmentsPerScene = Math.ceil(segments.length / this.scenes.length);

      this.scenes.forEach((scene, index) => {
        const startSegIdx = index * segmentsPerScene;
        const endSegIdx = Math.min(startSegIdx + segmentsPerScene - 1, segments.length - 1);

        scene.startTime = segments[startSegIdx].start;
        scene.duration = segments[endSegIdx].end - segments[startSegIdx].start;
      });
    } else {
      // More scenes than segments - distribute evenly within segments
      const durationPerScene = totalDuration / this.scenes.length;
      this.scenes.forEach((scene, index) => {
        scene.startTime = index * durationPerScene;
        scene.duration = durationPerScene;
      });
    }

    this.renderTimeline();
    this.renderCaptions();
    this.updateTotalDuration();
    showToast('Scenes synced to speech segments!', false);
  }

  // Fallback silence-based sync
  fallbackSilenceSync() {
    if (!this.audioBuffer) {
      // Ultimate fallback - even distribution
      const totalDuration = this.audioDuration || (this.scenes.length * 3);
      const durationPerScene = totalDuration / this.scenes.length;
      this.scenes.forEach((scene, index) => {
        scene.startTime = index * durationPerScene;
        scene.duration = durationPerScene;
      });
      this.renderTimeline();
      this.updateTotalDuration();
      showToast('Scenes distributed evenly.', false);
      return;
    }

    // Detect silence/pauses and distribute scenes
    const silenceThreshold = 0.02;
    const minSilenceDuration = 0.3;
    const data = this.audioBuffer.getChannelData(0);
    const sampleRate = this.audioBuffer.sampleRate;

    // Find pause points
    const pauses = [];
    let inSilence = false;
    let silenceStart = 0;

    for (let i = 0; i < data.length; i++) {
      const amplitude = Math.abs(data[i]);

      if (amplitude < silenceThreshold) {
        if (!inSilence) {
          inSilence = true;
          silenceStart = i;
        }
      } else {
        if (inSilence) {
          const duration = (i - silenceStart) / sampleRate;
          if (duration >= minSilenceDuration) {
            pauses.push({
              start: silenceStart / sampleRate,
              end: i / sampleRate,
              midpoint: (silenceStart + i) / 2 / sampleRate
            });
          }
          inSilence = false;
        }
      }
    }

    // Distribute scenes based on pauses or evenly
    if (pauses.length >= this.scenes.length - 1) {
      // Use pauses as breakpoints
      let startTime = 0;
      this.scenes.forEach((scene, index) => {
        scene.startTime = startTime;
        if (index < pauses.length) {
          scene.duration = pauses[index].midpoint - startTime;
          startTime = pauses[index].midpoint;
        } else {
          scene.duration = this.audioDuration - startTime;
        }
      });
    } else {
      // Distribute evenly
      const durationPerScene = this.audioDuration / this.scenes.length;
      this.scenes.forEach((scene, index) => {
        scene.startTime = index * durationPerScene;
        scene.duration = durationPerScene;
      });
    }

    this.renderTimeline();
    this.updateTotalDuration();
    showToast('Scenes synced to audio pauses!', false);
  }

  renderTimeline() {
    const totalDuration = this.getTotalDuration();

    this.timelineScenes.innerHTML = this.scenes.map((scene, index) => {
      const widthPercent = (scene.duration / totalDuration) * 100;
      return `
        <div class="timeline-scene" data-index="${index}" style="width: ${widthPercent}%">
          <img src="${scene.imageUrl}" alt="Scene ${index + 1}">
          <span class="scene-duration">${scene.duration.toFixed(1)}s</span>
          <div class="resize-handle"></div>
        </div>
      `;
    }).join('');

    this.initTimelineInteractions();
  }

  initTimelineInteractions() {
    const scenes = this.timelineScenes.querySelectorAll('.timeline-scene');

    scenes.forEach(scene => {
      const handle = scene.querySelector('.resize-handle');
      let isResizing = false;
      let startX, startWidth, sceneIndex;

      handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = scene.offsetWidth;
        sceneIndex = parseInt(scene.dataset.index);
        e.preventDefault();
      });

      document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const diff = e.clientX - startX;
        const timelineWidth = this.timelineScenes.offsetWidth;
        const totalDuration = this.getTotalDuration();

        const newWidth = Math.max(40, startWidth + diff);
        const newDuration = (newWidth / timelineWidth) * totalDuration;

        this.scenes[sceneIndex].duration = Math.max(0.5, newDuration);
        this.recalculateTimings();
        this.renderTimeline();
        this.updateTotalDuration();
      });

      document.addEventListener('mouseup', () => {
        isResizing = false;
      });
    });
  }

  renderCaptions() {
    if (this.scenes.length === 0) {
      this.captionsList.innerHTML = '<p class="muted">Captions will appear here for each scene</p>';
      return;
    }

    this.captionsList.innerHTML = this.scenes.map((scene, index) => `
      <div class="caption-item">
        <img src="${scene.imageUrl}" class="caption-scene" alt="Scene ${index + 1}">
        <div class="caption-input">
          <textarea
            placeholder="Enter caption for scene ${index + 1}..."
            onchange="videoEditor.updateCaption(${index}, this.value)"
          >${scene.caption || ''}</textarea>
          <div class="caption-time">${this.formatTime(scene.startTime)} - ${this.formatTime(scene.startTime + scene.duration)}</div>
        </div>
      </div>
    `).join('');
  }

  updateCaption(index, text) {
    if (this.scenes[index]) {
      this.scenes[index].caption = text;
    }
  }

  // Generate captions from audio transcription
  async generateCaptionsFromAudio() {
    if (!this.audioBlob) {
      showToast('Record or upload audio first to generate captions.');
      return;
    }

    if (this.scenes.length === 0) {
      showToast('Add scenes first before generating captions.');
      return;
    }

    // Show generating state
    this.generateCaptionsBtn.disabled = true;
    this.generateCaptionsBtn.innerHTML = '⏳ Uploading audio...';

    try {
      // Determine file extension based on mime type or filename
      let extension = 'm4a'; // Default to m4a since that's the user's file
      const mimeType = this.audioBlob.type || '';
      console.log('Audio blob MIME type:', mimeType, 'size:', this.audioBlob.size);

      if (mimeType.includes('wav') || mimeType.includes('wave')) {
        extension = 'wav';
      } else if (mimeType.includes('m4a') || mimeType.includes('mp4') || mimeType.includes('x-m4a') || mimeType === 'audio/mp4') {
        extension = 'm4a';
      } else if (mimeType.includes('ogg') || mimeType.includes('oga')) {
        extension = 'ogg';
      } else if (mimeType.includes('webm')) {
        extension = 'webm';
      } else if (mimeType.includes('mpeg') || mimeType.includes('mp3')) {
        extension = 'mp3';
      } else if (mimeType.includes('flac')) {
        extension = 'flac';
      }
      // If MIME type is empty or generic, keep m4a default
      console.log('Using extension:', extension);

      // Step 1: Get Supabase config for direct upload (bypasses Vercel 4.5MB limit)
      const configResponse = await fetch('/api/supabase-config');
      if (!configResponse.ok) {
        throw new Error('Cannot get storage config');
      }
      const config = await configResponse.json();

      // Step 2: Upload directly to Supabase Storage (bypasses Vercel completely)
      const fileName = `audio-${Date.now()}.${extension}`;
      const filePath = `audio/${fileName}`;

      this.generateCaptionsBtn.innerHTML = '⏳ Uploading to cloud...';

      // Direct upload to Supabase Storage REST API
      const uploadUrl = `${config.url}/storage/v1/object/${config.bucket}/${filePath}`;

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.anonKey}`,
          'apikey': config.anonKey,
          'Content-Type': mimeType,
          'x-upsert': 'true'
        },
        body: this.audioBlob
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('Supabase upload error:', errorText);
        throw new Error('Failed to upload audio to cloud storage');
      }

      // Get the public URL
      const publicUrl = `${config.url}/storage/v1/object/public/${config.bucket}/${filePath}`;
      console.log('Audio uploaded to:', publicUrl);

      // Step 3: Transcribe from Supabase URL
      this.generateCaptionsBtn.innerHTML = '⏳ Transcribing...';

      const transcribeResponse = await fetch('/api/transcribe-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl: publicUrl })
      });

      const result = await transcribeResponse.json();

      if (!transcribeResponse.ok || result.error) {
        throw new Error(result.error || 'Transcription failed');
      }

      console.log('Transcription for captions:', result);

      // Distribute transcription segments across scenes
      if (result.segments && result.segments.length > 0) {
        this.applyCaptionsFromSegments(result.segments);
      } else if (result.transcription) {
        // Fallback: split transcription evenly across scenes
        this.applyCaptionsFromText(result.transcription);
      } else {
        throw new Error('No transcription content received');
      }

      this.renderCaptions();
      showToast('Captions generated from audio!', false);

    } catch (error) {
      console.error('Caption generation error:', error);
      showToast('Failed to generate captions: ' + error.message);
    } finally {
      this.generateCaptionsBtn.disabled = false;
      this.generateCaptionsBtn.innerHTML = '🎤 Generate from Audio';
    }
  }

  // Apply captions from transcription segments
  applyCaptionsFromSegments(segments) {
    const totalDuration = this.audioDuration || segments[segments.length - 1].end;

    this.scenes.forEach((scene, index) => {
      // Find segments that overlap with this scene's time range
      const sceneStart = scene.startTime;
      const sceneEnd = scene.startTime + scene.duration;

      const overlappingSegments = segments.filter(seg => {
        return seg.end > sceneStart && seg.start < sceneEnd;
      });

      if (overlappingSegments.length > 0) {
        // Combine text from overlapping segments
        scene.caption = overlappingSegments
          .map(seg => seg.text.trim())
          .join(' ')
          .trim();
      } else {
        // No overlapping segment - find the closest one
        const closestSegment = segments.reduce((closest, seg) => {
          const segMidpoint = (seg.start + seg.end) / 2;
          const sceneMidpoint = (sceneStart + sceneEnd) / 2;
          const distance = Math.abs(segMidpoint - sceneMidpoint);

          if (!closest || distance < closest.distance) {
            return { segment: seg, distance };
          }
          return closest;
        }, null);

        if (closestSegment) {
          scene.caption = closestSegment.segment.text.trim();
        }
      }
    });
  }

  // Fallback: apply captions from full text
  applyCaptionsFromText(text) {
    // Split text into sentences
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

    // Distribute sentences across scenes
    const sentencesPerScene = Math.max(1, Math.ceil(sentences.length / this.scenes.length));

    this.scenes.forEach((scene, index) => {
      const start = index * sentencesPerScene;
      const end = Math.min(start + sentencesPerScene, sentences.length);
      const sceneSentences = sentences.slice(start, end);

      scene.caption = sceneSentences.join(' ').trim();
    });
  }

  // Clear all captions
  clearCaptions() {
    this.scenes.forEach(scene => {
      scene.caption = '';
    });
    this.renderCaptions();
    showToast('Captions cleared.', false);
  }

  // Preview caption style in a modal
  previewCaptionStyle() {
    // Get sample text
    let sampleText = "This is how your captions will look";

    // Try to get actual caption from first scene with one
    const sceneWithCaption = this.scenes.find(s => s.caption);
    if (sceneWithCaption) {
      sampleText = sceneWithCaption.caption;
    }

    // Get sample image (first scene or placeholder)
    let sampleImageUrl = this.scenes[0]?.imageUrl || null;

    // Create preview canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1280;
    canvas.height = 720;

    // Create modal
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.9);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      padding: 20px;
    `;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ Close Preview';
    closeBtn.style.cssText = `
      position: absolute;
      top: 20px;
      right: 20px;
      padding: 10px 20px;
      background: var(--primary, #6366f1);
      border: none;
      border-radius: 8px;
      color: white;
      cursor: pointer;
      font-size: 16px;
    `;
    closeBtn.onclick = () => modal.remove();

    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = 1280;
    previewCanvas.height = 720;
    previewCanvas.style.cssText = `
      max-width: 90%;
      max-height: 70vh;
      border-radius: 8px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    `;

    const info = document.createElement('p');
    info.style.cssText = `
      color: #888;
      margin-top: 20px;
      font-size: 14px;
    `;
    info.textContent = 'Change settings above and click Preview again to see updates';

    modal.appendChild(closeBtn);
    modal.appendChild(previewCanvas);
    modal.appendChild(info);
    document.body.appendChild(modal);

    const previewCtx = previewCanvas.getContext('2d');

    // Draw preview
    const drawPreview = () => {
      // Background
      previewCtx.fillStyle = '#1a1a2e';
      previewCtx.fillRect(0, 0, 1280, 720);

      // Draw scene image if available
      if (sampleImageUrl) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          // Cover fit
          const scale = Math.max(1280 / img.width, 720 / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          const x = (1280 - w) / 2;
          const y = (720 - h) / 2;
          previewCtx.drawImage(img, x, y, w, h);

          // Draw caption on top
          this.drawCaptionPreview(previewCtx, sampleText, 1280, 720);
        };
        img.onerror = () => {
          // Just draw caption on dark background
          this.drawCaptionPreview(previewCtx, sampleText, 1280, 720);
        };
        img.src = sampleImageUrl;
      } else {
        // No image, just draw gradient background
        const gradient = previewCtx.createLinearGradient(0, 0, 1280, 720);
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(1, '#16213e');
        previewCtx.fillStyle = gradient;
        previewCtx.fillRect(0, 0, 1280, 720);

        this.drawCaptionPreview(previewCtx, sampleText, 1280, 720);
      }
    };

    drawPreview();

    // Add animation preview for word-highlight
    const animation = document.getElementById('caption-animation')?.value || 'none';
    if (animation !== 'none') {
      let frame = 0;
      const words = sampleText.split(/\s+/);
      const totalFrames = words.length * 30; // 30 frames per word at 30fps

      const animate = () => {
        if (!document.body.contains(modal)) return;

        // Redraw background
        if (sampleImageUrl) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            const scale = Math.max(1280 / img.width, 720 / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            const x = (1280 - w) / 2;
            const y = (720 - h) / 2;
            previewCtx.drawImage(img, x, y, w, h);
            this.drawCaptionPreview(previewCtx, sampleText, 1280, 720, frame / totalFrames);
          };
          img.src = sampleImageUrl;
        } else {
          const gradient = previewCtx.createLinearGradient(0, 0, 1280, 720);
          gradient.addColorStop(0, '#1a1a2e');
          gradient.addColorStop(1, '#16213e');
          previewCtx.fillStyle = gradient;
          previewCtx.fillRect(0, 0, 1280, 720);
          this.drawCaptionPreview(previewCtx, sampleText, 1280, 720, frame / totalFrames);
        }

        frame = (frame + 1) % totalFrames;
        requestAnimationFrame(animate);
      };

      animate();
    }
  }

  // Draw caption preview with current settings
  drawCaptionPreview(ctx, text, width, height, progress = 0.5) {
    if (!text) return;

    // Get all settings
    const position = document.getElementById('caption-style')?.value || 'bottom-center';
    const fontSize = parseInt(document.getElementById('caption-font-size')?.value || 48);
    const fontFamily = document.getElementById('caption-font')?.value || 'Impact';
    const textColor = document.getElementById('caption-text-color')?.value || '#FFFFFF';
    const highlightColor = document.getElementById('caption-highlight-color')?.value || '#FFFF00';
    const bgStyle = document.getElementById('caption-bg-color')?.value || 'shadow';
    const animation = document.getElementById('caption-animation')?.value || 'none';
    const wordsPerLine = parseInt(document.getElementById('caption-words-per-line')?.value || 4);

    ctx.save();

    // Set font
    ctx.font = `bold ${fontSize}px ${fontFamily}, Impact, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Split into lines based on words per line
    const words = text.split(/\s+/);
    const lines = [];
    for (let i = 0; i < words.length; i += wordsPerLine) {
      lines.push(words.slice(i, i + wordsPerLine).join(' '));
    }

    // Calculate position
    const lineHeight = fontSize * 1.3;
    const totalHeight = lines.length * lineHeight;
    let startY;

    if (position === 'top-center') {
      startY = 80 + totalHeight / 2;
    } else if (position === 'center') {
      startY = height / 2;
    } else {
      startY = height - 80 - totalHeight / 2;
    }

    // Calculate current word index for animation
    const totalWords = words.length;
    const currentWordIndex = Math.floor(progress * totalWords);

    // Draw each line
    let wordIndex = 0;
    lines.forEach((line, lineIndex) => {
      const y = startY + (lineIndex - (lines.length - 1) / 2) * lineHeight;
      const lineWords = line.split(/\s+/);

      if (animation === 'none' || animation === 'typewriter') {
        // Simple draw
        if (bgStyle === 'shadow') {
          ctx.shadowColor = 'rgba(0,0,0,0.8)';
          ctx.shadowBlur = 8;
          ctx.shadowOffsetX = 2;
          ctx.shadowOffsetY = 2;
        } else if (bgStyle === 'box' || bgStyle === 'pill') {
          const metrics = ctx.measureText(line);
          const padding = bgStyle === 'pill' ? 20 : 10;
          const boxWidth = metrics.width + padding * 2;
          const boxHeight = fontSize + padding;
          const radius = bgStyle === 'pill' ? boxHeight / 2 : 8;

          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          this.roundRect(ctx, width / 2 - boxWidth / 2, y - boxHeight / 2, boxWidth, boxHeight, radius);
          ctx.fill();
        }

        ctx.fillStyle = textColor;
        ctx.fillText(line, width / 2, y);
        ctx.shadowColor = 'transparent';
      } else {
        // Word-by-word animation
        const lineWordsWidths = lineWords.map(w => ctx.measureText(w + ' ').width);
        const totalLineWidth = lineWordsWidths.reduce((a, b) => a + b, 0) - ctx.measureText(' ').width;
        let x = width / 2 - totalLineWidth / 2;

        lineWords.forEach((word, wi) => {
          const globalWordIndex = wordIndex + wi;
          const isCurrentWord = globalWordIndex === currentWordIndex;
          const isPastWord = globalWordIndex < currentWordIndex;

          let wordColor = textColor;
          let scale = 1;

          if (animation === 'word-highlight') {
            wordColor = isCurrentWord ? highlightColor : (isPastWord ? highlightColor : textColor);
          } else if (animation === 'word-pop') {
            if (isCurrentWord) {
              scale = 1.2;
              wordColor = highlightColor;
            }
          } else if (animation === 'karaoke') {
            wordColor = (isPastWord || isCurrentWord) ? highlightColor : textColor;
          }

          // Draw background for current word if needed
          if (bgStyle === 'shadow') {
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.shadowBlur = 8;
          }

          ctx.save();
          if (scale !== 1) {
            ctx.translate(x + ctx.measureText(word).width / 2, y);
            ctx.scale(scale, scale);
            ctx.translate(-(x + ctx.measureText(word).width / 2), -y);
          }

          ctx.fillStyle = wordColor;
          ctx.textAlign = 'left';
          ctx.fillText(word, x, y);
          ctx.restore();

          ctx.shadowColor = 'transparent';
          x += lineWordsWidths[wi];
        });

        wordIndex += lineWords.length;
      }
    });

    ctx.restore();
  }

  // Helper for rounded rectangles
  roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  getTotalDuration() {
    if (this.audioDuration > 0) {
      return this.audioDuration;
    }
    return this.scenes.reduce((sum, scene) => sum + scene.duration, 0);
  }

  updateTotalDuration() {
    const duration = this.getTotalDuration();
    this.totalDuration.textContent = this.formatTime(duration);
  }

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // Preview
  openPreview() {
    if (this.scenes.length === 0) {
      showToast('Add scenes first to preview.');
      return;
    }

    // Sync uploaded avatar segments to avatarVideos array for preview
    this.syncUploadedAvatarSegments();

    this.previewModal.hidden = false;
    this.setupPreviewCanvas();
    this.playbackTime = 0;
    this.updatePreviewFrame();
  }

  // Sync uploaded avatar segments from window.uploadedAvatarSegments to this.avatarVideos
  syncUploadedAvatarSegments() {
    const uploadedSegments = window.uploadedAvatarSegments || {};
    const segmentKeys = Object.keys(uploadedSegments).map(Number).sort((a, b) => a - b);

    if (segmentKeys.length === 0) return;

    // Calculate segment duration based on audio
    const totalDuration = this.audioDuration || this.getTotalDuration();
    const segmentDuration = totalDuration / segmentKeys.length;

    // Build avatarVideos array from uploaded segments
    this.avatarVideos = [];
    segmentKeys.forEach((segNum, index) => {
      const seg = uploadedSegments[segNum];
      if (seg && seg.url) {
        this.avatarVideos.push({
          videoUrl: seg.url,
          startTime: index * segmentDuration,
          endTime: (index + 1) * segmentDuration,
          segmentIndex: segNum
        });
      }
    });

    console.log(`Synced ${this.avatarVideos.length} avatar segments for preview`);
  }

  closePreview() {
    this.previewModal.hidden = true;
    this.stopPlayback();
  }

  setupPreviewCanvas() {
    const [width, height] = this.exportResolution.value.split('x').map(Number);
    this.previewCanvas.width = width;
    this.previewCanvas.height = height;
  }

  togglePlayback() {
    if (this.isPlaying) {
      this.stopPlayback();
    } else {
      this.startPlayback();
    }
  }

  startPlayback() {
    this.isPlaying = true;
    this.previewPlayPauseBtn.textContent = '⏸️ Pause';
    this.lastFrameTime = performance.now();

    // Play voiceover - ensure blob URL is valid
    if (this.audioBlob) {
      // Recreate blob URL if needed (Firefox fix)
      if (!this.audioPlayer.src || this.audioPlayer.src === '' || this.audioPlayer.error) {
        const url = URL.createObjectURL(this.audioBlob);
        this.audioPlayer.src = url;
        this.currentAudioUrl = url;
      }
      this.audioPlayer.currentTime = this.playbackTime;
      this.audioPlayer.play().catch(e => {
        console.log('Voiceover play error:', e);
        // Try reloading the audio
        if (this.audioBlob) {
          const url = URL.createObjectURL(this.audioBlob);
          this.audioPlayer.src = url;
          this.audioPlayer.load();
        }
      });
    }

    // Play background music
    if (this.bgMusicBlob && this.bgMusicPlayer) {
      this.bgMusicPlayer.currentTime = this.playbackTime % (this.bgMusicPlayer.duration || 1);
      this.bgMusicPlayer.volume = this.bgMusicVolume;
      this.bgMusicPlayer.play().catch(e => console.log('Background music play error:', e));
    }

    this.animate();
  }

  stopPlayback() {
    this.isPlaying = false;
    this.previewPlayPauseBtn.textContent = '▶️ Play';

    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }

    if (this.audioPlayer) {
      this.audioPlayer.pause();
    }

    // Stop background music
    if (this.bgMusicPlayer) {
      this.bgMusicPlayer.pause();
    }
  }

  animate() {
    if (!this.isPlaying) return;

    const now = performance.now();
    const delta = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;

    this.playbackTime += delta;

    const totalDuration = this.getTotalDuration();
    if (this.playbackTime >= totalDuration) {
      this.playbackTime = 0;
      if (this.audioPlayer) {
        this.audioPlayer.currentTime = 0;
      }
    }

    this.updatePreviewFrame();
    this.updatePlayhead();

    this.previewTime.textContent = `${this.formatTime(this.playbackTime)} / ${this.formatTime(totalDuration)}`;

    this.animationFrame = requestAnimationFrame(() => this.animate());
  }

  updatePreviewFrame() {
    const currentScene = this.getSceneAtTime(this.playbackTime);
    if (!currentScene) return;

    const img = new Image();
    img.onload = async () => {
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);

      // Apply Ken Burns effect
      this.applyKenBurnsEffect(img, currentScene);

      // Draw avatar overlay if enabled and videos exist
      if (this.avatarEnabled && this.avatarVideos && this.avatarVideos.length > 0) {
        await this.drawAvatarOnPreview();
      }

      // Draw caption
      this.drawCaption(currentScene);
    };
    img.src = currentScene.imageUrl;
  }

  // Draw avatar on preview canvas
  async drawAvatarOnPreview() {
    // Find the avatar video for current time
    const avatarVideo = this.avatarVideos.find(av =>
      this.playbackTime >= av.startTime && this.playbackTime < av.endTime
    );

    if (!avatarVideo || !avatarVideo.videoUrl) return;

    // Get or create video element for this avatar
    if (!this.previewAvatarVideos) {
      this.previewAvatarVideos = {};
    }

    let videoEl = this.previewAvatarVideos[avatarVideo.videoUrl];
    if (!videoEl) {
      videoEl = document.createElement('video');
      videoEl.crossOrigin = 'anonymous';
      videoEl.muted = true;
      videoEl.src = avatarVideo.videoUrl;
      videoEl.load();
      this.previewAvatarVideos[avatarVideo.videoUrl] = videoEl;

      // Wait for video to be ready
      await new Promise(resolve => {
        videoEl.onloadeddata = resolve;
        videoEl.onerror = resolve;
      });
    }

    // Seek to correct time
    const localTime = this.playbackTime - avatarVideo.startTime;
    if (Math.abs(videoEl.currentTime - localTime) > 0.15) {
      videoEl.currentTime = Math.max(0, Math.min(localTime, videoEl.duration - 0.1));
    }

    // Get overlay position and size
    const rect = this.getAvatarOverlayRect(this.previewCanvas.width, this.previewCanvas.height);

    // Draw the avatar
    this.ctx.save();

    if (this.avatarShape === 'circle') {
      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;
      const radius = Math.min(rect.width, rect.height) / 2;

      this.ctx.beginPath();
      this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      this.ctx.closePath();
      this.ctx.clip();

      this.ctx.drawImage(
        videoEl,
        rect.x + (rect.width - radius * 2) / 2,
        rect.y + (rect.height - radius * 2) / 2,
        radius * 2,
        radius * 2
      );
    } else {
      // Rectangle or square
      this.ctx.drawImage(videoEl, rect.x, rect.y, rect.width, rect.height);
    }

    this.ctx.restore();
  }

  getSceneAtTime(time) {
    for (const scene of this.scenes) {
      if (time >= scene.startTime && time < scene.startTime + scene.duration) {
        return scene;
      }
    }
    return this.scenes[this.scenes.length - 1];
  }

  applyKenBurnsEffect(img, scene) {
    const effect = this.zoomEffect.value;
    const progress = (this.playbackTime - scene.startTime) / scene.duration;

    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;

    switch (effect) {
      case 'zoom-in':
        scale = 1 + (progress * 0.1);
        break;
      case 'zoom-out':
        scale = 1.1 - (progress * 0.1);
        break;
      case 'pan-left':
        offsetX = -progress * 50;
        break;
      case 'pan-right':
        offsetX = progress * 50;
        break;
      case 'random':
        // Use scene index to determine effect
        const effects = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right'];
        const randomEffect = effects[scene.id % effects.length];
        return this.applyKenBurnsEffectByName(img, scene, randomEffect, progress);
    }

    const canvasW = this.previewCanvas.width;
    const canvasH = this.previewCanvas.height;

    // Calculate scaled dimensions
    const imgRatio = img.width / img.height;
    const canvasRatio = canvasW / canvasH;

    let drawW, drawH;
    if (imgRatio > canvasRatio) {
      drawH = canvasH * scale;
      drawW = drawH * imgRatio;
    } else {
      drawW = canvasW * scale;
      drawH = drawW / imgRatio;
    }

    const x = (canvasW - drawW) / 2 + offsetX;
    const y = (canvasH - drawH) / 2 + offsetY;

    this.ctx.drawImage(img, x, y, drawW, drawH);
  }

  applyKenBurnsEffectByName(img, scene, effectName, progress) {
    let scale = 1;
    let offsetX = 0;

    switch (effectName) {
      case 'zoom-in':
        scale = 1 + (progress * 0.1);
        break;
      case 'zoom-out':
        scale = 1.1 - (progress * 0.1);
        break;
      case 'pan-left':
        offsetX = -progress * 50;
        break;
      case 'pan-right':
        offsetX = progress * 50;
        break;
    }

    const canvasW = this.previewCanvas.width;
    const canvasH = this.previewCanvas.height;
    const imgRatio = img.width / img.height;
    const canvasRatio = canvasW / canvasH;

    let drawW, drawH;
    if (imgRatio > canvasRatio) {
      drawH = canvasH * scale;
      drawW = drawH * imgRatio;
    } else {
      drawW = canvasW * scale;
      drawH = drawW / imgRatio;
    }

    const x = (canvasW - drawW) / 2 + offsetX;
    const y = (canvasH - drawH) / 2;

    this.ctx.drawImage(img, x, y, drawW, drawH);
  }

  drawCaption(scene) {
    if (!scene.caption) return;

    const canvasW = this.previewCanvas.width;
    const canvasH = this.previewCanvas.height;

    // Get all caption settings
    const position = document.getElementById('caption-style')?.value || 'bottom-center';
    const fontSize = parseInt(document.getElementById('caption-font-size')?.value || 48);
    const fontFamily = document.getElementById('caption-font')?.value || 'Impact';
    const textColor = document.getElementById('caption-text-color')?.value || '#FFFFFF';
    const highlightColor = document.getElementById('caption-highlight-color')?.value || '#FFFF00';
    const bgStyle = document.getElementById('caption-bg-color')?.value || 'shadow';
    const animation = document.getElementById('caption-animation')?.value || 'word-highlight';
    const wordsPerLine = parseInt(document.getElementById('caption-words-per-line')?.value || 4);

    this.ctx.save();
    this.ctx.font = `bold ${fontSize}px ${fontFamily}, Impact, sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    // Get timing info
    const sceneStartTime = scene.startTime || 0;
    const sceneDuration = scene.duration || 6;
    const currentTime = this.playbackTime;
    const timeInScene = currentTime - sceneStartTime;

    // Split caption into words
    const allWords = scene.caption.split(/\s+/).filter(w => w.length > 0);

    // Calculate current word index based on time
    const wordDuration = sceneDuration / allWords.length;
    const currentWordIndex = Math.floor(timeInScene / wordDuration);

    // Only show a sliding window of words (2 lines worth)
    const totalWordsToShow = wordsPerLine * 2; // Show 2 lines at a time
    const windowStart = Math.max(0, Math.floor(currentWordIndex / wordsPerLine) * wordsPerLine);
    const windowEnd = Math.min(allWords.length, windowStart + totalWordsToShow);
    const visibleWords = allWords.slice(windowStart, windowEnd);

    // Group visible words into lines
    const lines = [];
    for (let i = 0; i < visibleWords.length; i += wordsPerLine) {
      lines.push(visibleWords.slice(i, i + wordsPerLine));
    }

    // Calculate position
    const lineHeight = fontSize * 1.4;
    const totalHeight = lines.length * lineHeight;
    let startY;

    if (position === 'top-center') {
      startY = 80 + lineHeight;
    } else if (position === 'center') {
      startY = canvasH / 2 - totalHeight / 2 + lineHeight / 2;
    } else {
      startY = canvasH - 100 - totalHeight + lineHeight;
    }

    // Draw each line with word highlighting
    lines.forEach((lineWords, lineIndex) => {
      const y = startY + lineIndex * lineHeight;

      // Calculate line width for centering
      const lineText = lineWords.join(' ');
      const lineWidth = this.ctx.measureText(lineText).width;
      let x = (canvasW - lineWidth) / 2;

      lineWords.forEach((word, wordIdx) => {
        const globalIdx = windowStart + (lineIndex * wordsPerLine) + wordIdx;
        const wordWidth = this.ctx.measureText(word + ' ').width;

        // Determine if this word should be highlighted
        const isCurrentWord = globalIdx === currentWordIndex;
        const isPastWord = globalIdx < currentWordIndex;

        // Apply background style
        if (bgStyle === 'shadow') {
          this.ctx.shadowColor = 'rgba(0,0,0,0.9)';
          this.ctx.shadowBlur = 10;
          this.ctx.shadowOffsetX = 3;
          this.ctx.shadowOffsetY = 3;
        } else {
          this.ctx.shadowColor = 'transparent';
          this.ctx.shadowBlur = 0;
        }

        // Set color based on highlight state
        this.ctx.textAlign = 'left';

        if (animation === 'word-highlight' || animation === 'karaoke') {
          if (isCurrentWord) {
            // Current word - highlighted and scaled
            this.ctx.save();
            this.ctx.fillStyle = highlightColor;
            const wordCenterX = x + (wordWidth - this.ctx.measureText(' ').width) / 2;
            this.ctx.translate(wordCenterX, y);
            this.ctx.scale(1.15, 1.15);
            this.ctx.translate(-wordCenterX, -y);
            this.ctx.fillText(word, x, y);
            this.ctx.restore();
          } else if (isPastWord && animation === 'karaoke') {
            // Past words in karaoke mode stay highlighted
            this.ctx.fillStyle = highlightColor;
            this.ctx.fillText(word, x, y);
          } else {
            // Future words or past words in word-highlight mode
            this.ctx.fillStyle = textColor;
            this.ctx.fillText(word, x, y);
          }
        } else {
          // No animation
          this.ctx.fillStyle = textColor;
          this.ctx.fillText(word, x, y);
        }

        x += wordWidth;
      });
    });

    this.ctx.restore();
  }

  updatePlayhead() {
    const totalDuration = this.getTotalDuration();
    const percent = (this.playbackTime / totalDuration) * 100;
    this.timelinePlayhead.style.left = `${percent}%`;
  }

  // Export as ZIP (fallback when FFmpeg unavailable)
  async exportAsZip() {
    if (this.scenes.length === 0) {
      showToast('Add scenes first to export.');
      return;
    }

    this.exportProgress.hidden = false;
    this.exportVideoBtn.disabled = true;
    this.exportStatus.textContent = 'Creating ZIP package...';

    try {
      const zip = new JSZip();
      const imgFolder = zip.folder('images');

      // Add numbered images
      for (let i = 0; i < this.scenes.length; i++) {
        const scene = this.scenes[i];
        this.exportStatus.textContent = `Adding image ${i + 1}/${this.scenes.length}...`;
        this.exportProgressBar.style.width = `${((i + 1) / this.scenes.length) * 50}%`;

        try {
          const response = await fetch(scene.imageUrl);
          const blob = await response.blob();
          const ext = blob.type.includes('png') ? 'png' : 'jpg';
          imgFolder.file(`scene_${String(i + 1).padStart(3, '0')}.${ext}`, blob);
        } catch (e) {
          console.error(`Failed to add scene ${i + 1}:`, e);
        }
      }

      // Add audio if available
      if (this.audioBlob) {
        this.exportStatus.textContent = 'Adding audio...';
        zip.file('voiceover.mp3', this.audioBlob);
      }

      // Add captions as SRT file
      if (this.scenes.some(s => s.caption)) {
        this.exportStatus.textContent = 'Adding captions...';
        const srt = this.generateSRT();
        zip.file('captions.srt', srt);
      }

      // Add scene info
      const sceneInfo = this.scenes.map((s, i) => ({
        scene: i + 1,
        duration: s.duration,
        caption: s.caption || ''
      }));
      zip.file('scene_info.json', JSON.stringify(sceneInfo, null, 2));

      this.exportStatus.textContent = 'Generating ZIP...';
      this.exportProgressBar.style.width = '80%';

      const content = await zip.generateAsync({ type: 'blob' });

      // Download
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `video_project_${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);

      this.exportProgressBar.style.width = '100%';
      this.exportStatus.textContent = 'ZIP downloaded! Import into CapCut or video editor.';
      showToast('ZIP exported! Import images in order into CapCut.', false);

    } catch (error) {
      console.error('ZIP export error:', error);
      showToast('ZIP export failed: ' + error.message);
    } finally {
      this.exportVideoBtn.disabled = false;
      setTimeout(() => {
        this.exportProgress.hidden = true;
        this.exportProgressBar.style.width = '0%';
      }, 3000);
    }
  }

  // Generate SRT subtitle file
  generateSRT() {
    let srt = '';
    let currentTime = 0;

    this.scenes.forEach((scene, i) => {
      if (scene.caption) {
        const startTime = this.formatSRTTime(currentTime);
        const endTime = this.formatSRTTime(currentTime + scene.duration);
        srt += `${i + 1}\n${startTime} --> ${endTime}\n${scene.caption}\n\n`;
      }
      currentTime += scene.duration;
    });

    return srt;
  }

  formatSRTTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  // Download SRT file directly (for CapCut/Premiere/etc)
  downloadSRT() {
    if (this.scenes.length === 0 || !this.scenes.some(s => s.caption)) {
      showToast('No captions to export. Generate captions first.');
      return;
    }

    const srt = this.generateSRT();
    const blob = new Blob([srt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'captions.srt';
    a.click();
    URL.revokeObjectURL(url);
    showToast('SRT file downloaded! Import into CapCut/Premiere.', 'success');
  }

  // Export Video
  async exportVideo() {
    // If FFmpeg not loaded, fall back to ZIP export
    if (!this.ffmpegLoaded) {
      showToast('FFmpeg unavailable. Exporting as ZIP instead...');
      return this.exportAsZip();
    }

    if (this.scenes.length === 0) {
      showToast('Add scenes first to export.');
      return;
    }

    this.exportProgress.hidden = false;
    this.exportVideoBtn.disabled = true;
    this.exportStatus.textContent = 'Preparing export...';

    try {
      const [width, height] = this.exportResolution.value.split('x').map(Number);
      const fps = parseInt(this.exportFps.value);
      const totalDuration = this.getTotalDuration();
      const totalFrames = Math.ceil(totalDuration * fps);

      // Step 1: Load avatar videos (from generated + uploaded segments)
      let avatarVideoElements = [];
      if (this.avatarEnabled && this.audioBlob) {
        const numSegments = Math.ceil(this.audioDuration / 90);

        // Check if we have uploaded segments
        const uploadedSegments = window.uploadedAvatarSegments || {};
        const hasUploaded = Object.keys(uploadedSegments).length > 0;

        // Generate any missing segments if we have avatar photo
        if (this.avatarPhotoBlob) {
          this.exportStatus.textContent = 'Generating talking avatar...';
          await this.generateAvatarVideos();
        }

        // Merge uploaded segments with generated ones
        this.exportStatus.textContent = 'Loading avatar videos...';
        const segmentSources = [];

        for (let i = 1; i <= numSegments; i++) {
          if (uploadedSegments[i]) {
            // Use uploaded segment
            segmentSources.push({
              videoUrl: uploadedSegments[i].url,
              startTime: (i - 1) * 90,
              source: 'uploaded'
            });
            console.log(`Using uploaded segment ${i}`);
          } else if (this.avatarVideos && this.avatarVideos[i - 1]) {
            // Use generated segment
            segmentSources.push({
              videoUrl: this.avatarVideos[i - 1].videoUrl,
              startTime: (i - 1) * 90,
              source: 'generated'
            });
            console.log(`Using generated segment ${i}`);
          } else {
            console.warn(`Missing segment ${i} - no uploaded or generated video`);
          }
        }

        // Load all video elements
        if (segmentSources.length > 0) {
          avatarVideoElements = await Promise.all(
            segmentSources.map(seg => this.loadVideoElement(seg.videoUrl))
          );
          console.log(`Loaded ${avatarVideoElements.length} avatar video elements (uploaded + generated)`);
        }
      }

      // Step 2: Generate frames
      this.exportStatus.textContent = 'Preparing frames...';
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      // Load all scene images first
      const images = await Promise.all(
        this.scenes.map(scene => this.loadImage(scene.imageUrl))
      );

      // Generate and write frames to FFmpeg
      for (let frame = 0; frame < totalFrames; frame++) {
        const time = frame / fps;
        const sceneIndex = this.getSceneIndexAtTime(time);
        const scene = this.scenes[sceneIndex];
        const img = images[sceneIndex];

        // Clear canvas
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);

        // Draw scene image with effects
        this.drawFrameWithEffects(ctx, img, scene, time, width, height);

        // Draw avatar overlay if available
        if (avatarVideoElements.length > 0) {
          await this.drawAvatarOverlay(ctx, time, width, height, avatarVideoElements);
        }

        // Draw caption (on top of everything) - pass time for animations
        this.drawCaptionOnCanvas(ctx, scene, width, height, time);

        // Convert to image data
        const frameData = await this.canvasToUint8Array(canvas);
        await this.ffmpeg.writeFile(`frame${String(frame).padStart(6, '0')}.png`, frameData);

        const progress = Math.round((frame / totalFrames) * 50);
        this.exportProgressBar.style.width = `${progress}%`;
        this.exportStatus.textContent = `Generating frames: ${frame + 1}/${totalFrames}`;
      }

      // Write voiceover audio if available
      const hasVoiceover = !!this.audioBlob;
      if (hasVoiceover) {
        const audioData = new Uint8Array(await this.audioBlob.arrayBuffer());
        await this.ffmpeg.writeFile('voiceover.webm', audioData);
      }

      // Write background music if available
      const hasBgMusic = !!this.bgMusicBlob;
      if (hasBgMusic) {
        const bgMusicData = new Uint8Array(await this.bgMusicBlob.arrayBuffer());
        const bgMusicExt = this.bgMusicBlob.name ? this.bgMusicBlob.name.split('.').pop() : 'mp3';
        await this.ffmpeg.writeFile(`bgmusic.${bgMusicExt}`, bgMusicData);
      }

      this.exportStatus.textContent = 'Encoding video...';

      // Build FFmpeg command based on available audio
      const ffmpegArgs = [
        '-framerate', String(fps),
        '-i', 'frame%06d.png',
      ];

      if (hasVoiceover && hasBgMusic) {
        // Both voiceover and background music - mix them
        const bgMusicExt = this.bgMusicBlob.name ? this.bgMusicBlob.name.split('.').pop() : 'mp3';
        ffmpegArgs.push('-i', 'voiceover.webm');
        ffmpegArgs.push('-i', `bgmusic.${bgMusicExt}`);

        // Audio filter to mix: voiceover at full volume, bg music at user-set volume
        // If ducking is enabled, we lower bg music (already at lower volume)
        const bgVolume = this.bgMusicDuck ? this.bgMusicVolume * 0.5 : this.bgMusicVolume;
        ffmpegArgs.push('-filter_complex', `[1:a]volume=1.0[voice];[2:a]volume=${bgVolume.toFixed(2)},aloop=loop=-1:size=2e+09[music];[voice][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`);
        ffmpegArgs.push('-map', '0:v');
        ffmpegArgs.push('-map', '[aout]');
        ffmpegArgs.push('-c:a', 'aac');
        ffmpegArgs.push('-shortest');
      } else if (hasVoiceover) {
        // Only voiceover
        ffmpegArgs.push('-i', 'voiceover.webm');
        ffmpegArgs.push('-c:a', 'aac');
        ffmpegArgs.push('-shortest');
      } else if (hasBgMusic) {
        // Only background music
        const bgMusicExt = this.bgMusicBlob.name ? this.bgMusicBlob.name.split('.').pop() : 'mp3';
        ffmpegArgs.push('-i', `bgmusic.${bgMusicExt}`);
        ffmpegArgs.push('-filter_complex', `[1:a]volume=${this.bgMusicVolume.toFixed(2)},aloop=loop=-1:size=2e+09[aout]`);
        ffmpegArgs.push('-map', '0:v');
        ffmpegArgs.push('-map', '[aout]');
        ffmpegArgs.push('-c:a', 'aac');
        ffmpegArgs.push('-shortest');
      }

      ffmpegArgs.push(
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'fast',
        'output.mp4'
      );

      await this.ffmpeg.exec(ffmpegArgs);

      // Read output
      const data = await this.ffmpeg.readFile('output.mp4');
      const blob = new Blob([data.buffer], { type: 'video/mp4' });

      // Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `video-${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Cleanup
      for (let frame = 0; frame < totalFrames; frame++) {
        await this.ffmpeg.deleteFile(`frame${String(frame).padStart(6, '0')}.png`);
      }
      await this.ffmpeg.deleteFile('output.mp4');
      if (hasVoiceover) {
        await this.ffmpeg.deleteFile('voiceover.webm');
      }
      if (hasBgMusic) {
        const bgMusicExt = this.bgMusicBlob.name ? this.bgMusicBlob.name.split('.').pop() : 'mp3';
        await this.ffmpeg.deleteFile(`bgmusic.${bgMusicExt}`);
      }

      this.exportProgressBar.style.width = '100%';
      this.exportStatus.textContent = 'Export complete!';
      showToast('Video exported successfully!', false);

    } catch (error) {
      console.error('Export failed:', error);
      showToast('Failed to export video: ' + error.message);
    } finally {
      this.exportVideoBtn.disabled = false;
      setTimeout(() => {
        this.exportProgress.hidden = true;
        this.exportProgressBar.style.width = '0%';
      }, 3000);
    }
  }

  loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  getSceneIndexAtTime(time) {
    for (let i = 0; i < this.scenes.length; i++) {
      const scene = this.scenes[i];
      if (time >= scene.startTime && time < scene.startTime + scene.duration) {
        return i;
      }
    }
    return this.scenes.length - 1;
  }

  drawFrameWithEffects(ctx, img, scene, time, width, height) {
    const effect = this.zoomEffect.value;
    const progress = (time - scene.startTime) / scene.duration;

    let scale = 1;
    let offsetX = 0;

    const effectToApply = effect === 'random'
      ? ['zoom-in', 'zoom-out', 'pan-left', 'pan-right'][scene.id % 4]
      : effect;

    switch (effectToApply) {
      case 'zoom-in':
        scale = 1 + (progress * 0.1);
        break;
      case 'zoom-out':
        scale = 1.1 - (progress * 0.1);
        break;
      case 'pan-left':
        offsetX = -progress * 50;
        break;
      case 'pan-right':
        offsetX = progress * 50;
        break;
    }

    const imgRatio = img.width / img.height;
    const canvasRatio = width / height;

    let drawW, drawH;
    if (imgRatio > canvasRatio) {
      drawH = height * scale;
      drawW = drawH * imgRatio;
    } else {
      drawW = width * scale;
      drawH = drawW / imgRatio;
    }

    const x = (width - drawW) / 2 + offsetX;
    const y = (height - drawH) / 2;

    ctx.drawImage(img, x, y, drawW, drawH);
  }

  drawCaptionOnCanvas(ctx, scene, width, height, currentTime = 0) {
    if (!scene.caption) return;

    // Get caption settings
    const fontSize = parseInt(document.getElementById('caption-font-size')?.value || 48);
    const fontFamily = document.getElementById('caption-font')?.value || 'Impact, sans-serif';
    const position = document.getElementById('caption-style')?.value || 'bottom-center';
    const animation = document.getElementById('caption-animation')?.value || 'word-highlight';
    const wordsPerLine = parseInt(document.getElementById('caption-words-per-line')?.value || 4);
    const textColor = document.getElementById('caption-text-color')?.value || '#FFFFFF';
    const highlightColor = document.getElementById('caption-highlight-color')?.value || '#FFFF00';
    const bgStyle = document.getElementById('caption-bg-color')?.value || 'shadow';

    ctx.font = `bold ${fontSize}px ${fontFamily}`;
    ctx.textBaseline = 'middle';

    // Calculate position
    let x = width / 2;
    let y;
    let textAlign = 'center';

    switch (position) {
      case 'top-center':
        y = fontSize + 60;
        break;
      case 'bottom-left':
        x = 60;
        y = height - 80;
        textAlign = 'left';
        break;
      case 'center':
        y = height / 2;
        break;
      default: // bottom-center
        y = height - 80;
    }
    ctx.textAlign = textAlign;

    // Split caption into words
    const allWords = scene.caption.split(/\s+/).filter(w => w.length > 0);

    // Calculate which word should be highlighted based on time within scene
    const sceneProgress = (currentTime - scene.startTime) / scene.duration;
    const totalWords = allWords.length;
    const currentWordIndex = Math.floor(sceneProgress * totalWords);

    // Only show a sliding window of words (2 lines worth) - same as preview
    const totalWordsToShow = wordsPerLine * 2;
    const windowStart = Math.max(0, Math.floor(currentWordIndex / wordsPerLine) * wordsPerLine);
    const windowEnd = Math.min(allWords.length, windowStart + totalWordsToShow);
    const visibleWords = allWords.slice(windowStart, windowEnd);

    // Group visible words into lines
    const lines = [];
    for (let i = 0; i < visibleWords.length; i += wordsPerLine) {
      lines.push(visibleWords.slice(i, i + wordsPerLine));
    }

    // Draw each line
    const lineHeight = fontSize * 1.4;
    const totalLinesHeight = lines.length * lineHeight;
    const startY = y - totalLinesHeight + lineHeight;

    lines.forEach((lineWords, lineIndex) => {
      const lineY = startY + (lineIndex * lineHeight);
      const lineText = lineWords.join(' ');

      // Draw background if needed
      if (bgStyle === 'box' || bgStyle === 'pill') {
        const metrics = ctx.measureText(lineText);
        const padding = 15;
        const bgX = textAlign === 'center' ? x - metrics.width / 2 - padding : x - padding;
        const bgW = metrics.width + padding * 2;
        const bgH = fontSize + padding;
        const bgY = lineY - bgH / 2;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        if (bgStyle === 'pill') {
          const radius = bgH / 2;
          ctx.beginPath();
          ctx.roundRect(bgX, bgY, bgW, bgH, radius);
          ctx.fill();
        } else {
          ctx.fillRect(bgX, bgY, bgW, bgH);
        }
      }

      // Draw words with animation
      if (animation === 'none' || animation === 'typewriter') {
        const displayText = animation === 'typewriter'
          ? lineText.substring(0, Math.floor(sceneProgress * lineText.length * 1.5))
          : lineText;

        if (bgStyle === 'shadow') {
          ctx.strokeStyle = 'black';
          ctx.lineWidth = fontSize / 8;
          ctx.strokeText(displayText, x, lineY);
        }
        ctx.fillStyle = textColor;
        ctx.fillText(displayText, x, lineY);
      } else {
        // Word-by-word animation
        let wordX = textAlign === 'center'
          ? x - ctx.measureText(lineText).width / 2
          : x;

        lineWords.forEach((word, wordInLineIndex) => {
          const globalIdx = windowStart + (lineIndex * wordsPerLine) + wordInLineIndex;
          const isCurrentWord = globalIdx === currentWordIndex;
          const isPastWord = globalIdx < currentWordIndex;
          const wordWidth = ctx.measureText(word + ' ').width;

          let wordColor = textColor;
          let scale = 1;

          if (animation === 'word-highlight') {
            wordColor = isCurrentWord ? highlightColor : textColor;
            scale = isCurrentWord ? 1.15 : 1;
          } else if (animation === 'word-pop') {
            if (isCurrentWord) {
              scale = 1.2;
              wordColor = highlightColor;
            }
          } else if (animation === 'karaoke') {
            wordColor = isPastWord || isCurrentWord ? highlightColor : textColor;
          }

          ctx.save();
          if (scale !== 1) {
            ctx.translate(wordX + wordWidth / 2, lineY);
            ctx.scale(scale, scale);
            ctx.translate(-(wordX + wordWidth / 2), -lineY);
          }

          if (bgStyle === 'shadow') {
            ctx.shadowColor = 'rgba(0,0,0,0.9)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetX = 3;
            ctx.shadowOffsetY = 3;
          }
          ctx.fillStyle = wordColor;
          ctx.textAlign = 'left';
          ctx.fillText(word, wordX, lineY);
          ctx.restore();

          wordX += wordWidth;
        });
      }
    });

    ctx.textAlign = textAlign;
  }

  async canvasToUint8Array(canvas) {
    return new Promise((resolve) => {
      canvas.toBlob(async (blob) => {
        const arrayBuffer = await blob.arrayBuffer();
        resolve(new Uint8Array(arrayBuffer));
      }, 'image/png');
    });
  }

  // Load a video element from URL
  loadVideoElement(url) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true; // Mute to allow auto-play
      video.preload = 'auto';

      video.onloadeddata = () => {
        console.log('Video loaded:', url, 'duration:', video.duration);
        resolve(video);
      };

      video.onerror = (e) => {
        console.error('Failed to load video:', url, e);
        reject(new Error(`Failed to load video: ${url}`));
      };

      video.src = url;
      video.load();
    });
  }

  // Draw avatar overlay on canvas at specific time
  async drawAvatarOverlay(ctx, time, canvasWidth, canvasHeight, avatarVideoElements) {
    // Find the avatar video for this time
    const avatarIndex = this.avatarVideos.findIndex(av =>
      time >= av.startTime && time < av.endTime
    );

    if (avatarIndex === -1 || !avatarVideoElements[avatarIndex]) {
      return;
    }

    const avatarVideo = this.avatarVideos[avatarIndex];
    const videoElement = avatarVideoElements[avatarIndex];

    // Calculate time within this avatar video segment
    const localTime = time - avatarVideo.startTime;

    // Seek video to the correct time
    if (Math.abs(videoElement.currentTime - localTime) > 0.1) {
      videoElement.currentTime = localTime;
      // Wait for seek to complete
      await new Promise(resolve => {
        const checkSeek = () => {
          if (videoElement.readyState >= 2) {
            resolve();
          } else {
            requestAnimationFrame(checkSeek);
          }
        };
        checkSeek();
      });
    }

    // Get overlay position and size
    const rect = this.getAvatarOverlayRect(canvasWidth, canvasHeight);

    // Draw the avatar video frame with shape masking
    ctx.save();

    if (this.avatarShape === 'circle') {
      // Circular mask
      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;
      const radius = Math.min(rect.width, rect.height) / 2;

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();

      // Draw centered and cropped to circle
      const size = radius * 2;
      ctx.drawImage(
        videoElement,
        rect.x + (rect.width - size) / 2,
        rect.y + (rect.height - size) / 2,
        size,
        size
      );

      // Add border
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();

    } else if (this.avatarShape === 'rounded') {
      // Rounded rectangle mask
      const radius = 20;
      ctx.beginPath();
      ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
      ctx.closePath();
      ctx.clip();

      ctx.drawImage(videoElement, rect.x, rect.y, rect.width, rect.height);

      // Add border
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

    } else {
      // Rectangle (no mask needed)
      ctx.drawImage(videoElement, rect.x, rect.y, rect.width, rect.height);

      // Add border
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }

    ctx.restore();
  }
}

// Initialize video editor when DOM is ready
let videoEditor;
document.addEventListener('DOMContentLoaded', () => {
  videoEditor = new VideoEditor();

  // Set up video scene duration slider
  const durationSlider = document.getElementById('video-scene-duration');
  const durationDisplay = document.getElementById('video-scene-duration-display');
  if (durationSlider && durationDisplay) {
    durationSlider.addEventListener('input', () => {
      durationDisplay.textContent = `${durationSlider.value} sec`;
    });
  }
});

// Make it globally accessible
window.videoEditor = videoEditor;

// Update scene duration display
function updateAllSceneDurations(value) {
  const display = document.getElementById('video-scene-duration-display');
  if (display) display.textContent = `${value} sec`;
}

// Apply scene duration to all scenes
function applySceneDuration() {
  if (!videoEditor || !videoEditor.scenes || videoEditor.scenes.length === 0) {
    showToast('No scenes imported yet');
    return;
  }

  const slider = document.getElementById('video-scene-duration');
  const duration = parseInt(slider?.value || 6);

  videoEditor.scenes.forEach((scene, index) => {
    scene.duration = duration;
    scene.startTime = index * duration;
  });

  videoEditor.renderTimeline();
  videoEditor.updateTotalDuration();

  showToast(`Applied ${duration} sec duration to all ${videoEditor.scenes.length} scenes`);
}

// Generate captions from script text (no audio transcription needed)
function generateCaptionsFromScript() {
  if (!videoEditor || !videoEditor.scenes || videoEditor.scenes.length === 0) {
    showToast('No scenes imported yet. Import scenes first.');
    return;
  }

  const scriptInput = document.getElementById('caption-script-input');
  const scriptText = scriptInput?.value?.trim();

  if (!scriptText) {
    showToast('Please paste your script in the text area first.');
    return;
  }

  // Split script into sentences or by double newlines
  let segments = [];

  // Try splitting by double newlines first (paragraph breaks)
  if (scriptText.includes('\n\n')) {
    segments = scriptText.split(/\n\n+/).filter(s => s.trim());
  } else if (scriptText.includes('\n')) {
    // Single newlines
    segments = scriptText.split(/\n+/).filter(s => s.trim());
  } else {
    // Split by sentences (. ! ?)
    segments = scriptText.split(/(?<=[.!?])\s+/).filter(s => s.trim());
  }

  // If we have more segments than scenes, combine some
  // If fewer segments than scenes, distribute evenly
  const numScenes = videoEditor.scenes.length;

  if (segments.length === 0) {
    showToast('Could not parse script. Please check the format.');
    return;
  }

  // Distribute segments across scenes
  const captions = [];

  if (segments.length >= numScenes) {
    // More segments than scenes - combine segments per scene
    const segmentsPerScene = Math.ceil(segments.length / numScenes);
    for (let i = 0; i < numScenes; i++) {
      const start = i * segmentsPerScene;
      const end = Math.min(start + segmentsPerScene, segments.length);
      const sceneCaption = segments.slice(start, end).join(' ').trim();
      captions.push(sceneCaption || '');
    }
  } else {
    // Fewer segments than scenes - some scenes get empty captions
    const scenesPerSegment = Math.ceil(numScenes / segments.length);
    for (let i = 0; i < numScenes; i++) {
      const segmentIndex = Math.floor(i / scenesPerSegment);
      if (segmentIndex < segments.length && (i % scenesPerSegment === 0)) {
        captions.push(segments[segmentIndex].trim());
      } else {
        captions.push('');
      }
    }
  }

  // Apply captions to scenes
  videoEditor.scenes.forEach((scene, index) => {
    scene.caption = captions[index] || '';
  });

  videoEditor.renderCaptions();
  showToast(`Generated captions for ${numScenes} scenes from script!`, false);
}

// Preview audio segments before generating
async function previewAudioSegments() {
  const statusEl = document.getElementById('avatar-status');

  if (!videoEditor || !videoEditor.audioBlob) {
    showToast('Please upload audio first');
    return;
  }

  statusEl.textContent = 'Analyzing audio segments...';

  try {
    const audioSegments = await videoEditor.splitAudioForAvatar();
    const audioDuration = videoEditor.audioDuration || 0;

    // Create preview panel
    const existing = document.getElementById('segment-preview');
    if (existing) existing.remove();

    const preview = document.createElement('div');
    preview.id = 'segment-preview';
    preview.style.cssText = `
      margin-top: 15px;
      padding: 15px;
      background: var(--bg-secondary, #1a1a2e);
      border-radius: 8px;
      border: 1px solid var(--border-color, #333);
    `;

    preview.innerHTML = `
      <h4 style="margin: 0 0 10px 0; color: var(--text-primary, #fff);">🎵 Audio Segments Preview</h4>
      <p style="margin: 0 0 15px 0; color: var(--text-secondary, #aaa); font-size: 13px;">
        Total: ${Math.round(audioDuration)}s → ${audioSegments.length} segments (~90s each)<br>
        <strong>Cost estimate:</strong> ~$${(audioSegments.length * 0.15).toFixed(2)} for all segments
      </p>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${audioSegments.map((seg, i) => `
          <div style="
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 12px;
            background: var(--bg-tertiary, #252540);
            border-radius: 4px;
          ">
            <span style="font-weight: bold; color: var(--accent, #6c5ce7); min-width: 30px;">#${i + 1}</span>
            <span style="color: var(--text-secondary, #aaa); font-size: 13px;">
              ${Math.floor(seg.startTime)}s - ${Math.floor(seg.endTime)}s
              (${Math.round(seg.endTime - seg.startTime)}s)
            </span>
          </div>
        `).join('')}
      </div>
      <p style="margin: 15px 0 0 0; color: var(--text-secondary, #888); font-size: 12px;">
        💡 When you generate, you can enter which segment # to start from to skip ones you already have.
      </p>
    `;

    const btn = document.getElementById('generate-avatar-btn');
    btn.parentElement.insertBefore(preview, btn.nextSibling);

    statusEl.textContent = `Audio will be split into ${audioSegments.length} segments.`;

  } catch (error) {
    console.error('Preview error:', error);
    statusEl.textContent = 'Error: ' + error.message;
  }
}

// Make preview function global
window.previewAudioSegments = previewAudioSegments;

// Generate avatar video separately and download it
async function generateAvatarOnly() {
  const statusEl = document.getElementById('avatar-status');
  const btn = document.getElementById('generate-avatar-btn');

  if (!videoEditor) {
    showToast('Video editor not initialized');
    return;
  }

  if (!videoEditor.avatarPhotoBlob) {
    showToast('Please upload an avatar photo first');
    return;
  }

  if (!videoEditor.audioBlob) {
    showToast('Please upload audio first');
    return;
  }

  // Check audio duration and warn about segmentation
  const audioDuration = videoEditor.audioDuration || 0;
  const segmentLength = 90; // 90 seconds per segment
  const numSegments = Math.ceil(audioDuration / segmentLength);

  // Ask user which segments to generate
  let startFromSegment = 1;
  let endAtSegment = numSegments;

  if (numSegments > 1) {
    const rangePrompt = prompt(
      `Your audio needs ${numSegments} segments.\n\n` +
      `Enter which segments to generate (e.g., "2-4" or "1-8"):\n` +
      `• "1-${numSegments}" = generate ALL\n` +
      `• "2-4" = generate only segments 2, 3, 4\n` +
      `• "5-${numSegments}" = generate segments 5 to ${numSegments}\n\n` +
      `Generate segments:`,
      `1-${numSegments}`
    );

    if (rangePrompt === null) {
      // User cancelled
      return;
    }

    // Parse range (e.g., "2-4" or just "2")
    const rangeParts = rangePrompt.split('-').map(s => parseInt(s.trim()));
    startFromSegment = rangeParts[0] || 1;
    endAtSegment = rangeParts[1] || rangeParts[0] || numSegments;

    if (startFromSegment < 1) startFromSegment = 1;
    if (endAtSegment > numSegments) endAtSegment = numSegments;
    if (startFromSegment > endAtSegment) {
      showToast(`Invalid range. Start must be less than end.`);
      return;
    }

    statusEl.textContent = `Will generate segments ${startFromSegment}-${endAtSegment}...`;
  }

  btn.disabled = true;
  btn.textContent = '⏳ Uploading...';

  try {
    // Get Supabase config
    const configResponse = await fetch('/api/supabase-config');
    if (!configResponse.ok) {
      throw new Error('Cannot get storage config');
    }
    const config = await configResponse.json();

    // Upload avatar image to Supabase
    statusEl.textContent = 'Uploading avatar image...';
    const avatarPath = `avatars/avatar-${Date.now()}.png`;
    const avatarUploadUrl = `${config.url}/storage/v1/object/${config.bucket}/${avatarPath}`;

    const avatarUploadResponse = await fetch(avatarUploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.anonKey}`,
        'apikey': config.anonKey,
        'Content-Type': 'image/png',
        'x-upsert': 'true'
      },
      body: videoEditor.avatarPhotoBlob
    });

    if (!avatarUploadResponse.ok) {
      throw new Error('Failed to upload avatar image');
    }

    const avatarPublicUrl = `${config.url}/storage/v1/object/public/${config.bucket}/${avatarPath}`;

    // Split audio into segments if needed
    const audioSegments = await videoEditor.splitAudioForAvatar();
    const avatarVideos = [];
    let cachedCount = 0;
    let generatedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < audioSegments.length; i++) {
      const segment = audioSegments[i];
      const segmentNum = i + 1;

      // Skip segments outside the requested range
      if (segmentNum < startFromSegment || segmentNum > endAtSegment) {
        skippedCount++;
        avatarVideos.push({
          index: i,
          videoUrl: null,  // User has these externally
          startTime: segment.startTime,
          endTime: segment.endTime,
          skipped: true
        });
        console.log(`Segment ${segmentNum} skipped (outside range ${startFromSegment}-${endAtSegment})`);
        continue;
      }

      statusEl.textContent = `Checking segment ${segmentNum}/${audioSegments.length}...`;
      btn.textContent = `⏳ ${segmentNum}/${audioSegments.length}`;

      // Check cache first to avoid re-processing
      const audioHash = await videoEditor.generateAudioHash(segment.blob);
      const cachedVideoUrl = await videoEditor.getCachedAvatarVideo(audioHash);

      if (cachedVideoUrl) {
        // Use cached video - skip generation
        avatarVideos.push({
          index: i,
          videoUrl: cachedVideoUrl,
          startTime: segment.startTime,
          endTime: segment.endTime,
          cached: true
        });
        cachedCount++;
        console.log(`Segment ${segmentNum} loaded from cache`);
        continue;
      }

      // Not cached - need to generate
      generatedCount++;
      statusEl.textContent = `Generating segment ${segmentNum}/${audioSegments.length} (${skippedCount} skipped, ${cachedCount} cached)...`;

      // Upload this audio segment
      const mimeType = 'audio/wav';
      const audioPath = `audio/avatar-segment-${Date.now()}-${i}.wav`;
      const audioUploadUrl = `${config.url}/storage/v1/object/${config.bucket}/${audioPath}`;

      const audioUploadResponse = await fetch(audioUploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.anonKey}`,
          'apikey': config.anonKey,
          'Content-Type': mimeType,
          'x-upsert': 'true'
        },
        body: segment.blob
      });

      if (!audioUploadResponse.ok) {
        throw new Error(`Failed to upload audio segment ${i + 1}`);
      }

      const audioPublicUrl = `${config.url}/storage/v1/object/public/${config.bucket}/${audioPath}`;

      // Generate avatar for this segment
      statusEl.textContent = `Starting avatar ${i + 1}/${audioSegments.length}...`;

      const response = await fetch('/api/animate-avatar-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          avatarUrl: avatarPublicUrl,
          audioUrl: audioPublicUrl
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Avatar segment ${i + 1} failed`);
      }

      // Poll for completion (SadTalker can take 5+ minutes)
      const predictionId = result.predictionId;
      let pollCount = 0;
      const maxPolls = 600; // 10 minutes max per segment
      let prediction = { status: result.status };

      while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && pollCount < maxPolls) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Poll every 2 seconds
        pollCount++;

        const elapsed = Math.floor(pollCount * 2);
        statusEl.textContent = `Avatar ${i + 1}/${audioSegments.length}: ${prediction.status} (${elapsed}s)...`;
        btn.textContent = `⏳ ${i + 1}/${audioSegments.length}`;

        const pollResponse = await fetch(`/api/prediction-status/${predictionId}`);
        prediction = await pollResponse.json();
      }

      if (prediction.status === 'failed') {
        throw new Error(prediction.error || `Avatar segment ${i + 1} failed`);
      }

      if (prediction.status !== 'succeeded') {
        throw new Error(`Avatar segment ${i + 1} timed out`);
      }

      // Cache the generated video for future use
      const duration = segment.endTime - segment.startTime;
      await videoEditor.cacheAvatarVideo(audioHash, prediction.output, duration);

      avatarVideos.push({
        index: i,
        videoUrl: prediction.output,
        startTime: segment.startTime,
        endTime: segment.endTime,
        cached: false
      });
    }

    // Show summary
    statusEl.textContent = `Done! ${skippedCount} skipped, ${cachedCount} from cache, ${generatedCount} newly generated.`;

    // Filter out skipped videos (user has these externally)
    const videosToDownload = avatarVideos.filter(v => !v.skipped && v.videoUrl);

    if (videosToDownload.length === 0) {
      statusEl.textContent = 'No new videos to download (all skipped or cached without URL).';
      showSegmentManager(avatarVideos, config, avatarPublicUrl);
      return;
    }

    // Download generated avatar videos
    statusEl.textContent = `Downloading ${videosToDownload.length} avatar video(s)...`;

    if (videosToDownload.length === 1) {
      // Single video - download directly
      const videoResponse = await fetch(videosToDownload[0].videoUrl);
      const videoBlob = await videoResponse.blob();
      const url = URL.createObjectURL(videoBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `avatar_part_${String(videosToDownload[0].index + 1).padStart(2, '0')}.mp4`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      // Multiple videos - download as ZIP
      const zip = new JSZip();
      for (let i = 0; i < videosToDownload.length; i++) {
        const vid = videosToDownload[i];
        statusEl.textContent = `Downloading video ${i + 1}/${videosToDownload.length}...`;
        const videoResponse = await fetch(vid.videoUrl);
        const videoBlob = await videoResponse.blob();
        zip.file(`avatar_part_${String(vid.index + 1).padStart(2, '0')}.mp4`, videoBlob);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'talking_avatar_parts.zip';
      a.click();
      URL.revokeObjectURL(url);
    }

    statusEl.textContent = `Done! Downloaded ${videosToDownload.length} new videos. Combine with your existing segments in CapCut.`;
    showToast(`${videosToDownload.length} avatar video(s) downloaded!`, false);

    // Show segment manager for individual regeneration
    showSegmentManager(avatarVideos, config, avatarPublicUrl);

  } catch (error) {
    console.error('Avatar generation error:', error);
    statusEl.textContent = 'Error: ' + error.message;
    showToast('Avatar generation failed: ' + error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '🎬 Generate Avatar Video';
  }
}

// Show segment manager for regenerating individual segments
function showSegmentManager(avatarVideos, config, avatarPublicUrl) {
  // Remove existing manager if present
  const existing = document.getElementById('segment-manager');
  if (existing) existing.remove();

  const manager = document.createElement('div');
  manager.id = 'segment-manager';
  manager.style.cssText = `
    margin-top: 20px;
    padding: 15px;
    background: var(--bg-secondary, #1a1a2e);
    border-radius: 8px;
    border: 1px solid var(--border-color, #333);
  `;

  manager.innerHTML = `
    <h4 style="margin: 0 0 15px 0; color: var(--text-primary, #fff);">📹 Avatar Segments</h4>
    <p style="margin: 0 0 15px 0; color: var(--text-secondary, #aaa); font-size: 14px;">
      Click "Replace Audio" to fix a segment with cleaned audio.
    </p>
    <div id="segment-list" style="display: flex; flex-direction: column; gap: 10px;">
      ${avatarVideos.map((seg, i) => `
        <div class="segment-item" data-index="${i}" style="
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px;
          background: var(--bg-tertiary, #252540);
          border-radius: 6px;
          ${seg.skipped ? 'opacity: 0.6;' : ''}
        ">
          <span style="font-weight: bold; color: ${seg.skipped ? '#888' : 'var(--accent, #6c5ce7)'};">#${i + 1}</span>
          <span style="flex: 1; color: var(--text-secondary, #aaa); font-size: 13px;">
            ${Math.floor(seg.startTime)}s - ${Math.floor(seg.endTime)}s
            ${seg.skipped ? '(skipped - you have this)' : seg.cached ? '(cached)' : '(new)'}
          </span>
          ${seg.skipped ? `
            <span style="color: #888; font-size: 12px;">Use your existing video</span>
          ` : `
            <button onclick="previewSegment('${seg.videoUrl}')" style="
              padding: 5px 10px;
              background: var(--bg-tertiary, #333);
              border: 1px solid var(--border-color, #444);
              border-radius: 4px;
              color: var(--text-primary, #fff);
              cursor: pointer;
            ">▶ Preview</button>
            <button onclick="downloadSegment('${seg.videoUrl}', ${i + 1})" style="
              padding: 5px 10px;
              background: var(--bg-tertiary, #333);
              border: 1px solid var(--border-color, #444);
              border-radius: 4px;
              color: var(--text-primary, #fff);
              cursor: pointer;
            ">⬇ Download</button>
          `}
          <button onclick="document.getElementById('replace-input-${i}').click()" style="
            padding: 5px 10px;
            background: var(--accent, #6c5ce7);
            border: none;
            border-radius: 4px;
            color: white;
            cursor: pointer;
          ">🔄 ${seg.skipped ? 'Generate' : 'Replace'}</button>
          <input type="file" id="replace-input-${i}" accept="audio/*" style="display: none;"
            onchange="handleReplaceSegment(${i}, this, '${avatarPublicUrl}')"
          >
        </div>
      `).join('')}
    </div>
  `;

  // Store config globally for replace function
  window._segmentReplaceConfig = config;
  window._segmentReplaceAvatarUrl = avatarPublicUrl;

  // Insert after the generate button
  const btn = document.getElementById('generate-avatar-btn');
  btn.parentElement.appendChild(manager);
}

// Handle replace segment button click
async function handleReplaceSegment(segmentIndex, inputEl, avatarUrl) {
  const file = inputEl.files[0];
  if (!file) return;

  const config = window._segmentReplaceConfig;
  if (!config) {
    showToast('Config not found. Please regenerate first.');
    return;
  }

  await regenerateSegment(segmentIndex, file, avatarUrl, config);
}
window.handleReplaceSegment = handleReplaceSegment;

// Preview a segment video
function previewSegment(videoUrl) {
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  modal.onclick = () => modal.remove();
  modal.innerHTML = `
    <video src="${videoUrl}" controls autoplay style="max-width: 90%; max-height: 90%; border-radius: 8px;">
    </video>
  `;
  document.body.appendChild(modal);
}

// Download individual segment
function downloadSegment(videoUrl, index) {
  const a = document.createElement('a');
  a.href = videoUrl;
  a.download = `avatar_segment_${index}.mp4`;
  a.click();
}

// Store for uploaded avatar segments
window.uploadedAvatarSegments = window.uploadedAvatarSegments || {};

// Show upload panel for existing avatar segments
function showUploadSegmentsPanel() {
  const existing = document.getElementById('upload-segments-panel');
  if (existing) existing.remove();

  const totalSegments = videoEditor.audioDuration ? Math.ceil(videoEditor.audioDuration / 90) : 8;

  const panel = document.createElement('div');
  panel.id = 'upload-segments-panel';
  panel.style.cssText = `
    margin-top: 20px;
    padding: 15px;
    background: var(--bg-secondary, #1a1a2e);
    border-radius: 8px;
    border: 2px solid var(--accent, #6c5ce7);
  `;

  panel.innerHTML = `
    <h4 style="margin: 0 0 10px 0; color: var(--text-primary, #fff);">📤 Upload Existing Avatar Segments</h4>
    <p style="margin: 0 0 15px 0; color: var(--text-secondary, #aaa); font-size: 14px;">
      Upload your previously downloaded avatar video files OR generate a segment with new audio.
    </p>

    <!-- Generate with new audio section -->
    <div style="margin-bottom: 20px; padding: 15px; background: rgba(99, 102, 241, 0.1); border-radius: 8px; border: 1px solid var(--accent, #6c5ce7);">
      <h5 style="margin: 0 0 10px 0; color: var(--accent, #6c5ce7);">🎙️ Generate Segment with New Audio</h5>
      <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 10px;">
        <select id="new-audio-segment-num" style="padding: 8px; background: var(--bg-tertiary, #333); border: 1px solid var(--border-color, #444); border-radius: 4px; color: white;">
          ${Array.from({length: totalSegments}, (_, i) => `<option value="${i + 1}">Segment ${i + 1}</option>`).join('')}
        </select>
        <input type="file" id="new-audio-file-input" accept="audio/*" style="display: none;">
        <button onclick="document.getElementById('new-audio-file-input').click()" style="padding: 8px 16px; background: var(--accent, #6c5ce7); border: none; border-radius: 4px; color: white; cursor: pointer;">
          📁 Choose Audio File
        </button>
        <span id="new-audio-filename" style="color: var(--text-secondary, #aaa); font-size: 13px;">No file selected</span>
      </div>
      <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 10px;">
        <label style="color: var(--text-secondary, #aaa); font-size: 13px;">Model:</label>
        <select id="avatar-model-select" style="padding: 8px; background: var(--bg-tertiary, #333); border: 1px solid var(--border-color, #444); border-radius: 4px; color: white; flex: 1;">
          <option value="musetalk" selected>💰 MuseTalk (CHEAP ~$0.05/segment, fast)</option>
          <option value="p-video-avatar">💎 p-video-avatar ($2.25/segment, premium)</option>
        </select>
      </div>
      <button id="generate-new-audio-btn" onclick="generateSegmentWithNewAudio()" style="padding: 10px 20px; background: var(--success, #22c55e); border: none; border-radius: 4px; color: white; cursor: pointer; width: 100%;" disabled>
        🎬 Generate Avatar for Selected Segment
      </button>
    </div>

    <h5 style="margin: 0 0 10px 0; color: var(--text-primary, #fff);">📹 Upload Existing Video Files</h5>
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px;">
      ${Array.from({length: totalSegments}, (_, i) => `
        <div class="upload-segment-slot" data-segment="${i + 1}" style="
          padding: 15px;
          background: ${window.uploadedAvatarSegments[i + 1] ? 'rgba(34, 197, 94, 0.2)' : 'var(--bg-tertiary, #252540)'};
          border: 2px dashed ${window.uploadedAvatarSegments[i + 1] ? '#22c55e' : 'var(--border-color, #444)'};
          border-radius: 8px;
          text-align: center;
          cursor: pointer;
        " onclick="document.getElementById('segment-upload-${i + 1}').click()">
          <input type="file" id="segment-upload-${i + 1}" accept="video/*" hidden
            onchange="handleSegmentUpload(${i + 1}, this.files[0])">
          <div style="font-size: 24px; margin-bottom: 5px;">
            ${window.uploadedAvatarSegments[i + 1] ? '✅' : '📹'}
          </div>
          <div style="font-weight: bold; color: var(--text-primary, #fff);">Segment ${i + 1}</div>
          <div style="font-size: 12px; color: var(--text-secondary, #aaa); margin-top: 5px;">
            ${window.uploadedAvatarSegments[i + 1] ? 'Uploaded!' : 'Click to upload'}
          </div>
        </div>
      `).join('')}
    </div>
    <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: flex-end;">
      <button onclick="document.getElementById('upload-segments-panel').remove()" style="
        padding: 8px 16px;
        background: var(--bg-tertiary, #333);
        border: 1px solid var(--border-color, #444);
        border-radius: 6px;
        color: var(--text-primary, #fff);
        cursor: pointer;
      ">Close</button>
      <span id="segments-upload-status" style="
        padding: 8px 16px;
        color: var(--text-secondary, #aaa);
        font-size: 14px;
      ">${Object.keys(window.uploadedAvatarSegments).length}/${totalSegments} segments uploaded</span>
    </div>
  `;

  const avatarSection = document.getElementById('avatar-section');
  avatarSection.appendChild(panel);

  // Setup new audio file input listener
  const newAudioInput = document.getElementById('new-audio-file-input');
  newAudioInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      window._newAudioFile = file;
      document.getElementById('new-audio-filename').textContent = file.name;
      document.getElementById('generate-new-audio-btn').disabled = false;
    }
  });
}

// Generate a single segment with new audio file
async function generateSegmentWithNewAudio() {
  const segmentNum = parseInt(document.getElementById('new-audio-segment-num').value);
  const audioFile = window._newAudioFile;

  if (!audioFile) {
    showToast('Please select an audio file first');
    return;
  }

  if (!videoEditor.avatarPhotoBlob) {
    showToast('Please upload an avatar photo first');
    return;
  }

  const btn = document.getElementById('generate-new-audio-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Generating...';

  try {
    // Get Supabase config
    const configResponse = await fetch('/api/supabase-config');
    const config = await configResponse.json();

    // Upload avatar image
    const avatarPath = `avatars/avatar-${Date.now()}.png`;
    const avatarUploadUrl = `${config.url}/storage/v1/object/${config.bucket}/${avatarPath}`;

    await fetch(avatarUploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.anonKey}`,
        'apikey': config.anonKey,
        'Content-Type': 'image/png',
        'x-upsert': 'true'
      },
      body: videoEditor.avatarPhotoBlob
    });

    const avatarPublicUrl = `${config.url}/storage/v1/object/public/${config.bucket}/${avatarPath}`;

    // Upload audio file
    const audioPath = `audio/segment-${segmentNum}-${Date.now()}.${audioFile.name.split('.').pop()}`;
    const audioUploadUrl = `${config.url}/storage/v1/object/${config.bucket}/${audioPath}`;

    await fetch(audioUploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.anonKey}`,
        'apikey': config.anonKey,
        'Content-Type': audioFile.type || 'audio/mpeg',
        'x-upsert': 'true'
      },
      body: audioFile
    });

    const audioPublicUrl = `${config.url}/storage/v1/object/public/${config.bucket}/${audioPath}`;

    // Get selected model
    const selectedModel = document.getElementById('avatar-model-select')?.value || 'musetalk';
    const endpoint = selectedModel === 'musetalk' ? '/api/animate-avatar-musetalk' : '/api/animate-avatar-url';

    btn.textContent = selectedModel === 'musetalk'
      ? '⏳ Generating (MuseTalk - cheap mode)...'
      : '⏳ Generating (p-video-avatar - premium)...';

    console.log(`Using model: ${selectedModel}, endpoint: ${endpoint}`);

    // Generate avatar video
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        avatarUrl: avatarPublicUrl,
        audioUrl: audioPublicUrl
      })
    });

    const result = await response.json();
    if (!result.predictionId) throw new Error('No prediction ID');

    // Poll for completion
    let prediction;
    while (true) {
      await new Promise(r => setTimeout(r, 3000));
      const pollRes = await fetch(`/api/prediction-status/${result.predictionId}`);
      prediction = await pollRes.json();

      if (prediction.status === 'succeeded') break;
      if (prediction.status === 'failed') throw new Error(prediction.error || 'Generation failed');

      btn.textContent = `⏳ ${prediction.status}...`;
    }

    // Store the video
    const videoUrl = prediction.output;
    window.uploadedAvatarSegments[segmentNum] = {
      url: videoUrl,
      generated: true
    };

    // Cache it permanently
    const audioHash = await videoEditor.generateAudioHash(audioFile);
    await videoEditor.cacheAvatarVideo(audioHash, videoUrl, 90);

    // Auto-download
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `avatar_segment_${segmentNum}.mp4`;
    a.click();

    btn.textContent = '✅ Done! Video downloaded.';
    btn.disabled = false;
    showToast(`Segment ${segmentNum} generated and downloaded!`, 'success');

    // Update the slot in the grid
    const slot = document.querySelector(`.upload-segment-slot[data-segment="${segmentNum}"]`);
    if (slot) {
      slot.style.background = 'rgba(34, 197, 94, 0.2)';
      slot.style.borderColor = '#22c55e';
    }

  } catch (error) {
    console.error('Generation error:', error);
    btn.textContent = '❌ Failed - Try again';
    btn.disabled = false;
    showToast(`Failed: ${error.message}`);
  }
}
window.generateSegmentWithNewAudio = generateSegmentWithNewAudio;

// Handle individual segment video upload
async function handleSegmentUpload(segmentNum, file) {
  if (!file) return;

  const slot = document.querySelector(`.upload-segment-slot[data-segment="${segmentNum}"]`);
  slot.style.background = 'rgba(99, 102, 241, 0.2)';
  slot.innerHTML = `
    <div style="font-size: 24px; margin-bottom: 5px;">⏳</div>
    <div style="font-weight: bold; color: var(--text-primary, #fff);">Segment ${segmentNum}</div>
    <div style="font-size: 12px; color: var(--text-secondary, #aaa); margin-top: 5px;">Processing...</div>
  `;

  try {
    // Create blob URL for the video
    const videoUrl = URL.createObjectURL(file);

    // Store in memory for export
    window.uploadedAvatarSegments[segmentNum] = {
      url: videoUrl,
      blob: file,
      fileName: file.name
    };

    // Update slot UI
    slot.style.background = 'rgba(34, 197, 94, 0.2)';
    slot.style.borderColor = '#22c55e';
    slot.innerHTML = `
      <input type="file" id="segment-upload-${segmentNum}" accept="video/*" hidden
        onchange="handleSegmentUpload(${segmentNum}, this.files[0])">
      <div style="font-size: 24px; margin-bottom: 5px;">✅</div>
      <div style="font-weight: bold; color: var(--text-primary, #fff);">Segment ${segmentNum}</div>
      <div style="font-size: 12px; color: #22c55e; margin-top: 5px;">${file.name}</div>
      <button onclick="previewSegment('${videoUrl}')" style="
        margin-top: 8px;
        padding: 4px 8px;
        background: var(--bg-tertiary, #333);
        border: 1px solid var(--border-color, #444);
        border-radius: 4px;
        color: var(--text-primary, #fff);
        cursor: pointer;
        font-size: 12px;
      ">▶ Preview</button>
    `;

    // Enable avatar overlay when segments are uploaded
    if (typeof videoEditor !== 'undefined') {
      videoEditor.avatarEnabled = true;
      videoEditor.syncUploadedAvatarSegments();
    }

    // Update status
    const totalSegments = videoEditor.audioDuration ? Math.ceil(videoEditor.audioDuration / 90) : 8;
    const statusEl = document.getElementById('segments-upload-status');
    if (statusEl) {
      statusEl.textContent = `${Object.keys(window.uploadedAvatarSegments).length}/${totalSegments} segments uploaded`;
    }

    showToast(`Segment ${segmentNum} uploaded!`, 'success');

  } catch (error) {
    console.error('Segment upload error:', error);
    slot.style.background = 'rgba(239, 68, 68, 0.2)';
    slot.innerHTML = `
      <input type="file" id="segment-upload-${segmentNum}" accept="video/*" hidden
        onchange="handleSegmentUpload(${segmentNum}, this.files[0])">
      <div style="font-size: 24px; margin-bottom: 5px;">❌</div>
      <div style="font-weight: bold; color: var(--text-primary, #fff);">Segment ${segmentNum}</div>
      <div style="font-size: 12px; color: #ef4444; margin-top: 5px;">Failed - click to retry</div>
    `;
    showToast(`Failed to upload segment ${segmentNum}`);
  }
}

// Make functions globally available
window.showUploadSegmentsPanel = showUploadSegmentsPanel;
window.handleSegmentUpload = handleSegmentUpload;

// Regenerate a single segment with new audio
async function regenerateSegment(segmentIndex, audioFile, avatarUrl, config) {
  if (!audioFile) return;

  const statusEl = document.getElementById('avatar-gen-status');
  const segmentItem = document.querySelector(`.segment-item[data-index="${segmentIndex}"]`);

  statusEl.textContent = `Regenerating segment ${segmentIndex + 1}...`;
  segmentItem.style.opacity = '0.5';

  try {
    // Upload the new audio file
    const audioPath = `audio/avatar-replace-${Date.now()}.${audioFile.name.split('.').pop()}`;
    const audioUploadUrl = `${config.url}/storage/v1/object/${config.bucket}/${audioPath}`;

    const audioUploadResponse = await fetch(audioUploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.anonKey}`,
        'apikey': config.anonKey,
        'Content-Type': audioFile.type || 'audio/mpeg',
        'x-upsert': 'true'
      },
      body: audioFile
    });

    if (!audioUploadResponse.ok) {
      throw new Error('Failed to upload replacement audio');
    }

    const audioPublicUrl = `${config.url}/storage/v1/object/public/${config.bucket}/${audioPath}`;

    // Generate new avatar video
    statusEl.textContent = `Generating new avatar for segment ${segmentIndex + 1}...`;

    const response = await fetch('/api/animate-avatar-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        avatarUrl: avatarUrl,
        audioUrl: audioPublicUrl
      })
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    // Poll for completion
    const predictionId = result.predictionId;
    let pollCount = 0;
    let prediction = { status: result.status };

    while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && pollCount < 300) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      pollCount++;
      statusEl.textContent = `Segment ${segmentIndex + 1}: ${prediction.status} (${pollCount * 2}s)...`;

      const pollResponse = await fetch(`/api/prediction-status/${predictionId}`);
      prediction = await pollResponse.json();
    }

    if (prediction.status !== 'succeeded') {
      throw new Error(prediction.error || 'Generation failed');
    }

    // Update the segment item with new video
    const newVideoUrl = prediction.output;
    segmentItem.style.opacity = '1';
    segmentItem.querySelector('button[onclick^="previewSegment"]').onclick = () => previewSegment(newVideoUrl);
    segmentItem.querySelector('button[onclick^="downloadSegment"]').onclick = () => downloadSegment(newVideoUrl, segmentIndex + 1);

    // Update cache with new video
    const audioBlob = audioFile;
    const audioHash = await videoEditor.generateAudioHash(audioBlob);
    await videoEditor.cacheAvatarVideo(audioHash, newVideoUrl, 90);

    statusEl.textContent = `Segment ${segmentIndex + 1} regenerated! Download the new version.`;
    showToast(`Segment ${segmentIndex + 1} regenerated successfully!`, false);

  } catch (error) {
    console.error('Regeneration error:', error);
    statusEl.textContent = `Error: ${error.message}`;
    segmentItem.style.opacity = '1';
    showToast(`Failed to regenerate: ${error.message}`);
  }
}

// Make functions globally available
window.previewSegment = previewSegment;
window.downloadSegment = downloadSegment;
window.regenerateSegment = regenerateSegment;
