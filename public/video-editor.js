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

    // Replaced audio segments (for stitching in export)
    this.replacedAudioSegments = {};
    this.stitchedAudioBlob = null; // Cached stitched audio for preview
    this.avatarShape = 'circle';
    this.avatarVideos = []; // Generated avatar videos per scene

    // Avatar Only Mode (full-screen avatar without scenes)
    this.avatarOnlyMode = false;
    this.avatarOnlyBackgroundType = 'original'; // original, solid, gradient, blurred
    this.avatarOnlyBgColor = '#1a1a2e';
    this.avatarOnlyGradientStart = '#1a1a2e';
    this.avatarOnlyGradientEnd = '#16213e';
    this.avatarOnlyGradientDirection = 'to bottom';
    this.avatarOnlyBlurredImage = null;
    this.avatarOnlyBlurAmount = 15;
    this.avatarOnlySize = 'large';

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
    this.loadAvatarSegmentsFromSupabase(); // Restore saved avatar segments
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

    // Auto-dedupe before saving to prevent duplicates
    const seen = new Set();
    const uniqueScenes = [];
    for (const scene of this.scenes) {
      const key = scene.imageUrl || scene.id;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueScenes.push(scene);
      }
    }
    if (uniqueScenes.length < this.scenes.length) {
      console.log(`Auto-deduped ${this.scenes.length - uniqueScenes.length} duplicates before save`);
      this.scenes = uniqueScenes;
    }

    // Use a consistent batch ID for video editor scenes
    const batchId = 'video-editor-main';

    try {
      // Delete existing batch first to prevent duplicates
      await fetch(`/api/db/batch-scenes/${userId}/${batchId}`, {
        method: 'DELETE'
      });

      // Now save the current scenes (including audio URL for cross-browser persistence)
      const response = await fetch('/api/db/batch-scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId,
          batchId: batchId,
          audioUrl: this.savedAudioUrl || localStorage.getItem('saved_audio_url') || null,
          audioFileName: this.audioFileName || localStorage.getItem('saved_audio_name') || null,
          scenes: this.scenes.map((scene, index) => ({
            imageUrl: scene.imageUrl,
            text: scene.text || scene.caption || '',
            visualDescription: scene.visualDescription || '',
            duration: scene.duration,
            startTime: scene.startTime,
            index: index
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

    // Use the same batch ID as save
    const batchId = 'video-editor-main';

    try {
      // First try to load the specific video-editor-main batch
      let response = await fetch(`/api/db/batch-scenes/${userId}/${batchId}`);

      if (response.ok) {
        const data = await response.json();
        const scenes = data.scenes || [];
        if (scenes.length > 0) {
          this.scenes = scenes.map((scene, index) => ({
            id: `scene-${Date.now()}-${index}`,
            imageUrl: scene.imageUrl || scene.image_url,
            text: scene.text || '',
            caption: scene.text || '',
            duration: scene.duration || 6,
            startTime: scene.startTime || scene.start_time || 0
          }));
          this.renderImportedScenes();
          this.renderTimeline();
          this.renderCaptions();
          this.updateTotalDuration();
          console.log(`Loaded ${this.scenes.length} scenes from Supabase (video-editor-main)`);

          // Load audio from Supabase URL if available
          if (data.audioUrl) {
            console.log('Found audio URL in Supabase:', data.audioUrl);
            this.savedAudioUrl = data.audioUrl;
            localStorage.setItem('saved_audio_url', data.audioUrl);
            if (data.audioFileName) {
              localStorage.setItem('saved_audio_name', data.audioFileName);
            }
            // Load the audio from URL
            await this.loadAudioFromUrl(data.audioUrl, data.audioFileName || 'Saved audio');
          }

          showToast(`Restored ${this.scenes.length} scenes`, 'success');
          return;
        }
      }

      // Fallback: try loading most recent batch
      response = await fetch(`/api/db/batch-scenes/${userId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.batches && data.batches.length > 0) {
          const mostRecentBatch = data.batches[0];
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
            this.renderImportedScenes();
            this.renderTimeline();
            this.renderCaptions();
            this.updateTotalDuration();
            console.log(`Loaded ${this.scenes.length} scenes from Supabase (fallback)`);
            showToast(`Restored ${this.scenes.length} scenes`, 'success');
          }
        }
      }
    } catch (e) {
      console.error('Failed to load scenes from Supabase:', e);
    }
  }

  // Load avatar segments from Supabase on page load
  async loadAvatarSegmentsFromSupabase() {
    const userId = localStorage.getItem('ai_tool_user_id') || this.userId;
    if (!userId) return;

    try {
      const response = await fetch(`/api/db/avatar-segments/${userId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.segments && data.segments.length > 0) {
          // Initialize the global storage
          window.uploadedAvatarSegments = window.uploadedAvatarSegments || {};

          // Populate from database
          data.segments.forEach(seg => {
            window.uploadedAvatarSegments[seg.segment_num] = {
              url: seg.video_url,
              fileName: seg.file_name
            };
          });

          // Sync to video editor
          this.syncUploadedAvatarSegments();
          this.avatarEnabled = true;

          console.log(`Loaded ${data.segments.length} avatar segments from Supabase`);

          // Update the UI slots if they exist
          this.updateAvatarSegmentSlots();

          // Auto-extract audio from avatar segments for clean audio playback
          this.extractAudioFromAvatarSegments(data.segments);
        }
      }
    } catch (e) {
      console.error('Failed to load avatar segments from Supabase:', e);
    }
  }

  // Extract audio from avatar video segments and store for stitching
  async extractAudioFromAvatarSegments(segments) {
    if (!segments || segments.length === 0) return;

    console.log(`Auto-extracting audio from ${segments.length} avatar segments...`);
    let extracted = 0;

    for (const seg of segments) {
      if (seg.video_url) {
        try {
          const response = await fetch(seg.video_url);
          const blob = await response.blob();
          const file = new File([blob], `segment${seg.segment_num}.mp4`, { type: 'video/mp4' });
          const audioBlob = await extractAudioFromVideo(file);
          this.replacedAudioSegments[seg.segment_num] = { blob: audioBlob, url: seg.video_url };
          extracted++;
          console.log(`✓ Auto-extracted audio from segment ${seg.segment_num}`);
        } catch (e) {
          console.warn(`✗ Failed to extract audio from segment ${seg.segment_num}:`, e.message);
        }
      }
    }

    if (extracted > 0) {
      this.stitchedAudioBlob = null; // Clear cache so it rebuilds with new segments
      console.log(`✓ Auto-extracted audio from ${extracted}/${segments.length} avatar segments. Clean audio ready!`);
    }
  }

  // Update avatar segment UI slots to show loaded segments
  updateAvatarSegmentSlots() {
    const segments = window.uploadedAvatarSegments || {};
    Object.keys(segments).forEach(segNum => {
      const seg = segments[segNum];
      const slot = document.querySelector(`.upload-segment-slot[data-segment="${segNum}"]`);
      if (slot && seg.url) {
        slot.style.background = 'rgba(34, 197, 94, 0.2)';
        slot.style.borderColor = '#22c55e';
        slot.innerHTML = `
          <input type="file" id="segment-upload-${segNum}" accept="video/*" hidden
            onchange="handleSegmentUpload(${segNum}, this.files[0])">
          <div style="font-size: 24px; margin-bottom: 5px;">✅</div>
          <div style="font-weight: bold; color: var(--text-primary, #fff);">Segment ${segNum}</div>
          <div style="font-size: 12px; color: #22c55e; margin-top: 5px;">${seg.fileName || 'Loaded'}</div>
          <button onclick="previewSegment('${seg.url}')" style="
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
      }
    });
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
    this.loadPreviousBatchBtn = document.getElementById('load-previous-batch');
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
    this.syncToSpeechBtn = document.getElementById('sync-to-speech-btn');
    this.syncToAudioBtn = document.getElementById('sync-to-audio-btn');
    this.distributeEvenlyBtn = document.getElementById('distribute-evenly-btn');
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
    this.previewScrubber = document.getElementById('preview-scrubber');
    this.previewNativeVideo = document.getElementById('preview-native-video');

    // Native layered preview elements (for Avatar + Scenes)
    this.previewNativeLayered = document.getElementById('preview-native-layered');
    this.previewSceneImg = document.getElementById('preview-scene-img');
    this.previewAvatarVideo = document.getElementById('preview-avatar-video');
    this.previewCaptionOverlay = document.getElementById('preview-caption-overlay');

    // Scene indicator and reorder controls
    this.previewSceneIndicator = document.getElementById('preview-scene-indicator');
    this.sceneIndicatorNumber = this.previewSceneIndicator?.querySelector('.scene-indicator-number');
    this.sceneIndicatorDesc = this.previewSceneIndicator?.querySelector('.scene-indicator-desc');
    this.sceneNumberBadge = document.getElementById('scene-number-badge');
    this.previewMoveEarlierBtn = document.getElementById('preview-move-earlier');
    this.previewMoveLaterBtn = document.getElementById('preview-move-later');
    this.currentPreviewSceneIndex = -1; // Track currently displayed scene

    // Canvas context
    this.ctx = this.previewCanvas.getContext('2d');

    // Use native preview by default (smoother playback)
    this.useNativePreview = true;
  }

  initEventListeners() {
    // Import
    this.importFromBatchBtn.addEventListener('click', () => this.importFromBatch());
    if (this.loadPreviousBatchBtn) {
      this.loadPreviousBatchBtn.addEventListener('click', () => this.showPreviousBatches());
    }
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
    if (this.syncToSpeechBtn) {
      this.syncToSpeechBtn.addEventListener('click', () => this.syncToSpeech());
    }
    if (this.syncToAudioBtn) {
      this.syncToAudioBtn.addEventListener('click', (e) => {
        // Shift+Click = force fresh transcription (clear cache)
        const forceRefresh = e.shiftKey;
        if (forceRefresh) {
          showToast('Clearing cache, will re-transcribe...', 'info');
        }
        this.syncToAudio(forceRefresh);
      });
      this.syncToAudioBtn.title = 'Click to sync | Shift+Click to clear cache and re-sync';
    }
    if (this.distributeEvenlyBtn) {
      this.distributeEvenlyBtn.addEventListener('click', () => this.distributeEvenly());
    }

    // Expanded Timeline Editor
    const expandTimelineBtn = document.getElementById('expand-timeline-btn');
    if (expandTimelineBtn) {
      expandTimelineBtn.addEventListener('click', () => this.openExpandedTimeline());
    }
    const closeExpandedBtn = document.getElementById('close-expanded-timeline');
    if (closeExpandedBtn) {
      closeExpandedBtn.addEventListener('click', () => this.closeExpandedTimeline());
    }

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

    // Skip Forward/Back buttons (15 seconds like YouTube)
    const skipBackBtn = document.getElementById('preview-skip-back');
    const skipForwardBtn = document.getElementById('preview-skip-forward');
    if (skipBackBtn) {
      skipBackBtn.addEventListener('click', () => this.skipTime(-15));
    }
    if (skipForwardBtn) {
      skipForwardBtn.addEventListener('click', () => this.skipTime(15));
    }

    // Scene Reorder Controls
    if (this.previewMoveEarlierBtn) {
      this.previewMoveEarlierBtn.addEventListener('click', () => this.moveSceneEarlier());
    }
    if (this.previewMoveLaterBtn) {
      this.previewMoveLaterBtn.addEventListener('click', () => this.moveSceneLater());
    }

    // Preview Scrubber
    if (this.previewScrubber) {
      this.previewScrubber.addEventListener('input', (e) => this.seekPreview(e.target.value));
      this.previewScrubber.addEventListener('mousedown', () => this.scrubbing = true);
      this.previewScrubber.addEventListener('mouseup', () => this.scrubbing = false);
    }

    // Native video time update for Avatar Only mode
    if (this.previewNativeVideo) {
      this.previewNativeVideo.addEventListener('timeupdate', () => {
        if (this.avatarOnlyMode && !this.scrubbing) {
          this.playbackTime = this.previewNativeVideo.currentTime;
          this.updateScrubberPosition();
          this.updateTimeDisplay();
        }
      });
      this.previewNativeVideo.addEventListener('ended', () => {
        if (this.avatarOnlyMode) {
          this.previewNativeVideo.currentTime = 0;
          this.previewNativeVideo.play();
        }
      });
    }
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

    // Convert imported scenes to our format
    const newScenes = scenesToImport.map((scene, index) => ({
      id: Date.now() + index, // Unique ID
      imageUrl: scene.imageUrl,
      text: scene.text || '',
      duration: duration,
      caption: scene.text ? scene.text.substring(0, 100) : '',
      startTime: 0 // Will be recalculated
    }));

    // If there are existing scenes, ask user what to do
    if (this.scenes.length > 0) {
      this.showImportChoiceDialog(newScenes);
      return;
    }

    // No existing scenes - just import
    this.scenes = newScenes;
    this.recalculateTimings();
    this.finishImport(newScenes.length, 'imported');
  }

  // Show dialog to choose replace or append
  showImportChoiceDialog(newScenes) {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'import-choice-overlay';
    overlay.innerHTML = `
      <div class="import-choice-dialog">
        <h3>Import ${newScenes.length} Scenes</h3>
        <p>You have ${this.scenes.length} existing scene(s). What would you like to do?</p>
        <div class="import-choice-buttons">
          <button class="btn secondary" id="import-replace">
            🔄 Replace All
            <small>Remove existing scenes</small>
          </button>
          <button class="btn primary" id="import-append">
            ➕ Add to Existing
            <small>Keep current scenes</small>
          </button>
        </div>
        <button class="btn text import-cancel">Cancel</button>
      </div>
    `;

    document.body.appendChild(overlay);

    // Handle button clicks
    overlay.querySelector('#import-replace').addEventListener('click', () => {
      this.scenes = newScenes;
      this.recalculateTimings();
      this.finishImport(newScenes.length, 'imported');
      overlay.remove();
    });

    overlay.querySelector('#import-append').addEventListener('click', () => {
      const startId = Date.now();
      newScenes.forEach((scene, i) => {
        scene.id = startId + i;
      });
      this.scenes = [...this.scenes, ...newScenes];
      this.recalculateTimings();
      this.finishImport(newScenes.length, 'added');
      overlay.remove();
    });

    overlay.querySelector('.import-cancel').addEventListener('click', () => {
      overlay.remove();
    });

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });
  }

  // Finish import process
  finishImport(count, action) {
    this.renderImportedScenes();
    this.renderTimeline();
    this.renderCaptions();
    this.updateTotalDuration();
    this.saveScenesToSupabase();
    showToast(`${count} scenes ${action}! Total: ${this.scenes.length}`, 'success');
  }

  // Show previous batches from Supabase
  async showPreviousBatches() {
    const userId = localStorage.getItem('ai_tool_user_id');
    if (!userId) {
      showToast('No saved batches found.');
      return;
    }

    try {
      showToast('Loading previous batches...', 'info');
      const response = await fetch(`/api/db/batch-scenes/${userId}`);
      const data = await response.json();

      if (!data.success || !data.batches || data.batches.length === 0) {
        showToast('No previous batches found.');
        return;
      }

      // Create batch selection overlay
      const overlay = document.createElement('div');
      overlay.className = 'batch-history-overlay';

      const batchesHtml = data.batches.map((batch, index) => {
        const date = new Date(batch.created_at || batch.createdAt || Date.now());
        const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const sceneCount = batch.scenes ? batch.scenes.length : 0;
        const firstScene = batch.scenes && batch.scenes[0] ? batch.scenes[0].imageUrl : '';

        return `
          <div class="batch-history-item" data-batch-index="${index}">
            <div class="batch-thumbnail">
              ${firstScene ? `<img src="${firstScene}" alt="Batch preview">` : '<div class="no-preview">No preview</div>'}
              <span class="batch-scene-count">${sceneCount} scenes</span>
            </div>
            <div class="batch-info">
              <span class="batch-date">${dateStr}</span>
              ${index === 0 ? '<span class="batch-latest">Latest</span>' : ''}
            </div>
          </div>
        `;
      }).join('');

      overlay.innerHTML = `
        <div class="batch-history-dialog">
          <div class="batch-history-header">
            <h3>📂 Previous Batches</h3>
            <button class="batch-history-close">&times;</button>
          </div>
          <p class="batch-history-subtitle">Click a batch to load it</p>
          <div class="batch-history-grid">
            ${batchesHtml}
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      // Close button
      overlay.querySelector('.batch-history-close').addEventListener('click', () => {
        overlay.remove();
      });

      // Close on overlay click
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.remove();
        }
      });

      // Batch selection
      overlay.querySelectorAll('.batch-history-item').forEach(item => {
        item.addEventListener('click', () => {
          const batchIndex = parseInt(item.dataset.batchIndex);
          const selectedBatch = data.batches[batchIndex];
          overlay.remove();
          this.loadBatchScenes(selectedBatch);
        });
      });

    } catch (error) {
      console.error('Failed to load previous batches:', error);
      showToast('Failed to load previous batches.');
    }
  }

  // Load scenes from a specific batch
  loadBatchScenes(batch) {
    if (!batch.scenes || batch.scenes.length === 0) {
      showToast('This batch has no scenes.');
      return;
    }

    const sceneDuration = typeof getSceneDuration === 'function'
      ? getSceneDuration()
      : (document.getElementById('scene-duration')?.value || 6);
    const duration = parseInt(sceneDuration);

    const newScenes = batch.scenes.filter(s => s && s.imageUrl).map((scene, index) => ({
      id: Date.now() + index,
      imageUrl: scene.imageUrl,
      text: scene.text || '',
      duration: duration,
      caption: scene.text ? scene.text.substring(0, 100) : '',
      startTime: 0
    }));

    // If there are existing scenes, ask user what to do
    if (this.scenes.length > 0) {
      this.showImportChoiceDialog(newScenes);
    } else {
      this.scenes = newScenes;
      this.recalculateTimings();
      this.finishImport(newScenes.length, 'loaded');
    }
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
      <div class="imported-scene ${this.swapSelection === index ? 'swap-selected' : ''}" data-index="${index}" draggable="true">
        <img src="${scene.imageUrl}" alt="Scene ${index + 1}"
             onclick="videoEditor.viewSceneFullscreen(${index})"
             title="Click to view full size" style="cursor: pointer;">
        <span class="scene-order">${index + 1}</span>
        <div class="imported-scene-actions">
          <button class="swap-scene-btn" onclick="event.stopPropagation(); videoEditor.toggleSwapSelection(${index})" title="Swap with another scene">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M7 16V4M7 4L3 8M7 4l4 4M17 8v12M17 20l4-4M17 20l-4-4"/>
            </svg>
          </button>
          <button class="remove-scene" onclick="event.stopPropagation(); videoEditor.removeScene(${index})" title="Remove scene">×</button>
        </div>
      </div>
    `).join('');

    // Add drag and drop
    this.initDragAndDrop();
  }

  // Swap selection state
  swapSelection = null;

  toggleSwapSelection(index) {
    if (this.swapSelection === null) {
      // First selection
      this.swapSelection = index;
      this.renderImportedScenes();
      this.showToast(`Scene ${index + 1} selected. Click another scene's swap button to swap.`);
    } else if (this.swapSelection === index) {
      // Deselect
      this.swapSelection = null;
      this.renderImportedScenes();
      this.showToast('Swap cancelled');
    } else {
      // Perform swap
      this.swapScenes(this.swapSelection, index);
      this.swapSelection = null;
    }
  }

  swapScenes(indexA, indexB) {
    // Swap the scenes in the array
    const temp = this.scenes[indexA];
    this.scenes[indexA] = this.scenes[indexB];
    this.scenes[indexB] = temp;

    // Update timings and re-render
    this.recalculateTimings();
    this.renderImportedScenes();
    this.renderTimeline();
    this.renderCaptions();
    this.saveScenesToSupabase();
    this.showToast(`Swapped scene ${indexA + 1} with scene ${indexB + 1}`);
  }

  showToast(message) {
    // Use existing showToast if available, otherwise create simple notification
    if (typeof window.showToast === 'function') {
      window.showToast(message, false);
    } else {
      console.log('Video Editor:', message);
    }
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

  // Load audio from a URL (for cross-browser persistence via Supabase)
  async loadAudioFromUrl(url, fileName) {
    try {
      console.log('Loading audio from URL:', url);
      showToast('Loading saved audio...', 'info');

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch audio: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || 'audio/mpeg';
      this.audioBlob = new Blob([arrayBuffer], { type: contentType });
      this.audioFileName = fileName;

      // Load the audio for playback
      this.loadAudioBlob(this.audioBlob);

      // Also save to IndexedDB for faster loading next time
      this.saveAudioToIndexedDB(fileName, this.audioBlob);

      console.log('Audio loaded from Supabase URL successfully');
      showToast('Audio restored!', 'success');
    } catch (error) {
      console.error('Failed to load audio from URL:', error);
      showToast('Could not load saved audio. Please re-upload.', 'error');
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

  // Simple hash function for cache keys
  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
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

  // Avatar Only Mode - full screen avatar without scene images
  toggleAvatarOnlyMode() {
    const checkbox = document.getElementById('avatar-only-mode');
    this.avatarOnlyMode = checkbox?.checked || false;

    const optionsDiv = document.getElementById('avatar-only-options');
    if (optionsDiv) {
      optionsDiv.hidden = !this.avatarOnlyMode;
    }

    // Initialize background upload handlers if not done
    if (this.avatarOnlyMode) {
      this.initAvatarOnlyBackgroundUpload();
    }

    // Update size select to use avatar-only sizes
    if (this.avatarOnlyMode) {
      // In avatar only mode, use full/large sizes
      this.avatarSize = this.avatarOnlySize;
    }

    showToast(this.avatarOnlyMode ? 'Avatar Only Mode - full screen avatar without scenes' : 'Normal mode - avatar as overlay on scenes', false);
  }

  updateBackgroundType() {
    const typeSelect = document.getElementById('avatar-background-type');
    this.avatarOnlyBackgroundType = typeSelect?.value || 'original';

    // Show/hide relevant options
    const solidOptions = document.getElementById('solid-bg-options');
    const gradientOptions = document.getElementById('gradient-bg-options');
    const blurredOptions = document.getElementById('blurred-bg-options');

    if (solidOptions) solidOptions.hidden = this.avatarOnlyBackgroundType !== 'solid';
    if (gradientOptions) gradientOptions.hidden = this.avatarOnlyBackgroundType !== 'gradient';
    if (blurredOptions) blurredOptions.hidden = this.avatarOnlyBackgroundType !== 'blurred';
  }

  initAvatarOnlyBackgroundUpload() {
    const uploadArea = document.getElementById('blurred-bg-upload');
    const fileInput = document.getElementById('blurred-bg-file');
    const placeholder = document.getElementById('blurred-bg-placeholder');
    const preview = document.getElementById('blurred-bg-preview');
    const previewImg = document.getElementById('blurred-bg-img');
    const clearBtn = document.getElementById('clear-blurred-bg');
    const blurSlider = document.getElementById('blur-amount');
    const blurValue = document.getElementById('blur-amount-value');

    if (!uploadArea || uploadArea.dataset.initialized) return;
    uploadArea.dataset.initialized = 'true';

    uploadArea.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          this.avatarOnlyBlurredImage = ev.target.result;
          if (previewImg) previewImg.src = ev.target.result;
          if (placeholder) placeholder.hidden = true;
          if (preview) preview.hidden = false;
        };
        reader.readAsDataURL(file);
      }
    });

    clearBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.avatarOnlyBlurredImage = null;
      if (fileInput) fileInput.value = '';
      if (placeholder) placeholder.hidden = false;
      if (preview) preview.hidden = true;
    });

    blurSlider?.addEventListener('input', (e) => {
      this.avatarOnlyBlurAmount = parseInt(e.target.value);
      if (blurValue) blurValue.textContent = `${this.avatarOnlyBlurAmount}px`;
    });

    // Color sync for solid and gradient backgrounds
    this.setupColorSync('avatar-bg-color', 'avatar-bg-color-hex');
    this.setupColorSync('avatar-gradient-start', 'avatar-gradient-start-hex');
    this.setupColorSync('avatar-gradient-end', 'avatar-gradient-end-hex');
  }

  // Draw background for avatar-only mode
  drawAvatarOnlyBackground(ctx, width, height) {
    switch (this.avatarOnlyBackgroundType) {
      case 'original':
        // Use video's original background - just clear with black
        // The avatar video itself contains the background
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        break;

      case 'solid':
        const bgColor = document.getElementById('avatar-bg-color')?.value || this.avatarOnlyBgColor;
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, width, height);
        break;

      case 'gradient':
        const startColor = document.getElementById('avatar-gradient-start')?.value || this.avatarOnlyGradientStart;
        const endColor = document.getElementById('avatar-gradient-end')?.value || this.avatarOnlyGradientEnd;
        const direction = document.getElementById('avatar-gradient-direction')?.value || this.avatarOnlyGradientDirection;

        let gradient;
        if (direction === 'radial') {
          gradient = ctx.createRadialGradient(width/2, height/2, 0, width/2, height/2, Math.max(width, height)/2);
        } else if (direction === 'to right') {
          gradient = ctx.createLinearGradient(0, 0, width, 0);
        } else if (direction === 'to bottom right') {
          gradient = ctx.createLinearGradient(0, 0, width, height);
        } else {
          gradient = ctx.createLinearGradient(0, 0, 0, height);
        }
        gradient.addColorStop(0, startColor);
        gradient.addColorStop(1, endColor);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        break;

      case 'blurred':
        if (this.avatarOnlyBlurredImage) {
          // Draw blurred image
          const img = new Image();
          img.src = this.avatarOnlyBlurredImage;
          if (img.complete) {
            ctx.filter = `blur(${this.avatarOnlyBlurAmount}px)`;
            // Scale to cover
            const scale = Math.max(width / img.width, height / img.height);
            const scaledW = img.width * scale;
            const scaledH = img.height * scale;
            const offsetX = (width - scaledW) / 2;
            const offsetY = (height - scaledH) / 2;
            ctx.drawImage(img, offsetX, offsetY, scaledW, scaledH);
            ctx.filter = 'none';
          }
        } else {
          // Fallback to dark background
          ctx.fillStyle = '#1a1a2e';
          ctx.fillRect(0, 0, width, height);
        }
        break;
    }
  }

  // Get avatar rect for avatar-only mode (larger/centered)
  getAvatarOnlyRect(canvasWidth, canvasHeight) {
    // When using original video background, always use full size to preserve the background
    if (this.avatarOnlyBackgroundType === 'original') {
      return { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
    }

    const sizeSelect = document.getElementById('avatar-only-size');
    const size = sizeSelect?.value || this.avatarOnlySize;

    let avatarWidth, avatarHeight;

    switch (size) {
      case 'medium':
        avatarWidth = canvasWidth * 0.5;
        avatarHeight = canvasHeight * 0.5;
        break;
      case 'large':
        avatarWidth = canvasWidth * 0.7;
        avatarHeight = canvasHeight * 0.7;
        break;
      case 'full':
        avatarWidth = canvasWidth;
        avatarHeight = canvasHeight;
        break;
      default:
        avatarWidth = canvasWidth * 0.7;
        avatarHeight = canvasHeight * 0.7;
    }

    // Center the avatar
    const x = (canvasWidth - avatarWidth) / 2;
    const y = (canvasHeight - avatarHeight) / 2;

    return { x, y, width: avatarWidth, height: avatarHeight };
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

  // Stitch audio segments together (using replaced segments where available)
  async stitchAudioForExport() {
    if (!this.audioBlob) return null;

    // Check if we have any replaced segments
    const replacedKeys = Object.keys(this.replacedAudioSegments);
    if (replacedKeys.length === 0) {
      console.log('No replaced audio segments, using original audio');
      return this.audioBlob;
    }

    console.log(`Stitching audio with ${replacedKeys.length} replaced segments:`, replacedKeys);

    // Get original audio segments
    const originalSegments = await this.splitAudioForAvatar();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // Load all segment audio buffers
    const segmentBuffers = [];
    for (let i = 0; i < originalSegments.length; i++) {
      const segmentNum = i + 1; // Segments are 1-indexed

      let audioBlob;
      if (this.replacedAudioSegments[segmentNum]) {
        // Use replaced audio
        audioBlob = this.replacedAudioSegments[segmentNum].blob;
        console.log(`Segment ${segmentNum}: using REPLACED audio`);
      } else {
        // Use original segment
        audioBlob = originalSegments[i].blob;
        console.log(`Segment ${segmentNum}: using original audio`);
      }

      // Decode audio blob to buffer
      try {
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        segmentBuffers.push(audioBuffer);
      } catch (e) {
        console.error(`Failed to decode segment ${segmentNum}:`, e);
        // Fall back to original if decode fails
        const arrayBuffer = await originalSegments[i].blob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        segmentBuffers.push(audioBuffer);
      }
    }

    // Calculate total length
    const sampleRate = segmentBuffers[0].sampleRate;
    const numChannels = segmentBuffers[0].numberOfChannels;
    let totalSamples = 0;
    for (const buf of segmentBuffers) {
      totalSamples += buf.length;
    }

    // Create combined buffer
    const combinedBuffer = audioContext.createBuffer(numChannels, totalSamples, sampleRate);

    let offset = 0;
    for (const buf of segmentBuffers) {
      for (let channel = 0; channel < numChannels; channel++) {
        const destData = combinedBuffer.getChannelData(channel);
        const srcData = buf.getChannelData(channel);
        destData.set(srcData, offset);
      }
      offset += buf.length;
    }

    // Convert to WAV blob
    const stitchedBlob = this.audioBufferToWav(combinedBuffer);
    console.log('Stitched audio created:', stitchedBlob.size, 'bytes');

    return stitchedBlob;
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

  // Sync scene durations based on word count (more words = longer scene)
  syncToSpeech() {
    if (this.scenes.length === 0) {
      showToast('Add scenes first.');
      return;
    }

    if (!this.audioDuration || this.audioDuration === 0) {
      showToast('Add audio first.');
      return;
    }

    // Count words in each scene's DIALOGUE (text in quotes) not visual descriptions
    const wordCounts = this.scenes.map(scene => {
      const text = scene.text || scene.caption || '';

      // Extract only dialogue in quotes
      const dialogueMatches = text.match(/"([^"]*)"/g) || [];
      const dialogue = dialogueMatches.map(m => m.replace(/"/g, '')).join(' ');

      // If no quoted dialogue, use the whole text but with lower weight
      let words;
      if (dialogue.length > 0) {
        words = dialogue.split(/\s+/).filter(w => w.length > 0);
      } else {
        // Visual description scene - give it minimal time
        words = ['placeholder']; // 1 word = minimum time
      }

      return Math.max(1, words.length);
    });

    const totalWords = wordCounts.reduce((sum, count) => sum + count, 0);
    const totalDuration = this.audioDuration;

    // Calculate duration with CAPPED proportional word count
    // Base: even distribution, then adjust slightly by word count
    const baseDuration = totalDuration / this.scenes.length;
    const avgWords = totalWords / this.scenes.length;

    let currentTime = 0;
    this.scenes.forEach((scene, index) => {
      // Start with even distribution, adjust by word ratio (capped)
      const wordRatio = Math.min(2, Math.max(0.5, wordCounts[index] / avgWords));
      scene.startTime = currentTime;
      scene.duration = baseDuration * wordRatio;

      // Cap between 3 and 25 seconds
      scene.duration = Math.max(3, Math.min(25, scene.duration));

      currentTime += scene.duration;
    });

    // Adjust to fit exact duration
    const actualTotal = this.scenes.reduce((sum, s) => sum + s.duration, 0);
    const scale = totalDuration / actualTotal;
    const anticipation = 3; // Show scenes 3 seconds BEFORE words are spoken

    currentTime = 0;
    this.scenes.forEach(scene => {
      scene.startTime = Math.max(0, currentTime - anticipation);
      scene.duration *= scale;
      currentTime += scene.duration;
    });

    // Make scenes contiguous after anticipation shift
    for (let i = 0; i < this.scenes.length - 1; i++) {
      this.scenes[i].duration = this.scenes[i + 1].startTime - this.scenes[i].startTime;
    }
    this.scenes[this.scenes.length - 1].duration = totalDuration - this.scenes[this.scenes.length - 1].startTime;

    this.renderTimeline();
    this.renderCaptions();
    this.updateTotalDuration();

    showToast(`Synced based on word count (shifted ${anticipation}s earlier)`, 'success');
  }

  // Sync scenes to actual audio transcription using Whisper
  // forceRefresh = true will clear all caches and re-transcribe
  async syncToAudio(forceRefresh = false) {
    if (this.scenes.length === 0) {
      showToast('Add scenes first.');
      return;
    }

    if (!this.audioBlob) {
      showToast('Add audio first.');
      return;
    }

    // If force refresh, clear all sync-related caches
    if (forceRefresh) {
      console.log('Force refresh: Clearing ALL audio and sync caches...');
      // Clear transcription and AI sync caches
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('transcription_') || key.startsWith('ai-sync-'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));

      // Also clear saved audio URL to force re-upload
      localStorage.removeItem('saved_audio_url');
      localStorage.removeItem('saved_audio_name');
      this.savedAudioUrl = null;

      console.log(`Cleared ${keysToRemove.length} cached items + saved audio URL`);
      showToast('Cleared all caches - will use current audio file', 'info');
    }

    // Show loading state
    if (this.syncToAudioBtn) {
      this.syncToAudioBtn.disabled = true;
      this.syncToAudioBtn.textContent = forceRefresh ? '🔄 Re-transcribing...' : '⏳ Transcribing...';
    }

    try {
      console.log('Step 1: Checking Supabase SDK...');

      // Check if Supabase SDK is loaded
      if (!window.supabase || !window.supabase.createClient) {
        throw new Error('Supabase SDK not loaded. Please refresh the page.');
      }

      // Use stitched audio if there are AI avatar replacements
      let audioToSync = this.audioBlob;
      const hasReplacements = Object.keys(this.replacedAudioSegments || {}).length > 0;

      if (hasReplacements) {
        console.log('Found replaced audio segments, stitching combined audio...');
        showToast('Combining audio with AI avatar segments...', 'info');
        const stitchedAudio = await this.stitchAudioForExport();
        if (stitchedAudio) {
          audioToSync = stitchedAudio;
          console.log('Using stitched audio with replacements');
        }
      }

      console.log('Step 2: Audio blob:', audioToSync?.type, audioToSync?.size);

      // Step 1: Get Supabase config for direct upload
      showToast('Connecting to storage...', 'info');
      const configResponse = await fetch('/api/supabase-config');

      if (!configResponse.ok) {
        const errText = await configResponse.text();
        throw new Error('Config fetch failed: ' + errText.substring(0, 100));
      }

      const config = await configResponse.json();
      console.log('Step 3: Got config, bucket:', config.bucket);

      if (!config.url || !config.anonKey) {
        throw new Error('Supabase not configured');
      }

      // Step 3: Initialize Supabase client and upload directly (bypasses Vercel limit)
      showToast('Uploading audio for transcription...', 'info');
      console.log('Step 4: Creating Supabase client...');
      const supabaseClient = window.supabase.createClient(config.url, config.anonKey);

      // Determine correct file extension from blob type
      const mimeType = audioToSync.type || 'audio/mpeg';
      let extension = 'mp3';
      if (mimeType.includes('webm')) extension = 'webm';
      else if (mimeType.includes('wav')) extension = 'wav';
      else if (mimeType.includes('ogg')) extension = 'ogg';
      else if (mimeType.includes('m4a') || mimeType.includes('mp4')) extension = 'm4a';
      else if (mimeType.includes('flac')) extension = 'flac';
      else if (mimeType.includes('mpeg') || mimeType.includes('mp3')) extension = 'mp3';

      const fileName = `audio/transcribe_${Date.now()}.${extension}`;
      console.log('Step 4: Uploading to Supabase:', fileName, 'mimeType:', mimeType, 'size:', audioToSync.size);

      const { data: uploadData, error: uploadError } = await supabaseClient.storage
        .from(config.bucket)
        .upload(fileName, audioToSync, {
          contentType: audioToSync.type || 'audio/mpeg',
          upsert: true
        });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        throw new Error('Upload failed: ' + (uploadError.message || JSON.stringify(uploadError)));
      }

      console.log('Step 4b: Upload successful:', uploadData);

      // Get public URL
      const { data: urlData } = supabaseClient.storage
        .from(config.bucket)
        .getPublicUrl(fileName);

      const audioUrl = urlData.publicUrl;
      console.log('Step 4c: Audio uploaded to:', audioUrl);

      // If we used stitched audio with replacements, make it the new primary audio
      if (hasReplacements) {
        console.log('Replacing primary audio blob with stitched audio (includes AI avatar segments)');
        this.audioBlob = audioToSync;
        // Clear replaced segments since they're now baked into the main audio
        this.replacedAudioSegments = {};
        showToast('Combined audio with AI segments saved as primary', 'success');
      }

      // Save audio URL for cross-browser persistence
      this.savedAudioUrl = audioUrl;
      localStorage.setItem('saved_audio_url', audioUrl);
      localStorage.setItem('saved_audio_name', this.audioFileName || 'combined-audio.m4a');
      // Also save to Supabase with scenes
      this.saveScenesToSupabase();

      // Step 4: Check cache first to avoid re-transcribing
      const audioHash = await this.generateAudioHash(audioToSync);
      const cacheKey = `transcription_${audioHash}`;
      let result = null;

      // Try to get cached transcription
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          result = JSON.parse(cached);
          console.log('Using CACHED transcription (saving API cost!)', result.segments?.length, 'segments');
          showToast('Using cached transcription (no API cost)', 'success');
        } catch (e) {
          console.log('Cache invalid, will re-transcribe');
        }
      }

      // If no cache, transcribe
      if (!result) {
        showToast('Transcribing audio with Whisper...', 'info');

        console.log('Step 5: Sending transcribe request to:', audioUrl);
        const response = await fetch('/api/transcribe-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audioUrl: audioUrl })
        });

        console.log('Step 6: Transcribe response status:', response.status);
        const responseText = await response.text();
        console.log('Step 7: Response preview:', responseText.substring(0, 100));

        try {
          result = JSON.parse(responseText);
        } catch (e) {
          throw new Error('Invalid transcription response: ' + responseText.substring(0, 100));
        }

        if (!response.ok || result.error) {
          throw new Error(result.error || 'Transcription failed');
        }

        // Cache the result for future syncs
        localStorage.setItem(cacheKey, JSON.stringify(result));
        console.log('Transcription cached for future use');
      }

      console.log('Step 8: Transcription received:', result.segments?.length, 'segments');

      // Step 3: Use AI-powered scene synchronization (GPT-4o)
      // This intelligently analyzes scene content and transcript to determine optimal placement
      if (this.syncToAudioBtn) {
        this.syncToAudioBtn.textContent = '🤖 AI Analyzing...';
      }

      const matchedCount = await this.aiSyncScenes(result.segments || [], result.duration || this.audioDuration);

      this.renderTimeline();
      this.renderCaptions();
      this.updateTotalDuration();

      // Save updated timings to Supabase
      this.saveScenesToSupabase();

      // All scenes now get timing via AI placement
      showToast(`AI synced ${this.scenes.length} scenes to ${(result.duration || this.audioDuration).toFixed(0)}s audio (${matchedCount} placed by GPT-4o)`, 'success');

    } catch (error) {
      console.error('Sync to audio error:', error);
      console.error('Error stack:', error.stack);
      const errorMsg = error.details || error.message || 'Unknown error';
      showToast(`Sync failed: ${errorMsg}`, 'error');
    } finally {
      // Restore button state
      if (this.syncToAudioBtn) {
        this.syncToAudioBtn.disabled = false;
        this.syncToAudioBtn.textContent = '🎯 Sync to Audio';
      }
    }
  }

  // Match scenes to transcription segments using SEMANTIC text matching
  matchScenesToSegments(segments, totalDuration) {
    if (!segments || segments.length === 0 || this.scenes.length === 0) {
      return 0;
    }

    console.log(`Matching ${this.scenes.length} scenes to ${segments.length} segments over ${totalDuration?.toFixed(1)}s`);

    const numScenes = this.scenes.length;
    const anticipation = 3.0; // Start scene before dialogue

    // === SEMANTIC CONCEPT MAPPINGS ===
    // Maps visual/conceptual keywords to related spoken words
    const semanticMap = {
      // Money & Abundance
      'money': ['money', 'wealth', 'rich', 'income', 'financial', 'cash', 'dollars', 'abundance', 'prosperity', 'afford', 'earn', 'salary', 'budget', 'investment', 'debt', 'bills', 'pay', 'cost', 'expensive', 'savings'],
      'wealth': ['wealth', 'wealthy', 'rich', 'money', 'abundance', 'prosperity', 'fortune', 'millionaire', 'assets', 'financial'],
      'abundance': ['abundance', 'abundant', 'plenty', 'overflow', 'prosperity', 'wealth', 'rich', 'blessed', 'fortunate'],
      'prosperity': ['prosperity', 'prosperous', 'wealth', 'success', 'thriving', 'flourishing', 'abundance'],
      'financial': ['financial', 'finance', 'money', 'budget', 'income', 'expenses', 'debt', 'savings', 'investment'],

      // Spirituality & Mindset
      'meditation': ['meditation', 'meditate', 'calm', 'peace', 'mindful', 'breathe', 'relax', 'center', 'quiet', 'stillness', 'presence'],
      'spiritual': ['spiritual', 'spirit', 'soul', 'divine', 'universe', 'energy', 'vibration', 'consciousness', 'awakening', 'enlightenment'],
      'manifest': ['manifest', 'manifestation', 'attract', 'create', 'intention', 'desire', 'vision', 'dream', 'goal', 'reality'],
      'mindset': ['mindset', 'mind', 'belief', 'think', 'thought', 'perspective', 'attitude', 'mental', 'psychology'],
      'gratitude': ['gratitude', 'grateful', 'thankful', 'appreciate', 'blessing', 'blessed', 'thanks'],
      'healing': ['healing', 'heal', 'health', 'wellness', 'recovery', 'restore', 'therapy', 'wholeness'],

      // Emotions & States
      'happy': ['happy', 'happiness', 'joy', 'joyful', 'pleased', 'delighted', 'content', 'satisfied', 'cheerful', 'smile'],
      'love': ['love', 'loving', 'loved', 'heart', 'compassion', 'care', 'affection', 'romance', 'relationship'],
      'fear': ['fear', 'afraid', 'scared', 'worry', 'anxiety', 'anxious', 'nervous', 'stress', 'panic', 'concern'],
      'confident': ['confident', 'confidence', 'bold', 'brave', 'courage', 'strong', 'powerful', 'assertive'],
      'peace': ['peace', 'peaceful', 'calm', 'serene', 'tranquil', 'quiet', 'still', 'relaxed'],
      'stress': ['stress', 'stressed', 'anxiety', 'anxious', 'overwhelm', 'pressure', 'tension', 'worry'],

      // Life & Growth
      'journey': ['journey', 'path', 'road', 'travel', 'adventure', 'trip', 'way', 'route', 'destination'],
      'growth': ['growth', 'grow', 'growing', 'develop', 'evolve', 'progress', 'improve', 'expand', 'transform'],
      'change': ['change', 'changing', 'transform', 'shift', 'transition', 'different', 'new', 'evolve'],
      'success': ['success', 'successful', 'achieve', 'accomplish', 'win', 'victory', 'triumph', 'goal'],
      'dream': ['dream', 'dreams', 'vision', 'goal', 'aspiration', 'hope', 'desire', 'wish', 'imagine'],
      'future': ['future', 'tomorrow', 'ahead', 'coming', 'next', 'forward', 'later', 'destiny', 'fate'],
      'past': ['past', 'yesterday', 'before', 'history', 'memory', 'memories', 'ago', 'used', 'former'],

      // People & Relationships
      'woman': ['woman', 'women', 'lady', 'female', 'she', 'her', 'girl', 'mother', 'wife', 'sister', 'daughter'],
      'man': ['man', 'men', 'male', 'he', 'him', 'guy', 'father', 'husband', 'brother', 'son'],
      'family': ['family', 'families', 'parent', 'child', 'children', 'kids', 'mom', 'dad', 'mother', 'father'],
      'friend': ['friend', 'friends', 'friendship', 'buddy', 'companion', 'relationship'],

      // Actions & Activities
      'work': ['work', 'working', 'job', 'career', 'business', 'profession', 'employment', 'office', 'boss'],
      'learn': ['learn', 'learning', 'study', 'education', 'knowledge', 'understand', 'discover', 'teach'],
      'create': ['create', 'creating', 'creation', 'build', 'make', 'design', 'craft', 'produce'],
      'speak': ['speak', 'speaking', 'talk', 'say', 'tell', 'voice', 'words', 'communicate', 'express'],
      'write': ['write', 'writing', 'written', 'journal', 'note', 'book', 'story', 'letter'],

      // Nature & Environment
      'nature': ['nature', 'natural', 'earth', 'world', 'environment', 'outdoors', 'outside', 'green'],
      'sun': ['sun', 'sunshine', 'sunny', 'light', 'bright', 'morning', 'dawn', 'day', 'warm'],
      'moon': ['moon', 'night', 'evening', 'dark', 'stars', 'midnight', 'sleep', 'dream'],
      'ocean': ['ocean', 'sea', 'water', 'wave', 'beach', 'shore', 'flow', 'deep'],
      'mountain': ['mountain', 'mountains', 'peak', 'climb', 'high', 'top', 'summit', 'hill'],
      'forest': ['forest', 'trees', 'woods', 'nature', 'green', 'leaves', 'path', 'wilderness'],

      // Body & Health
      'body': ['body', 'physical', 'health', 'healthy', 'fitness', 'exercise', 'strength', 'energy'],
      'brain': ['brain', 'mind', 'mental', 'think', 'thought', 'intelligence', 'smart', 'cognitive'],
      'heart': ['heart', 'love', 'feel', 'feeling', 'emotion', 'passion', 'care', 'compassion'],
      'energy': ['energy', 'energetic', 'power', 'force', 'vibration', 'frequency', 'dynamic', 'vital'],

      // Abstract concepts
      'time': ['time', 'moment', 'now', 'present', 'today', 'tomorrow', 'yesterday', 'hour', 'minute', 'year'],
      'life': ['life', 'living', 'alive', 'exist', 'existence', 'lifetime', 'born', 'death', 'world'],
      'truth': ['truth', 'true', 'real', 'reality', 'honest', 'authentic', 'genuine', 'fact'],
      'power': ['power', 'powerful', 'strength', 'strong', 'force', 'energy', 'control', 'ability'],
      'freedom': ['freedom', 'free', 'liberty', 'liberate', 'release', 'escape', 'independent']
    };

    // Stopwords to ignore
    const stopwords = new Set(['the', 'a', 'an', 'i', 'you', 'to', 'and', 'of', 'is', 'it', 'in',
      'that', 'for', 'on', 'with', 'as', 'at', 'by', 'this', 'be', 'are', 'was', 'have', 'has',
      'had', 'but', 'or', 'not', 'so', 'if', 'my', 'your', 'we', 'they', 'me', 'him', 'her',
      'its', 'just', 'like', 'dont', 'can', 'will', 'would', 'could', 'should', 'do', 'does',
      'image', 'photo', 'picture', 'showing', 'depicts', 'scene', 'background', 'style',
      'did', 'been', 'being', 'get', 'got', 'going', 'gonna', 'want', 'know', 'think', 'say',
      'said', 'let', 'make', 'made', 'take', 'come', 'came', 'look', 'see', 'way', 'well',
      'back', 'now', 'then', 'here', 'there', 'when', 'what', 'who', 'how', 'why', 'all',
      'any', 'some', 'one', 'two', 'out', 'about', 'into', 'over', 'after', 'before']);

    // Get ALL text from scene (prompt, text, caption, everything)
    const getSceneText = (scene) => {
      const parts = [
        scene.text || '',
        scene.caption || '',
        scene.prompt || '',
        scene.description || ''
      ];
      return parts.join(' ').toLowerCase();
    };

    // Get meaningful words from text
    const getMeaningfulWords = (text) => {
      return (text || '').toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3 && !stopwords.has(w));
    };

    // Expand keywords using semantic map
    const expandKeywords = (words) => {
      const expanded = new Set(words);
      words.forEach(word => {
        // Direct semantic mappings
        if (semanticMap[word]) {
          semanticMap[word].forEach(syn => expanded.add(syn));
        }
        // Also check if word appears in any semantic group
        Object.values(semanticMap).forEach(group => {
          if (group.includes(word)) {
            group.forEach(syn => expanded.add(syn));
          }
        });
      });
      return [...expanded];
    };

    // Calculate SEMANTIC similarity
    const semanticSimilarity = (sceneText, segmentText) => {
      const sceneWords = getMeaningfulWords(sceneText);
      const segmentWords = new Set(getMeaningfulWords(segmentText));

      if (sceneWords.length === 0 || segmentWords.size === 0) return 0;

      // Expand scene keywords semantically
      const expandedSceneWords = expandKeywords(sceneWords);

      // Count matches (including semantic matches)
      let matches = 0;
      let directMatches = 0;

      for (const word of expandedSceneWords) {
        if (segmentWords.has(word)) {
          matches++;
          if (sceneWords.includes(word)) directMatches++;
        }
      }

      // Score: direct matches count more
      const score = (directMatches * 2 + matches) / (expandedSceneWords.length + sceneWords.length);
      return Math.min(1, score);
    };

    // === STEP 1: PROPORTIONAL BASELINE ===
    const sceneTimings = this.scenes.map((scene, i) => ({
      sceneIndex: i,
      startTime: (i / numScenes) * totalDuration,
      confidence: 0,
      matched: false,
      method: 'proportional'
    }));

    console.log('Step 1: Assigned proportional times to all', numScenes, 'scenes');

    // === STEP 2: SEMANTIC MATCHING (IMPROVED) ===
    // Match scenes to audio using sliding window context (not just single segments)

    let refinedCount = 0;

    // Build sliding window contexts (combine 3-5 segments for better matching)
    const windowContexts = [];
    const windowSize = 3; // Number of segments per window
    for (let i = 0; i < segments.length; i++) {
      const windowSegs = segments.slice(i, i + windowSize);
      const combinedText = windowSegs.map(s => s.text).join(' ');
      const startTime = windowSegs[0]?.start || 0;
      const endTime = windowSegs[windowSegs.length - 1]?.end || startTime;
      windowContexts.push({
        text: combinedText,
        start: startTime,
        end: endTime,
        midpoint: (startTime + endTime) / 2
      });
    }

    sceneTimings.forEach((timing, sceneIndex) => {
      const scene = this.scenes[sceneIndex];
      const sceneText = getSceneText(scene);

      if (!sceneText || sceneText.length < 10) return;

      const expectedTime = timing.startTime;

      // Search ALL window contexts for best match
      let bestMatch = null;
      let bestScore = 0;

      windowContexts.forEach((ctx) => {
        const baseScore = semanticSimilarity(sceneText, ctx.text);

        // Smaller position bonus - allow more flexibility in matching
        const timeDiff = Math.abs(ctx.midpoint - expectedTime) / totalDuration;
        const positionBonus = Math.max(0, 0.15 - timeDiff * 0.5);

        const finalScore = baseScore + positionBonus;

        // Lower threshold (0.10) to catch more matches
        if (finalScore > bestScore && baseScore >= 0.10) {
          bestScore = finalScore;
          bestMatch = { ...ctx, baseScore };
        }
      });

      // Accept matches with reasonable confidence
      if (bestMatch && bestMatch.baseScore >= 0.10) {
        const newStartTime = Math.max(0, bestMatch.start - anticipation);

        timing.startTime = newStartTime;
        timing.confidence = bestMatch.baseScore;
        timing.matched = true;
        timing.method = 'semantic';
        timing.matchedText = bestMatch.text?.substring(0, 50);
        refinedCount++;

        console.log(`Scene ${sceneIndex + 1} matched: ${expectedTime.toFixed(1)}s → ${newStartTime.toFixed(1)}s (${(bestMatch.baseScore * 100).toFixed(0)}% semantic match)`);
        console.log(`  Scene: "${sceneText.substring(0, 60)}..."`);
        console.log(`  Audio: "${bestMatch.text?.substring(0, 60)}..."`);
      }
    });

    console.log(`Step 2: Matched ${refinedCount}/${numScenes} scenes using SEMANTIC matching (sliding window)`);

    // === STEP 3: REDISTRIBUTE BETWEEN ANCHORS ===
    // Find anchor points (refined scenes) and redistribute unrefined scenes between them
    const anchors = sceneTimings
      .map((t, i) => ({ index: i, ...t }))
      .filter(t => t.matched);

    // Add start and end as implicit anchors
    const allAnchors = [
      { index: -1, startTime: 0 },
      ...anchors,
      { index: numScenes, startTime: totalDuration }
    ];

    console.log(`Step 3: Found ${anchors.length} anchor points, redistributing scenes between them`);

    // Redistribute scenes between each pair of anchors
    for (let a = 0; a < allAnchors.length - 1; a++) {
      const startAnchor = allAnchors[a];
      const endAnchor = allAnchors[a + 1];

      const startIdx = startAnchor.index + 1;
      const endIdx = endAnchor.index;
      const sceneCount = endIdx - startIdx;

      if (sceneCount <= 0) continue;

      const timeSpan = endAnchor.startTime - startAnchor.startTime;
      const timePerScene = timeSpan / (sceneCount + 1); // +1 because end anchor takes a slot

      for (let i = startIdx; i < endIdx; i++) {
        const posInSpan = i - startIdx + 1;
        sceneTimings[i].startTime = startAnchor.startTime + (timePerScene * posInSpan);
      }
    }

    // Ensure sequential order (safety check)
    let lastTime = 0;
    for (let i = 0; i < sceneTimings.length; i++) {
      if (sceneTimings[i].startTime <= lastTime) {
        sceneTimings[i].startTime = lastTime + 0.5;
      }
      lastTime = sceneTimings[i].startTime;
    }

    console.log(`Step 3: All ${numScenes} scenes redistributed between anchors`);
    const matchedCount = refinedCount;

    // IMPORTANT: Ensure Scene 1 always starts at time 0
    if (sceneTimings.length > 0) {
      sceneTimings[0].startTime = 0;
    }

    // Calculate minimum visible duration (at least 0.8% of timeline, minimum 3 seconds)
    const minVisibleDuration = Math.max(3, totalDuration * 0.008);
    console.log(`Minimum visible duration: ${minVisibleDuration.toFixed(1)}s (${(minVisibleDuration/totalDuration*100).toFixed(2)}% of timeline)`);

    // Make scenes contiguous and apply timings
    for (let i = 0; i < sceneTimings.length; i++) {
      const endTime = i < sceneTimings.length - 1 ? sceneTimings[i + 1].startTime : totalDuration;
      const scene = this.scenes[sceneTimings[i].sceneIndex];
      scene.startTime = sceneTimings[i].startTime;
      scene.duration = Math.max(minVisibleDuration, endTime - scene.startTime);
    }

    // Post-process: Fix any overlapping scenes caused by minimum duration enforcement
    // Sort scenes by startTime and recalculate to prevent overlaps
    const sortedScenes = [...this.scenes].sort((a, b) => a.startTime - b.startTime);
    for (let i = 0; i < sortedScenes.length - 1; i++) {
      const current = sortedScenes[i];
      const next = sortedScenes[i + 1];
      const currentEnd = current.startTime + current.duration;

      // If current scene overlaps with next, adjust
      if (currentEnd > next.startTime) {
        // Either shrink current or push next forward
        const overlap = currentEnd - next.startTime;
        if (current.duration - overlap >= minVisibleDuration) {
          // Shrink current scene
          current.duration -= overlap;
        } else {
          // Push all subsequent scenes forward
          const pushAmount = currentEnd - next.startTime;
          for (let j = i + 1; j < sortedScenes.length; j++) {
            sortedScenes[j].startTime += pushAmount;
          }
        }
      }
    }

    // Final check: ensure last scene doesn't exceed total duration
    const lastScene = sortedScenes[sortedScenes.length - 1];
    if (lastScene && lastScene.startTime + lastScene.duration > totalDuration) {
      lastScene.duration = Math.max(minVisibleDuration, totalDuration - lastScene.startTime);
    }

    // Log first 15 scenes to debug timing issues
    console.log('=== SCENE TIMINGS (first 15) ===');
    this.scenes.slice(0, 15).forEach((s, i) => {
      console.log(`Scene ${i + 1}: ${s.startTime?.toFixed(1)}s - ${(s.startTime + s.duration)?.toFixed(1)}s (${s.duration?.toFixed(1)}s)`);
    });
    console.log('=== END SCENE TIMINGS ===');

    // Check for any problematic scenes (very short duration)
    const shortScenes = this.scenes.filter((s, i) => s.duration < minVisibleDuration);
    if (shortScenes.length > 0) {
      console.warn(`Warning: ${shortScenes.length} scenes have duration < ${minVisibleDuration.toFixed(1)} seconds`);
    }

    return matchedCount;
  }

  // AI-powered scene synchronization using GPT-4o
  // This sends scenes + transcript to AI for intelligent placement
  async aiSyncScenes(segments, totalDuration) {
    if (!segments || segments.length === 0 || this.scenes.length === 0) {
      console.log('AI Sync: Missing segments or scenes, falling back to keyword matching');
      return this.matchScenesToSegments(segments, totalDuration);
    }

    // Prepare scene data for API (only send relevant fields)
    const sceneData = this.scenes.map((scene, index) => ({
      index,
      text: scene.text || '',
      caption: scene.caption || '',
      prompt: scene.prompt || '',
      description: scene.description || ''
    }));

    // Generate cache key based on scene content + segment content + duration
    const sceneHash = sceneData.map(s => `${s.text}|${s.caption}`.substring(0, 50)).join('::');
    const segmentHash = segments.slice(0, 10).map(s => s.text?.substring(0, 30) || '').join('::');
    const cacheKey = `ai-sync-${this.scenes.length}-${segments.length}-${totalDuration.toFixed(0)}-${this.hashString(sceneHash + segmentHash)}`;

    // Check cache first
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const cachedTimings = JSON.parse(cached);
        console.log('AI Sync: Using cached timings (saved $$ on GPT-4o call)');

        // Apply cached timings
        cachedTimings.forEach(timing => {
          const scene = this.scenes[timing.sceneIndex];
          if (scene) {
            scene.startTime = timing.startTime;
            scene.duration = timing.duration;
          }
        });

        return cachedTimings.length;
      } catch (e) {
        console.log('AI Sync: Cache invalid, will call API');
        localStorage.removeItem(cacheKey);
      }
    }

    console.log(`AI Sync: Sending ${this.scenes.length} scenes and ${segments.length} segments to GPT-4o...`);

    try {
      const response = await fetch('/api/ai-sync-scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenes: sceneData,
          segments: segments,
          totalDuration: totalDuration
        })
      });

      const result = await response.json();

      if (!response.ok || result.error) {
        console.error('AI Sync failed:', result.error);
        console.log('Falling back to keyword matching...');
        return this.matchScenesToSegments(segments, totalDuration);
      }

      // Apply AI timings to scenes
      console.log('AI Sync successful! Applying timings...');
      const timings = result.timings;

      timings.forEach(timing => {
        const scene = this.scenes[timing.sceneIndex];
        if (scene) {
          scene.startTime = timing.startTime;
          scene.duration = timing.duration;
          console.log(`Scene ${timing.sceneIndex + 1}: ${timing.startTime.toFixed(1)}s-${(timing.startTime + timing.duration).toFixed(1)}s | ${timing.reason}`);
        }
      });

      // Log first 10 scene timings
      console.log('=== AI SCENE TIMINGS (first 10) ===');
      this.scenes.slice(0, 10).forEach((s, i) => {
        console.log(`Scene ${i + 1}: ${s.startTime?.toFixed(1)}s - ${(s.startTime + s.duration)?.toFixed(1)}s (${s.duration?.toFixed(1)}s)`);
      });
      console.log('=== END AI SCENE TIMINGS ===');

      // Cache the results to avoid repeated API calls
      try {
        localStorage.setItem(cacheKey, JSON.stringify(timings));
        console.log('AI Sync: Results cached for future use');
      } catch (e) {
        console.log('AI Sync: Could not cache results');
      }

      return timings.length; // Return number of AI-placed scenes

    } catch (error) {
      console.error('AI Sync error:', error);
      console.log('Falling back to keyword matching...');
      return this.matchScenesToSegments(segments, totalDuration);
    }
  }

  // Distribute scenes evenly across audio duration (simple, guaranteed to work)
  distributeEvenly() {
    if (this.scenes.length === 0) {
      showToast('Add scenes first.');
      return;
    }

    if (!this.audioDuration || this.audioDuration === 0) {
      showToast('Add audio first to distribute scenes.');
      return;
    }

    const durationPerScene = this.audioDuration / this.scenes.length;
    const anticipation = 3; // Show scenes 3 seconds BEFORE words are spoken

    this.scenes.forEach((scene, index) => {
      // Shift each scene earlier by anticipation amount
      scene.startTime = Math.max(0, (index * durationPerScene) - anticipation);
      scene.duration = durationPerScene;
    });

    // Make sure scenes don't overlap due to anticipation shift
    for (let i = 0; i < this.scenes.length - 1; i++) {
      const nextStart = this.scenes[i + 1].startTime;
      if (this.scenes[i].startTime + this.scenes[i].duration > nextStart) {
        this.scenes[i].duration = nextStart - this.scenes[i].startTime;
      }
    }
    // Last scene goes to end of audio
    this.scenes[this.scenes.length - 1].duration = this.audioDuration - this.scenes[this.scenes.length - 1].startTime;

    this.renderTimeline();
    this.renderCaptions();
    this.updateTotalDuration();

    // Save to Supabase so changes persist
    this.saveScenesToSupabase();

    showToast(`Distributed ${this.scenes.length} scenes (~${durationPerScene.toFixed(1)}s each, shifted ${anticipation}s earlier)`, 'success');

    console.log('distributeEvenly completed. First 5 scenes:', this.scenes.slice(0, 5).map(s => ({start: s.startTime, dur: s.duration})));
  }

  // Fix any scenes that are too short to be visible
  fixShortScenes() {
    if (this.scenes.length === 0) return 0;

    const totalDuration = this.audioDuration || this.getTotalDuration();
    // Minimum 3 seconds or 0.8% of total duration (whichever is larger)
    const minDuration = Math.max(3, totalDuration * 0.008);

    let fixedCount = 0;

    // Sort scenes by startTime to process in order
    const sortedScenes = [...this.scenes].sort((a, b) => a.startTime - b.startTime);

    for (let i = 0; i < sortedScenes.length; i++) {
      const scene = sortedScenes[i];

      if (scene.duration < minDuration) {
        // Calculate max possible duration (until next scene or end)
        const nextScene = sortedScenes[i + 1];
        const maxEnd = nextScene ? nextScene.startTime : totalDuration;
        const availableSpace = maxEnd - scene.startTime;

        // Expand to minimum duration or available space
        const newDuration = Math.min(minDuration, Math.max(scene.duration, availableSpace));

        if (newDuration > scene.duration) {
          console.log(`Fixing scene ${this.scenes.indexOf(scene) + 1}: ${scene.duration.toFixed(1)}s → ${newDuration.toFixed(1)}s`);
          scene.duration = newDuration;
          fixedCount++;
        }
      }
    }

    if (fixedCount > 0) {
      console.log(`Fixed ${fixedCount} short scenes (min duration: ${minDuration.toFixed(1)}s)`);
      this.renderTimeline();
      this.saveScenesToSupabase();
    }

    return fixedCount;
  }

  // ===== EXPANDED TIMELINE EDITOR =====

  openExpandedTimeline() {
    if (this.scenes.length === 0) {
      showToast('Add scenes first to use the timeline editor.');
      return;
    }

    const modal = document.getElementById('expanded-timeline-modal');
    if (!modal) return;

    // Auto-fix any scenes that are too short to be visible
    const fixedCount = this.fixShortScenes();
    if (fixedCount > 0) {
      showToast(`Fixed ${fixedCount} scenes that were too short to display`, 'success');
    }

    modal.style.display = 'flex';
    this.renderExpandedTimeline();
    this.setupExpandedTimelineInteractions();

    // Update preview with first scene
    this.updateExpandedPreview(0);

    // Bind control buttons
    const playBtn = document.getElementById('expanded-play-btn');
    const syncBtn = document.getElementById('expanded-sync-audio-btn');
    const distributeBtn = document.getElementById('expanded-distribute-btn');

    console.log('Binding expanded timeline buttons:', { playBtn, syncBtn, distributeBtn });

    if (playBtn) {
      // Remove old listener and add new one
      playBtn.replaceWith(playBtn.cloneNode(true));
      const newPlayBtn = document.getElementById('expanded-play-btn');
      newPlayBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Play button clicked!');
        this.toggleExpandedPlayback();
      });
    } else {
      console.error('Play button not found!');
    }
    if (syncBtn) {
      syncBtn.replaceWith(syncBtn.cloneNode(true));
      const newSyncBtn = document.getElementById('expanded-sync-audio-btn');
      newSyncBtn.addEventListener('click', () => {
        this.syncToAudio();
        this.renderExpandedTimeline();
        this.setupExpandedTimelineInteractions();
      });
    }
    if (distributeBtn) {
      distributeBtn.replaceWith(distributeBtn.cloneNode(true));
      const newDistributeBtn = document.getElementById('expanded-distribute-btn');
      newDistributeBtn.addEventListener('click', () => {
        this.distributeEvenly();
        this.renderExpandedTimeline();
        this.setupExpandedTimelineInteractions();
      });
    }

    // Skip back 15s button
    const skipBackBtn = document.getElementById('expanded-skip-back');
    if (skipBackBtn) {
      skipBackBtn.replaceWith(skipBackBtn.cloneNode(true));
      const newSkipBackBtn = document.getElementById('expanded-skip-back');
      newSkipBackBtn.addEventListener('click', () => {
        this.expandedSkip(-15);
      });
    }

    // Skip forward 15s button
    const skipForwardBtn = document.getElementById('expanded-skip-forward');
    if (skipForwardBtn) {
      skipForwardBtn.replaceWith(skipForwardBtn.cloneNode(true));
      const newSkipForwardBtn = document.getElementById('expanded-skip-forward');
      newSkipForwardBtn.addEventListener('click', () => {
        this.expandedSkip(15);
      });
    }

    // Captions toggle button
    const captionsBtn = document.getElementById('expanded-captions-btn');
    if (captionsBtn) {
      captionsBtn.replaceWith(captionsBtn.cloneNode(true));
      const newCaptionsBtn = document.getElementById('expanded-captions-btn');
      // Initialize captions enabled (default true)
      if (this.expandedCaptionsEnabled === undefined) {
        this.expandedCaptionsEnabled = true;
      }
      // Update button state
      if (this.expandedCaptionsEnabled) {
        newCaptionsBtn.classList.add('active');
      }
      newCaptionsBtn.addEventListener('click', () => {
        this.expandedCaptionsEnabled = !this.expandedCaptionsEnabled;
        newCaptionsBtn.classList.toggle('active', this.expandedCaptionsEnabled);
        // Update preview to show/hide caption
        const currentScene = this.getSceneAtTime(this.audioPlayer?.currentTime || 0);
        if (currentScene) {
          const sceneIndex = this.scenes.indexOf(currentScene);
          this.updateExpandedPreview(sceneIndex, this.audioPlayer?.currentTime);
        }
        showToast(this.expandedCaptionsEnabled ? 'Captions enabled' : 'Captions disabled');
      });
    }
  }

  // Skip forward/back in expanded timeline
  expandedSkip(seconds) {
    if (!this.audioPlayer) return;

    const totalDuration = this.audioDuration || this.getTotalDuration();
    const newTime = Math.max(0, Math.min(totalDuration, this.audioPlayer.currentTime + seconds));
    this.audioPlayer.currentTime = newTime;

    // Update playhead and preview
    const playhead = document.getElementById('expanded-timeline-playhead');
    if (playhead) {
      playhead.style.left = `${(newTime / totalDuration) * 100}%`;
    }

    const currentTimeEl = document.getElementById('expanded-current-time');
    if (currentTimeEl) {
      currentTimeEl.textContent = `${this.formatTime(newTime)} / ${this.formatTime(totalDuration)}`;
    }

    // Update scene preview
    const currentScene = this.getSceneAtTime(newTime);
    if (currentScene) {
      const sceneIndex = this.scenes.indexOf(currentScene);
      this.updateExpandedPreview(sceneIndex, newTime);
    }
  }

  closeExpandedTimeline() {
    const modal = document.getElementById('expanded-timeline-modal');
    if (modal) {
      modal.style.display = 'none';
    }

    // Stop any playback
    if (this.expandedPlaybackInterval) {
      clearInterval(this.expandedPlaybackInterval);
      this.expandedPlaybackInterval = null;
    }
    if (this.audioPlayer) {
      this.audioPlayer.pause();
    }

    // Re-render the regular timeline
    this.renderTimeline();
    this.renderCaptions();
  }

  renderExpandedTimeline() {
    const scenesContainer = document.getElementById('expanded-timeline-scenes');
    if (!scenesContainer) return;

    // Use max of audio duration and scene end times to ensure all scenes fit
    const sceneEndTime = this.scenes.length > 0
      ? Math.max(...this.scenes.map(s => s.startTime + s.duration))
      : 0;
    const totalDuration = Math.max(this.audioDuration || 0, sceneEndTime, this.getTotalDuration());

    scenesContainer.innerHTML = this.scenes.map((scene, index) => {
      const leftPercent = (scene.startTime / totalDuration) * 100;
      const widthPercent = (scene.duration / totalDuration) * 100;
      return `
        <div class="expanded-scene" data-index="${index}"
             style="left: ${leftPercent}%; width: ${widthPercent}%">
          <img src="${scene.imageUrl}" alt="Scene ${index + 1}">
          <span class="scene-label">${index + 1}</span>
          <span class="scene-time">${scene.duration.toFixed(1)}s</span>
        </div>
      `;
    }).join('');

    // Render waveform copy
    const waveformArea = document.getElementById('expanded-waveform');
    if (waveformArea && this.waveformContainer) {
      // Copy waveform visual
      const svg = this.waveformContainer.querySelector('svg');
      if (svg) {
        waveformArea.innerHTML = '';
        const clone = svg.cloneNode(true);
        clone.style.width = '100%';
        clone.style.height = '100%';
        waveformArea.appendChild(clone);
      }
    }
  }

  updateExpandedPreview(sceneIndex, currentTime = null) {
    const scene = this.scenes[sceneIndex];
    if (!scene) return;

    const previewImg = document.getElementById('expanded-preview-image');
    const sceneNumber = document.getElementById('expanded-scene-number');
    const sceneTime = document.getElementById('expanded-scene-time');
    const sceneDesc = document.getElementById('expanded-scene-desc');
    const captionOverlay = document.getElementById('expanded-caption-overlay');

    if (previewImg) previewImg.src = scene.imageUrl;
    if (sceneNumber) sceneNumber.textContent = `Scene ${sceneIndex + 1} of ${this.scenes.length}`;
    if (sceneTime) sceneTime.textContent = this.formatTime(currentTime !== null ? currentTime : scene.startTime);

    // Show scene description/text
    if (sceneDesc) {
      const descText = scene.text || scene.caption || scene.description || '';
      sceneDesc.textContent = descText;
      sceneDesc.style.display = descText ? 'block' : 'none';
    }

    // Show caption overlay if enabled
    if (captionOverlay) {
      const captionText = scene.caption || '';
      if (captionText && this.expandedCaptionsEnabled) {
        captionOverlay.textContent = captionText;
        captionOverlay.classList.add('visible');
      } else {
        captionOverlay.classList.remove('visible');
      }
    }
  }

  // Update avatar video in expanded timeline
  updateExpandedAvatar(currentTime) {
    const expandedAvatarVideo = document.getElementById('expanded-avatar-video');
    if (!expandedAvatarVideo) return;

    // Check if we have avatar videos generated
    if (!this.avatarVideos || this.avatarVideos.length === 0) {
      expandedAvatarVideo.classList.remove('active');
      return;
    }

    // Find the avatar video for the current time
    const avatarVideo = this.getAvatarVideoAtTime(currentTime);

    if (avatarVideo) {
      // Show and play the avatar video
      if (expandedAvatarVideo.src !== avatarVideo.videoUrl) {
        expandedAvatarVideo.src = avatarVideo.videoUrl;
        // Wait for video to be ready before seeking and playing
        expandedAvatarVideo.onloadeddata = () => {
          const avatarTime = currentTime - avatarVideo.startTime;
          expandedAvatarVideo.currentTime = avatarTime;
          expandedAvatarVideo.play().catch(() => {});
        };
        expandedAvatarVideo.load();
      } else {
        // Same video, just sync time - tighter threshold (50ms)
        const avatarTime = currentTime - avatarVideo.startTime;
        if (Math.abs(expandedAvatarVideo.currentTime - avatarTime) > 0.05) {
          expandedAvatarVideo.currentTime = avatarTime;
        }

        if (expandedAvatarVideo.paused) {
          expandedAvatarVideo.play().catch(() => {});
        }
      }
      expandedAvatarVideo.classList.add('active');
    } else {
      // No avatar for this time, hide it
      expandedAvatarVideo.classList.remove('active');
      expandedAvatarVideo.pause();
    }
  }

  setupExpandedTimelineInteractions() {
    const scenesContainer = document.getElementById('expanded-timeline-scenes');
    if (!scenesContainer) return;

    const sceneElements = scenesContainer.querySelectorAll('.expanded-scene');

    sceneElements.forEach(sceneEl => {
      const sceneIndex = parseInt(sceneEl.dataset.index);
      let isDragging = false;
      let dragStartX, dragStartLeft;
      let lastScrubTime = 0;

      const onMouseDown = (e) => {
        isDragging = true;
        dragStartX = e.clientX;
        dragStartLeft = sceneEl.offsetLeft;
        sceneEl.classList.add('dragging');

        // Update preview to this scene
        this.updateExpandedPreview(sceneIndex);

        // Start audio scrubbing
        if (this.audioPlayer) {
          this.audioPlayer.pause();
        }

        e.preventDefault();
      };

      const onMouseMove = (e) => {
        if (!isDragging) return;

        const timelineWidth = scenesContainer.offsetWidth;
        const totalDuration = this.audioDuration || this.getTotalDuration();

        const diff = e.clientX - dragStartX;
        const newLeft = Math.max(0, Math.min(timelineWidth - sceneEl.offsetWidth, dragStartLeft + diff));
        const newStartTime = (newLeft / timelineWidth) * totalDuration;

        // Update scene position
        this.scenes[sceneIndex].startTime = Math.max(0, newStartTime);

        // Update visual position directly
        sceneEl.style.left = `${(newStartTime / totalDuration) * 100}%`;

        // Update preview info
        const sceneTime = document.getElementById('expanded-scene-time');
        if (sceneTime) sceneTime.textContent = this.formatTime(newStartTime);

        // Update current time display
        const currentTimeEl = document.getElementById('expanded-current-time');
        if (currentTimeEl) {
          currentTimeEl.textContent = `${this.formatTime(newStartTime)} / ${this.formatTime(totalDuration)}`;
        }

        // Audio scrubbing - play at current position (throttled)
        const now = Date.now();
        if (this.audioPlayer && now - lastScrubTime > 80) {
          lastScrubTime = now;
          this.audioPlayer.currentTime = newStartTime;
          this.audioPlayer.play().catch(() => {});

          // Stop after a short moment
          setTimeout(() => {
            if (isDragging && this.audioPlayer) {
              this.audioPlayer.pause();
            }
          }, 120);
        }

        // Update playhead position
        const playhead = document.getElementById('expanded-timeline-playhead');
        if (playhead) {
          playhead.style.left = `${(newStartTime / totalDuration) * 100}%`;
        }
      };

      const onMouseUp = () => {
        if (!isDragging) return;

        isDragging = false;
        sceneEl.classList.remove('dragging');

        // Stop audio
        if (this.audioPlayer) {
          this.audioPlayer.pause();
        }

        // Re-render to update positions
        this.renderExpandedTimeline();
        this.setupExpandedTimelineInteractions();

        // Save changes
        this.saveScenesToSupabase();
      };

      sceneEl.addEventListener('mousedown', onMouseDown);
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  toggleExpandedPlayback() {
    const playBtn = document.getElementById('expanded-play-btn');
    const expandedAvatarVideo = document.getElementById('expanded-avatar-video');

    console.log('toggleExpandedPlayback called, interval:', this.expandedPlaybackInterval, 'audioElement:', this.audioPlayer);

    if (this.expandedPlaybackInterval) {
      // Stop playback
      console.log('Stopping playback');
      clearInterval(this.expandedPlaybackInterval);
      this.expandedPlaybackInterval = null;
      if (this.audioPlayer) this.audioPlayer.pause();
      if (expandedAvatarVideo) {
        expandedAvatarVideo.pause();
        expandedAvatarVideo.classList.remove('active');
      }
      if (playBtn) playBtn.textContent = '▶️ Play';
    } else {
      // Start playback
      console.log('Starting playback, audioElement:', this.audioPlayer);

      if (!this.audioPlayer) {
        console.error('No audioElement!');
        showToast('No audio loaded. Upload audio first to preview.', true);
        return;
      }

      console.log('Audio src:', this.audioPlayer.src, 'readyState:', this.audioPlayer.readyState);

      // Don't reset to 0 - resume from current position (after skip/rewind)
      // this.audioPlayer.currentTime = 0;
      this.audioPlayer.play().then(() => {
        console.log('Audio started playing successfully');
      }).catch((err) => {
        console.error('Audio play error:', err);
        showToast('Could not play audio: ' + err.message, true);
      });
      if (playBtn) playBtn.textContent = '⏸️ Pause';

      const totalDuration = this.audioDuration || this.getTotalDuration();

      this.expandedPlaybackInterval = setInterval(() => {
        if (!this.audioPlayer) return;

        const currentTime = this.audioPlayer.currentTime;

        // Update playhead
        const playhead = document.getElementById('expanded-timeline-playhead');
        if (playhead) {
          playhead.style.left = `${(currentTime / totalDuration) * 100}%`;
        }

        // Update current time display
        const currentTimeEl = document.getElementById('expanded-current-time');
        if (currentTimeEl) {
          currentTimeEl.textContent = `${this.formatTime(currentTime)} / ${this.formatTime(totalDuration)}`;
        }

        // Find and show current scene
        const currentScene = this.getSceneAtTime(currentTime);
        if (currentScene) {
          const sceneIndex = this.scenes.indexOf(currentScene);
          this.updateExpandedPreview(sceneIndex, currentTime);
        }

        // Update avatar video if available
        this.updateExpandedAvatar(currentTime);

        // Stop at end
        if (currentTime >= totalDuration) {
          clearInterval(this.expandedPlaybackInterval);
          this.expandedPlaybackInterval = null;
          this.audioPlayer.pause();
          if (expandedAvatarVideo) {
            expandedAvatarVideo.pause();
            expandedAvatarVideo.classList.remove('active');
          }
          if (playBtn) playBtn.textContent = '▶️ Play';
        }
      }, 50);
    }
  }

  // Update the scene indicator during preview playback
  updateSceneIndicator(currentTime) {
    if (!this.previewSceneIndicator || this.scenes.length === 0) return;

    // Find which scene is currently playing
    let currentSceneIndex = -1;
    for (let i = 0; i < this.scenes.length; i++) {
      const scene = this.scenes[i];
      const sceneEnd = scene.startTime + scene.duration;
      if (currentTime >= scene.startTime && currentTime < sceneEnd) {
        currentSceneIndex = i;
        break;
      }
    }

    // If no scene found and we're past all scenes, show last scene
    if (currentSceneIndex === -1 && currentTime >= 0) {
      currentSceneIndex = this.scenes.length - 1;
    }

    // Only update if scene changed
    if (currentSceneIndex !== this.currentPreviewSceneIndex) {
      this.currentPreviewSceneIndex = currentSceneIndex;

      if (currentSceneIndex >= 0 && currentSceneIndex < this.scenes.length) {
        const scene = this.scenes[currentSceneIndex];
        const sceneNumber = currentSceneIndex + 1;
        const sceneText = scene.text || scene.caption || '';
        const truncatedText = sceneText.length > 50 ? sceneText.substring(0, 50) + '...' : sceneText;

        if (this.sceneIndicatorNumber) {
          this.sceneIndicatorNumber.textContent = `Scene ${sceneNumber} of ${this.scenes.length}`;
        }
        if (this.sceneIndicatorDesc) {
          this.sceneIndicatorDesc.textContent = truncatedText;
        }
        // Update large scene number badge on image
        if (this.sceneNumberBadge) {
          this.sceneNumberBadge.textContent = sceneNumber;
          this.sceneNumberBadge.style.display = 'block';
        }
        this.previewSceneIndicator.style.display = 'block';
      } else {
        this.previewSceneIndicator.style.display = 'none';
        if (this.sceneNumberBadge) {
          this.sceneNumberBadge.style.display = 'none';
        }
      }
    }
  }

  // Move the current scene earlier in the order (swap with previous scene)
  moveSceneEarlier() {
    if (this.currentPreviewSceneIndex <= 0) {
      showToast('This is already the first scene.');
      return;
    }

    const currentIndex = this.currentPreviewSceneIndex;
    const prevIndex = currentIndex - 1;

    // Swap scenes in the array
    [this.scenes[prevIndex], this.scenes[currentIndex]] = [this.scenes[currentIndex], this.scenes[prevIndex]];

    // Recalculate timings after swap
    this.recalculateSceneTimings();

    // Update the current scene index
    this.currentPreviewSceneIndex = prevIndex;

    // Update UI
    this.renderTimeline();
    this.renderCaptions();
    this.updateSceneIndicator(this.currentTime);

    showToast(`Moved scene ${currentIndex + 1} to position ${prevIndex + 1}`, 'success');
  }

  // Move the current scene later in the order (swap with next scene)
  moveSceneLater() {
    if (this.currentPreviewSceneIndex < 0 || this.currentPreviewSceneIndex >= this.scenes.length - 1) {
      showToast('This is already the last scene.');
      return;
    }

    const currentIndex = this.currentPreviewSceneIndex;
    const nextIndex = currentIndex + 1;

    // Swap scenes in the array
    [this.scenes[currentIndex], this.scenes[nextIndex]] = [this.scenes[nextIndex], this.scenes[currentIndex]];

    // Recalculate timings after swap
    this.recalculateSceneTimings();

    // Update the current scene index
    this.currentPreviewSceneIndex = nextIndex;

    // Update UI
    this.renderTimeline();
    this.renderCaptions();
    this.updateSceneIndicator(this.currentTime);

    showToast(`Moved scene ${currentIndex + 1} to position ${nextIndex + 1}`, 'success');
  }

  // Recalculate scene timings after reordering
  recalculateSceneTimings() {
    let currentStart = 0;
    for (let i = 0; i < this.scenes.length; i++) {
      const scene = this.scenes[i];
      scene.startTime = currentStart;
      currentStart += scene.duration;
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
    // Use max of audio duration and scene end times to ensure all scenes fit
    const sceneEndTime = this.scenes.length > 0
      ? Math.max(...this.scenes.map(s => s.startTime + s.duration))
      : 0;
    const totalDuration = Math.max(this.audioDuration || 0, sceneEndTime, this.getTotalDuration());

    this.timelineScenes.innerHTML = this.scenes.map((scene, index) => {
      const leftPercent = (scene.startTime / totalDuration) * 100;
      const widthPercent = (scene.duration / totalDuration) * 100;
      return `
        <div class="timeline-scene" data-index="${index}"
             style="left: ${leftPercent}%; width: ${widthPercent}%">
          <div class="drag-handle" title="Drag to reposition">⋮⋮</div>
          <img src="${scene.imageUrl}" alt="Scene ${index + 1}"
               title="Drag to move, click to view full size" style="cursor: grab;">
          <span class="scene-number">${index + 1}</span>
          <span class="scene-duration">${scene.duration.toFixed(1)}s</span>
          <div class="resize-handle" title="Drag to resize"></div>
        </div>
      `;
    }).join('');

    this.initTimelineInteractions();
  }

  initTimelineInteractions() {
    const sceneElements = this.timelineScenes.querySelectorAll('.timeline-scene');

    // Clean up any existing time indicator
    const existingIndicator = document.querySelector('.drag-time-indicator');
    if (existingIndicator) existingIndicator.remove();

    // Remove old event listeners
    if (this._timelineCleanup) {
      this._timelineCleanup.forEach(fn => fn());
    }
    this._timelineCleanup = [];

    sceneElements.forEach(sceneEl => {
      const resizeHandle = sceneEl.querySelector('.resize-handle');
      const dragHandle = sceneEl.querySelector('.drag-handle');
      const sceneIndex = parseInt(sceneEl.dataset.index);

      // ===== RESIZE FUNCTIONALITY =====
      let isResizing = false;
      let resizeStartX, resizeStartWidth;

      resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        resizeStartX = e.clientX;
        resizeStartWidth = sceneEl.offsetWidth;
        e.preventDefault();
        e.stopPropagation();
      });

      // ===== DRAG FUNCTIONALITY =====
      let isDragging = false;
      let dragStartX, dragStartLeft;
      let timeIndicator = null;
      let lastScrubTime = 0;

      const startDrag = (e) => {
        isDragging = true;
        dragStartX = e.clientX;
        dragStartLeft = sceneEl.offsetLeft;
        sceneEl.classList.add('dragging');

        // Create time indicator
        timeIndicator = document.createElement('div');
        timeIndicator.className = 'drag-time-indicator';
        document.body.appendChild(timeIndicator);

        // Start audio scrubbing - pause any current playback
        if (this.audioPlayer) {
          this.audioPlayer.pause();
        }

        e.preventDefault();
        e.stopPropagation();
      };

      dragHandle.addEventListener('mousedown', startDrag);

      // Allow dragging from anywhere on the scene INCLUDING the image
      // (hold and drag to move, quick click on image still shows fullscreen)
      let clickStartTime = 0;
      sceneEl.addEventListener('mousedown', (e) => {
        // Ignore if clicking on resize handle or drag handle (they have their own handlers)
        if (e.target === resizeHandle || e.target === dragHandle) {
          return;
        }
        clickStartTime = Date.now();
        startDrag(e);
      });

      // If it was a quick click (not a drag), show fullscreen
      sceneEl.addEventListener('mouseup', (e) => {
        const clickDuration = Date.now() - clickStartTime;
        if (clickDuration < 200 && e.target.tagName === 'IMG' && !isDragging) {
          videoEditor.viewSceneFullscreen(sceneIndex);
        }
      });

      // Shared mousemove handler
      const onMouseMove = (e) => {
        const timelineWidth = this.timelineScenes.offsetWidth;
        const totalDuration = this.audioDuration || this.getTotalDuration();

        if (isResizing) {
          const diff = e.clientX - resizeStartX;
          const newWidth = Math.max(40, resizeStartWidth + diff);
          const newDuration = (newWidth / timelineWidth) * totalDuration;

          this.scenes[sceneIndex].duration = Math.max(0.5, newDuration);
          // Don't recalculate timings - allow non-contiguous scenes
          this.renderTimeline();
          this.updateTotalDuration();
        }

        if (isDragging) {
          const diff = e.clientX - dragStartX;
          const newLeft = Math.max(0, Math.min(timelineWidth - sceneEl.offsetWidth, dragStartLeft + diff));
          const newStartTime = (newLeft / timelineWidth) * totalDuration;

          // Update scene position
          this.scenes[sceneIndex].startTime = Math.max(0, newStartTime);

          // Update visual position directly for smoother dragging
          sceneEl.style.left = `${(newStartTime / totalDuration) * 100}%`;

          // Update time indicator
          if (timeIndicator) {
            timeIndicator.textContent = `${this.formatTime(newStartTime)}`;
            timeIndicator.style.left = `${e.clientX + 10}px`;
            timeIndicator.style.top = `${e.clientY - 30}px`;
          }

          // Audio scrubbing - play audio at current position (throttled)
          const now = Date.now();
          if (this.audioPlayer && now - lastScrubTime > 100) {
            lastScrubTime = now;
            this.audioPlayer.currentTime = newStartTime;
            this.audioPlayer.play().catch(() => {});

            // Stop after a short moment to create scrubbing effect
            setTimeout(() => {
              if (isDragging && this.audioPlayer) {
                this.audioPlayer.pause();
              }
            }, 150);
          }
        }
      };

      // Shared mouseup handler
      const onMouseUp = () => {
        if (isResizing) {
          isResizing = false;
        }

        if (isDragging) {
          isDragging = false;
          sceneEl.classList.remove('dragging');

          // Stop audio scrubbing
          if (this.audioPlayer) {
            this.audioPlayer.pause();
          }

          // Remove time indicator
          if (timeIndicator) {
            timeIndicator.remove();
            timeIndicator = null;
          }

          // Re-render to ensure proper ordering
          this.renderTimeline();
          this.renderCaptions();

          // Save changes
          this.saveScenesToSupabase();
        }
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);

      // Store cleanup functions
      this._timelineCleanup.push(() => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
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
        <div class="caption-scene-wrapper">
          <img src="${scene.imageUrl}" class="caption-scene" alt="Scene ${index + 1}"
               onclick="videoEditor.viewSceneFullscreen(${index})" title="Click to view full size">
          <button class="regenerate-image-btn" onclick="event.stopPropagation(); videoEditor.regenerateSceneImage(${index})" title="Regenerate with AI (removes tarot/crystals)">
            🔁
          </button>
          <button class="replace-image-btn" onclick="event.stopPropagation(); videoEditor.triggerReplaceImage(${index})" title="Upload your own image">
            🔄
          </button>
          <span class="scene-number-label">${index + 1}</span>
        </div>
        <div class="caption-input">
          <textarea
            placeholder="Enter caption for scene ${index + 1}..."
            onchange="videoEditor.updateCaption(${index}, this.value)"
          >${scene.caption || ''}</textarea>
          <div class="caption-timing">
            <span class="caption-time">${this.formatTime(scene.startTime)} - ${this.formatTime(scene.startTime + scene.duration)}</span>
            <div class="duration-controls">
              <button class="duration-btn" onclick="videoEditor.adjustSceneDuration(${index}, -2)" title="Shorten by 2s">-2s</button>
              <input type="number" class="duration-input" value="${scene.duration.toFixed(1)}"
                     onchange="videoEditor.setSceneDuration(${index}, parseFloat(this.value))"
                     min="1" max="60" step="0.5" title="Duration in seconds">
              <button class="duration-btn" onclick="videoEditor.adjustSceneDuration(${index}, 2)" title="Lengthen by 2s">+2s</button>
            </div>
          </div>
        </div>
      </div>
    `).join('');
  }

  // Adjust scene duration by a delta (positive or negative)
  adjustSceneDuration(index, delta) {
    if (!this.scenes[index]) return;

    const newDuration = Math.max(1, this.scenes[index].duration + delta);
    this.setSceneDuration(index, newDuration);
  }

  // Set specific duration for a scene and adjust following scenes
  setSceneDuration(index, duration) {
    if (!this.scenes[index]) return;

    const oldDuration = this.scenes[index].duration;
    const diff = duration - oldDuration;

    this.scenes[index].duration = Math.max(1, duration);

    // Shift all following scenes by the difference
    for (let i = index + 1; i < this.scenes.length; i++) {
      this.scenes[i].startTime += diff;
    }

    // Auto-extend last scene to fill remaining audio (so you never run out of scenes)
    if (this.audioDuration && this.scenes.length > 0) {
      const lastScene = this.scenes[this.scenes.length - 1];
      const lastSceneEnd = lastScene.startTime + lastScene.duration;

      if (lastSceneEnd < this.audioDuration) {
        // Extend last scene to cover remaining audio
        lastScene.duration = this.audioDuration - lastScene.startTime;
      } else if (lastSceneEnd > this.audioDuration && index === this.scenes.length - 1) {
        // If editing last scene made it go past audio, cap it
        lastScene.duration = Math.max(1, this.audioDuration - lastScene.startTime);
      }
    }

    this.renderTimeline();
    this.renderCaptions();
    this.updateTotalDuration();
  }

  updateCaption(index, text) {
    if (this.scenes[index]) {
      this.scenes[index].caption = text;
    }
  }

  // Trigger file picker to replace scene image
  triggerReplaceImage(index) {
    this.replaceImageIndex = index;

    // Create a temporary file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => this.handleReplaceImage(e, index);
    input.click();
  }

  // Handle the image replacement
  async handleReplaceImage(event, index) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Please select an image file.');
      return;
    }

    try {
      // Create object URL for immediate preview
      const imageUrl = URL.createObjectURL(file);

      // Update the scene
      if (this.scenes[index]) {
        // Revoke old object URL if it exists
        if (this.scenes[index].imageUrl && this.scenes[index].imageUrl.startsWith('blob:')) {
          URL.revokeObjectURL(this.scenes[index].imageUrl);
        }

        this.scenes[index].imageUrl = imageUrl;
        this.scenes[index].imageFile = file; // Store file for later upload if needed

        // Re-render timeline and captions
        this.renderTimeline();
        this.renderCaptions();

        showToast(`Scene ${index + 1} image replaced!`, 'success');
      }
    } catch (error) {
      console.error('Error replacing image:', error);
      showToast('Failed to replace image.');
    }
  }

  // Regenerate scene image with AI (applies content filter, uses avatar and style)
  async regenerateSceneImage(index) {
    const scene = this.scenes[index];
    if (!scene) return;

    // Get the scene description to regenerate - prefer visualDescription over text/caption
    // Remove any quoted dialogue or script text that shouldn't be rendered as image text
    let description = scene.visualDescription || '';

    // If no visual description, create a generic one (don't use caption/text as it contains dialogue)
    if (!description) {
      description = `Professional woman in conversation, warm cozy interior setting, scene ${index + 1}`;
    }

    // Strip out any quoted text or dialogue markers
    description = description.replace(/"[^"]*"/g, '').replace(/\[.*?\]/g, '').trim();

    // Get avatar description from global (app.js) or DOM
    const avatarDesc = (typeof avatarDescription !== 'undefined' && avatarDescription)
      ? avatarDescription
      : document.getElementById('avatar-description')?.value?.trim() || '';

    // Get selected style from global (app.js) or default to cinematic-2d
    const style = (typeof selectedStyle !== 'undefined' && selectedStyle)
      ? selectedStyle
      : 'cinematic-2d';

    // Style presets (matching app.js)
    const STYLE_PROMPTS = {
      'photorealistic': 'cinematic film scene, professional movie production, dramatic lighting, shallow depth of field, high quality cinematography',
      'cinematic-2d': 'cinematic 2D animated style, high quality animation, smooth gradients, professional animated movie aesthetic, vibrant colors, clean lines, Disney/Pixar inspired 2D look',
      'hand-drawn': 'hand-drawn pencil sketch style, artistic sketchy lines, crosshatching shading, illustration on paper texture',
      'stickman': 'simple stickman figure style, minimalist black line art on white background, stick figure characters',
      'pixel-art': '8-bit retro pixel art style, pixelated graphics, limited color palette, nostalgic video game aesthetic',
      'soft-cartoon': 'soft pastel cartoon style, rounded friendly shapes, gentle gradients, explainer video aesthetic, warm colors',
      'yellow-character': 'yellow-skinned cartoon character style like Simpsons, bold outlines, flat colors, animated sitcom aesthetic',
      '3d-cinematic': '3D rendered cinematic style, Pixar-quality, volumetric lighting, detailed textures'
    };

    // Build the full prompt with avatar, style, and content filter
    let prompt = description;

    // Add avatar description if available
    if (avatarDesc) {
      prompt = `${prompt}. MAIN CHARACTER: ${avatarDesc}. Feature this character prominently in the scene.`;
    }

    // Add style
    const stylePrompt = STYLE_PROMPTS[style] || STYLE_PROMPTS['cinematic-2d'];
    prompt = `${prompt}. Style: ${stylePrompt}`;

    // Add content filter AND style consistency rules
    prompt = `${prompt}.

CRITICAL STYLE RULES - SOFT PINK GLAM AESTHETIC:
- Warm ambient lamp lighting with golden glow
- Soft pink, lavender, and mauve wall tones
- Cozy evening atmosphere with warm shadows
- Elegant, glamorous but approachable feel
- Rich warm color grading (pink, coral, warm browns)
- Character in white blouse, cream, or soft neutral clothing
- Soft bokeh background, cinematic depth of field
- Luxurious but cozy interior (velvet, warm wood, soft textures)

CONTENT TO AVOID: tarot cards, crystals, occult symbols, astrology imagery, motivational text posters, harsh lighting, cool/blue tones, bright neon colors, busy cluttered backgrounds.

CRITICAL: NO speech bubbles or chat bubbles with text. No dialogue text overlays.`;

    // Show loading state on the button
    const btn = document.querySelector(`.caption-item:nth-child(${index + 1}) .regenerate-image-btn`);
    const originalText = btn?.textContent;
    if (btn) {
      btn.textContent = '⏳';
      btn.disabled = true;
    }

    // Check if we have an avatar image for face swap
    const hasAvatarImage = typeof avatarImageData !== 'undefined' && avatarImageData;

    showToast(`Regenerating scene ${index + 1}...`, 'info');

    try {
      // Step 1: Generate image with text prompt only (like original flow)
      // Use landscape format to match original batch scenes
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt,
          size: '1792x1024',
          quality: 'standard',
          model: 'dall-e-3'
        })
      });
      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      // Handle different response formats
      let imageUrl = data.image || data.imageUrl;
      if (!imageUrl) {
        throw new Error('No image returned from API');
      }

      // Face swap the generated image with avatar (with caching)
      if (hasAvatarImage) {
        showToast(`Face swapping scene ${index + 1}...`, 'info');

        try {
          const sceneBlob = await fetch(imageUrl).then(r => r.blob());
          const avatarBlob = await fetch(avatarImageData).then(r => r.blob());

          // Check cache first
          const sceneHash = await this.generateAudioHash(sceneBlob);
          const avatarHash = await this.generateAudioHash(avatarBlob);
          const cacheKey = `face_swap_${sceneHash}_${avatarHash}`;
          const cached = localStorage.getItem(cacheKey);

          let swapData;
          if (cached) {
            try {
              const cacheData = JSON.parse(cached);
              if (cacheData.timestamp && Date.now() - cacheData.timestamp < 7 * 24 * 60 * 60 * 1000) {
                swapData = cacheData.result;
                console.log(`Scene ${index + 1}: Using CACHED face swap`);
              }
            } catch (e) {}
          }

          if (!swapData) {
            const swapFormData = new FormData();
            swapFormData.append('sourceImage', sceneBlob, 'scene.png');
            swapFormData.append('faceImage', avatarBlob, 'avatar.png');

            const swapResponse = await fetch('/api/face-swap', {
              method: 'POST',
              body: swapFormData
            });

            swapData = await swapResponse.json();

            // Cache successful result
            if (swapData.success && swapData.image) {
              try {
                localStorage.setItem(cacheKey, JSON.stringify({ result: swapData, timestamp: Date.now() }));
              } catch (e) {}
            }
          }

          if (swapData.success && swapData.image) {
            imageUrl = swapData.image;
            console.log(`Scene ${index + 1} face swapped successfully`);
          } else {
            console.warn('Face swap failed, using original generated image:', swapData.error);
          }
        } catch (swapError) {
          console.warn('Face swap error, using original generated image:', swapError);
        }
      }

      // Update the scene with new image
      if (this.scenes[index]) {
        this.scenes[index].imageUrl = imageUrl;
        this.scenes[index].regenerated = true;
        this.scenes[index].faceSwapped = hasAvatarImage;

        // Re-render all views with the new image
        this.renderImportedScenes();
        this.renderTimeline();
        this.renderCaptions();

        // Save to Supabase so it persists on refresh
        this.saveScenesToSupabase();

        showToast(`Scene ${index + 1} regenerated and saved!`, 'success');
      }
    } catch (error) {
      console.error('Error regenerating image:', error);
      showToast(`Failed to regenerate scene ${index + 1}: ${error.message}`);
    } finally {
      // Restore button
      if (btn) {
        btn.textContent = originalText || '🔁';
        btn.disabled = false;
      }
    }
  }

  // Extend a square image to landscape (outpaint sides)
  async extendToLandscape(index) {
    const scene = this.scenes[index];
    if (!scene || !scene.imageUrl) {
      showToast('Scene not found');
      return;
    }

    showToast(`Extending scene ${index + 1} to landscape...`, 'info');

    try {
      // Fetch the current image
      const imgResponse = await fetch(scene.imageUrl);
      const imgBlob = await imgResponse.blob();

      // Create canvas to add transparent sides (1792x1024 from 1024x1024)
      const img = new Image();
      img.crossOrigin = 'anonymous';

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = URL.createObjectURL(imgBlob);
      });

      // Create landscape canvas with image centered
      const canvas = document.createElement('canvas');
      canvas.width = 1792;
      canvas.height = 1024;
      const ctx = canvas.getContext('2d');

      // Scale image to fit height, center horizontally
      const scale = 1024 / img.height;
      const scaledWidth = img.width * scale;
      const offsetX = (1792 - scaledWidth) / 2;

      // Fill with a base color first (will be replaced by AI)
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 1792, 1024);

      // Draw the original image centered
      ctx.drawImage(img, offsetX, 0, scaledWidth, 1024);

      // Create mask (white = keep, black = edit)
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = 1792;
      maskCanvas.height = 1024;
      const maskCtx = maskCanvas.getContext('2d');

      // Black sides (areas to generate)
      maskCtx.fillStyle = '#000';
      maskCtx.fillRect(0, 0, 1792, 1024);

      // White center (area to keep)
      maskCtx.fillStyle = '#fff';
      maskCtx.fillRect(offsetX, 0, scaledWidth, 1024);

      // Convert to blobs
      const imageBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const maskBlob = await new Promise(resolve => maskCanvas.toBlob(resolve, 'image/png'));

      // Get scene description for context
      const description = scene.visualDescription || scene.text || scene.caption || 'Continue the scene naturally';

      // Call edit API
      const formData = new FormData();
      formData.append('image', imageBlob, 'image.png');
      formData.append('mask', maskBlob, 'mask.png');
      formData.append('prompt', `Extend this scene seamlessly to the sides. ${description}. Match the existing style, lighting, and atmosphere perfectly. Soft pink glam aesthetic with warm lighting.`);

      const response = await fetch('/api/edit', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      // Update scene with extended image
      const newImageUrl = data.image || data.imageUrl;
      if (newImageUrl) {
        this.scenes[index].imageUrl = newImageUrl;
        this.renderImportedScenes();
        this.renderTimeline();
        this.renderCaptions();
        this.saveScenesToSupabase();
        showToast(`Scene ${index + 1} extended to landscape!`, 'success');
      }

    } catch (error) {
      console.error('Extend to landscape error:', error);
      showToast(`Failed to extend: ${error.message}`);
    }
  }

  // View scene image in fullscreen modal
  viewSceneFullscreen(index) {
    const scene = this.scenes[index];
    if (!scene || !scene.imageUrl) return;

    // Create fullscreen overlay
    const overlay = document.createElement('div');
    overlay.className = 'scene-fullscreen-overlay';
    overlay.innerHTML = `
      <div class="scene-fullscreen-content">
        <button class="scene-fullscreen-close" title="Close">&times;</button>
        <img src="${scene.imageUrl}" alt="Scene ${index + 1}">
        <div class="scene-fullscreen-info">
          <span class="scene-fullscreen-number">Scene ${index + 1}</span>
          <span class="scene-fullscreen-duration">${scene.duration.toFixed(1)}s</span>
          ${scene.caption ? `<p class="scene-fullscreen-caption">${scene.caption}</p>` : ''}
        </div>
        <div class="scene-fullscreen-nav">
          ${index > 0 ? `<button class="btn secondary scene-nav-prev" title="Previous">← Previous</button>` : '<span></span>'}
          ${index < this.scenes.length - 1 ? `<button class="btn secondary scene-nav-next" title="Next">Next →</button>` : '<span></span>'}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Close button
    overlay.querySelector('.scene-fullscreen-close').addEventListener('click', () => {
      overlay.remove();
    });

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });

    // Navigation
    const prevBtn = overlay.querySelector('.scene-nav-prev');
    const nextBtn = overlay.querySelector('.scene-nav-next');

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        overlay.remove();
        this.viewSceneFullscreen(index - 1);
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        overlay.remove();
        this.viewSceneFullscreen(index + 1);
      });
    }

    // Keyboard navigation
    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', handleKeydown);
      } else if (e.key === 'ArrowLeft' && index > 0) {
        overlay.remove();
        document.removeEventListener('keydown', handleKeydown);
        this.viewSceneFullscreen(index - 1);
      } else if (e.key === 'ArrowRight' && index < this.scenes.length - 1) {
        overlay.remove();
        document.removeEventListener('keydown', handleKeydown);
        this.viewSceneFullscreen(index + 1);
      }
    };
    document.addEventListener('keydown', handleKeydown);
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
        // No overlapping segment - find the closest one within 3 seconds
        const closestSegment = segments.reduce((closest, seg) => {
          const segMidpoint = (seg.start + seg.end) / 2;
          const sceneMidpoint = (sceneStart + sceneEnd) / 2;
          const distance = Math.abs(segMidpoint - sceneMidpoint);

          // Only consider segments within 3 seconds
          if (distance > 3) return closest;

          if (!closest || distance < closest.distance) {
            return { segment: seg, distance };
          }
          return closest;
        }, null);

        if (closestSegment) {
          scene.caption = closestSegment.segment.text.trim();
        } else {
          // No nearby segment - use scene text as fallback
          scene.caption = scene.text || '';
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
    // Avatar Only mode doesn't require scenes
    if (!this.avatarOnlyMode && this.scenes.length === 0) {
      showToast('Add scenes first to preview.');
      return;
    }

    // Sync uploaded avatar segments to avatarVideos array for preview
    this.syncUploadedAvatarSegments();

    this.previewModal.hidden = false;
    this.playbackTime = 0;

    // Reset segment switching state for clean start
    this.segmentSwitching = false;
    this.videoSyncReady = false;
    this.currentAvatarSegmentUrl = null;
    this.currentNativeScene = null;

    // Reset scrubber
    if (this.previewScrubber) {
      this.previewScrubber.value = 0;
    }

    // Reset scene indicator
    this.currentPreviewSceneIndex = -1;
    this.updateSceneIndicator(0);

    // Avatar Only Mode - use native video for smooth playback
    if (this.avatarOnlyMode && this.avatarVideos && this.avatarVideos.length > 0) {
      // Hide canvas and layered, show native video
      if (this.previewCanvas) this.previewCanvas.hidden = true;
      if (this.previewNativeLayered) this.previewNativeLayered.hidden = true;
      if (this.previewNativeVideo) {
        this.previewNativeVideo.hidden = false;
        // Use first avatar video segment
        this.previewNativeVideo.src = this.avatarVideos[0].videoUrl;
        this.previewNativeVideo.load();
      }
      // Hide scene indicator, badge, and reorder controls in Avatar Only mode
      if (this.previewSceneIndicator) this.previewSceneIndicator.style.display = 'none';
      if (this.sceneNumberBadge) this.sceneNumberBadge.style.display = 'none';
      if (this.previewMoveEarlierBtn) this.previewMoveEarlierBtn.style.display = 'none';
      if (this.previewMoveLaterBtn) this.previewMoveLaterBtn.style.display = 'none';
      console.log('Avatar Only Mode - using native video playback');
      return;
    }

    // Avatar + Scenes Mode with native preview (smooth playback)
    if (this.useNativePreview && this.avatarEnabled && this.avatarVideos && this.avatarVideos.length > 0) {
      // Hide canvas and native video, show layered preview
      if (this.previewCanvas) this.previewCanvas.hidden = true;
      if (this.previewNativeVideo) this.previewNativeVideo.hidden = true;
      if (this.previewNativeLayered) this.previewNativeLayered.hidden = false;

      // Set up avatar video element
      this.previewAvatarVideo.src = this.avatarVideos[0].videoUrl;
      this.previewAvatarVideo.load();

      // Apply avatar styling (position, size, shape)
      this.updateNativeAvatarStyle();

      // Show first scene
      if (this.scenes.length > 0 && this.scenes[0].imageUrl) {
        this.previewSceneImg.src = this.scenes[0].imageUrl;
      }

      // Show scene indicator and reorder controls
      if (this.previewSceneIndicator) this.previewSceneIndicator.style.display = 'block';
      if (this.previewMoveEarlierBtn) this.previewMoveEarlierBtn.style.display = '';
      if (this.previewMoveLaterBtn) this.previewMoveLaterBtn.style.display = '';

      console.log('Avatar + Scenes - using native layered playback');
      return;
    }

    // Fallback: Canvas mode (no avatar or native preview disabled)
    if (this.previewCanvas) this.previewCanvas.hidden = false;
    if (this.previewNativeVideo) this.previewNativeVideo.hidden = true;
    if (this.previewNativeLayered) this.previewNativeLayered.hidden = true;

    // Show scene indicator and reorder controls for canvas mode
    if (this.previewSceneIndicator) this.previewSceneIndicator.style.display = 'block';
    if (this.previewMoveEarlierBtn) this.previewMoveEarlierBtn.style.display = '';
    if (this.previewMoveLaterBtn) this.previewMoveLaterBtn.style.display = '';

    this.setupPreviewCanvas();

    // Preload all avatar videos before playback
    if (this.avatarEnabled && this.avatarVideos && this.avatarVideos.length > 0) {
      this.preloadAvatarVideos().then(() => {
        console.log('Avatar videos preloaded');
        this.updatePreviewFrame();
      });
    } else {
      this.updatePreviewFrame();
    }
  }

  // Update native avatar video element styling based on settings
  updateNativeAvatarStyle() {
    if (!this.previewAvatarVideo) return;

    // Reset classes
    this.previewAvatarVideo.className = 'preview-avatar-video';

    // Shape
    this.previewAvatarVideo.classList.add(this.avatarShape === 'circle' ? 'circle' : 'rectangle');

    // Position
    const posMap = {
      'bottom-right': 'pos-bottom-right',
      'bottom-left': 'pos-bottom-left',
      'top-right': 'pos-top-right',
      'top-left': 'pos-top-left',
      'center': 'pos-center'
    };
    this.previewAvatarVideo.classList.add(posMap[this.avatarPosition] || 'pos-bottom-right');

    // Size
    const sizeMap = {
      'small': 'size-small',
      'medium': 'size-medium',
      'large': 'size-large'
    };
    this.previewAvatarVideo.classList.add(sizeMap[this.avatarSize] || 'size-medium');
  }

  // Preload all avatar videos for smooth playback
  async preloadAvatarVideos() {
    if (!this.previewAvatarVideos) {
      this.previewAvatarVideos = {};
    }

    const loadPromises = this.avatarVideos.map(async (av) => {
      if (!av.videoUrl) return;

      // Skip if already loaded
      if (this.previewAvatarVideos[av.videoUrl]) return;

      const videoEl = document.createElement('video');
      videoEl.crossOrigin = 'anonymous';
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.preload = 'auto';
      videoEl.src = av.videoUrl;

      // Store immediately so we don't double-load
      this.previewAvatarVideos[av.videoUrl] = videoEl;

      // Wait for video to be fully buffered
      await new Promise((resolve) => {
        videoEl.oncanplaythrough = resolve;
        videoEl.onloadeddata = () => {
          if (videoEl.readyState >= 3) resolve();
        };
        videoEl.onerror = resolve;
        setTimeout(resolve, 5000); // Timeout fallback
        videoEl.load();
      });

      console.log(`Preloaded avatar video: ${av.videoUrl}, duration: ${videoEl.duration}s`);
    });

    await Promise.all(loadPromises);
  }

  // Sync uploaded avatar segments from window.uploadedAvatarSegments to this.avatarVideos
  syncUploadedAvatarSegments() {
    const uploadedSegments = window.uploadedAvatarSegments || {};
    const segmentKeys = Object.keys(uploadedSegments).map(Number).sort((a, b) => a - b);

    if (segmentKeys.length === 0) return;

    // Each segment is 90 seconds (the length used during avatar generation)
    const SEGMENT_LENGTH = 90;
    // Use audio duration, or calculate from scenes, or default to segment count * 90
    const totalDuration = this.audioDuration || this.getTotalDuration() || (segmentKeys.length * SEGMENT_LENGTH);

    // Build avatarVideos array from uploaded segments
    // Segments are 1-indexed, so segment 1 = 0-90s, segment 2 = 90-180s, etc.
    this.avatarVideos = [];
    segmentKeys.forEach((segNum) => {
      const seg = uploadedSegments[segNum];
      if (seg && seg.url) {
        const segmentIndex = segNum - 1; // Convert to 0-indexed
        const startTime = segmentIndex * SEGMENT_LENGTH;
        const endTime = Math.min((segmentIndex + 1) * SEGMENT_LENGTH, totalDuration);

        this.avatarVideos.push({
          videoUrl: seg.url,
          startTime: startTime,
          endTime: endTime,
          segmentIndex: segNum
        });

        console.log(`Avatar segment ${segNum}: ${startTime}s - ${endTime}s`);
      }
    });

    console.log(`Synced ${this.avatarVideos.length} avatar segments for preview`);
  }

  closePreview() {
    this.previewModal.hidden = true;
    this.stopPlayback();

    // Stop native video if playing
    if (this.previewNativeVideo) {
      this.previewNativeVideo.pause();
      this.previewNativeVideo.hidden = true;
    }

    // Stop native layered preview
    if (this.previewNativeLayered) {
      this.previewNativeLayered.hidden = true;
      if (this.previewAvatarVideo) {
        this.previewAvatarVideo.pause();
      }
    }

    // Reset to canvas as default
    if (this.previewCanvas) {
      this.previewCanvas.hidden = false;
    }

    // Reset scene tracking
    this.currentNativeScene = null;
  }

  // Seek to position via scrubber
  seekPreview(percent) {
    const totalDuration = this.getTotalDuration();
    this.playbackTime = (percent / 100) * totalDuration;

    // Avatar Only mode - seek native video
    if (this.avatarOnlyMode && this.previewNativeVideo && !this.previewNativeVideo.hidden) {
      this.previewNativeVideo.currentTime = this.playbackTime;
    }
    // Native Layered mode - seek avatar video and audio
    else if (this.previewNativeLayered && !this.previewNativeLayered.hidden) {
      if (this.previewAvatarVideo) {
        this.previewAvatarVideo.currentTime = this.playbackTime;
      }
      if (this.audioPlayer && this.audioPlayer.duration) {
        this.audioPlayer.currentTime = this.playbackTime;
      }
      // Update scene image immediately
      const currentScene = this.getSceneAtTime(this.playbackTime);
      if (currentScene && this.previewSceneImg && currentScene.imageUrl) {
        this.previewSceneImg.src = currentScene.imageUrl;
        this.currentNativeScene = currentScene.id;
      }
    }
    // Canvas mode - seek audio and update frame
    else {
      if (this.audioPlayer && this.audioPlayer.duration) {
        this.audioPlayer.currentTime = this.playbackTime;
      }
      this.updatePreviewFrame();
    }

    this.updateTimeDisplay();
  }

  // Skip forward or back by given seconds (like YouTube)
  skipTime(seconds) {
    const totalDuration = this.getTotalDuration();
    const newTime = Math.max(0, Math.min(totalDuration, this.playbackTime + seconds));
    const percent = (newTime / totalDuration) * 100;
    this.seekPreview(percent);
    this.updateSceneIndicator(newTime);
    console.log(`Skipped ${seconds > 0 ? 'forward' : 'back'} to ${this.formatTime(newTime)}`);
  }

  // Update scrubber position
  updateScrubberPosition() {
    if (!this.previewScrubber || this.scrubbing) return;
    const totalDuration = this.getTotalDuration();
    const percent = (this.playbackTime / totalDuration) * 100;
    this.previewScrubber.value = percent;
  }

  // Update time display
  updateTimeDisplay() {
    const totalDuration = this.getTotalDuration();
    if (this.previewTime) {
      this.previewTime.textContent = `${this.formatTime(this.playbackTime)} / ${this.formatTime(totalDuration)}`;
    }
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

    // Avatar Only Mode - play native video directly
    if (this.avatarOnlyMode && this.previewNativeVideo && !this.previewNativeVideo.hidden) {
      this.previewNativeVideo.currentTime = this.playbackTime;
      this.previewNativeVideo.play().catch(e => console.log('Native video play error:', e));
      return; // Don't use animation frame for native video
    }

    // Native Layered Mode (Avatar + Scenes) - smooth native video with scene switching
    if (this.previewNativeLayered && !this.previewNativeLayered.hidden) {
      // Reset to first segment if starting from beginning
      if (this.playbackTime < 1 && this.avatarVideos && this.avatarVideos.length > 0) {
        const firstSegment = this.avatarVideos[0];
        if (firstSegment && firstSegment.videoUrl) {
          this.currentAvatarSegmentUrl = firstSegment.videoUrl;
          this.previewAvatarVideo.src = firstSegment.videoUrl;
          this.previewAvatarVideo.load();
        }
      }

      // Start avatar video from correct position
      if (this.previewAvatarVideo) {
        this.previewAvatarVideo.currentTime = this.playbackTime;
        this.previewAvatarVideo.play().catch(e => console.log('Avatar video play error:', e));
      }

      // Start voiceover audio - but MUTE it if avatar videos have their own audio
      if (this.audioBlob) {
        // Check if we have uploaded avatar segments (they have audio baked in)
        const hasAvatarSegments = this.avatarVideos && this.avatarVideos.some(v => v && v.url);

        if (hasAvatarSegments) {
          // Avatar videos have their own audio - don't play separate voiceover
          console.log('Avatar segments have audio - muting separate voiceover');
          this.audioPlayer.pause();
        } else {
          // No avatar segments - play voiceover normally
          const hasReplacements = Object.keys(this.replacedAudioSegments || {}).length > 0;

          if (hasReplacements && !this.stitchedAudioBlob) {
            this.stitchAudioForExport().then(blob => {
              if (blob && blob !== this.audioBlob) {
                this.stitchedAudioBlob = blob;
                console.log('Stitched audio ready for preview');
              }
            });
          }

          const audioToPlay = this.stitchedAudioBlob || this.audioBlob;

          if (!this.audioPlayer.src || this.audioPlayer.src === '' || this.audioPlayer.error) {
            const url = URL.createObjectURL(audioToPlay);
            this.audioPlayer.src = url;
            this.currentAudioUrl = url;
          }
          this.audioPlayer.currentTime = this.playbackTime;
          this.audioPlayer.play().catch(e => console.log('Voiceover play error:', e));
        }
      }

      // Start background music
      if (this.bgMusicBlob && this.bgMusicPlayer) {
        this.bgMusicPlayer.currentTime = this.playbackTime % (this.bgMusicPlayer.duration || 1);
        this.bgMusicPlayer.volume = this.bgMusicVolume;
        this.bgMusicPlayer.play().catch(e => console.log('Background music play error:', e));
      }

      // Start lightweight animation loop for scene/caption switching
      this.animateNativeLayered();
      return;
    }

    // Canvas mode fallback
    // In canvas mode, ALWAYS play voiceover (canvas can't play video audio)
    // The avatar videos were generated from the voiceover, so audio matches
    if (this.audioBlob) {
      console.log('Canvas mode: playing voiceover audio');
      {
        const audioToPlay = this.stitchedAudioBlob || this.audioBlob;

        if (!this.audioPlayer.src || this.audioPlayer.src === '' || this.audioPlayer.error) {
          const url = URL.createObjectURL(audioToPlay);
          this.audioPlayer.src = url;
          this.currentAudioUrl = url;
        }
        this.audioPlayer.currentTime = this.playbackTime;
        this.audioPlayer.play().catch(e => {
          console.log('Voiceover play error:', e);
          if (audioToPlay) {
            const url = URL.createObjectURL(audioToPlay);
            this.audioPlayer.src = url;
            this.audioPlayer.load();
          }
        });
      }
    }

    // Play background music
    if (this.bgMusicBlob && this.bgMusicPlayer) {
      this.bgMusicPlayer.currentTime = this.playbackTime % (this.bgMusicPlayer.duration || 1);
      this.bgMusicPlayer.volume = this.bgMusicVolume;
      this.bgMusicPlayer.play().catch(e => console.log('Background music play error:', e));
    }

    this.animate();
  }

  // Lightweight animation loop for native layered preview
  // Updates scene images, captions, AND switches avatar videos
  animateNativeLayered() {
    if (!this.isPlaying) return;

    // Find which segment should be playing based on time
    const currentSegment = this.avatarVideos?.find(av =>
      this.playbackTime >= av.startTime && this.playbackTime < av.endTime
    );

    // Handle segment switching (with debounce to prevent rapid switching)
    if (currentSegment && currentSegment.videoUrl !== this.currentAvatarSegmentUrl && !this.segmentSwitching) {
      this.segmentSwitching = true;
      this.videoSyncReady = false; // Don't sync until video is properly positioned
      console.log(`Switching to avatar segment: ${currentSegment.startTime}s - ${currentSegment.endTime}s`);
      this.currentAvatarSegmentUrl = currentSegment.videoUrl;
      this.activeSegment = currentSegment; // Store for reference

      // Store segment reference for the callback
      const targetSegment = currentSegment;
      const targetTime = this.playbackTime;

      // Clear any existing handlers
      this.previewAvatarVideo.oncanplay = null;
      this.previewAvatarVideo.onerror = null;
      this.previewAvatarVideo.onplaying = null;

      this.previewAvatarVideo.src = currentSegment.videoUrl;

      // Wait for video to be ready before playing
      this.previewAvatarVideo.oncanplay = () => {
        this.previewAvatarVideo.oncanplay = null; // Clear to prevent multiple fires
        const localTime = targetTime - targetSegment.startTime;
        const seekTime = Math.max(0, Math.min(localTime, this.previewAvatarVideo.duration - 0.1));
        this.previewAvatarVideo.currentTime = seekTime;
        this.previewAvatarVideo.play().then(() => {
          this.segmentSwitching = false;
          this.videoSyncReady = true; // NOW we can sync from video
          console.log(`Segment playing from ${seekTime.toFixed(1)}s`);
        }).catch(e => {
          console.log('Segment play error:', e);
          this.segmentSwitching = false;
          this.videoSyncReady = true; // Allow sync even if play failed
        });
      };

      // Handle errors - don't get stuck
      this.previewAvatarVideo.onerror = () => {
        console.log('Segment load error, resetting');
        this.segmentSwitching = false;
        this.currentAvatarSegmentUrl = null; // Allow retry
      };

      this.previewAvatarVideo.load();

      // Timeout fallback - don't get stuck if oncanplay never fires
      setTimeout(() => {
        if (this.segmentSwitching) {
          console.log('Segment switch timeout, forcing play');
          this.segmentSwitching = false;
          this.videoSyncReady = true;
          // Try to play anyway
          this.previewAvatarVideo.play().catch(() => {});
        }
      }, 3000);
    }

    // If avatar video paused unexpectedly, restart it
    if (currentSegment && this.videoSyncReady && !this.segmentSwitching && this.previewAvatarVideo.paused && this.isPlaying) {
      console.log('Avatar video paused, restarting...');
      this.previewAvatarVideo.play().catch(e => console.log('Restart error:', e));
    }

    // Sync playback time with avatar video (it has the audio)
    // ONLY sync when video is properly positioned (videoSyncReady) to avoid jumping to wrong scene
    if (this.previewAvatarVideo && !this.previewAvatarVideo.paused && currentSegment && !this.segmentSwitching && this.videoSyncReady) {
      const localVideoTime = this.previewAvatarVideo.currentTime;
      this.playbackTime = currentSegment.startTime + localVideoTime;
      this.lastFrameTime = performance.now(); // Keep lastFrameTime fresh
    } else if (this.segmentSwitching || !this.videoSyncReady) {
      // During segment switch, progress time manually so scenes still update
      const now = performance.now();
      if (this.lastFrameTime) {
        const delta = (now - this.lastFrameTime) / 1000;
        this.playbackTime += delta;
      }
      this.lastFrameTime = now;
    }

    const totalDuration = this.getTotalDuration();

    // Loop at end
    if (this.playbackTime >= totalDuration) {
      this.playbackTime = 0;
      if (this.audioPlayer) this.audioPlayer.currentTime = 0;
      if (this.previewAvatarVideo) this.previewAvatarVideo.currentTime = 0;
    }

    // Update scene image
    const currentScene = this.getSceneAtTime(this.playbackTime);
    if (currentScene && this.previewSceneImg && this.currentNativeScene !== currentScene.id) {
      this.currentNativeScene = currentScene.id;
      if (currentScene.imageUrl) {
        this.previewSceneImg.src = currentScene.imageUrl;
      }
    }

    // Update caption
    if (this.previewCaptionOverlay && currentScene) {
      const caption = currentScene.caption || '';
      if (caption && this.captionsEnabled) {
        this.previewCaptionOverlay.textContent = caption;
        this.previewCaptionOverlay.classList.add('visible');
      } else {
        this.previewCaptionOverlay.classList.remove('visible');
      }
    }

    // Update scene indicator overlay
    this.updateSceneIndicator(this.playbackTime);

    // Update scrubber and time display
    this.updateScrubberPosition();
    this.updateTimeDisplay();

    // Continue loop
    this.animationFrame = requestAnimationFrame(() => this.animateNativeLayered());
  }

  stopPlayback() {
    this.isPlaying = false;
    this.previewPlayPauseBtn.textContent = '▶️ Play';

    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }

    // Stop native video if Avatar Only mode
    if (this.previewNativeVideo && !this.previewNativeVideo.hidden) {
      this.previewNativeVideo.pause();
    }

    // Stop native layered avatar video
    if (this.previewAvatarVideo && !this.previewNativeLayered?.hidden) {
      this.previewAvatarVideo.pause();
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

    // SYNC with audio player if audio is playing - this is the source of truth
    // This prevents avatar and scenes from drifting out of sync with voiceover
    if (this.audioPlayer && !this.audioPlayer.paused && this.audioPlayer.duration > 0) {
      // Use audio time as the master clock
      this.playbackTime = this.audioPlayer.currentTime;
    } else {
      // No audio or audio paused - use delta time
      this.playbackTime += delta;
    }

    const totalDuration = this.getTotalDuration();
    if (this.playbackTime >= totalDuration) {
      this.playbackTime = 0;
      if (this.audioPlayer) {
        this.audioPlayer.currentTime = 0;
      }
    }

    this.updatePreviewFrame();
    this.updatePlayhead();
    this.updateScrubberPosition();
    this.updateTimeDisplay();
    this.updateSceneIndicator(this.playbackTime);

    this.animationFrame = requestAnimationFrame(() => this.animate());
  }

  updatePreviewFrame() {
    const currentScene = this.getSceneAtTime(this.playbackTime);

    // Avatar Only Mode - no scene images needed
    if (this.avatarOnlyMode) {
      // Draw background
      this.drawAvatarOnlyBackground(this.ctx, this.previewCanvas.width, this.previewCanvas.height);

      // Draw avatar (large/centered)
      if (this.avatarEnabled && this.avatarVideos && this.avatarVideos.length > 0) {
        this.drawAvatarOnPreviewFullscreen();
      }

      // Draw caption if scene exists
      if (currentScene) {
        this.drawCaption(currentScene);
      }
      return;
    }

    // Normal mode - scene images with avatar overlay
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

  // Draw avatar fullscreen for avatar-only mode
  async drawAvatarOnPreviewFullscreen() {
    const avatarVideo = this.avatarVideos.find(av =>
      this.playbackTime >= av.startTime && this.playbackTime < av.endTime
    );

    if (!avatarVideo || !avatarVideo.videoUrl) return;

    if (!this.previewAvatarVideos) {
      this.previewAvatarVideos = {};
    }

    let videoEl = this.previewAvatarVideos[avatarVideo.videoUrl];
    if (!videoEl) {
      videoEl = document.createElement('video');
      videoEl.crossOrigin = 'anonymous';
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.preload = 'auto';
      videoEl.src = avatarVideo.videoUrl;
      videoEl.load();
      this.previewAvatarVideos[avatarVideo.videoUrl] = videoEl;

      await new Promise(resolve => {
        videoEl.oncanplaythrough = resolve;
        videoEl.onloadeddata = () => { if (videoEl.readyState >= 3) resolve(); };
        videoEl.onerror = resolve;
        setTimeout(resolve, 3000);
      });
    }

    // Sync video time
    if (this.currentAvatarSegment !== avatarVideo.videoUrl) {
      if (this.currentAvatarSegment && this.previewAvatarVideos[this.currentAvatarSegment]) {
        this.previewAvatarVideos[this.currentAvatarSegment].pause();
      }
      this.currentAvatarSegment = avatarVideo.videoUrl;
      const localTime = this.playbackTime - avatarVideo.startTime;
      videoEl.currentTime = Math.max(0, Math.min(localTime, videoEl.duration - 0.1));
      if (this.isPlaying) {
        videoEl.play().catch(() => {});
      }
    }

    if (this.isPlaying) {
      if (videoEl.paused) {
        videoEl.play().catch(() => {});
      }
      // Only resync if drift is significant (0.5s) to avoid jumpy playback
      // Let the video play naturally most of the time
      const localTime = this.playbackTime - avatarVideo.startTime;
      if (Math.abs(videoEl.currentTime - localTime) > 0.5) {
        videoEl.currentTime = Math.max(0, Math.min(localTime, videoEl.duration - 0.1));
      }
    } else {
      videoEl.pause();
      const localTime = this.playbackTime - avatarVideo.startTime;
      if (Math.abs(videoEl.currentTime - localTime) > 0.1) {
        videoEl.currentTime = Math.max(0, Math.min(localTime, videoEl.duration - 0.1));
      }
    }

    // Get rect for avatar-only mode - preserve original aspect ratio
    const videoAspect = videoEl.videoWidth / videoEl.videoHeight;
    const canvasAspect = this.previewCanvas.width / this.previewCanvas.height;

    let drawWidth, drawHeight, drawX, drawY;

    if (this.avatarOnlyBackgroundType === 'original') {
      // Preserve original aspect ratio - fit video without stretching
      if (videoAspect > canvasAspect) {
        // Video is wider than canvas - fit to width
        drawWidth = this.previewCanvas.width;
        drawHeight = drawWidth / videoAspect;
        drawX = 0;
        drawY = (this.previewCanvas.height - drawHeight) / 2;
      } else {
        // Video is taller than canvas - fit to height
        drawHeight = this.previewCanvas.height;
        drawWidth = drawHeight * videoAspect;
        drawX = (this.previewCanvas.width - drawWidth) / 2;
        drawY = 0;
      }
    } else {
      // Custom background - use size selector
      const rect = this.getAvatarOnlyRect(this.previewCanvas.width, this.previewCanvas.height);
      drawX = rect.x;
      drawY = rect.y;
      drawWidth = rect.width;
      drawHeight = rect.height;
    }

    // Draw avatar
    this.ctx.drawImage(videoEl, drawX, drawY, drawWidth, drawHeight);
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
      videoEl.playsInline = true;
      videoEl.preload = 'auto';
      videoEl.src = avatarVideo.videoUrl;
      videoEl.load();
      this.previewAvatarVideos[avatarVideo.videoUrl] = videoEl;

      // Wait for video to be ready to play
      await new Promise(resolve => {
        videoEl.oncanplaythrough = resolve;
        videoEl.onloadeddata = () => {
          if (videoEl.readyState >= 3) resolve();
        };
        videoEl.onerror = resolve;
        // Timeout fallback
        setTimeout(resolve, 3000);
      });
    }

    // Check if we switched to a different segment
    if (this.currentAvatarSegment !== avatarVideo.videoUrl) {
      // Pause previous segment
      if (this.currentAvatarSegment && this.previewAvatarVideos[this.currentAvatarSegment]) {
        this.previewAvatarVideos[this.currentAvatarSegment].pause();
      }
      // Start playing new segment
      this.currentAvatarSegment = avatarVideo.videoUrl;
      const localTime = this.playbackTime - avatarVideo.startTime;
      videoEl.currentTime = Math.max(0, Math.min(localTime, videoEl.duration - 0.1));
      if (this.isPlaying) {
        videoEl.play().catch(() => {});
      }
    }

    // If playing, make sure video is playing and synced
    if (this.isPlaying) {
      if (videoEl.paused) {
        videoEl.play().catch(() => {});
      }

      const localTime = this.playbackTime - avatarVideo.startTime;
      const drift = videoEl.currentTime - localTime;

      // Use playback rate adjustment for smooth sync instead of hard seeking
      // This prevents visible jumps when resyncing
      if (Math.abs(drift) > 0.5) {
        // Large drift - hard seek is necessary
        videoEl.currentTime = Math.max(0, Math.min(localTime, videoEl.duration - 0.1));
        videoEl.playbackRate = 1.0;
      } else if (Math.abs(drift) > 0.05) {
        // Small drift - adjust playback rate to catch up smoothly
        // If video is ahead (positive drift), slow down; if behind, speed up
        videoEl.playbackRate = drift > 0 ? 0.95 : 1.05;
      } else {
        // In sync - normal playback rate
        videoEl.playbackRate = 1.0;
      }
    } else {
      // Paused - seek to exact frame and reset playback rate
      videoEl.pause();
      videoEl.playbackRate = 1.0;
      const localTime = this.playbackTime - avatarVideo.startTime;
      if (Math.abs(videoEl.currentTime - localTime) > 0.05) {
        videoEl.currentTime = Math.max(0, Math.min(localTime, videoEl.duration - 0.1));
      }
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
    if (!this.scenes || this.scenes.length === 0) return null;

    // Sort scenes by startTime for proper lookup
    const sortedScenes = [...this.scenes].sort((a, b) => a.startTime - b.startTime);

    // If time is before first scene, return first scene
    if (time < sortedScenes[0].startTime) {
      return sortedScenes[0];
    }

    // Find scene that contains this time (with small epsilon for floating point)
    const epsilon = 0.001;
    for (const scene of sortedScenes) {
      if (time >= scene.startTime - epsilon && time < scene.startTime + scene.duration + epsilon) {
        return scene;
      }
    }

    // If time is past all scenes, find the scene whose time range is closest
    // This prevents jumping to scene 46 when there are gaps
    let closestScene = sortedScenes[0];
    let closestDistance = Math.abs(time - sortedScenes[0].startTime);

    for (const scene of sortedScenes) {
      const sceneEnd = scene.startTime + scene.duration;
      // Check distance to start and end of scene
      const distToStart = Math.abs(time - scene.startTime);
      const distToEnd = Math.abs(time - sceneEnd);
      const minDist = Math.min(distToStart, distToEnd);

      if (minDist < closestDistance) {
        closestDistance = minDist;
        closestScene = scene;
      }
    }

    return closestScene;
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

  // Export using MediaRecorder (works in all browsers without FFmpeg)
  async exportWithMediaRecorder() {
    this.exportProgress.hidden = false;
    this.exportVideoBtn.disabled = true;
    this.exportStatus.textContent = 'Preparing MediaRecorder export...';

    try {
      const [width, height] = this.exportResolution.value.split('x').map(Number);
      const fps = parseInt(this.exportFps.value) || 30;
      const totalDuration = this.getTotalDuration();

      // Create export canvas
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = width;
      exportCanvas.height = height;
      const ctx = exportCanvas.getContext('2d');

      // Sync uploaded avatar segments
      this.syncUploadedAvatarSegments();

      // Load avatar video elements
      this.exportStatus.textContent = 'Loading avatar videos...';
      const avatarVideoElements = [];
      if (this.avatarEnabled && this.avatarVideos && this.avatarVideos.length > 0) {
        for (const av of this.avatarVideos) {
          if (av.videoUrl) {
            try {
              const videoEl = await this.loadVideoElement(av.videoUrl);
              videoEl.muted = true; // Mute avatar video (we use main audio)
              videoEl.loop = false;
              avatarVideoElements.push({ element: videoEl, ...av });
            } catch (e) {
              console.error('Failed to load avatar video:', e);
              avatarVideoElements.push(null);
            }
          }
        }
      }

      // Preload scene images
      this.exportStatus.textContent = 'Loading scene images...';
      const sceneImages = await Promise.all(this.scenes.map(scene => {
        return new Promise(resolve => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = scene.imageUrl;
        });
      }));

      // Create audio element with stitched audio (using replaced segments)
      let audioElement = null;
      let audioContext = null;
      if (this.audioBlob) {
        this.exportStatus.textContent = 'Preparing audio (stitching segments)...';
        const audioToUse = await this.stitchAudioForExport();
        audioElement = new Audio(URL.createObjectURL(audioToUse));
        audioElement.muted = false;
        audioElement.preload = 'auto';
        // Wait for audio to be ready
        await new Promise(resolve => {
          audioElement.oncanplaythrough = resolve;
          audioElement.load();
        });
      }

      // Set up MediaRecorder
      const stream = exportCanvas.captureStream(fps);

      // Add audio track if available
      if (audioElement) {
        try {
          audioContext = new AudioContext();
          const source = audioContext.createMediaElementSource(audioElement);
          const destination = audioContext.createMediaStreamDestination();
          source.connect(destination);
          // Don't connect to speakers to avoid echo
          destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
        } catch (e) {
          console.log('Audio track not added:', e);
        }
      }

      // Determine best codec
      const mimeTypes = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4'
      ];
      let selectedMimeType = mimeTypes.find(mt => MediaRecorder.isTypeSupported(mt)) || 'video/webm';
      console.log('Using MediaRecorder with:', selectedMimeType);

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: selectedMimeType,
        videoBitsPerSecond: 8000000, // 8 Mbps
        audioBitsPerSecond: 128000   // 128 kbps audio
      });

      const chunks = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      // Start recording
      mediaRecorder.start(100); // Collect data every 100ms

      // Start audio playback - this drives the timeline
      if (audioElement) {
        audioElement.currentTime = 0;
        await audioElement.play();
      }

      // Start all avatar videos (paused, we'll sync them)
      for (const av of avatarVideoElements) {
        if (av && av.element) {
          av.element.currentTime = 0;
          av.element.pause();
        }
      }

      // Render frames synced to real time (driven by audio)
      this.exportStatus.textContent = 'Recording video...';
      const recordingStartTime = performance.now();
      let lastActiveAvatar = null;

      const renderFrame = () => {
        // Use audio time if available, otherwise calculate from elapsed time
        const currentTime = audioElement
          ? audioElement.currentTime
          : (performance.now() - recordingStartTime) / 1000;

        if (currentTime >= totalDuration || (audioElement && audioElement.ended)) {
          // Done rendering
          mediaRecorder.stop();
          if (audioElement) audioElement.pause();
          // Stop all avatar videos
          for (const av of avatarVideoElements) {
            if (av && av.element) av.element.pause();
          }
          return;
        }

        // Find current scene
        const scene = this.scenes.find(s =>
          currentTime >= s.startTime && currentTime < s.startTime + s.duration
        ) || this.scenes[this.scenes.length - 1];

        const sceneIndex = this.scenes.indexOf(scene);
        const sceneImg = sceneImages[sceneIndex];

        // Clear canvas
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);

        // Draw scene image with Ken Burns
        if (sceneImg) {
          const progress = (currentTime - scene.startTime) / scene.duration;
          const scale = 1 + progress * 0.1;
          const imgRatio = sceneImg.width / sceneImg.height;
          const canvasRatio = width / height;

          let drawW, drawH;
          if (imgRatio > canvasRatio) {
            drawH = height * scale;
            drawW = drawH * imgRatio;
          } else {
            drawW = width * scale;
            drawH = drawW / imgRatio;
          }

          ctx.drawImage(sceneImg, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
        }

        // Draw avatar overlay - play videos smoothly
        if (avatarVideoElements.length > 0) {
          const avatarData = avatarVideoElements.find(av =>
            av && currentTime >= av.startTime && currentTime < av.endTime
          );

          // Handle avatar video switching
          if (avatarData && avatarData !== lastActiveAvatar) {
            // Pause previous avatar
            if (lastActiveAvatar && lastActiveAvatar.element) {
              lastActiveAvatar.element.pause();
            }
            // Start new avatar at correct position
            const localTime = currentTime - avatarData.startTime;
            avatarData.element.currentTime = localTime;
            avatarData.element.play().catch(() => {});
            lastActiveAvatar = avatarData;
          } else if (!avatarData && lastActiveAvatar) {
            // No avatar for this time, pause current
            lastActiveAvatar.element.pause();
            lastActiveAvatar = null;
          }

          if (avatarData && avatarData.element) {
            const rect = this.getAvatarOverlayRect(width, height);
            ctx.save();
            if (this.avatarShape === 'circle') {
              const centerX = rect.x + rect.width / 2;
              const centerY = rect.y + rect.height / 2;
              const radius = Math.min(rect.width, rect.height) / 2;
              ctx.beginPath();
              ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
              ctx.clip();
              ctx.drawImage(avatarData.element, rect.x, rect.y, rect.width, rect.height);
            } else {
              ctx.drawImage(avatarData.element, rect.x, rect.y, rect.width, rect.height);
            }
            ctx.restore();
          }
        }

        // Draw caption (temporarily swap context)
        const originalCtx = this.ctx;
        const originalCanvas = this.previewCanvas;
        this.ctx = ctx;
        this.previewCanvas = exportCanvas;
        this.playbackTime = currentTime;
        this.drawCaption(scene);
        this.ctx = originalCtx;
        this.previewCanvas = originalCanvas;

        // Update progress
        const percent = Math.round((currentTime / totalDuration) * 100);
        this.exportProgressBar.style.width = `${percent}%`;
        this.exportStatus.textContent = `Recording: ${percent}%`;

        // Use requestAnimationFrame for smooth real-time rendering
        requestAnimationFrame(renderFrame);
      };

      // Start rendering
      requestAnimationFrame(renderFrame);

      // Wait for recording to complete
      await new Promise(resolve => {
        mediaRecorder.onstop = resolve;
      });

      // Create video blob
      const videoBlob = new Blob(chunks, { type: selectedMimeType });
      const extension = selectedMimeType.includes('mp4') ? 'mp4' : 'webm';

      // Download
      const url = URL.createObjectURL(videoBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `video_export_${Date.now()}.${extension}`;
      a.click();
      URL.revokeObjectURL(url);

      this.exportStatus.textContent = 'Export complete!';
      showToast(`Video exported as ${extension.toUpperCase()}!`, 'success');

    } catch (error) {
      console.error('MediaRecorder export error:', error);
      showToast(`Export failed: ${error.message}. Try ZIP export.`);
      this.exportStatus.textContent = 'Export failed';
    } finally {
      this.exportVideoBtn.disabled = false;
      setTimeout(() => {
        this.exportProgress.hidden = true;
      }, 3000);
    }
  }

  // Export Video (FFmpeg version)
  async exportVideo() {
    if (this.scenes.length === 0) {
      showToast('Add scenes first to export.');
      return;
    }

    // Try MediaRecorder first (works in all browsers)
    if (!this.ffmpegLoaded) {
      console.log('FFmpeg not available, using MediaRecorder export');
      return this.exportWithMediaRecorder();
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
    if (!this.scenes || this.scenes.length === 0) return 0;

    // Create sorted index pairs to track original indices
    const sortedPairs = this.scenes.map((scene, idx) => ({ scene, idx }))
      .sort((a, b) => a.scene.startTime - b.scene.startTime);

    // If time is before first scene, return first scene's index
    if (time < sortedPairs[0].scene.startTime) {
      return sortedPairs[0].idx;
    }

    // Find scene that contains this time (with small epsilon for floating point)
    const epsilon = 0.001;
    for (const { scene, idx } of sortedPairs) {
      if (time >= scene.startTime - epsilon && time < scene.startTime + scene.duration + epsilon) {
        return idx;
      }
    }

    // Find closest scene to prevent jumping to last scene
    let closestIdx = sortedPairs[0].idx;
    let closestDistance = Math.abs(time - sortedPairs[0].scene.startTime);

    for (const { scene, idx } of sortedPairs) {
      const sceneEnd = scene.startTime + scene.duration;
      const distToStart = Math.abs(time - scene.startTime);
      const distToEnd = Math.abs(time - sceneEnd);
      const minDist = Math.min(distToStart, distToEnd);

      if (minDist < closestDistance) {
        closestDistance = minDist;
        closestIdx = idx;
      }
    }

    return closestIdx;
  }

  // Remove duplicate scenes (by imageUrl)
  dedupeScenes() {
    const seen = new Set();
    const uniqueScenes = [];

    for (const scene of this.scenes) {
      const key = scene.imageUrl || scene.id;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueScenes.push(scene);
      }
    }

    const removed = this.scenes.length - uniqueScenes.length;
    if (removed > 0) {
      this.scenes = uniqueScenes;
      this.recalculateTimings();
      this.renderImportedScenes();
      this.renderTimeline();
      // SAVE to Supabase so duplicates don't come back on refresh
      this.saveScenesToSupabase();
      showToast(`Removed ${removed} duplicate scenes. Now have ${this.scenes.length} scenes.`, 'success');
      console.log(`Deduped: removed ${removed} duplicates, now have ${this.scenes.length} scenes`);
    } else {
      showToast('No duplicates found', 'info');
    }
    return this.scenes.length;
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
      video.playsInline = true;

      // Wait for video to be fully ready to play
      video.oncanplaythrough = () => {
        console.log('Video ready:', url, 'duration:', video.duration);
        resolve(video);
      };

      video.onloadeddata = () => {
        // Fallback if canplaythrough doesn't fire
        if (video.readyState >= 3) {
          console.log('Video loaded (fallback):', url, 'duration:', video.duration);
          resolve(video);
        }
      };

      video.onerror = (e) => {
        console.error('Failed to load video:', url, e);
        reject(new Error(`Failed to load video: ${url}`));
      };

      // Timeout fallback
      setTimeout(() => {
        if (video.readyState >= 2) {
          console.log('Video loaded (timeout):', url);
          resolve(video);
        }
      }, 5000);

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

  // Make it globally accessible (must be inside DOMContentLoaded)
  window.videoEditor = videoEditor;

  // Set up video scene duration slider
  const durationSlider = document.getElementById('video-scene-duration');
  const durationDisplay = document.getElementById('video-scene-duration-display');
  if (durationSlider && durationDisplay) {
    durationSlider.addEventListener('input', () => {
      durationDisplay.textContent = `${durationSlider.value} sec`;
    });
  }
});

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

    // Store the replaced audio for stitching in export
    if (typeof videoEditor !== 'undefined') {
      videoEditor.replacedAudioSegments[segmentNum] = {
        blob: audioFile,
        url: audioPublicUrl
      };
      // Clear cached stitched audio so it gets re-generated with new replacement
      videoEditor.stitchedAudioBlob = null;
      console.log(`Stored replaced audio for segment ${segmentNum}`);
    }

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
    <div style="font-size: 12px; color: var(--text-secondary, #aaa); margin-top: 5px;">Uploading to cloud...</div>
  `;

  try {
    // Upload to Supabase for persistence
    const configResponse = await fetch('/api/supabase-config');
    const config = await configResponse.json();
    const userId = localStorage.getItem('ai_tool_user_id') || 'default';

    const videoPath = `avatar-segments/${userId}/segment-${segmentNum}-${Date.now()}.mp4`;
    const uploadUrl = `${config.url}/storage/v1/object/${config.bucket}/${videoPath}`;

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.anonKey}`,
        'apikey': config.anonKey,
        'Content-Type': file.type || 'video/mp4',
        'x-upsert': 'true'
      },
      body: file
    });

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload video to cloud');
    }

    // Permanent URL that persists
    const permanentUrl = `${config.url}/storage/v1/object/public/${config.bucket}/${videoPath}`;
    console.log(`Segment ${segmentNum} uploaded to:`, permanentUrl);

    // Store in memory for export (with permanent URL)
    window.uploadedAvatarSegments[segmentNum] = {
      url: permanentUrl,
      fileName: file.name
    };

    // Extract audio from uploaded video and store for stitching
    try {
      const audioBlob = await extractAudioFromVideo(file);
      if (audioBlob && typeof videoEditor !== 'undefined') {
        videoEditor.replacedAudioSegments[segmentNum] = {
          blob: audioBlob,
          url: permanentUrl
        };
        videoEditor.stitchedAudioBlob = null; // Clear cache
        console.log(`Extracted and stored audio from uploaded segment ${segmentNum}`);
      }
    } catch (audioErr) {
      console.warn(`Could not extract audio from segment ${segmentNum}:`, audioErr);
    }

    // Save to database for persistence across refreshes
    await fetch('/api/db/avatar-segments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        segmentNum,
        videoUrl: permanentUrl,
        fileName: file.name
      })
    });

    // Update slot UI
    slot.style.background = 'rgba(34, 197, 94, 0.2)';
    slot.style.borderColor = '#22c55e';
    slot.innerHTML = `
      <input type="file" id="segment-upload-${segmentNum}" accept="video/*" hidden
        onchange="handleSegmentUpload(${segmentNum}, this.files[0])">
      <div style="font-size: 24px; margin-bottom: 5px;">✅</div>
      <div style="font-weight: bold; color: var(--text-primary, #fff);">Segment ${segmentNum}</div>
      <div style="font-size: 12px; color: #22c55e; margin-top: 5px;">${file.name}</div>
      <button onclick="previewSegment('${permanentUrl}')" style="
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

// Extract audio from a video file using Web Audio API
async function extractAudioFromVideo(videoFile) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = false;
    video.src = URL.createObjectURL(videoFile);

    video.onloadedmetadata = async () => {
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuffer = await videoFile.arrayBuffer();

        // Try to decode audio from video
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // Convert AudioBuffer to WAV blob
        const wavBlob = audioBufferToWav(audioBuffer);
        URL.revokeObjectURL(video.src);
        resolve(wavBlob);
      } catch (err) {
        URL.revokeObjectURL(video.src);
        reject(err);
      }
    };

    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Failed to load video'));
    };
  });
}

// Convert AudioBuffer to WAV Blob
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

  // Interleave channels and write samples
  const offset = 44;
  const channels = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  let pos = offset;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(pos, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      pos += 2;
    }
  }

  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

// Make functions globally available
window.showUploadSegmentsPanel = showUploadSegmentsPanel;
window.handleSegmentUpload = handleSegmentUpload;
window.extractAudioFromVideo = extractAudioFromVideo;

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
