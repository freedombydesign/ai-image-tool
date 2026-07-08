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

    // Timeline
    this.playPreviewBtn.addEventListener('click', () => this.openPreview());
    this.autoSyncBtn.addEventListener('click', () => this.autoSyncScenes());

    // Export
    this.exportVideoBtn.addEventListener('click', () => this.exportVideo());

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

      // Try different audio formats for better compatibility
      let options = {};
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        options = { mimeType: 'audio/webm;codecs=opus' };
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        options = { mimeType: 'audio/webm' };
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        options = { mimeType: 'audio/mp4' };
      }

      this.mediaRecorder = new MediaRecorder(this.recordingStream, options);
      this.recordingChunks = [];

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.recordingChunks.push(e.data);
        }
      };

      this.mediaRecorder.onerror = (e) => {
        console.error('MediaRecorder error:', e);
        showToast('Recording error occurred. Please try again.');
        this.resetRecordingUI();
      };

      this.mediaRecorder.onstop = () => {
        if (this.recordingChunks.length === 0) {
          showToast('No audio was captured. Please try again.');
          this.recordingStream.getTracks().forEach(track => track.stop());
          this.resetRecordingUI();
          return;
        }

        const mimeType = this.mediaRecorder.mimeType || 'audio/webm';
        this.audioBlob = new Blob(this.recordingChunks, { type: mimeType });

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

      // Request data every second to ensure we capture audio
      this.mediaRecorder.start(1000);
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
      const url = URL.createObjectURL(blob);
      this.audioPlayer.src = url;
      this.audioPreview.hidden = false;

      // Decode audio for waveform and duration
      const arrayBuffer = await blob.arrayBuffer();
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();

      this.audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      this.audioDuration = this.audioBuffer.duration;

      this.renderWaveform();
      this.updateTotalDuration();

      console.log('Audio loaded:', this.audioDuration, 'seconds');
    } catch (error) {
      console.error('Audio decode error:', error);
      // Even if waveform fails, audio player should still work
      if (this.audioPlayer.src) {
        showToast('Audio loaded (waveform unavailable)', false);
      } else {
        showToast('Could not load audio file. Try a different format (MP3, WAV, M4A).');
      }
    }
  }

  removeAudio() {
    this.audioBlob = null;
    this.audioBuffer = null;
    this.audioDuration = 0;
    this.audioPlayer.src = '';
    this.audioPreview.hidden = true;
    this.waveformContainer.innerHTML = '';
    this.updateTotalDuration();
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

  // Auto-sync scenes to audio
  autoSyncScenes() {
    if (!this.audioBuffer || this.scenes.length === 0) {
      showToast('Need both audio and scenes to auto-sync.');
      return;
    }

    // Simple approach: detect silence/pauses and distribute scenes
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
    showToast('Scenes synced to audio!', false);
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

    if (this.audioBuffer) {
      this.audioPlayer.currentTime = this.playbackTime;
      this.audioPlayer.play();
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
    this.exportStatus.textContent = 'Preparing frames...';

    try {
      const [width, height] = this.exportResolution.value.split('x').map(Number);
      const fps = parseInt(this.exportFps.value);
      const totalDuration = this.getTotalDuration();
      const totalFrames = Math.ceil(totalDuration * fps);

      // Generate frames
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      // Load all images first
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

        // Draw image with effects
        this.drawFrameWithEffects(ctx, img, scene, time, width, height);

        // Draw caption
        this.drawCaptionOnCanvas(ctx, scene, width, height);

        // Convert to image data
        const frameData = await this.canvasToUint8Array(canvas);
        await this.ffmpeg.writeFile(`frame${String(frame).padStart(6, '0')}.png`, frameData);

        const progress = Math.round((frame / totalFrames) * 50);
        this.exportProgressBar.style.width = `${progress}%`;
        this.exportStatus.textContent = `Generating frames: ${frame + 1}/${totalFrames}`;
      }

      // Write audio if available
      if (this.audioBlob) {
        const audioData = new Uint8Array(await this.audioBlob.arrayBuffer());
        await this.ffmpeg.writeFile('audio.webm', audioData);
      }

      this.exportStatus.textContent = 'Encoding video...';

      // Encode video
      const ffmpegArgs = [
        '-framerate', String(fps),
        '-i', 'frame%06d.png',
      ];

      if (this.audioBlob) {
        ffmpegArgs.push('-i', 'audio.webm');
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
      if (this.audioBlob) {
        await this.ffmpeg.deleteFile('audio.webm');
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
}

// Initialize video editor when DOM is ready
let videoEditor;
document.addEventListener('DOMContentLoaded', () => {
  videoEditor = new VideoEditor();
});

// Make it globally accessible
window.videoEditor = videoEditor;
