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

    // Initialize
    this.initElements();
    this.initEventListeners();
    this.initFFmpeg();
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

    // Export
    this.exportVideoBtn.addEventListener('click', () => this.exportVideo());

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
      });
    }
    if (this.avatarSizeSelect) {
      this.avatarSizeSelect.addEventListener('change', (e) => {
        this.avatarSize = e.target.value;
      });
    }
    if (this.avatarShapeSelect) {
      this.avatarShapeSelect.addEventListener('change', (e) => {
        this.avatarShape = e.target.value;
      });
    }

    // Preview Modal
    this.closePreviewBtn.addEventListener('click', () => this.closePreview());
    this.previewPlayPauseBtn.addEventListener('click', () => this.togglePlayback());
  }

  async initFFmpeg() {
    try {
      const { FFmpeg } = FFmpegWASM;
      this.ffmpeg = new FFmpeg();

      this.ffmpeg.on('progress', ({ progress }) => {
        const percent = Math.round(progress * 100);
        this.exportProgressBar.style.width = `${percent}%`;
        this.exportStatus.textContent = `Encoding: ${percent}%`;
      });

      await this.ffmpeg.load({
        coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
      });

      this.ffmpegLoaded = true;
      console.log('FFmpeg loaded successfully');
    } catch (error) {
      console.error('Failed to load FFmpeg:', error);
      showToast('Video export requires FFmpeg. Some browsers may not support this feature.');
    }
  }

  // Import scenes from batch generator
  importFromBatch() {
    if (typeof generatedScenes === 'undefined' || generatedScenes.length === 0) {
      showToast('No scenes available. Generate scenes in the Batch Scenes tab first.');
      return;
    }

    this.scenes = generatedScenes
      .filter(s => s && s.imageUrl)
      .map((scene, index) => ({
        id: index,
        imageUrl: scene.imageUrl,
        text: scene.text || '',
        duration: 3, // Default 3 seconds per scene
        caption: scene.text ? scene.text.substring(0, 100) : '',
        startTime: index * 3
      }));

    this.renderImportedScenes();
    this.renderTimeline();
    this.renderCaptions();
    this.updateTotalDuration();

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
  }

  removeScene(index) {
    this.scenes.splice(index, 1);
    this.recalculateTimings();
    this.renderImportedScenes();
    this.renderTimeline();
    this.renderCaptions();
    this.updateTotalDuration();
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

  handleAudioUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    this.audioBlob = file;
    this.loadAudioBlob(file);
  }

  async loadAudioBlob(blob) {
    try {
      // Revoke any previous URL to prevent memory leaks
      if (this.currentAudioUrl) {
        URL.revokeObjectURL(this.currentAudioUrl);
      }

      const url = URL.createObjectURL(blob);
      this.currentAudioUrl = url;

      // Set up audio player with error handling
      this.audioPlayer.onerror = (e) => {
        console.error('Audio player error:', e);
        // Try to get more info about the error
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
      this.audioPreview.hidden = false;

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
  }

  handleAvatarPhotoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Please upload an image file.');
      return;
    }

    this.avatarPhotoBlob = file;

    // Revoke previous URL
    if (this.avatarPhotoUrl) {
      URL.revokeObjectURL(this.avatarPhotoUrl);
    }

    this.avatarPhotoUrl = URL.createObjectURL(file);

    // Update preview image
    if (this.editorAvatarImg) {
      this.editorAvatarImg.src = this.avatarPhotoUrl;
    }

    // Show preview container, hide placeholder
    if (this.editorAvatarPreview) {
      this.editorAvatarPreview.hidden = false;
    }

    if (this.editorAvatarPlaceholder) {
      this.editorAvatarPlaceholder.hidden = true;
    }

    this.updateAvatarCostEstimate();
    showToast('Avatar photo loaded!', false);
  }

  clearAvatarPhoto() {
    if (this.avatarPhotoUrl) {
      URL.revokeObjectURL(this.avatarPhotoUrl);
      this.avatarPhotoUrl = null;
    }
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

  // Generate talking avatar videos for all scenes
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

    for (let i = 0; i < audioSegments.length; i++) {
      const segment = audioSegments[i];
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

        this.avatarVideos.push({
          videoUrl: result.videoUrl,
          startTime: segment.startTime,
          endTime: segment.endTime,
          index: segment.index
        });

        console.log(`Avatar video ${i + 1} generated:`, result.videoUrl);

      } catch (error) {
        console.error(`Failed to generate avatar video ${i + 1}:`, error);
        showToast(`Avatar generation failed for segment ${i + 1}: ${error.message}`);
        // Continue with remaining segments
      }
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

      // Create form data with audio and scene info
      const formData = new FormData();
      formData.append('audio', this.audioBlob, 'recording.webm');
      formData.append('scenes', JSON.stringify(sceneDescriptions));

      // Call transcription API
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData
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
    this.generateCaptionsBtn.innerHTML = '⏳ Transcribing...';

    try {
      // Create form data with just the audio (no scenes - we want full transcription)
      const formData = new FormData();
      formData.append('audio', this.audioBlob, 'recording.webm');

      // Call transcription API
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (!response.ok) {
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

    this.previewModal.hidden = false;
    this.setupPreviewCanvas();
    this.playbackTime = 0;
    this.updatePreviewFrame();
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

    // Play voiceover
    if (this.audioBuffer || this.audioBlob) {
      this.audioPlayer.currentTime = this.playbackTime;
      this.audioPlayer.play().catch(e => console.log('Voiceover play error:', e));
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
    img.onload = () => {
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);

      // Apply Ken Burns effect
      this.applyKenBurnsEffect(img, currentScene);

      // Draw caption
      this.drawCaption(currentScene);
    };
    img.src = currentScene.imageUrl;
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

    const fontSize = parseInt(this.captionFontSize.value);
    const style = this.captionStyle.value;

    this.ctx.font = `bold ${fontSize}px Inter, sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.fillStyle = 'white';
    this.ctx.strokeStyle = 'black';
    this.ctx.lineWidth = 3;

    const canvasW = this.previewCanvas.width;
    const canvasH = this.previewCanvas.height;

    let x = canvasW / 2;
    let y;

    switch (style) {
      case 'top-center':
        y = fontSize + 40;
        break;
      case 'bottom-left':
        x = 40;
        y = canvasH - 40;
        this.ctx.textAlign = 'left';
        break;
      default: // bottom-center
        y = canvasH - 40;
    }

    // Word wrap
    const words = scene.caption.split(' ');
    const lines = [];
    let currentLine = '';
    const maxWidth = canvasW - 80;

    words.forEach(word => {
      const testLine = currentLine + word + ' ';
      const metrics = this.ctx.measureText(testLine);
      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine.trim());
        currentLine = word + ' ';
      } else {
        currentLine = testLine;
      }
    });
    lines.push(currentLine.trim());

    // Draw lines
    lines.forEach((line, index) => {
      const lineY = y - ((lines.length - 1 - index) * (fontSize + 10));
      this.ctx.strokeText(line, x, lineY);
      this.ctx.fillText(line, x, lineY);
    });
  }

  updatePlayhead() {
    const totalDuration = this.getTotalDuration();
    const percent = (this.playbackTime / totalDuration) * 100;
    this.timelinePlayhead.style.left = `${percent}%`;
  }

  // Export Video
  async exportVideo() {
    if (!this.ffmpegLoaded) {
      showToast('FFmpeg is still loading. Please wait...');
      return;
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

      // Step 1: Generate avatar videos if enabled
      let avatarVideoElements = [];
      if (this.avatarEnabled && this.avatarPhotoBlob && this.audioBlob) {
        this.exportStatus.textContent = 'Generating talking avatar...';
        await this.generateAvatarVideos();

        // Load avatar videos as video elements for frame extraction
        if (this.avatarVideos.length > 0) {
          this.exportStatus.textContent = 'Loading avatar videos...';
          avatarVideoElements = await Promise.all(
            this.avatarVideos.map(av => this.loadVideoElement(av.videoUrl))
          );
          console.log(`Loaded ${avatarVideoElements.length} avatar video elements`);
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

        // Draw caption (on top of everything)
        this.drawCaptionOnCanvas(ctx, scene, width, height);

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

  drawCaptionOnCanvas(ctx, scene, width, height) {
    if (!scene.caption) return;

    const fontSize = parseInt(this.captionFontSize.value);
    const style = this.captionStyle.value;

    ctx.font = `bold ${fontSize}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 3;

    let x = width / 2;
    let y;

    switch (style) {
      case 'top-center':
        y = fontSize + 40;
        break;
      case 'bottom-left':
        x = 40;
        y = height - 40;
        ctx.textAlign = 'left';
        break;
      default:
        y = height - 40;
    }

    const words = scene.caption.split(' ');
    const lines = [];
    let currentLine = '';
    const maxWidth = width - 80;

    words.forEach(word => {
      const testLine = currentLine + word + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine.trim());
        currentLine = word + ' ';
      } else {
        currentLine = testLine;
      }
    });
    lines.push(currentLine.trim());

    lines.forEach((line, index) => {
      const lineY = y - ((lines.length - 1 - index) * (fontSize + 10));
      ctx.strokeText(line, x, lineY);
      ctx.fillText(line, x, lineY);
    });
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
});

// Make it globally accessible
window.videoEditor = videoEditor;
