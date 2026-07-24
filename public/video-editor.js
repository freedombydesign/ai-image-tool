// Video Editor Module
// Handles scene import, audio recording/upload, timeline, captions, effects, and video export

// Helper: Get signed URL for storage path (reduces CDN egress vs public URLs)
async function getSignedReadUrl(path) {
  try {
    const response = await fetch('/api/signed-read-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    });

    if (!response.ok) {
      console.warn('Failed to get signed URL for:', path);
      return null;
    }

    const data = await response.json();
    return data.signedUrl;
  } catch (error) {
    console.warn('Signed URL error:', error.message);
    return null;
  }
}

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
            text: scene.text || '',
            caption: scene.caption || '',  // Save caption separately (transcription from Whisper)
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
        let scenes = data.scenes || [];
        if (scenes.length > 0) {
          // Dedupe scenes by imageUrl during load to prevent duplicates
          const seen = new Set();
          scenes = scenes.filter(scene => {
            const key = scene.imageUrl || scene.image_url;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          this.scenes = scenes.map((scene, index) => ({
            id: `scene-${Date.now()}-${index}`,
            imageUrl: scene.imageUrl || scene.image_url,
            text: scene.text || '',
            caption: scene.caption || scene.text || '',  // Prefer saved caption (transcription), fall back to text
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
          let scenes = mostRecentBatch.scenes || [];
          if (scenes.length > 0) {
            // Dedupe scenes by imageUrl during load
            const seen = new Set();
            scenes = scenes.filter(scene => {
              const key = scene.imageUrl || scene.image_url;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });

            this.scenes = scenes.map((scene, index) => ({
              id: `scene-${Date.now()}-${index}`,
              imageUrl: scene.imageUrl || scene.image_url,
              text: scene.text || '',
              caption: scene.caption || scene.text || '',  // Prefer saved caption (transcription), fall back to text
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
              // duration will be loaded by syncUploadedAvatarSegmentsWithDurations
            };
          });

          // Sync to video editor with actual durations (fixes stutter at segment boundaries)
          await this.syncUploadedAvatarSegmentsWithDurations();
          this.avatarEnabled = true;

          console.log(`Loaded ${data.segments.length} avatar segments from Supabase`);

          // Update the UI slots if they exist
          this.updateAvatarSegmentSlots();

          // Store segments globally so we can repair them after audio loads
          window.loadedAvatarSegments = data.segments;

          // Auto-extract audio from avatar segments for clean audio playback
          // (will retry after audio loads if audioBlob not ready yet)
          this.extractAudioFromAvatarSegments(data.segments);
        }
      }
    } catch (e) {
      console.error('Failed to load avatar segments from Supabase:', e);
    }
  }

  // Load audio for avatar segments - uses saved audio_url if available, else TTS splits
  async extractAudioFromAvatarSegments(segments) {
    if (!segments || segments.length === 0) return;

    console.log(`Loading audio for ${segments.length} avatar segments...`);
    let loaded = 0;

    // ALWAYS use TTS splits for consistent 90s segment durations
    // Do NOT use saved audio_url - those contain lip-sync audio from avatar videos
    // which may have different durations (e.g., 90.82s instead of 90s)
    let needsRepair = [...segments];

    // Second pass: use TTS splits for segments without saved audio
    if (needsRepair.length > 0 && this.audioBlob) {
      console.log(`🔊 Splitting TTS audio for ${needsRepair.length} segments without saved audio...`);

      try {
        // Split TTS audio into segments
        const audioSegments = await this.splitAudioForAvatar();
        console.log(`Split TTS audio into ${audioSegments.length} segments`);

        const userId = localStorage.getItem('ai_tool_user_id') || this.userId;
        const config = window.supabaseConfig;

        for (const seg of needsRepair) {
          const segmentIndex = seg.segment_num - 1;
          if (segmentIndex >= 0 && segmentIndex < audioSegments.length) {
            const audioSeg = audioSegments[segmentIndex];

            // Store in memory immediately
            this.replacedAudioSegments[seg.segment_num] = { blob: audioSeg.blob, url: null };
            loaded++;
            console.log(`✓ Loaded clean audio for segment ${seg.segment_num} from TTS split (blob size: ${audioSeg.blob.size})`);

            // Upload to Supabase if available
            if (userId && config) {
              try {
                const audioPath = `audio/avatar-segment-${seg.segment_num}-${Date.now()}.wav`;
                const audioUploadUrl = `${config.url}/storage/v1/object/${config.bucket}/${audioPath}`;

                const uploadResponse = await fetch(audioUploadUrl, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${config.anonKey}`,
                    'apikey': config.anonKey,
                    'Content-Type': 'audio/wav',
                    'x-upsert': 'true'
                  },
                  body: audioSeg.blob
                });

                if (uploadResponse.ok) {
                  // Get signed URL instead of public URL to reduce CDN egress
                  const audioSignedUrl = await getSignedReadUrl(audioPath);
                  if (audioSignedUrl) {
                    // Update database with audio_url
                    await fetch('/api/db/avatar-segments', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        userId,
                        segmentNum: seg.segment_num,
                        videoUrl: seg.video_url,
                        fileName: seg.file_name,
                        audioUrl: audioSignedUrl
                      })
                    });

                    this.replacedAudioSegments[seg.segment_num].url = audioSignedUrl;
                    console.log(`✓ Saved audio_url for segment ${seg.segment_num} to database (signed URL)`);
                  }
                }
              } catch (uploadErr) {
                console.warn(`  Failed to upload audio for segment ${seg.segment_num}:`, uploadErr.message);
              }
            }
          }
        }
      } catch (splitErr) {
        console.error('Failed to split TTS audio for repair:', splitErr);
      }
    }

    if (loaded > 0) {
      this.stitchedAudioBlob = null; // Clear cache so it rebuilds with new segments
      console.log(`✓ Loaded audio for ${loaded}/${segments.length} avatar segments. Clean audio ready!`);

      // Show all segment blob sizes for cache key debugging
      const segmentSizes = Object.entries(this.replacedAudioSegments || {})
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
        .map(([num, seg]) => `${num}:${seg.blob?.size || 0}`);
      console.log('=== AUDIO SEGMENT BLOB SIZES (for cache key) ===');
      segmentSizes.forEach(s => console.log(`  Segment ${s}`));
      console.log(`Cache key segment portion: ${segmentSizes.join(',')}`);
    } else {
      console.log('No audio loaded - will use original TTS audio for export');
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

  // Trim audio blob to specified duration starting at startSeconds
  // startSeconds: where to start extracting (default 0)
  // maxDurationSeconds: how many seconds to extract
  async trimAudioBlob(blob, maxDurationSeconds, startSeconds = 0) {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const sampleRate = audioBuffer.sampleRate;
      const totalAudioSamples = audioBuffer.length;

      // Calculate start and end sample positions
      const startSample = Math.min(
        Math.floor(startSeconds * sampleRate),
        totalAudioSamples
      );
      const endSample = Math.min(
        startSample + Math.floor(maxDurationSeconds * sampleRate),
        totalAudioSamples
      );
      const samplesToExtract = endSample - startSample;

      if (samplesToExtract <= 0) {
        console.warn('No samples to extract - start time beyond audio length');
        await audioContext.close();
        return blob;
      }

      // Create new buffer with extracted section
      const trimmedBuffer = audioContext.createBuffer(
        audioBuffer.numberOfChannels,
        samplesToExtract,
        sampleRate
      );

      // Copy samples from the specified range
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const sourceData = audioBuffer.getChannelData(channel);
        const destData = trimmedBuffer.getChannelData(channel);
        for (let i = 0; i < samplesToExtract; i++) {
          destData[i] = sourceData[startSample + i];
        }
      }

      // Encode to WAV (simpler than re-encoding to original format)
      const wavBlob = this.audioBufferToWav(trimmedBuffer);
      const actualDuration = samplesToExtract / sampleRate;
      console.log(`Extracted audio: ${startSeconds}s to ${startSeconds + actualDuration}s (${wavBlob.size} bytes)`);

      await audioContext.close();
      return wavBlob;
    } catch (e) {
      console.error('Failed to trim audio:', e);
      // Return original blob if trimming fails
      return blob;
    }
  }

  // Convert AudioBuffer to WAV blob
  audioBufferToWav(buffer) {
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
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, bufferLength - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);

    // Write audio data
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let channel = 0; channel < numChannels; channel++) {
        const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, intSample, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
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
    this.audioControls = document.querySelector('.audio-controls');
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
    this.matchToScriptBtn = document.getElementById('match-to-script-btn');
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
    this.captionsEnabledToggle = document.getElementById('captions-enabled-toggle');

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
    this.testExportBtn = document.getElementById('test-export-btn');

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
    const importFromLibraryBtn = document.getElementById('import-from-library');
    if (importFromLibraryBtn) {
      importFromLibraryBtn.addEventListener('click', () => this.openLibraryImportModal());
    }
    const uploadZipBtn = document.getElementById('upload-zip-to-editor');
    const zipInput = document.getElementById('video-editor-zip-upload');
    if (uploadZipBtn && zipInput) {
      uploadZipBtn.addEventListener('click', () => zipInput.click());
      zipInput.addEventListener('change', (e) => this.handleZipUpload(e));
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
        // Shift+Click OR Ctrl+Click = force fresh transcription (clear cache)
        const forceRefresh = e.shiftKey || e.ctrlKey || e.metaKey;
        console.log('Sync button clicked. Modifier keys - Shift:', e.shiftKey, 'Ctrl:', e.ctrlKey, 'Meta:', e.metaKey);
        if (forceRefresh) {
          console.log('🔄 FORCE REFRESH MODE - Will clear all caches');
          showToast('Clearing ALL caches, will re-analyze...', 'info');
        }
        this.syncToAudio(forceRefresh);
      });
      this.syncToAudioBtn.title = 'Click to sync | Shift/Ctrl+Click to clear cache and re-sync';
    }
    if (this.distributeEvenlyBtn) {
      this.distributeEvenlyBtn.addEventListener('click', () => this.distributeEvenly());
    }
    if (this.matchToScriptBtn) {
      this.matchToScriptBtn.addEventListener('click', () => this.matchScenesToScript());
    }

    // Force Re-sync button - always clears cache
    const forceResyncBtn = document.getElementById('force-resync-btn');
    if (forceResyncBtn) {
      forceResyncBtn.addEventListener('click', () => {
        console.log('🔄 FORCE RE-SYNC clicked - clearing all caches');
        showToast('Clearing ALL caches, will re-analyze with GPT-4o...', 'info');
        this.syncToAudio(true); // true = force refresh
      });
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
    // Test captions - 30 seconds starting at specified time (cheaper for testing sync)
    // Shift+Click to force fresh transcription (bypass cache)
    this.testCaptionsBtn = document.getElementById('test-captions-btn');
    this.testCaptionsStartInput = document.getElementById('test-captions-start');
    if (this.testCaptionsBtn) {
      this.testCaptionsBtn.addEventListener('click', (e) => {
        const startTime = this.parseTime(this.testCaptionsStartInput?.value || '0');
        const forceRefresh = e.shiftKey;
        if (forceRefresh) {
          console.log('Shift+Click: forcing fresh transcription (bypassing cache)');
          showToast('Forcing fresh transcription...', false);
        }
        this.generateCaptionsFromAudio(30, startTime, forceRefresh);
      });
    }
    if (this.clearCaptionsBtn) {
      this.clearCaptionsBtn.addEventListener('click', () => this.clearCaptions());
    }
    // Force Fresh button - always bypasses cache and clears old captions first
    this.forceFreshCaptionsBtn = document.getElementById('force-fresh-captions-btn');
    if (this.forceFreshCaptionsBtn) {
      this.forceFreshCaptionsBtn.addEventListener('click', () => {
        console.log('Force Fresh: clearing all caption caches and regenerating');
        // Clear localStorage caption caches
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith('captions_')) {
            localStorage.removeItem(key);
            console.log('Cleared cache:', key);
          }
        });
        showToast('Cleared caption cache, regenerating...', false);
        this.generateCaptionsFromAudio(null, 0, true); // Full audio, force refresh
      });
    }
    if (this.previewCaptionBtn) {
      this.previewCaptionBtn.addEventListener('click', () => this.previewCaptionStyle());
    }

    // Color picker + hex input sync
    this.setupColorSync('caption-text-color', 'caption-text-color-hex');
    this.setupColorSync('caption-highlight-color', 'caption-highlight-color-hex');

    // Export
    this.exportVideoBtn.addEventListener('click', () => this.exportVideo());

    // Test Export (30 seconds only for quick testing)
    if (this.testExportBtn) {
      this.testExportBtn.addEventListener('click', () => {
        const startInput = document.getElementById('test-export-start');
        const startTime = this.parseTime(startInput?.value || '0');
        this.exportVideo(30, startTime);
      });
    }

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

    // Background Only Export (for FFmpeg compositing)
    const exportBgOnlyBtn = document.getElementById('export-bg-only-btn');
    if (exportBgOnlyBtn) {
      exportBgOnlyBtn.addEventListener('click', () => this.exportBackgroundOnly());
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

    // Initialize hex input from color picker value (prevents browser autofill issues)
    hexInput.value = colorInput.value.toUpperCase();

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
    // FFmpeg WASM disabled - browser security blocks dynamic worker loading
    // Using fix-webm-metainfo library for WebM metadata fix (Duration + Cues)
    console.log('FFmpeg disabled - using fix-webm-metainfo library for exports');
    this.ffmpegLoaded = false;
  }

  // Legacy function - no longer used
  async loadFFmpegScript() {
    console.log('FFmpeg script loading skipped - not supported in browser');
    return Promise.resolve();
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
          const response = await fetch(`/api/db/batch-scenes/${userId}?limit=50`);
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

  // =============================================
  // LIBRARY IMPORT METHODS
  // =============================================

  selectedLibraryScenes = [];
  currentLibraryFilter = 'all';

  // Open library import modal
  async openLibraryImportModal() {
    const modal = document.getElementById('library-import-modal');
    if (!modal) return;

    // Check if scene library manager is available
    if (typeof sceneLibraryManager === 'undefined') {
      showToast('Scene Library not loaded. Please refresh the page.', true);
      return;
    }

    // Load library scenes
    try {
      await sceneLibraryManager.loadFromSupabase();
      this.selectedLibraryScenes = [];
      this.currentLibraryFilter = 'all';
      this.renderLibraryImportGrid();

      modal.hidden = false;
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    } catch (error) {
      console.error('Failed to load library:', error);
      showToast('Failed to load scene library: ' + error.message, true);
    }
  }

  // Close library import modal
  closeLibraryImportModal() {
    const modal = document.getElementById('library-import-modal');
    if (modal) {
      modal.hidden = true;
      modal.style.display = 'none';
      document.body.style.overflow = '';
    }
    this.selectedLibraryScenes = [];
  }

  // Filter library scenes by tag
  filterLibraryImport(tag) {
    this.currentLibraryFilter = tag;

    // Update active filter button
    const filterBtns = document.querySelectorAll('#library-import-modal .library-filter-btn');
    filterBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === tag);
    });

    this.renderLibraryImportGrid();
  }

  // Render library import grid
  renderLibraryImportGrid() {
    const grid = document.getElementById('library-import-grid');
    const emptyState = document.getElementById('library-import-empty');

    if (!grid) return;

    let scenes = sceneLibraryManager.getByTag(this.currentLibraryFilter);

    if (scenes.length === 0) {
      grid.innerHTML = '';
      if (emptyState) emptyState.hidden = false;
      return;
    }

    if (emptyState) emptyState.hidden = true;

    grid.innerHTML = scenes.map(scene => {
      const isSelected = this.selectedLibraryScenes.includes(scene.id);
      return `
        <div class="library-import-item ${isSelected ? 'selected' : ''}" data-id="${scene.id}" onclick="videoEditor.toggleLibrarySceneSelection('${scene.id}')">
          <img src="${scene.imageUrl}" alt="${scene.libraryName || 'Library scene'}">
          <div class="library-import-selected-badge">✓</div>
          <div class="library-import-item-info">
            <div class="library-import-item-name">${scene.libraryName || 'Untitled'}</div>
            <span class="library-tag ${scene.libraryTag}">${scene.libraryTag}</span>
          </div>
        </div>
      `;
    }).join('');

    this.updateLibrarySelectionCount();
  }

  // Toggle scene selection
  toggleLibrarySceneSelection(sceneId) {
    const index = this.selectedLibraryScenes.indexOf(sceneId);
    if (index > -1) {
      this.selectedLibraryScenes.splice(index, 1);
    } else {
      this.selectedLibraryScenes.push(sceneId);
    }

    // Update UI
    const item = document.querySelector(`.library-import-item[data-id="${sceneId}"]`);
    if (item) {
      item.classList.toggle('selected');
    }

    this.updateLibrarySelectionCount();
  }

  // Update selection count
  updateLibrarySelectionCount() {
    const countSpan = document.getElementById('library-selected-count');
    const importBtn = document.getElementById('import-library-scenes-btn');

    if (countSpan) {
      countSpan.textContent = this.selectedLibraryScenes.length;
    }

    if (importBtn) {
      importBtn.disabled = this.selectedLibraryScenes.length === 0;
    }
  }

  // Confirm library import
  async confirmLibraryImport() {
    if (this.selectedLibraryScenes.length === 0) {
      showToast('Please select at least one scene', true);
      return;
    }

    // Get selected scenes
    const allScenes = sceneLibraryManager.scenes;
    const scenesToImport = allScenes.filter(s => this.selectedLibraryScenes.includes(s.id));

    if (scenesToImport.length === 0) {
      showToast('Selected scenes not found', true);
      return;
    }

    // Get scene duration from slider or default
    const sceneDuration = typeof getSceneDuration === 'function'
      ? getSceneDuration()
      : (document.getElementById('scene-duration')?.value || 6);
    const duration = parseInt(sceneDuration);

    // Convert library scenes to video editor format
    const newScenes = scenesToImport.map((scene, index) => ({
      id: Date.now() + index,
      imageUrl: scene.imageUrl,
      text: scene.caption || scene.prompt || '',
      duration: duration,
      caption: scene.caption || scene.prompt || '',
      startTime: 0 // Will be recalculated
    }));

    this.closeLibraryImportModal();

    // If there are existing scenes, ask user what to do
    if (this.scenes.length > 0) {
      this.showImportChoiceDialog(newScenes);
      return;
    }

    // No existing scenes - just import
    this.scenes = newScenes;
    this.recalculateTimings();
    this.finishImport(newScenes.length, 'imported from library');
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
      const response = await fetch(`/api/db/batch-scenes/${userId}?limit=50`);
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

  // Handle ZIP file upload
  async handleZipUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      showToast('Extracting ZIP file...', 'info');

      const zip = await JSZip.loadAsync(file);
      const imageFiles = [];

      // Get all image files from zip
      zip.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir && /\.(png|jpg|jpeg|webp)$/i.test(relativePath)) {
          imageFiles.push({ path: relativePath, entry: zipEntry });
        }
      });

      // Sort by filename to maintain order
      imageFiles.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));

      if (imageFiles.length === 0) {
        showToast('No images found in ZIP file', true);
        return;
      }

      // Get scene duration from slider or default
      const sceneDuration = typeof getSceneDuration === 'function'
        ? getSceneDuration()
        : (document.getElementById('scene-duration')?.value || 6);
      const duration = parseInt(sceneDuration);

      // Convert images to base64 and create scenes
      const newScenes = [];
      for (let i = 0; i < imageFiles.length; i++) {
        const blob = await imageFiles[i].entry.async('blob');

        // Convert to base64
        const reader = new FileReader();
        const base64Promise = new Promise((resolve) => {
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
        const base64Url = await base64Promise;

        newScenes.push({
          id: Date.now() + i,
          imageUrl: base64Url,
          text: `Scene ${i + 1}`,
          duration: duration,
          caption: '',
          startTime: 0 // Will be recalculated
        });
      }

      // If there are existing scenes, ask user what to do
      if (this.scenes.length > 0) {
        this.showImportChoiceDialog(newScenes);
      } else {
        // No existing scenes - just import
        this.scenes = newScenes;
        this.recalculateTimings();
        this.finishImport(newScenes.length, 'imported from ZIP');
      }

      // Reset file input
      event.target.value = '';

    } catch (error) {
      console.error('ZIP upload error:', error);
      showToast('Failed to extract ZIP file', true);
    }
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

      // Hide upload/record controls and show audio preview
      if (this.audioControls) {
        this.audioControls.hidden = true;
        this.audioControls.style.display = 'none';
      }

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

        // Now that audio is loaded, repair any avatar segments missing audio_url
        if (window.loadedAvatarSegments && window.loadedAvatarSegments.length > 0) {
          const needsRepair = window.loadedAvatarSegments.filter(s => !s.audio_url);
          if (needsRepair.length > 0) {
            console.log(`Audio loaded - triggering repair for ${needsRepair.length} segments...`);
            this.extractAudioFromAvatarSegments(window.loadedAvatarSegments);
          }
        }
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
      if (saved && saved.audioData && typeof saved.audioData === 'string' && saved.audioData.startsWith('data:')) {
        console.log('Found saved audio from Batch Scenes:', saved.fileName);

        // Convert base64 data URL to blob
        const response = await fetch(saved.audioData);
        const blob = await response.blob();

        this.audioBlob = blob;
        await this.loadAudioBlob(blob);

        showToast(`Loaded voiceover: ${saved.fileName}`, 'success');
      } else if (saved) {
        console.log('Invalid saved audio data, skipping:', typeof saved.audioData);
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

    // Hide preview and show upload/record controls again
    this.audioPreview.hidden = true;
    if (this.audioControls) {
      this.audioControls.hidden = false;
      this.audioControls.style.display = '';
    }

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

    // Load saved trim settings from localStorage
    try {
      const savedTrim = localStorage.getItem('video_editor_trim');
      console.log(`Trim restore: audioDuration=${this.audioDuration}, savedTrim=${savedTrim}`);
      if (savedTrim) {
        const { start, end } = JSON.parse(savedTrim);
        console.log(`Trim restore check: start=${start}, end=${end}, audioDuration=${this.audioDuration}`);
        // Only restore if values are within current audio duration (with small tolerance)
        // Allow end to be slightly larger than audioDuration due to rounding
        if (start >= 0 && end <= this.audioDuration + 1 && start < end) {
          this.trimStartTime = start;
          // Clamp end to audioDuration if it's slightly over
          this.trimEndTime = Math.min(end, this.audioDuration);
          console.log(`✓ Restored trim settings: ${this.formatTime(start)} - ${this.formatTime(this.trimEndTime)}`);
        } else {
          console.log(`✗ Trim not restored: end (${end}) > audioDuration (${this.audioDuration})?`);
        }
      }
    } catch (e) {
      console.error('Failed to load trim settings:', e);
    }

    // Set initial values
    this.trimStartInput.value = this.formatTime(this.trimStartTime);
    this.trimEndInput.value = this.formatTime(this.trimEndTime);
    this.trimDuration.textContent = this.formatTime(this.trimEndTime - this.trimStartTime);

    this.trimStartSlider.value = (this.trimStartTime / this.audioDuration) * 100;
    this.trimEndSlider.value = (this.trimEndTime / this.audioDuration) * 100;
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

    // Save trim settings to localStorage
    this.saveTrimSettings();
  }

  saveTrimSettings() {
    try {
      localStorage.setItem('video_editor_trim', JSON.stringify({
        start: this.trimStartTime,
        end: this.trimEndTime
      }));
    } catch (e) {
      console.error('Failed to save trim settings:', e);
    }
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

  // Compress WAV to WebM/Opus using MediaRecorder (for large files)
  async compressAudioToWebM(wavBlob) {
    const startTime = Date.now();

    // Decode WAV to AudioBuffer
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // Resume context if suspended (browser autoplay policy)
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    const arrayBuffer = await wavBlob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const durationSec = audioBuffer.duration;
    console.log(`Compressing ${durationSec.toFixed(1)}s audio from WAV to WebM (this takes real-time)...`);

    // Create a MediaStreamDestination to capture audio
    const dest = audioContext.createMediaStreamDestination();

    // Create a buffer source and connect to destination
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(dest);

    // Set up MediaRecorder to capture as WebM
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    const mediaRecorder = new MediaRecorder(dest.stream, {
      mimeType: mimeType,
      audioBitsPerSecond: 128000 // 128kbps - good quality, much smaller than WAV
    });

    const chunks = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    return new Promise((resolve, reject) => {
      let stopped = false;

      mediaRecorder.onstop = () => {
        if (stopped) return; // Prevent double-trigger
        stopped = true;
        const webmBlob = new Blob(chunks, { type: mimeType });
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`Compression complete in ${elapsed}s: ${(wavBlob.size / 1024 / 1024).toFixed(1)}MB -> ${(webmBlob.size / 1024 / 1024).toFixed(1)}MB`);
        audioContext.close();
        resolve(webmBlob);
      };

      mediaRecorder.onerror = (e) => {
        audioContext.close();
        reject(new Error('MediaRecorder error: ' + e.error));
      };

      // Start recording and play the audio
      mediaRecorder.start(1000); // Request data every 1 second
      source.start(0);

      // Progress logging
      let progressInterval = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const percent = Math.min(100, (elapsed / durationSec) * 100).toFixed(0);
        console.log(`Compression progress: ${percent}% (${elapsed.toFixed(0)}s / ${durationSec.toFixed(0)}s)`);
      }, 5000); // Log every 5 seconds

      // Use precise timeout based on audio duration (more reliable than onended)
      const timeout = (durationSec + 0.5) * 1000; // Small buffer
      setTimeout(() => {
        clearInterval(progressInterval);
        if (mediaRecorder.state === 'recording') {
          console.log('Audio playback complete, finalizing...');
          mediaRecorder.stop();
        }
      }, timeout);
    });
  }

  // Fix WebM metadata for proper seeking in long videos
  // Uses fix-webm-metainfo library which adds Duration, SeekHead, AND Cues
  // Cues are critical for seeking - without them, browser must load entire file
  async fixWebmDuration(blob, durationSeconds) {
    // Try using fix-webm-duration library (adds Duration for seekable playback)
    if (typeof fixWebmMetaInfo === 'function') {
      try {
        console.log(`Fixing WebM metadata...`);
        console.log(`Video size: ${(blob.size / 1024 / 1024).toFixed(1)}MB, duration: ${durationSeconds.toFixed(1)}s`);
        // Pass duration in milliseconds as required by fix-webm-duration
        const durationMs = durationSeconds * 1000;
        const fixedBlob = await fixWebmMetaInfo(blob, durationMs);
        console.log(`WebM metadata fixed! Size: ${(fixedBlob.size / 1024 / 1024).toFixed(1)}MB`);
        return fixedBlob;
      } catch (err) {
        console.warn('fix-webm-duration failed:', err.message);
      }
    } else {
      console.warn('fix-webm-duration library not loaded');
    }

    // Return original if library not available or failed
    console.log('Returning original WebM (may have seeking issues in long videos)');
    return blob;
  }

  // Stitch audio segments together (using replaced segments where available)
  async stitchAudioForExport() {
    if (!this.audioBlob) return null;

    // Check if we have any replaced segments
    const replacedKeys = Object.keys(this.replacedAudioSegments || {});
    if (replacedKeys.length === 0) {
      console.log('No replaced audio segments, using original audio');
      return this.audioBlob;
    }

    // If ALL segments are replaced, just concatenate the replaced audio (faster)
    const numAvatarSegments = this.avatarVideos?.length || 8;
    if (replacedKeys.length === numAvatarSegments) {
      console.log('All segments replaced - using fast concatenation');
      return this.fastStitchReplacedAudio();
    }

    console.log(`Stitching audio with ${replacedKeys.length}/${numAvatarSegments} replaced segments`);

    // Get original audio segments (this is slow - decodes entire audio)
    console.log('Splitting original audio into segments...');
    const originalSegments = await this.splitAudioForAvatar();
    console.log(`Split into ${originalSegments.length} segments`);

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
        console.log(`Segment ${segmentNum} decoded`);
      } catch (e) {
        console.error(`Failed to decode segment ${segmentNum}:`, e);
        // Fall back to original if decode fails
        const arrayBuffer = await originalSegments[i].blob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        segmentBuffers.push(audioBuffer);
      }
    }

    // Calculate total length - NORMALIZE all segments to 48000 Hz to prevent sync drift
    const TARGET_SAMPLE_RATE = 48000;
    const numChannels = segmentBuffers[0].numberOfChannels;

    // Check for sample rate mismatches and resample if needed
    const normalizedBuffers = [];
    for (let i = 0; i < segmentBuffers.length; i++) {
      const buf = segmentBuffers[i];
      if (buf.sampleRate !== TARGET_SAMPLE_RATE) {
        console.log(`Segment ${i + 1}: resampling from ${buf.sampleRate}Hz to ${TARGET_SAMPLE_RATE}Hz`);
        const resampled = await this.resampleAudioBuffer(buf, TARGET_SAMPLE_RATE);
        normalizedBuffers.push(resampled);
      } else {
        normalizedBuffers.push(buf);
      }
    }

    const sampleRate = TARGET_SAMPLE_RATE;
    let totalSamples = 0;
    for (const buf of normalizedBuffers) {
      totalSamples += buf.length;
    }

    // Create combined buffer
    const combinedBuffer = audioContext.createBuffer(numChannels, totalSamples, sampleRate);

    let offset = 0;
    for (const buf of normalizedBuffers) {
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

  // Resample audio buffer to target sample rate using OfflineAudioContext
  async resampleAudioBuffer(audioBuffer, targetSampleRate) {
    const numChannels = audioBuffer.numberOfChannels;
    const duration = audioBuffer.duration;
    const targetLength = Math.ceil(duration * targetSampleRate);

    // Create offline context with target sample rate
    const offlineCtx = new OfflineAudioContext(numChannels, targetLength, targetSampleRate);

    // Create buffer source
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    // Render resampled audio
    const resampledBuffer = await offlineCtx.startRendering();
    console.log(`Resampled: ${audioBuffer.sampleRate}Hz -> ${targetSampleRate}Hz, duration: ${resampledBuffer.duration.toFixed(2)}s`);

    return resampledBuffer;
  }

  // Fast stitch when ALL segments are replaced (no need to split original)
  async fastStitchReplacedAudio() {
    const replacedKeys = Object.keys(this.replacedAudioSegments || {}).map(Number).sort((a, b) => a - b);
    console.log('Fast stitching replaced segments:', replacedKeys);

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const segmentBuffers = [];

    for (const segmentNum of replacedKeys) {
      const audioBlob = this.replacedAudioSegments[segmentNum].blob;
      console.log(`Fast stitch: decoding segment ${segmentNum}...`);
      try {
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        segmentBuffers.push(audioBuffer);
        // Store duration for avatar boundary calculations
        this.replacedAudioSegments[segmentNum].duration = audioBuffer.duration;
        console.log(`Segment ${segmentNum} decoded: ${audioBuffer.duration.toFixed(2)}s (stored for sync)`);
      } catch (e) {
        console.error(`Failed to decode segment ${segmentNum}:`, e);
      }
    }

    if (segmentBuffers.length === 0) {
      console.error('No segments decoded, falling back to original');
      return this.audioBlob;
    }

    // NORMALIZE all segments to 48000 Hz to prevent sync drift
    const TARGET_SAMPLE_RATE = 48000;
    const numChannels = segmentBuffers[0].numberOfChannels;

    // Check for sample rate mismatches and resample if needed
    const normalizedBuffers = [];
    for (let i = 0; i < segmentBuffers.length; i++) {
      const buf = segmentBuffers[i];
      if (buf.sampleRate !== TARGET_SAMPLE_RATE) {
        console.log(`Fast stitch segment ${i + 1}: resampling from ${buf.sampleRate}Hz to ${TARGET_SAMPLE_RATE}Hz`);
        const resampled = await this.resampleAudioBuffer(buf, TARGET_SAMPLE_RATE);
        normalizedBuffers.push(resampled);
      } else {
        normalizedBuffers.push(buf);
      }
    }

    const sampleRate = TARGET_SAMPLE_RATE;
    let totalSamples = 0;
    for (const buf of normalizedBuffers) {
      totalSamples += buf.length;
    }

    console.log(`Combining ${normalizedBuffers.length} segments: ${totalSamples} samples, ${numChannels} channels (normalized to ${sampleRate}Hz)`);

    // Crossfade duration in samples (100ms crossfade to smooth audio transitions)
    const crossfadeSamples = Math.floor(sampleRate * 0.1);
    const adjustedTotalSamples = totalSamples - (crossfadeSamples * (normalizedBuffers.length - 1));
    console.log(`Using ${crossfadeSamples} sample crossfade (100ms) between segments`);

    // Create combined buffer (slightly shorter due to crossfade overlaps)
    const combinedBuffer = audioContext.createBuffer(numChannels, adjustedTotalSamples, sampleRate);

    let writeOffset = 0;
    for (let i = 0; i < normalizedBuffers.length; i++) {
      const buf = normalizedBuffers[i];
      const isFirst = i === 0;
      const isLast = i === normalizedBuffers.length - 1;

      for (let channel = 0; channel < numChannels; channel++) {
        const destData = combinedBuffer.getChannelData(channel);
        const srcData = buf.getChannelData(channel);

        for (let j = 0; j < srcData.length; j++) {
          const destIndex = writeOffset + j;
          if (destIndex >= adjustedTotalSamples) break;

          let sample = srcData[j];

          // Fade out at end of segment (except last)
          if (!isLast && j >= srcData.length - crossfadeSamples) {
            const fadeProgress = (srcData.length - j) / crossfadeSamples;
            sample *= fadeProgress;
          }

          // Fade in at start of segment (except first) and blend with previous
          if (!isFirst && j < crossfadeSamples) {
            const fadeProgress = j / crossfadeSamples;
            sample *= fadeProgress;
            // Add to existing faded-out samples from previous segment
            destData[destIndex] += sample;
          } else {
            destData[destIndex] = sample;
          }
        }
      }

      // Move write offset, overlapping by crossfade amount
      writeOffset += buf.length - (isLast ? 0 : crossfadeSamples);
    }

    console.log(`Crossfade stitching complete: ${combinedBuffer.duration.toFixed(2)}s`);

    // Convert to WAV blob
    const stitchedBlob = this.audioBufferToWav(combinedBuffer);
    console.log('Fast stitched audio created:', stitchedBlob.size, 'bytes', `${combinedBuffer.duration.toFixed(1)}s`);

    // CRITICAL: Store the AudioBuffer for direct playback during export
    // This avoids blob URL seeking issues with large files
    this.stitchedAudioBuffer = combinedBuffer;
    console.log('Stored AudioBuffer for direct export playback');

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

        // Save to database with audio_url for persistence across refreshes
        const userId = localStorage.getItem('ai_tool_user_id') || this.userId;
        if (userId && window.supabaseConfig) {
          try {
            const segmentNum = i + 1;
            // Upload audio segment to Supabase storage
            const audioPath = `audio/avatar-segment-${segmentNum}-${Date.now()}.wav`;
            const audioUploadUrl = `${window.supabaseConfig.url}/storage/v1/object/${window.supabaseConfig.bucket}/${audioPath}`;

            const audioUploadResponse = await fetch(audioUploadUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${window.supabaseConfig.anonKey}`,
                'apikey': window.supabaseConfig.anonKey,
                'Content-Type': 'audio/wav',
                'x-upsert': 'true'
              },
              body: segment.blob
            });

            if (audioUploadResponse.ok) {
              // Get signed URL instead of public URL to reduce CDN egress
              const audioSignedUrl = await getSignedReadUrl(audioPath);
              if (audioSignedUrl) {
                // Save segment to database with audio URL
                await fetch('/api/db/avatar-segments', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    userId,
                    segmentNum,
                    videoUrl: result.videoUrl,
                    fileName: `avatar_segment_${segmentNum}.mp4`,
                    audioUrl: audioSignedUrl
                  })
                });

                // Store in memory for immediate use
                this.replacedAudioSegments[segmentNum] = { blob: segment.blob, url: audioSignedUrl };
                console.log(`Segment ${segmentNum} saved to database with audio URL (signed URL)`);
              }
            }
          } catch (dbError) {
            console.warn(`Failed to save segment ${i + 1} to database:`, dbError.message);
          }
        }

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
      // Clear transcription, stitched transcription, captions and AI sync caches
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('transcription_') ||
          key.startsWith('stitched_transcription_') ||
          key.startsWith('captions_') ||
          key.startsWith('ai-sync-')
        )) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));

      // Also clear saved audio URL and stitched audio to force re-upload and re-stitch
      localStorage.removeItem('saved_audio_url');
      localStorage.removeItem('saved_audio_name');
      this.savedAudioUrl = null;
      this.stitchedAudioBlob = null; // Force re-stitching with current segment audio

      console.log(`Cleared ${keysToRemove.length} cached items + saved audio URL + stitched audio`);
      showToast('Cleared all caches - will re-stitch and re-transcribe', 'info');
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

      // Use stitched audio if we have replaced segments (so scene timing matches captions/export)
      let audioToSync = this.audioBlob;
      const hasReplacements = Object.keys(this.replacedAudioSegments || {}).length > 0;

      // Generate STABLE cache key (v3) using segment numbers - doesn't depend on blob sizes
      const segmentNums = Object.keys(this.replacedAudioSegments || {})
        .map(Number)
        .sort((a, b) => a - b)
        .join(',');
      const baseAudioKey = `${this.audioFileName || 'audio'}_${this.audioBlob?.size || 0}`;
      const stableCacheKey = `stitched_transcription_v3_${baseAudioKey}_segs_${segmentNums}`;

      // Legacy v2 key for backwards compatibility
      const segmentSizes = Object.entries(this.replacedAudioSegments || {})
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
        .map(([num, seg]) => `${num}:${seg.blob?.size || 0}`)
        .join(',');
      const legacyCacheKey = `stitched_transcription_v2_${baseAudioKey}_segsizes_${segmentSizes}`;

      console.log('Stable cache key (v3):', stableCacheKey);
      console.log('Legacy cache key (v2):', legacyCacheKey);

      let result = null;

      // Check v3 stable cache FIRST, then v2 legacy (before any audio processing)
      const cachedV3 = localStorage.getItem(stableCacheKey);
      if (cachedV3) {
        try {
          result = JSON.parse(cachedV3);
          console.log('✓ INSTANT: Using v3 stable cache (no stitch/compress needed!)', result.segments?.length, 'segments');
          showToast('Using cached transcription - instant!', 'success');
        } catch (e) {
          console.log('V3 cache invalid');
        }
      }
      // Fall back to v2 legacy cache
      if (!result) {
        const cachedV2 = localStorage.getItem(legacyCacheKey);
        if (cachedV2) {
          try {
            result = JSON.parse(cachedV2);
            console.log('✓ INSTANT: Using v2 legacy cache (no stitch/compress needed!)', result.segments?.length, 'segments');
            showToast('Using cached transcription - instant!', 'success');
            // Migrate to v3
            localStorage.setItem(stableCacheKey, cachedV2);
            console.log('Migrated cache to v3 stable key');
          } catch (e) {
            console.log('V2 cache invalid');
          }
        }
      }

      // Only stitch audio if we need to (no cache hit)
      if (!result && hasReplacements) {
        console.log('Found replaced audio segments - using STITCHED audio for sync (matches export/captions)');
        if (this.syncToAudioBtn) this.syncToAudioBtn.textContent = '⏳ Building stitched audio...';
        audioToSync = await this.stitchAudioForExport();
        console.log('Stitched audio ready for sync:', audioToSync?.size, 'bytes');
      }

      // Also check old-style hash caches as fallback
      if (!result) {
        console.log('Step 2: Audio blob:', audioToSync?.type, audioToSync?.size);
        const audioHash = await this.generateAudioHash(audioToSync);
        const transcriptionCacheKey = `transcription_${audioHash}`;
        const captionCacheKey = `captions_${audioHash}`;

        const cachedTranscription = localStorage.getItem(transcriptionCacheKey);
        const cachedCaptions = localStorage.getItem(captionCacheKey);

      if (cachedTranscription) {
        try {
          result = JSON.parse(cachedTranscription);
          console.log('Using CACHED transcription (from sync cache)', result.segments?.length, 'segments');
          showToast('Using cached transcription (no upload needed)', 'success');
        } catch (e) {
          console.log('Sync cache invalid');
        }
      }

      if (!result && cachedCaptions) {
        try {
          result = JSON.parse(cachedCaptions);
          console.log('REUSING caption transcription (no upload needed!)', result.segments?.length, 'segments');
          showToast('Reusing caption transcription - no upload needed!', 'success');
          // Also save to transcription cache for future
          localStorage.setItem(transcriptionCacheKey, cachedCaptions);
        } catch (e) {
          console.log('Caption cache invalid');
        }
      }

      // Only do upload/transcribe if no cache hit
      if (!result) {
        console.log('No cached transcription found - need to upload and transcribe');

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
        let mimeType = audioToSync.type || 'audio/mpeg';
        let extension = 'mp3';
        if (mimeType.includes('webm')) extension = 'webm';
        else if (mimeType.includes('wav')) extension = 'wav';
        else if (mimeType.includes('ogg')) extension = 'ogg';
        else if (mimeType.includes('m4a') || mimeType.includes('mp4')) extension = 'm4a';
        else if (mimeType.includes('flac')) extension = 'flac';
        else if (mimeType.includes('mpeg') || mimeType.includes('mp3')) extension = 'mp3';

        // Compress large WAV files to WebM (Supabase limit is 50MB)
        const fileSizeMB = audioToSync.size / (1024 * 1024);
        if (fileSizeMB > 50 && extension === 'wav') {
          console.log(`Audio is ${fileSizeMB.toFixed(1)}MB - compressing to WebM...`);
          if (this.syncToAudioBtn) this.syncToAudioBtn.textContent = '⏳ Compressing audio...';
          showToast(`Compressing ${fileSizeMB.toFixed(0)}MB audio (this takes a while)...`, 'info');
          try {
            audioToSync = await this.compressAudioToWebM(audioToSync);
            extension = 'webm';
            mimeType = 'audio/webm';
            console.log('Compressed to WebM:', (audioToSync.size / (1024 * 1024)).toFixed(1) + 'MB');
          } catch (compressError) {
            console.error('Compression failed:', compressError);
            throw new Error('Audio too large and compression failed');
          }
        }

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

        // Get signed URL (1 year expiry) instead of public URL to reduce CDN egress
        const { data: signedUrlData, error: signedUrlError } = await supabaseClient.storage
          .from(config.bucket)
          .createSignedUrl(fileName, 60 * 60 * 24 * 365); // 1 year expiry

        if (signedUrlError || !signedUrlData?.signedUrl) {
          console.error('Failed to create signed URL:', signedUrlError);
          throw new Error('Failed to generate audio URL');
        }
        const audioUrl = signedUrlData.signedUrl;
        console.log('Step 4c: Audio uploaded to:', audioUrl);

        // Keep replaced segments for export - they'll be stitched during export
        if (hasReplacements) {
          console.log('Keeping replaced audio segments for export stitching');
          console.log('Segments available:', Object.keys(this.replacedAudioSegments));
          showToast('AI avatar audio ready for export', 'success');
        }

        // Save audio URL for cross-browser persistence
        this.savedAudioUrl = audioUrl;
        localStorage.setItem('saved_audio_url', audioUrl);
        localStorage.setItem('saved_audio_name', this.audioFileName || 'combined-audio.m4a');
        // Also save to Supabase with scenes
        this.saveScenesToSupabase();

        // Transcribe
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
        const resultJson = JSON.stringify(result);
        localStorage.setItem(transcriptionCacheKey, resultJson);
        // ALSO save to v3 stable cache key for instant future lookups
        localStorage.setItem(stableCacheKey, resultJson);
        console.log('Transcription cached (hash + v3 stable key)');
      } // end if (!result) - upload/transcribe
      } // end if (!result) - fallback hash cache check

      console.log('Step 8: Transcription received:', result.segments?.length, 'segments');

      // Step 3: Use AI-powered scene synchronization (GPT-4o)
      // This intelligently analyzes scene content and transcript to determine optimal placement
      if (this.syncToAudioBtn) {
        this.syncToAudioBtn.textContent = '🤖 AI Analyzing...';
      }

      // Calculate duration - prefer explicit duration, then audioDuration, then calculate from segments
      let totalDuration = result.duration || this.audioDuration;
      if (!totalDuration || totalDuration === 0) {
        // Calculate from last segment's end time
        const segments = result.segments || [];
        if (segments.length > 0) {
          const lastSegment = segments[segments.length - 1];
          totalDuration = lastSegment.end || lastSegment.start || 0;
          console.log('Calculated duration from segments:', totalDuration);
        }
      }

      const matchedCount = await this.aiSyncScenes(result.segments || [], totalDuration);

      this.renderTimeline();
      this.renderCaptions();
      this.updateTotalDuration();

      // Save updated timings to Supabase
      this.saveScenesToSupabase();

      // All scenes now get timing via AI placement
      showToast(`AI synced ${this.scenes.length} scenes to ${totalDuration.toFixed(0)}s audio (${matchedCount} placed by GPT-4o)`, 'success');

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

  // Clean script text for AI sync - removes visual cues and stage directions
  // that aren't spoken in the audio
  cleanScriptForAiSync(text) {
    if (!text) return '';

    let cleaned = text;

    // Remove [Visual: ...] cues (case insensitive)
    cleaned = cleaned.replace(/\[Visual:[^\]]*\]/gi, '');

    // Remove [Beat...] stage directions
    cleaned = cleaned.replace(/\[Beat[^\]]*\]/gi, '');

    // Remove other common stage directions in brackets
    // e.g., [pause], [laughs], [sighs], [whispers], [shifts tone], etc.
    cleaned = cleaned.replace(/\[(pause|laughs?|sighs?|whispers?|shifts?[^\]]*|quietly|louder|softly|angrily|sadly|excitedly)[^\]]*\]/gi, '');

    // Remove empty brackets that might remain
    cleaned = cleaned.replace(/\[\s*\]/g, '');

    // Clean up multiple spaces and trim
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned;
  }

  // AI-powered scene synchronization using GPT-4o
  // This sends scenes + transcript to AI for intelligent placement
  async aiSyncScenes(segments, totalDuration) {
    if (!segments || segments.length === 0 || this.scenes.length === 0) {
      console.log('AI Sync: Missing segments or scenes, falling back to keyword matching');
      return this.matchScenesToSegments(segments, totalDuration);
    }

    // Prepare scene data for API (only send relevant fields)
    // Clean text to remove visual cues/stage directions that aren't spoken
    const sceneData = this.scenes.map((scene, index) => ({
      index,
      text: this.cleanScriptForAiSync(scene.text || ''),
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
        console.log('⚠️ To force fresh AI analysis, use Shift+Click on "Sync to Audio" button');

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

    // Debug: Log scene texts being sent (cleaned vs original)
    console.log('=== SCENE TEXTS BEING SENT TO AI (cleaned) ===');
    sceneData.forEach((s, i) => {
      const original = this.scenes[i]?.text || '';
      const cleaned = s.text || s.caption || 'NO TEXT';
      const wasCleaned = original !== cleaned && original.includes('[');
      console.log(`Scene ${i + 1}${wasCleaned ? ' (CLEANED)' : ''}: "${cleaned.substring(0, 100)}..."`);
      if (wasCleaned) {
        console.log(`  └─ Original had visual cues/stage directions removed`);
      }
    });
    console.log('=== END SCENE TEXTS ===');

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

  // Match scenes to script using DIRECT text matching (find exact phrases in transcript)
  async matchScenesToScript() {
    if (this.scenes.length === 0) {
      showToast('Add scenes first.');
      return;
    }

    // Get the cached transcription
    const segmentNums = Object.keys(this.replacedAudioSegments || {}).map(Number).sort((a, b) => a - b).join(',');
    const baseAudioKey = `${this.audioFileName || 'audio'}_${this.audioBlob?.size || 0}`;
    const stableCacheKey = `stitched_transcription_v3_${baseAudioKey}_segs_${segmentNums}`;

    let transcription = null;
    const cached = localStorage.getItem(stableCacheKey);
    if (cached) {
      try {
        transcription = JSON.parse(cached);
      } catch (e) {}
    }

    if (!transcription || !transcription.words || transcription.words.length === 0) {
      showToast('Run "Full Captions" first to get word timestamps.');
      return;
    }

    console.log('=== MATCHING SCENES TO SCRIPT (DIRECT TEXT MATCH) ===');
    console.log(`Scenes: ${this.scenes.length}, Words in transcript: ${transcription.words.length}`);

    const words = transcription.words;
    const anticipation = 2; // Show scene 2 seconds before words are spoken
    let matchedCount = 0;

    // Build a full transcript text with word positions
    const fullText = words.map(w => w.word.toLowerCase().replace(/[^\w]/g, '')).join(' ');

    this.scenes.forEach((scene, index) => {
      const sceneText = (scene.text || '').toLowerCase();
      if (!sceneText || sceneText.length < 10) {
        console.log(`Scene ${index + 1}: No text, skipping`);
        return;
      }

      // Extract key phrases (first 5-8 significant words)
      const sceneWords = sceneText
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3)
        .slice(0, 8);

      if (sceneWords.length < 3) {
        console.log(`Scene ${index + 1}: Too few words, skipping`);
        return;
      }

      // Search for these words in sequence in the transcript
      const searchPhrase = sceneWords.slice(0, 5).join(' ');
      let bestMatchTime = null;
      let bestMatchScore = 0;

      // Sliding window search through transcript words
      for (let i = 0; i < words.length - 3; i++) {
        let matchScore = 0;
        const windowWords = words.slice(i, i + 10).map(w => w.word.toLowerCase().replace(/[^\w]/g, ''));

        // Count how many scene words appear in this window
        for (const sw of sceneWords) {
          if (windowWords.includes(sw)) {
            matchScore++;
          }
        }

        // Check for sequence matches (consecutive words)
        const windowText = windowWords.join(' ');
        for (let len = Math.min(5, sceneWords.length); len >= 3; len--) {
          const phrase = sceneWords.slice(0, len).join(' ');
          if (windowText.includes(phrase)) {
            matchScore += len * 2; // Bonus for phrase match
            break;
          }
        }

        if (matchScore > bestMatchScore) {
          bestMatchScore = matchScore;
          bestMatchTime = words[i].start;
        }
      }

      if (bestMatchTime !== null && bestMatchScore >= 3) {
        const newStartTime = Math.max(0, bestMatchTime - anticipation);
        console.log(`Scene ${index + 1} MATCHED: ${scene.startTime?.toFixed(1) || '?'}s → ${newStartTime.toFixed(1)}s (score: ${bestMatchScore})`);
        console.log(`  Text: "${sceneText.substring(0, 60)}..."`);
        scene.matchedTime = newStartTime;
        scene.matchScore = bestMatchScore;
        matchedCount++;
      } else {
        console.log(`Scene ${index + 1}: No good match found (best score: ${bestMatchScore})`);
        console.log(`  Text: "${sceneText.substring(0, 60)}..."`);
        scene.matchedTime = null;
      }
    });

    console.log(`=== MATCHED ${matchedCount}/${this.scenes.length} SCENES ===`);

    if (matchedCount === 0) {
      showToast('No scenes could be matched to script. Check that scenes have script text attached.');
      return;
    }

    // Reorder scenes by matched time
    const matchedScenes = this.scenes.filter(s => s.matchedTime !== null);
    const unmatchedScenes = this.scenes.filter(s => s.matchedTime === null);

    // Sort matched scenes by their matched time
    matchedScenes.sort((a, b) => a.matchedTime - b.matchedTime);

    const totalDuration = this.audioDuration || 656;
    const minDuration = 5; // Minimum 5 seconds per scene

    console.log(`Matched ${matchedScenes.length} scenes, ${unmatchedScenes.length} unmatched`);
    console.log(`Total duration: ${totalDuration}s`);

    // Set startTime to ACTUAL matched time (when text is spoken)
    // Duration = time until next scene, with minimum of 5 seconds
    for (let i = 0; i < matchedScenes.length; i++) {
      const scene = matchedScenes[i];
      scene.startTime = scene.matchedTime;

      // Duration is time until next scene starts (or end of audio)
      if (i < matchedScenes.length - 1) {
        const nextStart = matchedScenes[i + 1].matchedTime;
        scene.duration = Math.max(minDuration, nextStart - scene.startTime);
      } else {
        scene.duration = Math.max(minDuration, totalDuration - scene.startTime);
      }

      console.log(`Scene at ${scene.startTime.toFixed(1)}s, duration ${scene.duration.toFixed(1)}s: "${(scene.text || '').substring(0, 40)}..."`);
    }

    // Put unmatched scenes (stage directions) in gaps or at end
    // For now, distribute them at the very end
    let endTime = totalDuration;
    const unmatchedDuration = 5;
    unmatchedScenes.forEach(scene => {
      scene.startTime = endTime;
      scene.duration = unmatchedDuration;
      endTime += unmatchedDuration;
      console.log(`Unmatched scene at ${scene.startTime.toFixed(1)}s: "${(scene.text || '').substring(0, 40)}..."`);
    });

    // Rebuild scenes array - matched scenes in order, unmatched at end
    this.scenes = [...matchedScenes, ...unmatchedScenes];

    // Cleanup temp properties
    this.scenes.forEach(s => {
      delete s.matchedTime;
      delete s.matchScore;
    });

    this.renderTimeline();
    this.renderCaptions();
    this.updateTotalDuration();
    this.saveScenesToSupabase();

    showToast(`Matched ${matchedCount}/${this.scenes.length} scenes to script! Check console for details.`, 'success');
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

    // Save reordered scenes
    this.saveScenesToSupabase();

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

    // Save reordered scenes
    this.saveScenesToSupabase();

    showToast(`Moved scene ${currentIndex + 1} to position ${nextIndex + 1}`, 'success');
  }

  // Recalculate scene timings after reordering
  recalculateSceneTimings() {
    let currentStart = 0;
    for (let i = 0; i < this.scenes.length; i++) {
      const scene = this.scenes[i];
      scene.id = i; // Keep ID in sync with position
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
      // Show first 60 chars of script text in tooltip
      const scriptPreview = (scene.text || '').substring(0, 60).replace(/"/g, '&quot;');
      const fullTooltip = scriptPreview ? `Script: "${scriptPreview}..."` : 'No script text';
      return `
        <div class="timeline-scene" data-index="${index}"
             style="left: ${leftPercent}%; width: ${widthPercent}%"
             title="${fullTooltip}">
          <div class="drag-handle" title="Drag to reposition">⋮⋮</div>
          <img src="${scene.imageUrl}" alt="Scene ${index + 1}"
               style="cursor: grab;">
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
      // Update the scene
      if (this.scenes[index]) {
        // Revoke old object URL if it exists
        if (this.scenes[index].imageUrl && this.scenes[index].imageUrl.startsWith('blob:')) {
          URL.revokeObjectURL(this.scenes[index].imageUrl);
        }

        // Convert to base64 for persistence (blob URLs break on tab close)
        const reader = new FileReader();
        const base64Promise = new Promise((resolve) => {
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(file);
        });
        const base64Url = await base64Promise;

        // Update with base64 URL so it persists
        this.scenes[index].imageUrl = base64Url;
        this.scenes[index].imageFile = file; // Store file for later upload if needed

        // Re-render all views with the new image
        this.renderImportedScenes();
        this.renderTimeline();
        this.renderCaptions();

        // Save to Supabase so it persists on refresh
        this.saveScenesToSupabase();

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
  // maxDuration: optional limit in seconds (e.g., 30 for test captions)
  // startOffset: where to start extracting audio (for testing middle sections)
  async generateCaptionsFromAudio(maxDuration = null, startOffset = 0, forceRefresh = false) {
    if (!this.audioBlob) {
      showToast('Record or upload audio first to generate captions.');
      return;
    }

    if (this.scenes.length === 0) {
      showToast('Add scenes first before generating captions.');
      return;
    }

    const isTestMode = maxDuration !== null;
    const activeBtn = isTestMode ? this.testCaptionsBtn : this.generateCaptionsBtn;

    // Validate start offset
    if (startOffset > 0 && startOffset >= this.audioDuration) {
      showToast(`Start time ${this.formatTime(startOffset)} is beyond audio length (${this.formatTime(this.audioDuration)})`);
      return;
    }

    // Show generating state
    if (activeBtn) {
      activeBtn.disabled = true;
      activeBtn.innerHTML = '⏳ Checking...';
    }

    try {
      // Use stitched audio if we have replaced segments (so captions match export audio)
      const hasReplacements = Object.keys(this.replacedAudioSegments || {}).length > 0;
      let baseAudio = this.audioBlob;

      console.log('=== CAPTION GENERATION DEBUG ===');
      console.log(`Has replacements: ${hasReplacements}`);
      console.log(`Is test mode: ${isTestMode}`);
      console.log(`Force refresh: ${forceRefresh}`);

      // Generate STABLE cache key using segment numbers and audio file name (v3)
      // V3 is more stable - doesn't depend on blob sizes which change on page reload
      const segmentNums = Object.keys(this.replacedAudioSegments || {})
        .map(Number)
        .sort((a, b) => a - b)
        .join(',');
      const baseAudioKey = `${this.audioFileName || 'audio'}_${this.audioBlob?.size || 0}`;
      const stableCacheKey = hasReplacements && !isTestMode
        ? `stitched_transcription_v3_${baseAudioKey}_segs_${segmentNums}`
        : null;

      // Also check v2 key for backwards compatibility (with blob sizes)
      const segmentSizes = Object.entries(this.replacedAudioSegments || {})
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
        .map(([num, seg]) => `${num}:${seg.blob?.size || 0}`)
        .join(',');
      const legacyCacheKey = hasReplacements && !isTestMode
        ? `stitched_transcription_v2_${baseAudioKey}_segsizes_${segmentSizes}`
        : null;

      console.log(`Segment nums: ${segmentNums}`);
      console.log(`Stable cache key (v3): ${stableCacheKey ? stableCacheKey.substring(0, 80) + '...' : 'NONE'}`);
      console.log(`Legacy cache key (v2): ${legacyCacheKey ? legacyCacheKey.substring(0, 80) + '...' : 'NONE'}`);

      // Check caches - try stable v3 first, then legacy v2
      let result = null;
      if (!forceRefresh && !isTestMode && hasReplacements) {
        // Try v3 stable key first
        if (stableCacheKey) {
          const cachedV3 = localStorage.getItem(stableCacheKey);
          if (cachedV3) {
            try {
              result = JSON.parse(cachedV3);
              console.log('✓ INSTANT: Using v3 stable cache for captions!', result.segments?.length, 'segments');
              showToast('Using cached transcription - instant!', 'success');
            } catch (e) {
              result = null;
            }
          }
        }
        // Fall back to v2 legacy key
        if (!result && legacyCacheKey) {
          const cachedV2 = localStorage.getItem(legacyCacheKey);
          if (cachedV2) {
            try {
              result = JSON.parse(cachedV2);
              console.log('✓ INSTANT: Using v2 legacy cache for captions!', result.segments?.length, 'segments');
              showToast('Using cached transcription - instant!', 'success');
              // Also save to v3 for future
              if (stableCacheKey) {
                localStorage.setItem(stableCacheKey, cachedV2);
                console.log('Migrated cache to v3 stable key');
              }
            } catch (e) {
              result = null;
            }
          }
        }
        if (!result) {
          console.log('⚠️ CACHE MISS: No cache found - will need to process audio');
          const allKeys = Object.keys(localStorage).filter(k => k.startsWith('stitched_transcription'));
          console.log(`Available transcription cache keys (${allKeys.length}):`);
          allKeys.slice(0, 5).forEach(k => console.log(`  - ${k.substring(0, 80)}...`));
        }
      } else if (forceRefresh) {
        console.log('⚠️ Force refresh requested - bypassing cache');
      } else {
        console.log('⚠️ No cache key (test mode or no replacements)');
      }

      // Only do audio processing if no cache hit
      if (!result && hasReplacements) {
        if (activeBtn) activeBtn.innerHTML = '⏳ Building stitched audio...';
        console.log('Generating captions from STITCHED audio (has replaced segments)');
        baseAudio = await this.stitchAudioForExport();
      }

      // Trim audio if maxDuration specified (for test mode - saves API cost)
      let audioToTranscribe = baseAudio;
      if (isTestMode) {
        const effectiveEnd = Math.min(startOffset + maxDuration, this.audioDuration);
        const effectiveDuration = effectiveEnd - startOffset;
        if (effectiveDuration > 0) {
          if (activeBtn) activeBtn.innerHTML = '⏳ Trimming audio...';
          audioToTranscribe = await this.trimAudioBlob(baseAudio, effectiveDuration, startOffset);
          console.log(`Extracted audio from ${this.formatTime(startOffset)} to ${this.formatTime(effectiveEnd)} for test`);
        }
      }

      // Only proceed with audio processing if we don't have a cached result
      if (!result) {
        // Check hash-based cache to avoid API costs (unless forceRefresh)
        const audioHash = await this.generateAudioHash(audioToTranscribe);
        const cacheKey = `captions_${audioHash}`;
        const cached = forceRefresh ? null : localStorage.getItem(cacheKey);

        if (forceRefresh) {
          console.log('Force refresh: bypassing caption cache');
          localStorage.removeItem(cacheKey); // Clear old cache entry
        } else if (cached) {
          try {
            result = JSON.parse(cached);
            console.log('Caption transcription loaded from hash cache (FREE!)');
            showToast('Using cached transcription (no API cost)', false);
          } catch (e) {
            console.log('Cache invalid, will call API');
            localStorage.removeItem(cacheKey);
          }
        }

      // Only call API if not cached
      if (!result) {
        // OPTIMIZATION: If we have a saved audio URL and don't need stitching/trimming,
        // use it directly without re-uploading (the audio is already on Supabase!)
        const canUseExistingUrl = !hasReplacements && !isTestMode && this.savedAudioUrl;

        if (canUseExistingUrl) {
          console.log('Using existing audio URL (no upload needed):', this.savedAudioUrl);
          if (activeBtn) activeBtn.innerHTML = '⏳ Transcribing...';

          const transcribeResponse = await fetch('/api/transcribe-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audioUrl: this.savedAudioUrl })
          });

          result = await transcribeResponse.json();

          if (!transcribeResponse.ok || result.error) {
            throw new Error(result.error || 'Transcription failed');
          }

          // Cache the result
          try {
            const resultJson = JSON.stringify(result);
            localStorage.setItem(cacheKey, resultJson);
            // Also save to stable v3 cache key for instant future lookups
            if (stableCacheKey) {
              localStorage.setItem(stableCacheKey, resultJson);
              console.log('Caption transcription cached (hash + v3 stable key)');
            } else {
              console.log('Caption transcription cached for future use');
            }
          } catch (e) {
            console.warn('Could not cache transcription:', e);
          }
        } else {
          // Need to upload audio (stitched or trimmed)
          // Determine file extension based on mime type or filename
          let extension = 'm4a'; // Default to m4a since that's the user's file
          const mimeType = audioToTranscribe.type || '';
          console.log('Audio blob MIME type:', mimeType, 'size:', audioToTranscribe.size);

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

          if (activeBtn) activeBtn.innerHTML = '⏳ Uploading...';

          // Check file size before attempting upload (Supabase default limit is 50MB)
          const fileSizeMB = audioToTranscribe.size / (1024 * 1024);
          if (fileSizeMB > 50) {
            console.warn(`Audio file is ${fileSizeMB.toFixed(1)}MB - may exceed Supabase limit`);
            showToast(`Large audio file (${fileSizeMB.toFixed(0)}MB) - this may fail. Compressing...`, 'warning');

            // Attempt to compress WAV to WebM using MediaRecorder
            if (extension === 'wav') {
              if (activeBtn) activeBtn.innerHTML = '⏳ Compressing audio...';
              try {
                audioToTranscribe = await this.compressAudioToWebM(audioToTranscribe);
                extension = 'webm';
                console.log('Compressed to WebM, new size:', (audioToTranscribe.size / (1024 * 1024)).toFixed(1) + 'MB');
              } catch (compressError) {
                console.error('Compression failed:', compressError);
                // Continue with original WAV
              }
            }
          }

          // Use signed upload URL to bypass Vercel's 4.5MB body limit
          const fileName = `audio-${Date.now()}.${extension}`;

        // Step 1: Get signed upload URL from server
        const signedUrlResponse = await fetch('/api/signed-upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName, contentType: audioToTranscribe.type || 'audio/mp4' })
        });

        if (!signedUrlResponse.ok) {
          const errorData = await signedUrlResponse.json().catch(() => ({}));
          console.error('Failed to get signed URL:', errorData);
          throw new Error(errorData.error || 'Failed to get upload URL');
        }

        const { signedUrl, publicUrl } = await signedUrlResponse.json();
        console.log('Got signed upload URL, uploading directly to Supabase...');

        // Step 2: Upload directly to Supabase using signed URL (bypasses Vercel limit)
        // Supabase SDK wraps Blobs in FormData - we must do the same
        const contentType = audioToTranscribe.type || 'audio/wav';
        console.log('Uploading with content-type:', contentType, 'size:', audioToTranscribe.size);

        const formData = new FormData();
        formData.append('', audioToTranscribe);  // Empty key is what Supabase SDK uses
        formData.append('cacheControl', '3600');

        const uploadResponse = await fetch(signedUrl, {
          method: 'PUT',
          headers: {
            'x-upsert': 'true'
          },
          body: formData
        });

        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text().catch(() => 'No response body');
          console.error('Direct upload failed:', uploadResponse.status, errorText);

          // Check if it's a file size limit error
          if (errorText.includes('Payload too large') || errorText.includes('maximum allowed size')) {
            const sizeMB = (audioToTranscribe.size / (1024 * 1024)).toFixed(1);
            throw new Error(`Audio file too large (${sizeMB}MB). The stitched WAV is uncompressed. Try using the original TTS captions, or increase your Supabase bucket file size limit.`);
          }
          throw new Error(`Failed to upload audio: ${errorText}`);
        }

        console.log('Audio uploaded to:', publicUrl);

        // Step 3: Transcribe from Supabase URL
        if (activeBtn) activeBtn.innerHTML = '⏳ Transcribing...';

        const transcribeResponse = await fetch('/api/transcribe-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audioUrl: publicUrl })
        });

        result = await transcribeResponse.json();

        if (!transcribeResponse.ok || result.error) {
          throw new Error(result.error || 'Transcription failed');
        }

          // Cache the result to avoid future API costs
          try {
            const resultJson = JSON.stringify(result);
            localStorage.setItem(cacheKey, resultJson);
            // Also save to stable v3 cache key for instant future lookups
            if (stableCacheKey) {
              localStorage.setItem(stableCacheKey, resultJson);
              console.log('Caption transcription cached (hash + v3 stable key)');
            } else {
              console.log('Caption transcription cached for future use');
            }
          } catch (e) {
            console.log('Could not cache transcription');
          }
        } // end else (upload path)
      } // end inner if (!result) - API call
      } // end outer if (!result) - audio processing

      console.log('Transcription for captions:', result);
      console.log('Word-level timestamps available:', result.words?.length || 0);

      // Offset timestamps if we extracted from a middle section
      if (startOffset > 0 && result.words) {
        result.words = result.words.map(w => ({
          ...w,
          start: w.start + startOffset,
          end: w.end + startOffset
        }));
        console.log(`Offset ${result.words.length} word timestamps by ${startOffset}s`);
      }
      if (startOffset > 0 && result.segments) {
        result.segments = result.segments.map(s => ({
          ...s,
          start: s.start + startOffset,
          end: s.end + startOffset
        }));
        console.log(`Offset ${result.segments.length} segment timestamps by ${startOffset}s`);
      }

      // Store word-level timestamps for accurate caption sync
      if (result.words && result.words.length > 0) {
        this.transcriptionWords = result.words;
        console.log('Stored', this.transcriptionWords.length, 'word timestamps');
      }

      // Distribute transcription segments across scenes
      if (result.segments && result.segments.length > 0) {
        this.applyCaptionsFromSegments(result.segments, result.words);
      } else if (result.transcription) {
        // Fallback: split transcription evenly across scenes
        this.applyCaptionsFromText(result.transcription);
      } else {
        throw new Error('No transcription content received');
      }

      this.renderCaptions();
      if (isTestMode) {
        const endTime = Math.min(startOffset + maxDuration, this.audioDuration);
        showToast(`Test captions: ${this.formatTime(startOffset)} to ${this.formatTime(endTime)}`, false);
      } else {
        showToast('Captions generated from audio!', false);
      }

    } catch (error) {
      console.error('Caption generation error:', error);
      showToast('Failed to generate captions: ' + error.message);
    } finally {
      // Restore button states
      if (this.generateCaptionsBtn) {
        this.generateCaptionsBtn.disabled = false;
        this.generateCaptionsBtn.innerHTML = '🎤 Full Audio';
      }
      if (this.testCaptionsBtn) {
        this.testCaptionsBtn.disabled = false;
        this.testCaptionsBtn.innerHTML = '🧪 Test 30s';
      }
    }
  }

  // Apply captions from transcription segments with word-level timestamps
  applyCaptionsFromSegments(segments, words = []) {
    const totalDuration = this.audioDuration || segments[segments.length - 1].end;

    console.log('=== APPLYING CAPTIONS TO SCENES ===');
    console.log(`Total audio duration: ${totalDuration.toFixed(2)}s`);
    console.log(`Total transcription segments: ${segments.length}`);
    console.log(`Total words with timestamps: ${words.length}`);
    console.log(`Total scenes: ${this.scenes.length}`);

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

        // Store word-level timestamps for this scene
        if (words && words.length > 0) {
          scene.captionWords = words.filter(w =>
            w.start >= sceneStart && w.start < sceneEnd
          ).map(w => ({
            word: w.word,
            start: w.start,
            end: w.end
          }));
          console.log(`Scene ${index}: stored ${scene.captionWords.length} word timestamps`);
        }
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
          // Also get words for the closest segment
          if (words && words.length > 0) {
            const seg = closestSegment.segment;
            scene.captionWords = words.filter(w =>
              w.start >= seg.start && w.start < seg.end
            ).map(w => ({
              word: w.word,
              start: w.start,
              end: w.end
            }));
          }
        } else {
          // No nearby segment - use scene text as fallback
          scene.caption = scene.text || '';
          scene.captionWords = null; // No timestamps available
        }
      }
    });

    // Summary of caption application
    const scenesWithCaptions = this.scenes.filter(s => s.caption && s.caption.length > 0).length;
    const scenesWithWordTimestamps = this.scenes.filter(s => s.captionWords && s.captionWords.length > 0).length;
    const totalWords = this.scenes.reduce((sum, s) => sum + (s.captionWords?.length || 0), 0);
    console.log('=== CAPTION APPLICATION SUMMARY ===');
    console.log(`Scenes with captions: ${scenesWithCaptions}/${this.scenes.length}`);
    console.log(`Scenes with word timestamps: ${scenesWithWordTimestamps}/${this.scenes.length}`);
    console.log(`Total word timestamps stored: ${totalWords}`);

    // Show first 3 scenes as sample
    console.log('Sample scene captions:');
    this.scenes.slice(0, 3).forEach((scene, i) => {
      console.log(`  Scene ${i+1} (${scene.startTime.toFixed(1)}s-${(scene.startTime + scene.duration).toFixed(1)}s): ${scene.captionWords?.length || 0} words - "${(scene.caption || '').substring(0, 50)}..."`);
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
  async openPreview() {
    // Avatar Only mode doesn't require scenes
    if (!this.avatarOnlyMode && this.scenes.length === 0) {
      showToast('Add scenes first to preview.');
      return;
    }

    // Sync uploaded avatar segments to avatarVideos array for preview
    // Use async version to get actual video durations (fixes stutter at segment boundaries)
    const hasSegments = Object.keys(window.uploadedAvatarSegments || {}).length > 0;
    if (hasSegments) {
      showToast('Loading segment durations...', 1500);
      await this.syncUploadedAvatarSegmentsWithDurations();
    } else {
      this.syncUploadedAvatarSegments();
    }

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
  // Now uses ACTUAL video durations instead of fixed 90s to prevent stutter at boundaries
  syncUploadedAvatarSegments() {
    const uploadedSegments = window.uploadedAvatarSegments || {};
    const segmentKeys = Object.keys(uploadedSegments).map(Number).sort((a, b) => a - b);

    if (segmentKeys.length === 0) return;

    // Use actual video durations if available, otherwise fall back to 90s
    // This fixes the stutter at segment boundaries (e.g., at 3 minutes)
    const FALLBACK_SEGMENT_LENGTH = 90;

    // Build avatarVideos array from uploaded segments using ACTUAL durations
    this.avatarVideos = [];
    let cumulativeTime = 0;

    segmentKeys.forEach((segNum) => {
      const seg = uploadedSegments[segNum];
      if (seg && seg.url) {
        // Use actual duration if stored, otherwise use fallback
        // Duration may be stored from previous load or video preload
        const actualDuration = seg.duration || seg.actualDuration || FALLBACK_SEGMENT_LENGTH;

        const startTime = cumulativeTime;
        const endTime = cumulativeTime + actualDuration;

        this.avatarVideos.push({
          videoUrl: seg.url,
          startTime: startTime,
          endTime: endTime,
          segmentIndex: segNum,
          actualDuration: actualDuration
        });

        console.log(`Avatar segment ${segNum}: ${startTime.toFixed(2)}s - ${endTime.toFixed(2)}s (duration: ${actualDuration.toFixed(2)}s)`);

        cumulativeTime = endTime;
      }
    });

    console.log(`Synced ${this.avatarVideos.length} avatar segments for preview (total: ${cumulativeTime.toFixed(2)}s)`);
  }

  // Async version that loads actual video durations - call this for accurate sync
  async syncUploadedAvatarSegmentsWithDurations() {
    const uploadedSegments = window.uploadedAvatarSegments || {};
    const segmentKeys = Object.keys(uploadedSegments).map(Number).sort((a, b) => a - b);

    if (segmentKeys.length === 0) return;

    console.log('Loading actual video durations for segment sync...');

    // First, load actual durations for all segments
    const durationPromises = segmentKeys.map(async (segNum) => {
      const seg = uploadedSegments[segNum];
      if (!seg || !seg.url) return;

      // Skip if we already have actual duration
      if (seg.actualDuration) return;

      try {
        const duration = await this.getVideoDuration(seg.url);
        seg.actualDuration = duration;
        seg.duration = duration; // Also set duration for compatibility
        console.log(`Segment ${segNum} actual duration: ${duration.toFixed(2)}s`);
      } catch (e) {
        console.log(`Failed to get duration for segment ${segNum}, using 90s fallback`);
        seg.actualDuration = 90;
        seg.duration = 90;
      }
    });

    await Promise.all(durationPromises);

    // Now sync with actual durations
    this.syncUploadedAvatarSegments();
  }

  // Helper to get video duration by loading it
  getVideoDuration(url) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;

      const timeout = setTimeout(() => {
        video.src = '';
        reject(new Error('Timeout loading video duration'));
      }, 10000);

      video.onloadedmetadata = () => {
        clearTimeout(timeout);
        const duration = video.duration;
        video.src = ''; // Clean up
        resolve(duration);
      };

      video.onerror = () => {
        clearTimeout(timeout);
        video.src = '';
        reject(new Error('Failed to load video'));
      };

      video.src = url;
    });
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
      // Find the correct avatar segment for this time
      const targetSegment = this.avatarVideos?.find(av =>
        this.playbackTime >= av.startTime && this.playbackTime < av.endTime
      );

      if (targetSegment && this.previewAvatarVideo) {
        // Set active segment for sync tracking
        this.activeSegment = targetSegment;

        // Calculate LOCAL time within this segment
        const localTime = this.playbackTime - targetSegment.startTime;
        // Use segment duration as fallback (90s typical)
        const segmentDuration = targetSegment.endTime - targetSegment.startTime;

        // Helper to safely seek video
        const safeSeek = (time) => {
          const duration = this.previewAvatarVideo.duration;
          const maxTime = isFinite(duration) && duration > 0 ? duration - 0.1 : segmentDuration - 0.1;
          const seekTime = Math.max(0, Math.min(time, maxTime));
          if (isFinite(seekTime)) {
            this.previewAvatarVideo.currentTime = seekTime;
          }
        };

        // Switch to correct segment video if needed
        if (targetSegment.videoUrl !== this.currentAvatarSegmentUrl) {
          console.log(`Seek: switching to segment ${targetSegment.startTime}s-${targetSegment.endTime}s, local time: ${localTime.toFixed(2)}s`);
          this.currentAvatarSegmentUrl = targetSegment.videoUrl;
          this.previewAvatarVideo.src = targetSegment.videoUrl;
          this.previewAvatarVideo.load();

          // Wait for video to load then seek to local time
          this.previewAvatarVideo.onloadeddata = () => {
            safeSeek(localTime);
            this.previewAvatarVideo.onloadeddata = null;
          };
        } else {
          // Same segment - just seek to local time
          safeSeek(localTime);
        }
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
      // Find the correct segment for current playback time
      const targetSegment = this.avatarVideos?.find(av =>
        this.playbackTime >= av.startTime && this.playbackTime < av.endTime
      ) || (this.avatarVideos && this.avatarVideos[0]);

      if (targetSegment && this.previewAvatarVideo) {
        // Calculate LOCAL time within this segment
        const localTime = Math.max(0, this.playbackTime - targetSegment.startTime);

        // Set active segment for sync tracking
        this.activeSegment = targetSegment;
        this.videoSyncReady = true;

        // Switch to correct segment if needed
        if (targetSegment.videoUrl !== this.currentAvatarSegmentUrl) {
          console.log(`Starting playback: loading segment ${targetSegment.startTime}s-${targetSegment.endTime}s, local time: ${localTime.toFixed(2)}s`);
          this.currentAvatarSegmentUrl = targetSegment.videoUrl;
          this.previewAvatarVideo.src = targetSegment.videoUrl;

          // Wait for video to load, then seek and play
          this.previewAvatarVideo.onloadeddata = () => {
            const seekTime = Math.min(localTime, this.previewAvatarVideo.duration - 0.1);
            if (isFinite(seekTime) && seekTime >= 0) {
              this.previewAvatarVideo.currentTime = seekTime;
            }
            this.previewAvatarVideo.play().catch(e => console.log('Avatar video play error:', e));
            this.previewAvatarVideo.onloadeddata = null;
          };
          this.previewAvatarVideo.load();
        } else {
          // Already on correct segment - just seek to local time and play
          const seekTime = Math.min(localTime, this.previewAvatarVideo.duration || 90);
          if (isFinite(seekTime) && seekTime >= 0) {
            this.previewAvatarVideo.currentTime = seekTime;
          }
          this.previewAvatarVideo.play().catch(e => console.log('Avatar video play error:', e));
        }
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
    // CRITICAL FIX: Use activeSegment (the segment currently loaded) not currentSegment (calculated from time)
    // Otherwise when crossing segment boundaries, we'd calculate wrong time (e.g., 180 + 89 = 269s jump!)
    const syncSegment = this.activeSegment || currentSegment;
    const isOnCorrectVideo = syncSegment && syncSegment.videoUrl === this.currentAvatarSegmentUrl;

    if (this.previewAvatarVideo && !this.previewAvatarVideo.paused && isOnCorrectVideo && !this.segmentSwitching && this.videoSyncReady) {
      const localVideoTime = this.previewAvatarVideo.currentTime;
      this.playbackTime = syncSegment.startTime + localVideoTime;
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

    // Hide caption overlay in preview (captions only show in export)
    if (this.previewCaptionOverlay) {
      this.previewCaptionOverlay.classList.remove('visible');
    }

    // Update scene indicator overlay
    this.updateSceneIndicator(this.playbackTime);

    // Update scrubber and time display
    this.updateScrubberPosition();
    this.updateTimeDisplay();

    // Continue loop
    this.animationFrame = requestAnimationFrame(() => this.animateNativeLayered());
  }

  // Render styled caption with word highlighting in preview (matches export style)
  renderStyledCaption(scene, currentTime) {
    if (!this.previewCaptionOverlay || !scene.caption) return;

    // Get caption style settings
    const textColor = document.getElementById('caption-text-color')?.value || '#FFFFFF';
    const highlightColor = document.getElementById('caption-highlight-color')?.value || '#FFFF00';
    const fontSize = document.getElementById('caption-font-size')?.value || '32';
    const fontFamily = document.getElementById('caption-font-family')?.value || 'Arial Black';

    // Get words and find current word
    let allWords, currentWordIndex = 0;

    if (scene.captionWords && scene.captionWords.length > 0) {
      allWords = scene.captionWords.map(w => w.word.trim()).filter(w => w.length > 0);
      currentWordIndex = scene.captionWords.findIndex(w => currentTime < w.end);
      if (currentWordIndex === -1) currentWordIndex = allWords.length - 1;
      currentWordIndex = Math.max(0, Math.min(allWords.length - 1, currentWordIndex));
    } else {
      // Fallback: split caption into words
      allWords = scene.caption.split(/\s+/).filter(w => w.length > 0);
      const sceneProgress = (currentTime - scene.startTime) / scene.duration;
      currentWordIndex = Math.floor(sceneProgress * allWords.length);
      currentWordIndex = Math.max(0, Math.min(allWords.length - 1, currentWordIndex));
    }

    // Build HTML with highlighted current word
    const wordsHtml = allWords.map((word, i) => {
      const color = i === currentWordIndex ? highlightColor : textColor;
      return `<span style="color: ${color}; ${i === currentWordIndex ? 'transform: scale(1.05);' : ''}">${word}</span>`;
    }).join(' ');

    // Apply styles to overlay
    this.previewCaptionOverlay.style.fontFamily = fontFamily;
    this.previewCaptionOverlay.style.fontSize = `${Math.round(parseInt(fontSize) * 0.6)}px`; // Scale for preview
    this.previewCaptionOverlay.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
    this.previewCaptionOverlay.style.fontWeight = 'bold';
    this.previewCaptionOverlay.innerHTML = wordsHtml;
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

    // Draw avatar with shape masking (fixes square avatar showing through)
    this.ctx.save();

    if (this.avatarShape === 'circle') {
      const centerX = drawX + drawWidth / 2;
      const centerY = drawY + drawHeight / 2;
      const radius = Math.min(drawWidth, drawHeight) / 2;

      this.ctx.beginPath();
      this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      this.ctx.closePath();
      this.ctx.clip();

      // Draw centered in circle
      this.ctx.drawImage(
        videoEl,
        drawX + (drawWidth - radius * 2) / 2,
        drawY + (drawHeight - radius * 2) / 2,
        radius * 2,
        radius * 2
      );
    } else {
      // Rectangle or square
      this.ctx.drawImage(videoEl, drawX, drawY, drawWidth, drawHeight);
    }

    this.ctx.restore();
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

  // Clean caption text by removing visual cues like [laughs], (pauses), etc.
  cleanCaptionText(text) {
    if (!text) return '';
    return text
      // Remove [bracketed text] like [laughs], [music], [applause]
      .replace(/\[.*?\]/g, '')
      // Remove (parenthetical text) like (pauses), (sighs)
      .replace(/\(.*?\)/g, '')
      // Remove *action text* like *laughs*, *clears throat*
      .replace(/\*.*?\*/g, '')
      // Remove stage directions in caps like VISUAL: or CUT TO:
      .replace(/[A-Z]{2,}:\s*/g, '')
      // Clean up extra whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  drawCaption(scene) {
    // Check if captions are enabled
    if (this.captionsEnabledToggle && !this.captionsEnabledToggle.checked) return;

    if (!scene.caption) return;

    // Clean the caption text (remove visual cues)
    const cleanCaption = this.cleanCaptionText(scene.caption);
    if (!cleanCaption) return;

    const canvasW = this.previewCanvas.width;
    const canvasH = this.previewCanvas.height;

    // Get timing info first to check scene boundaries
    const sceneStartTime = scene.startTime || 0;
    const sceneDuration = scene.duration || 6;
    const currentTime = this.playbackTime;
    const sceneEndTime = sceneStartTime + sceneDuration;

    // Don't draw caption if we're outside this scene's time range
    // This prevents captions from repeating/bleeding into the next scene
    if (currentTime < sceneStartTime || currentTime >= sceneEndTime) {
      return;
    }

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

    // Get words from captionWords if available, otherwise split caption text
    let allWords;
    if (scene.captionWords && scene.captionWords.length > 0) {
      allWords = scene.captionWords.map(w => w.word.trim()).filter(w => w.length > 0);
    } else {
      allWords = cleanCaption.split(/\s+/).filter(w => w.length > 0);
    }

    // Use scene-relative timing for word highlighting
    // Add small offset (0.15s) to compensate for render latency - makes captions appear slightly ahead
    const renderOffset = 0.15;
    const timeInScene = Math.max(0, (currentTime + renderOffset) - sceneStartTime);
    const wordDuration = sceneDuration / allWords.length;
    const rawWordIndex = Math.floor(timeInScene / wordDuration);
    const currentWordIndex = Math.max(0, Math.min(allWords.length - 1, rawWordIndex));

    // Only show current line of words (no preview of next line)
    const totalWordsToShow = wordsPerLine; // Show 1 line at a time
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

      // Add audio if available (use stitched audio with AI avatar segments)
      if (this.audioBlob) {
        this.exportStatus.textContent = 'Preparing audio (stitching clean segments)...';
        const audioToExport = await this.stitchAudioForExport();
        zip.file('voiceover.mp3', audioToExport);
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

  // Export Background Only - just scene images with correct timing, no avatar
  // This creates a clean background video that can be composited with FFmpeg
  async exportBackgroundOnly() {
    if (this.scenes.length === 0) {
      showToast('Add scenes first to export.');
      return;
    }

    this.exportProgress.hidden = false;
    this.exportVideoBtn.disabled = true;
    this.exportStatus.textContent = 'Exporting background scenes only...';

    try {
      const [width, height] = this.exportResolution.value.split('x').map(Number);
      const fps = parseInt(this.exportFps.value);
      const totalDuration = this.getTotalDuration();
      const totalFrames = Math.ceil(totalDuration * fps);

      // Create export canvas
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = width;
      exportCanvas.height = height;
      const ctx = exportCanvas.getContext('2d');

      // Preload all scene images
      this.exportStatus.textContent = 'Loading scene images...';
      const sceneImages = await Promise.all(
        this.scenes.map(scene => {
          return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = scene.imageUrl;
          });
        })
      );
      this.exportProgressBar.style.width = '20%';

      // Set up MediaRecorder (no audio - avatar video has the audio)
      const stream = exportCanvas.captureStream(fps);

      const mimeTypes = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4'
      ];
      let mimeType = mimeTypes.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 8000000
      });

      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      // Render frames
      let frameCount = 0;
      const frameInterval = 1000 / fps;

      recorder.start();

      await new Promise((resolve) => {
        const renderFrame = () => {
          if (frameCount >= totalFrames) {
            recorder.stop();
            resolve();
            return;
          }

          const currentTime = frameCount / fps;

          // Find current scene
          let accumulatedTime = 0;
          let currentScene = null;
          let sceneIndex = 0;

          for (let i = 0; i < this.scenes.length; i++) {
            const scene = this.scenes[i];
            if (currentTime >= accumulatedTime && currentTime < accumulatedTime + scene.duration) {
              currentScene = scene;
              sceneIndex = i;
              break;
            }
            accumulatedTime += scene.duration;
          }

          // Draw scene image (full screen, no avatar)
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, width, height);

          if (currentScene && sceneImages[sceneIndex]) {
            const img = sceneImages[sceneIndex];
            // Cover the canvas (like background-size: cover)
            const imgRatio = img.width / img.height;
            const canvasRatio = width / height;
            let drawWidth, drawHeight, drawX, drawY;

            if (imgRatio > canvasRatio) {
              drawHeight = height;
              drawWidth = height * imgRatio;
              drawX = (width - drawWidth) / 2;
              drawY = 0;
            } else {
              drawWidth = width;
              drawHeight = width / imgRatio;
              drawX = 0;
              drawY = (height - drawHeight) / 2;
            }

            ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
          }

          // Update progress
          const progress = 20 + (frameCount / totalFrames) * 70;
          this.exportProgressBar.style.width = `${progress}%`;

          if (frameCount % (fps * 10) === 0) {
            this.exportStatus.textContent = `Rendering background: ${Math.floor(currentTime)}s / ${Math.floor(totalDuration)}s`;
          }

          frameCount++;
          setTimeout(renderFrame, frameInterval / 2); // Faster than real-time
        };

        renderFrame();
      });

      // Wait for recorder to finish
      await new Promise(resolve => {
        recorder.onstop = resolve;
      });

      this.exportProgressBar.style.width = '95%';
      this.exportStatus.textContent = 'Creating video file...';

      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'background_only.webm';
      a.click();
      URL.revokeObjectURL(url);

      this.exportProgressBar.style.width = '100%';
      this.exportStatus.textContent = 'Background video exported! Now use FFmpeg to composite with your avatar.';
      showToast('Background video exported! Combine with avatar using FFmpeg.', 'success');

      // Show FFmpeg command helper
      console.log(`
=== FFmpeg COMPOSITE COMMAND ===
After downloading your avatar video, run:

ffmpeg -i background_only.webm -i avatar_video.mp4 \\
  -filter_complex "[1:v]scale=300:-1[avatar];[0:v][avatar]overlay=W-w-40:H-h-120" \\
  -map 1:a -c:a aac \\
  final_output.mp4

This will:
- Use background_only.webm as the main video
- Overlay avatar (scaled to 300px wide) in bottom-right
- Use audio from the avatar video
================================
      `);

    } catch (error) {
      console.error('Background export failed:', error);
      this.exportStatus.textContent = `Export failed: ${error.message}`;
      showToast('Export failed: ' + error.message);
    } finally {
      this.exportVideoBtn.disabled = false;
    }
  }

  // Export using MediaRecorder (works in all browsers without FFmpeg)
  // maxDuration: optional limit in seconds for test exports
  async exportWithMediaRecorder(maxDuration = null, startTime = 0) {
    this.exportProgress.hidden = false;
    this.exportVideoBtn.disabled = true;

    const isTestExport = maxDuration !== null;
    this.exportStatus.textContent = isTestExport
      ? `Preparing TEST export (${maxDuration}s from ${startTime}s)...`
      : 'Preparing MediaRecorder export...';

    try {
      const [width, height] = this.exportResolution.value.split('x').map(Number);
      const fps = parseInt(this.exportFps.value) || 30;
      const fullDuration = this.getTotalDuration();

      // Calculate duration considering startTime and maxDuration
      const availableDuration = fullDuration - startTime;
      let totalDuration = maxDuration ? Math.min(maxDuration, availableDuration) : availableDuration;

      if (startTime > 0) {
        console.log(`Test export: starting at ${startTime}s, exporting ${totalDuration}s`);
      }

      // Create export canvas
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = width;
      exportCanvas.height = height;
      const ctx = exportCanvas.getContext('2d');

      // Sync uploaded avatar segments with ACTUAL durations (fixes stutter at boundaries)
      await this.syncUploadedAvatarSegmentsWithDurations();

      // Load avatar video elements with progress and timeout
      const avatarVideoElements = [];
      const exportEndTime = startTime + totalDuration;
      if (this.avatarEnabled && this.avatarVideos && this.avatarVideos.length > 0) {
        // For test exports, only load videos that overlap with the export time range
        const videosToLoad = isTestExport
          ? this.avatarVideos.filter(av => {
              if (!av.videoUrl) return false;
              // Use actual endTime from avatar data (not fixed 90s)
              return av.startTime < exportEndTime && av.endTime > startTime;
            })
          : this.avatarVideos.filter(av => av.videoUrl);

        const totalVideos = videosToLoad.length;
        let loadedCount = 0;

        console.log(`Loading ${totalVideos} avatar videos in parallel${isTestExport ? ` (test mode: ${startTime}s to ${exportEndTime}s)` : ''}`);
        this.exportStatus.textContent = `Loading ${totalVideos} avatar videos...`;

        // Load all avatar videos in parallel (much faster than sequential)
        const timeout = isTestExport ? 30000 : 90000; // 90s for full export
        const videoLoadPromises = videosToLoad.map(async (av, index) => {
          try {
            const videoEl = await Promise.race([
              this.loadVideoElement(av.videoUrl),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Video load timeout')), timeout))
            ]);
            videoEl.muted = true;
            videoEl.loop = false;
            loadedCount++;
            this.exportProgressBar.style.width = `${(loadedCount / totalVideos) * 20}%`;
            console.log(`Loaded avatar video ${loadedCount}/${totalVideos}`);
            return { element: videoEl, ...av };
          } catch (e) {
            console.error(`Failed to load avatar video ${index + 1}:`, e);
            loadedCount++;
            return null;
          }
        });

        const loadedVideos = await Promise.all(videoLoadPromises);
        // Sort by startTime to maintain order
        avatarVideoElements.push(...loadedVideos.filter(v => v !== null).sort((a, b) => a.startTime - b.startTime));
        this.exportProgressBar.style.width = '20%';
      }

      // Preload scene images with progress
      this.exportStatus.textContent = 'Loading scene images...';
      this.exportProgressBar.style.width = '25%';
      let imagesLoaded = 0;
      const totalImages = this.scenes.length;
      const sceneImages = await Promise.all(this.scenes.map(scene => {
        return new Promise(resolve => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            imagesLoaded++;
            this.exportStatus.textContent = `Loading images ${imagesLoaded}/${totalImages}...`;
            this.exportProgressBar.style.width = `${25 + (imagesLoaded / totalImages) * 15}%`; // 25-40%
            resolve(img);
          };
          img.onerror = () => {
            imagesLoaded++;
            resolve(null);
          };
          img.src = scene.imageUrl;
        });
      }));
      this.exportProgressBar.style.width = '40%';

      // Create audio element with stitched audio (using replaced segments)
      let audioElement = null;
      let audioContext = null;
      const hasReplacedSegments = this.replacedAudioSegments && Object.keys(this.replacedAudioSegments).length > 0;

      if (this.audioBlob) {
        this.exportStatus.textContent = 'Preparing audio (stitching segments)...';
        this.exportProgressBar.style.width = '45%';
        console.log('Stitching audio for export, hasReplacedSegments:', hasReplacedSegments);

        // Try stitching with 45 second timeout, fall back to original if it fails
        let audioToUse;
        try {
          audioToUse = await Promise.race([
            this.stitchAudioForExport(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Stitching timeout')), 45000))
          ]);
          console.log('Audio stitched, size:', audioToUse?.size);

          // RE-SYNC avatar segment boundaries AFTER stitching
          // Stitching sets actual audio durations, so boundaries need updating
          if (hasReplacedSegments) {
            console.log('Re-syncing avatar segments with actual audio durations...');
            this.syncUploadedAvatarSegments();

            // CRITICAL: Also update avatarVideoElements with new boundaries!
            // The video elements are already loaded, just need to update timing
            avatarVideoElements.forEach(avEl => {
              const updated = this.avatarVideos.find(av => av.segmentIndex === avEl.segmentIndex);
              if (updated) {
                const oldStart = avEl.startTime;
                const oldEnd = avEl.endTime;
                avEl.startTime = updated.startTime;
                avEl.endTime = updated.endTime;
                console.log(`Updated avatarVideoElement seg ${avEl.segmentIndex}: ${oldStart.toFixed(2)}-${oldEnd.toFixed(2)} -> ${avEl.startTime.toFixed(2)}-${avEl.endTime.toFixed(2)}`);
              }
            });
          }
        } catch (e) {
          console.warn('Audio stitching failed or timed out, using original audio:', e.message);
          this.exportStatus.textContent = 'Using original audio (stitching timed out)...';
          audioToUse = this.audioBlob;
        }
        this.exportProgressBar.style.width = '50%';

        this.exportStatus.textContent = 'Loading audio for export...';

        // IMPORTANT: If we have stitched audio (with AI avatar audio), use it!
        // Don't fall back to the existing player which has original audio
        if (hasReplacedSegments && audioToUse && audioToUse !== this.audioBlob) {
          console.log('Using STITCHED audio for export:', audioToUse.size, 'bytes');
          const stitchedUrl = URL.createObjectURL(audioToUse);
          audioElement = new Audio(stitchedUrl);
          audioElement.muted = false;
          audioElement.preload = 'auto';

          // Wait for stitched audio to FULLY buffer (not just metadata)
          await Promise.race([
            new Promise(resolve => {
              let metadataLoaded = false;
              let resolved = false;

              audioElement.onloadedmetadata = () => {
                metadataLoaded = true;
                console.log('Stitched audio metadata loaded, duration:', audioElement.duration);
              };

              audioElement.oncanplaythrough = () => {
                if (!resolved) {
                  resolved = true;
                  console.log('Stitched audio fully buffered');
                  resolve(true);
                }
              };

              // For large files, also check progress
              audioElement.onprogress = () => {
                if (!resolved && metadataLoaded && audioElement.buffered.length > 0) {
                  const bufferedEnd = audioElement.buffered.end(audioElement.buffered.length - 1);
                  console.log(`Stitched audio buffered: ${bufferedEnd.toFixed(1)}s / ${audioElement.duration.toFixed(1)}s`);
                  // If we've buffered past the start time, we can proceed
                  if (bufferedEnd >= Math.min(startTime + 60, audioElement.duration)) {
                    resolved = true;
                    console.log('Stitched audio buffered enough for export');
                    resolve(true);
                  }
                }
              };

              audioElement.load();
            }),
            new Promise(resolve => setTimeout(() => {
              console.warn('Stitched audio buffer timeout, proceeding anyway');
              resolve(false);
            }, 30000))
          ]);

          this.exportProgressBar.style.width = '55%';
          console.log('Stitched audio ready for export, duration:', audioElement.duration);
        } else {
          // No stitched audio - try existing player or fallback
          const existingPlayer = document.getElementById('audio-player');
          if (existingPlayer && existingPlayer.duration > 0 && existingPlayer.readyState >= 2) {
            console.log('Using existing audio player (no stitching needed), duration:', existingPlayer.duration);
            audioElement = existingPlayer.cloneNode(true);
            audioElement.currentTime = 0;
            this.exportProgressBar.style.width = '55%';
            console.log('Audio ready for export (cloned player)');
          } else {
            // Try Supabase URL if available
            const supabaseUrl = this.audioUrl;
            if (supabaseUrl) {
              console.log('Loading audio from Supabase URL:', supabaseUrl);
              audioElement = new Audio(supabaseUrl);
            } else {
              console.log('Creating audio element from blob:', audioToUse?.size, 'bytes', audioToUse?.type);
              audioElement = new Audio(URL.createObjectURL(audioToUse));
            }

            audioElement.muted = false;
            audioElement.preload = 'auto';
            audioElement.crossOrigin = 'anonymous';

            // Add error handler
            audioElement.onerror = (e) => {
              console.error('Audio element error:', audioElement.error?.code, audioElement.error?.message);
            };

            // Wait for audio to be ready with 15 second timeout
            const audioLoaded = await Promise.race([
              new Promise(resolve => {
                audioElement.oncanplaythrough = () => resolve(true);
                audioElement.onloadedmetadata = () => {
                  console.log('Audio metadata loaded, duration:', audioElement.duration);
                  resolve(true);
                };
                audioElement.load();
              }),
              new Promise(resolve => setTimeout(() => resolve(false), 15000))
            ]);

            if (!audioLoaded) {
              console.warn('Audio load timeout - trying to proceed anyway');
            }
            this.exportProgressBar.style.width = '55%';
            console.log('Audio ready for export, duration:', audioElement.duration);
          }
        }
      }

      // Set up MediaRecorder
      const stream = exportCanvas.captureStream(fps);

      // Add audio track - prefer AudioBufferSourceNode for stitched audio (avoids blob URL seeking issues)
      let audioBufferSource = null;
      let useBufferSource = false;
      let audioBufferStartContextTime = 0; // Track when AudioBufferSource started (in AudioContext time)

      if (this.stitchedAudioBuffer && hasReplacedSegments) {
        // Use AudioBufferSourceNode - this is MUCH more reliable for large stitched audio
        // It can start at any offset instantly without seeking issues
        try {
          console.log('Using AudioBufferSourceNode for stitched audio (instant offset playback)');
          audioContext = new AudioContext();

          if (audioContext.state === 'suspended') {
            await audioContext.resume();
            console.log('AudioContext resumed');
          }

          audioBufferSource = audioContext.createBufferSource();
          audioBufferSource.buffer = this.stitchedAudioBuffer;

          const destination = audioContext.createMediaStreamDestination();
          audioBufferSource.connect(destination);

          const audioTracks = destination.stream.getAudioTracks();
          console.log('AudioBufferSource tracks to add:', audioTracks.length);
          audioTracks.forEach(track => stream.addTrack(track));

          useBufferSource = true;
          // Don't use audioElement for time - we'll use elapsed time
          audioElement = null;
          console.log(`AudioBufferSourceNode ready, duration: ${this.stitchedAudioBuffer.duration.toFixed(1)}s`);
        } catch (e) {
          console.error('AudioBufferSourceNode failed, falling back to element:', e.message);
          useBufferSource = false;
        }
      }

      // Fallback: use MediaElementSource if AudioBufferSource not available
      if (!useBufferSource && audioElement) {
        try {
          console.log('Creating AudioContext for audio routing...');
          audioContext = new AudioContext();
          console.log('AudioContext state:', audioContext.state);

          // Resume AudioContext if suspended (required after user gesture)
          if (audioContext.state === 'suspended') {
            await audioContext.resume();
            console.log('AudioContext resumed');
          }

          const source = audioContext.createMediaElementSource(audioElement);
          console.log('MediaElementSource created successfully');
          const destination = audioContext.createMediaStreamDestination();
          source.connect(destination);
          // Don't connect to speakers to avoid echo
          const audioTracks = destination.stream.getAudioTracks();
          console.log('Audio tracks to add:', audioTracks.length);
          audioTracks.forEach(track => stream.addTrack(track));
          console.log('Audio track added to stream successfully');
        } catch (e) {
          console.error('Audio track not added:', e.message);
          console.error('Audio element src:', audioElement.src?.substring(0, 50));
          console.error('Audio element crossOrigin:', audioElement.crossOrigin);
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
      // Seek to startTime for test exports from a specific position
      let audioPlaybackFailed = false;

      // Start AudioBufferSourceNode if we're using it (instant offset - no seeking needed!)
      if (useBufferSource && audioBufferSource) {
        console.log(`Starting AudioBufferSource at offset ${startTime}s (instant, no seek needed)`);
        // AudioBufferSourceNode.start(when, offset, duration) - starts at exact offset instantly
        audioBufferSource.start(0, startTime);
        // CRITICAL: Record AudioContext time when we started - this is the sync anchor
        // Using AudioContext.currentTime ensures we sync to the actual audio clock
        audioBufferStartContextTime = audioContext.currentTime;
        console.log(`AudioBufferSource playback started at audioContext.currentTime=${audioBufferStartContextTime.toFixed(3)}s`);
      }

      if (audioElement) {
        try {
          // For blob URLs, we need to wait for seek to complete before playing
          if (startTime > 0) {
            console.log(`Seeking audio to ${startTime}s before playback...`);

            // Wait for the seek to complete (longer timeout for large stitched files)
            await new Promise((resolve, reject) => {
              const seekTimeout = setTimeout(() => {
                console.warn('Audio seek timeout, proceeding with elapsed time fallback');
                audioPlaybackFailed = true;
                resolve();
              }, 15000);

              audioElement.onseeked = () => {
                clearTimeout(seekTimeout);
                console.log('Audio seek completed, currentTime:', audioElement.currentTime);
                resolve();
              };

              audioElement.onerror = (e) => {
                clearTimeout(seekTimeout);
                console.error('Audio seek error:', e);
                audioPlaybackFailed = true;
                resolve();
              };

              audioElement.currentTime = startTime;
            });
          }

          if (!audioPlaybackFailed) {
            await audioElement.play();
            console.log('Audio playback started, currentTime:', audioElement.currentTime);

            // Verify audio is actually playing after a short delay
            await new Promise(resolve => setTimeout(resolve, 200));
            if (Math.abs(audioElement.currentTime - startTime) < 0.1 && !audioElement.paused) {
              // Audio didn't advance - might be stuck
              console.warn('Audio appears stuck at', audioElement.currentTime, '- checking...');
              await new Promise(resolve => setTimeout(resolve, 300));
              if (Math.abs(audioElement.currentTime - startTime) < 0.1) {
                console.warn('Audio confirmed stuck, switching to elapsed time fallback');
                audioPlaybackFailed = true;
              }
            }
          }
        } catch (e) {
          console.error('Audio playback failed:', e);
          audioPlaybackFailed = true;
        }
      }

      // If audio failed, we'll use elapsed time calculation in renderFrame
      if (audioPlaybackFailed) {
        console.log('Using elapsed time fallback instead of audio time');
        audioElement = null; // Force elapsed time calculation
      }

      // Pre-seek all avatar videos and WAIT for seeks AND frame data to be ready
      // This is critical for lip sync - videos must have actual frame data, not just metadata
      this.exportStatus.textContent = 'Syncing avatar videos...';
      const seekPromises = avatarVideoElements.map(av => {
        if (av && av.element) {
          const localTime = Math.max(0, startTime - av.startTime);
          return new Promise(resolve => {
            const vid = av.element;

            // Helper to check if video is truly ready (has frame data)
            const checkReady = () => {
              if (vid.readyState >= 2) {
                console.log(`Avatar segment ${av.segmentIndex}: READY at ${localTime.toFixed(2)}s (readyState=${vid.readyState})`);
                return true;
              }
              return false;
            };

            // Step 1: Wait for seek to complete
            const onSeeked = () => {
              vid.removeEventListener('seeked', onSeeked);
              console.log(`Avatar segment ${av.segmentIndex}: seeked to ${localTime.toFixed(2)}s (readyState=${vid.readyState})`);

              // Pre-set switchTime so this segment won't trigger skip frames when activated
              // Use -2000 to make it appear "old enough" when export starts
              av.switchTime = performance.now() - 2000;

              // Step 2: Check if frame data is ready
              if (checkReady()) {
                resolve();
                return;
              }

              // Step 3: Need to wait for frame data - try play/pause to trigger buffering
              console.log(`Avatar segment ${av.segmentIndex}: waiting for frame data (readyState=${vid.readyState})...`);

              const onCanPlay = () => {
                vid.removeEventListener('canplay', onCanPlay);
                vid.removeEventListener('canplaythrough', onCanPlay);
                vid.pause();
                vid.currentTime = localTime; // Re-seek after play triggered buffering
                if (checkReady()) {
                  resolve();
                } else {
                  // One more wait for the re-seek
                  setTimeout(() => {
                    checkReady();
                    resolve();
                  }, 100);
                }
              };

              vid.addEventListener('canplay', onCanPlay);
              vid.addEventListener('canplaythrough', onCanPlay);

              // Trigger buffering by briefly playing
              vid.play().then(() => {
                // Play started, wait for canplay event
              }).catch(() => {
                // Autoplay blocked, try muted
                vid.muted = true;
                vid.play().catch(() => {
                  console.log(`Avatar segment ${av.segmentIndex}: play failed, continuing anyway`);
                  resolve();
                });
              });

              // Timeout fallback for frame data
              setTimeout(() => {
                vid.removeEventListener('canplay', onCanPlay);
                vid.removeEventListener('canplaythrough', onCanPlay);
                vid.pause();
                console.log(`Avatar segment ${av.segmentIndex}: timeout waiting for frame data (readyState=${vid.readyState})`);
                resolve();
              }, 3000);
            };

            vid.addEventListener('seeked', onSeeked);
            vid.currentTime = localTime;
            vid.pause();

            // Timeout fallback for seek
            setTimeout(() => {
              vid.removeEventListener('seeked', onSeeked);
              console.log(`Avatar segment ${av.segmentIndex}: seek timeout (readyState=${vid.readyState})`);
              resolve();
            }, 2000);
          });
        }
        return Promise.resolve();
      });
      await Promise.all(seekPromises);
      console.log('All avatar videos pre-seeked and ready');

      // Render frames synced to real time (driven by audio)
      this.exportStatus.textContent = 'Recording video...';
      const recordingStartTime = performance.now();

      // Pre-initialize lastActiveAvatar to avoid triggering "switch" on first frame
      // Find the avatar segment that should be active at startTime
      let lastActiveAvatar = null;
      for (const av of avatarVideoElements) {
        if (av && startTime >= av.startTime && startTime < av.endTime) {
          lastActiveAvatar = av;
          // Set switchTime to "already old" so we don't skip frames
          av.switchTime = recordingStartTime - 1000;
          // Start playing immediately so video can buffer
          av.element.playbackRate = 1.0;
          av.element.play().catch(() => {});
          console.log(`Pre-initialized active avatar: segment ${av.segmentIndex}, starting playback`);
          break;
        }
      }
      let frameCount = 0;
      let lastSceneIndex = -1;
      let lastAvatarResyncTime = 0; // Track when we last resynced to prevent feedback loop

      const renderFrame = () => {
        frameCount++;
        // Use audio time if available, otherwise calculate from AudioContext time (synced to audio)
        // CRITICAL: When using AudioBufferSourceNode, we MUST use AudioContext time, not performance.now()
        // AudioContext.currentTime is synced to the audio hardware clock, ensuring perfect sync
        let currentTime;
        if (audioElement) {
          currentTime = audioElement.currentTime;
        } else if (useBufferSource && audioContext) {
          // Use AudioContext clock - this is synced to the actual audio playback
          currentTime = startTime + (audioContext.currentTime - audioBufferStartContextTime);

          // DIAGNOSTIC: Log clock drift every 30 seconds to verify sync
          if (frameCount % 900 === 1) { // Every 30s at 30fps
            const perfTime = startTime + (performance.now() - recordingStartTime) / 1000;
            const clockDrift = currentTime - perfTime;
            console.log(`[SYNC CHECK ${currentTime.toFixed(1)}s] AudioContext=${currentTime.toFixed(3)}s, performance.now=${perfTime.toFixed(3)}s, drift=${clockDrift.toFixed(3)}s`);
          }
        } else {
          // Fallback to wall clock (less accurate but better than nothing)
          currentTime = startTime + (performance.now() - recordingStartTime) / 1000;
        }

        if (currentTime >= exportEndTime || (audioElement && audioElement.ended)) {
          // Done rendering
          mediaRecorder.stop();
          if (audioElement) audioElement.pause();
          // Stop AudioBufferSourceNode if using it
          if (audioBufferSource) {
            try { audioBufferSource.stop(); } catch (e) { /* may already be stopped */ }
          }
          // Stop all avatar videos
          for (const av of avatarVideoElements) {
            if (av && av.element) av.element.pause();
          }
          return;
        }

        // Find current scene
        let scene = this.scenes.find(s =>
          currentTime >= s.startTime && currentTime < s.startTime + s.duration
        );

        // If no scene found (gap in timeline), use closest scene
        if (!scene) {
          // Find scene that ends closest to current time
          scene = this.scenes.reduce((closest, s) => {
            const sceneEnd = s.startTime + s.duration;
            const closestEnd = closest.startTime + closest.duration;
            return Math.abs(currentTime - sceneEnd) < Math.abs(currentTime - closestEnd) ? s : closest;
          }, this.scenes[0]);
          console.log(`No scene at ${currentTime.toFixed(2)}s, using fallback scene ${this.scenes.indexOf(scene)}`);
        }

        const sceneIndex = this.scenes.indexOf(scene);
        const sceneImg = sceneImages[sceneIndex];

        // Clear canvas
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);

        // Draw scene image with Ken Burns - use same logic as preview's applyKenBurnsEffect
        if (sceneImg) {
          const effect = this.zoomEffect ? this.zoomEffect.value : 'zoom-in';
          // Clamp progress to 0-1 to prevent extreme zoom during scene gaps
          const rawProgress = (currentTime - scene.startTime) / scene.duration;
          const progress = Math.max(0, Math.min(1, rawProgress));

          // Calculate scale and offset based on effect (match preview exactly)
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
              // Use scene index to determine effect (same as preview)
              const effects = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right'];
              const randomEffect = effects[sceneIndex % effects.length];
              switch (randomEffect) {
                case 'zoom-in': scale = 1 + (progress * 0.1); break;
                case 'zoom-out': scale = 1.1 - (progress * 0.1); break;
                case 'pan-left': offsetX = -progress * 50; break;
                case 'pan-right': offsetX = progress * 50; break;
              }
              break;
            // 'none' - scale stays at 1, no offsets
          }

          // Get image dimensions
          const imgW = sceneImg.naturalWidth || sceneImg.width || 1;
          const imgH = sceneImg.naturalHeight || sceneImg.height || 1;

          // Debug on scene changes
          if (sceneIndex !== lastSceneIndex) {
            console.log(`Scene ${sceneIndex}: image ${imgW}x${imgH}, canvas ${width}x${height}, effect: ${effect}, time: ${currentTime.toFixed(2)}s, progress: ${progress.toFixed(3)}, scale: ${scale.toFixed(3)}`);
            lastSceneIndex = sceneIndex;
          }

          // Warn if progress or scale is abnormal
          if (progress < 0 || progress > 1.5 || scale > 1.2) {
            console.warn(`Abnormal values at ${currentTime.toFixed(2)}s: progress=${progress.toFixed(3)}, scale=${scale.toFixed(3)}, scene ${sceneIndex}`);
          }

          // Skip if image isn't loaded
          if (imgW <= 1 || imgH <= 1) {
            console.warn(`Scene ${sceneIndex} image not loaded properly: ${imgW}x${imgH}`);
            ctx.fillStyle = '#333';
            ctx.fillRect(0, 0, width, height);
          } else {
            const imgRatio = imgW / imgH;
            const canvasRatio = width / height;

            let drawW, drawH;
            if (imgRatio > canvasRatio) {
              // Image is wider than canvas - fit by height
              drawH = height * scale;
              drawW = drawH * imgRatio;
            } else {
              // Image is taller than canvas - fit by width
              drawW = width * scale;
              drawH = drawW / imgRatio;
            }

            // Center the image with offset (matches preview exactly)
            const x = (width - drawW) / 2 + offsetX;
            const y = (height - drawH) / 2 + offsetY;

            ctx.drawImage(sceneImg, x, y, drawW, drawH);
          }
        }

        // Draw avatar overlay - play videos smoothly
        if (avatarVideoElements.length > 0) {
          // PRE-SEEK: Prepare next segment 1 second before boundary
          // This ensures the video is at the right frame when we need to switch
          const PRE_SEEK_TIME = 1.0; // seconds before boundary to pre-seek

          // Find the NEXT segment based on actual segment boundaries (not fixed 90s)
          // This fixes the stutter at 3-minute mark when segment 2 is slightly longer
          const currentSegmentIdx = avatarVideoElements.findIndex(av =>
            av && currentTime >= av.startTime && currentTime < av.endTime
          );
          const nextSegmentIdx = currentSegmentIdx >= 0 ? currentSegmentIdx + 1 : 0;
          const nextSegment = avatarVideoElements[nextSegmentIdx];
          const nextBoundary = nextSegment ? nextSegment.startTime : null;
          const timeToNextBoundary = nextBoundary !== null ? nextBoundary - currentTime : Infinity;

          if (nextSegment && nextSegment.element && !nextSegment._preSeekDone &&
              timeToNextBoundary > 0 && timeToNextBoundary <= PRE_SEEK_TIME) {
            // Pre-seek to position 0 so it's ready when we switch
            nextSegment.element.currentTime = 0;
            nextSegment.element.muted = true;
            nextSegment._preSeekDone = true;
            nextSegment.switchTime = performance.now(); // Mark as pre-seeked
            console.log(`🎯 PRE-SEEK: segment ${nextSegment.segmentIndex} ready at t=${currentTime.toFixed(1)}s (${timeToNextBoundary.toFixed(1)}s before boundary at ${nextBoundary.toFixed(1)}s)`);
          }

          // Find avatar for current time, but also check if video has ended
          let avatarData = avatarVideoElements.find(av =>
            av && currentTime >= av.startTime && currentTime < av.endTime
          );

          // Debug: Log every 30 seconds to track avatar state
          if (frameCount % 900 === 0) { // Every 30 seconds at 30fps
            if (avatarData) {
              console.log(`[${currentTime.toFixed(1)}s] Avatar seg ${avatarData.segmentIndex}: video=${avatarData.element?.currentTime?.toFixed(1)}s/${avatarData.element?.duration?.toFixed(1)}s, ended=${avatarData.element?.ended}`);
            } else {
              console.log(`[${currentTime.toFixed(1)}s] No avatar found. Segments: ${avatarVideoElements.map(av => `${av.segmentIndex}:${av.startTime}-${av.endTime}`).join(', ')}`);
            }
          }

          // CRITICAL: Check if this avatar's video has ended BEFORE trying to switch/draw
          // This prevents the loop bug where we seek past video end
          if (avatarData && avatarData.element) {
            const expectedLocalTime = currentTime - avatarData.startTime;
            const videoDuration = avatarData.element.duration || 90;

            // If video has ended or we're past its duration, mark it but KEEP DRAWING
            // Don't set avatarData = null - we want to keep showing the last frame
            // until the next segment starts (prevents flash/gap at boundaries)
            if (avatarData.element.ended || expectedLocalTime >= videoDuration - 0.05) {
              if (!avatarData._loggedEnd) {
                console.log(`Avatar segment ${avatarData.segmentIndex} video ended at ${currentTime.toFixed(1)}s (video: ${videoDuration.toFixed(1)}s, expected: ${expectedLocalTime.toFixed(1)}s) - holding last frame`);
                avatarData._loggedEnd = true;
              }
              // Mark as ended but DON'T set to null - keep drawing last frame
              avatarData._hasEnded = true;
            }
          } else if (!avatarData && frameCount % 30 === 0) {
            // Log when no avatar is found (every second)
            console.log(`[${currentTime.toFixed(1)}s] No matching avatar segment`);
          }

          // Handle avatar video switching
          if (avatarData && avatarData !== lastActiveAvatar) {
            // Pause previous avatar
            if (lastActiveAvatar && lastActiveAvatar.element) {
              lastActiveAvatar.element.pause();
            }
            // Start new avatar at correct position - safe now because we checked video hasn't ended
            const localTime = currentTime - avatarData.startTime;
            const vidDur = avatarData.element.duration;
            console.log(`AVATAR SWITCH at ${currentTime.toFixed(1)}s: seg ${avatarData.segmentIndex}, seeking to localTime=${localTime.toFixed(2)}s, videoDuration=${vidDur?.toFixed(1)}s, ended=${avatarData.element.ended}`);

            // EXTRA SAFETY: Don't seek if localTime exceeds video duration
            if (vidDur && localTime >= vidDur - 0.1) {
              console.log(`BLOCKED: Would seek past video end. Skipping this avatar.`);
              avatarData = null;
            } else {
              avatarData.element.currentTime = localTime;
              // Set playback rate to catch up if we're behind (helps with sync)
              avatarData.element.playbackRate = 1.0;
              avatarData.element.play().catch(() => {});
              lastActiveAvatar = avatarData;
              // Only set switchTime if not already set by pre-seek (which sets it to a time in the past)
              // If switchTime is already > 1 second old, keep it (pre-seeked)
              const timeSincePreSeek = avatarData.switchTime ? performance.now() - avatarData.switchTime : Infinity;
              if (timeSincePreSeek > 1000) {
                // Pre-seeked segment - keep the old switchTime so we don't skip frames
                console.log(`Avatar switch: segment ${avatarData.segmentIndex}, localTime=${localTime.toFixed(2)}s (pre-seeked, no skip)`);
              } else {
                // Not pre-seeked or very recent - set new switchTime
                avatarData.switchTime = performance.now();
                console.log(`Avatar switch: segment ${avatarData.segmentIndex}, localTime=${localTime.toFixed(2)}s (NEW switchTime)`);
              }
            }
          } else if (!avatarData && lastActiveAvatar) {
            // No avatar for this time (or video ended), pause current
            lastActiveAvatar.element.pause();
            lastActiveAvatar = null;
          }

          if (avatarData && avatarData.element) {
            // TIGHT sync: continuously sync avatar video to audio timeline
            // This is critical for lip sync - we force the video to match audio time
            const expectedLocalTime = currentTime - avatarData.startTime;
            const videoDuration = avatarData.element.duration || 90;
            const actualVideoTime = avatarData.element.currentTime;
            const drift = actualVideoTime - expectedLocalTime; // positive = video ahead, negative = video behind
            const absDrift = Math.abs(drift);

            // Check if we just switched segments
            const timeSinceSwitch = avatarData.switchTime ? performance.now() - avatarData.switchTime : Infinity;

            // CRITICAL: Always skip first 100ms after switch to let video element update its frame
            // This gives time for video decode and buffer - prevents "loop" visual artifact
            const tooSoonAfterSwitch = timeSinceSwitch < 100;  // ~6 frames at 60fps, ~3 at 30fps

            // Also check if video has decoded data for current position (readyState >= 2)
            // readyState: 0=NOTHING, 1=METADATA, 2=CURRENT_DATA, 3=FUTURE_DATA, 4=ENOUGH_DATA
            const videoNotReady = avatarData.element.readyState < 2;

            // ALWAYS DRAW SOMETHING - never skip frames, it causes sync issues
            // If current segment not ready, draw from previous segment instead
            const canDrawCurrent = avatarData.element.readyState >= 2 && !tooSoonAfterSwitch;

            // Continuous sync: DISABLED - seeking during playback causes visual stutter
            // Only log severe drift for debugging, don't correct it
            // The pre-seek and initial segment positioning should be enough
            if (absDrift > 0.5 && frameCount % 30 === 0) {
              // Only log once per second if drift is severe (>0.5s)
              console.log(`[DRIFT WARNING] drift=${drift.toFixed(2)}s at ${currentTime.toFixed(1)}s (not correcting - would cause stutter)`);
            }

            if (!canDrawCurrent) {
              // Can't draw current segment yet - draw previous segment to fill the gap
              if (lastActiveAvatar && lastActiveAvatar !== avatarData && lastActiveAvatar.element && lastActiveAvatar.element.readyState >= 2) {
                // Draw from previous segment
                const rect = this.getAvatarOverlayRect(width, height);
                ctx.save();
                if (this.avatarShape === 'circle') {
                  const centerX = rect.x + rect.width / 2;
                  const centerY = rect.y + rect.height / 2;
                  const radius = Math.min(rect.width, rect.height) / 2;
                  ctx.beginPath();
                  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
                  ctx.closePath();
                  ctx.clip();
                  ctx.drawImage(lastActiveAvatar.element, rect.x + (rect.width - radius * 2) / 2, rect.y + (rect.height - radius * 2) / 2, radius * 2, radius * 2);
                } else {
                  ctx.drawImage(lastActiveAvatar.element, rect.x, rect.y, rect.width, rect.height);
                }
                ctx.restore();
                if (frameCount % 30 === 0) {
                  console.log(`Drawing previous segment while waiting for segment ${avatarData.segmentIndex}`);
                }
              }
            } else {
              // Video is close enough to expected position - sync and draw
              // Keep playbackRate at 1.0 always - adjustments cause visual stutter
              if (avatarData.element.playbackRate !== 1.0) {
                avatarData.element.playbackRate = 1.0;
              }

              // DISABLE ALL SEEKING during playback - seeking causes stutter
              // The video is pre-seeked to correct position, just let it play
              // Small drift (<0.5s) is acceptable - human perception is forgiving

              const rect = this.getAvatarOverlayRect(width, height);

              // Match preview exactly - simple stretch to fit, no aspect ratio preservation
              ctx.save();
              if (this.avatarShape === 'circle') {
                const centerX = rect.x + rect.width / 2;
                const centerY = rect.y + rect.height / 2;
                const radius = Math.min(rect.width, rect.height) / 2;
                ctx.beginPath();
                ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
                ctx.closePath();
                ctx.clip();
                // Draw same as preview: stretch to fit circle
                ctx.drawImage(
                  avatarData.element,
                  rect.x + (rect.width - radius * 2) / 2,
                  rect.y + (rect.height - radius * 2) / 2,
                  radius * 2,
                  radius * 2
                );
              } else {
                // Rectangle - stretch to fit rect (same as preview)
                ctx.drawImage(avatarData.element, rect.x, rect.y, rect.width, rect.height);
              }
              ctx.restore();
            }
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

        // Update progress (recording is 55-95% of total progress)
        // Calculate progress relative to export range
        const elapsedInExport = currentTime - startTime;
        const recordingPercent = Math.round((elapsedInExport / totalDuration) * 100);
        const overallPercent = 55 + Math.round((elapsedInExport / totalDuration) * 40); // 55-95%
        this.exportProgressBar.style.width = `${Math.min(95, overallPercent)}%`;
        this.exportStatus.textContent = `Recording: ${recordingPercent}% (${elapsedInExport.toFixed(1)}s / ${totalDuration}s)`;

        // Debug: log progress every 100 frames
        if (frameCount % 100 === 0) {
          console.log(`Export progress: currentTime=${currentTime.toFixed(1)}, exportEndTime=${exportEndTime}, elapsed=${elapsedInExport.toFixed(1)}/${totalDuration}`);
        }

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
      let videoBlob = new Blob(chunks, { type: selectedMimeType });
      let extension = selectedMimeType.includes('mp4') ? 'mp4' : 'webm';

      console.log('=== Export Post-Processing ===');
      console.log('Initial format:', extension, 'Size:', (videoBlob.size / 1024 / 1024).toFixed(1) + 'MB');
      console.log('FFmpeg loaded:', this.ffmpegLoaded, 'FFmpeg instance:', !!this.ffmpeg);

      // If we recorded WebM but FFmpeg is available, convert to MP4 (or remux for better seeking)
      if (extension === 'webm' && this.ffmpegLoaded && this.ffmpeg) {
        const videoSizeMB = videoBlob.size / (1024 * 1024);
        console.log(`WebM size: ${videoSizeMB.toFixed(1)}MB`);

        // For large files (>100MB), prefer fast remux over full transcode to avoid memory issues
        const useRemuxOnly = videoSizeMB > 100;

        try {
          this.exportStatus.textContent = useRemuxOnly ? 'Fixing video metadata...' : 'Converting to MP4...';
          this.exportProgressBar.style.width = '96%';

          // Write WebM to FFmpeg
          const webmData = new Uint8Array(await videoBlob.arrayBuffer());
          await this.ffmpeg.writeFile('input.webm', webmData);

          if (useRemuxOnly) {
            // Fast remux: just copy streams to fix Cues/seeking metadata (no re-encoding)
            // FFmpeg will automatically add proper Duration and Cues elements
            console.log('Large file - using fast remux to fix seeking metadata');
            await this.ffmpeg.exec([
              '-i', 'input.webm',
              '-c', 'copy',           // Copy all streams (no re-encode = fast!)
              '-y',                   // Overwrite output
              'output.webm'
            ]);

            const fixedWebm = await this.ffmpeg.readFile('output.webm');
            videoBlob = new Blob([fixedWebm.buffer], { type: 'video/webm' });
            extension = 'webm';

            await this.ffmpeg.deleteFile('input.webm');
            await this.ffmpeg.deleteFile('output.webm');

            console.log('WebM remuxed successfully for better seeking');
          } else {
            // Convert to MP4 with H.264/AAC for smaller files
            await this.ffmpeg.exec([
              '-i', 'input.webm',
              '-c:v', 'libx264',
              '-preset', 'fast',
              '-crf', '23',
              '-c:a', 'aac',
              '-b:a', '128k',
              '-movflags', '+faststart',
              'output.mp4'
            ]);

            // Read the MP4
            const mp4Data = await this.ffmpeg.readFile('output.mp4');
            videoBlob = new Blob([mp4Data.buffer], { type: 'video/mp4' });
            extension = 'mp4';

            // Cleanup
            await this.ffmpeg.deleteFile('input.webm');
            await this.ffmpeg.deleteFile('output.mp4');

            console.log('Converted WebM to MP4 successfully');
          }
        } catch (conversionError) {
          console.warn('FFmpeg processing failed:', conversionError.message);

          // Fallback: try fixing WebM duration with pure JS
          try {
            this.exportStatus.textContent = 'Fixing video metadata (fallback)...';
            videoBlob = await this.fixWebmDuration(videoBlob, totalDuration);
            console.log('WebM duration fixed with JS fallback');
          } catch (fixError) {
            console.warn('WebM fix failed, keeping original:', fixError.message);
            // Keep original WebM - may have seeking issues
          }
        }
      } else if (extension === 'webm') {
        // No FFmpeg - try pure JS fix for WebM duration/seeking
        console.log('FFmpeg not available - using pure JS WebM fix');
        try {
          this.exportStatus.textContent = 'Optimizing video...';
          const originalSize = videoBlob.size;
          videoBlob = await this.fixWebmDuration(videoBlob, totalDuration);
          console.log(`WebM duration fixed (no FFmpeg). Size: ${(originalSize / 1024 / 1024).toFixed(1)}MB -> ${(videoBlob.size / 1024 / 1024).toFixed(1)}MB`);
        } catch (fixError) {
          console.warn('WebM fix failed:', fixError.message);
        }
      } else {
        console.log('No post-processing needed (format:', extension, ')');
      }

      // Download
      this.exportProgressBar.style.width = '100%';
      const url = URL.createObjectURL(videoBlob);
      const a = document.createElement('a');
      a.href = url;
      const filename = isTestExport
        ? `test_export_${maxDuration}s_${Date.now()}.${extension}`
        : `video_export_${Date.now()}.${extension}`;
      a.download = filename;
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
  // maxDuration: optional limit in seconds for test exports
  async exportVideo(maxDuration = null, startTime = 0) {
    if (this.scenes.length === 0) {
      showToast('Add scenes first to export.');
      return;
    }

    // Try MediaRecorder first (works in all browsers)
    if (!this.ffmpegLoaded) {
      console.log('FFmpeg not available, using MediaRecorder export');
      return this.exportWithMediaRecorder(maxDuration, startTime);
    }

    this.exportProgress.hidden = false;
    this.exportVideoBtn.disabled = true;
    this.exportStatus.textContent = 'Preparing export...';

    try {
      const [width, height] = this.exportResolution.value.split('x').map(Number);
      const fps = parseInt(this.exportFps.value);
      const fullDuration = this.getTotalDuration();

      // Calculate duration based on startTime and maxDuration
      const availableDuration = fullDuration - startTime;
      const exportDuration = maxDuration ? Math.min(maxDuration, availableDuration) : availableDuration;
      const totalFrames = Math.ceil(exportDuration * fps);

      if (startTime > 0) {
        console.log(`Test export: starting at ${startTime}s, exporting ${exportDuration}s`);
      }

      // Step 1: Load avatar videos (from generated + uploaded segments)
      // Use actual video durations instead of fixed 90s to prevent stutter at boundaries
      let avatarVideoElements = [];
      if (this.avatarEnabled && this.audioBlob) {
        // Sync segments with actual durations first
        await this.syncUploadedAvatarSegmentsWithDurations();

        // Check if we have uploaded segments
        const uploadedSegments = window.uploadedAvatarSegments || {};
        const hasUploaded = Object.keys(uploadedSegments).length > 0;

        // Generate any missing segments if we have avatar photo
        if (this.avatarPhotoBlob) {
          this.exportStatus.textContent = 'Generating talking avatar...';
          await this.generateAvatarVideos();
        }

        // Merge uploaded segments with generated ones using ACTUAL durations
        this.exportStatus.textContent = 'Loading avatar videos...';
        const segmentSources = [];
        const segmentKeys = Object.keys(uploadedSegments).map(Number).sort((a, b) => a - b);
        let cumulativeTime = 0;

        for (const segNum of segmentKeys) {
          const seg = uploadedSegments[segNum];
          if (seg && seg.url) {
            const actualDuration = seg.duration || seg.actualDuration || 90;
            segmentSources.push({
              videoUrl: seg.url,
              startTime: cumulativeTime,
              endTime: cumulativeTime + actualDuration,
              segmentIndex: segNum,
              source: 'uploaded'
            });
            console.log(`Using uploaded segment ${segNum}: ${cumulativeTime.toFixed(2)}s - ${(cumulativeTime + actualDuration).toFixed(2)}s`);
            cumulativeTime += actualDuration;
          }
        }

        // Also check generated segments if no uploaded
        if (segmentSources.length === 0 && this.avatarVideos) {
          this.avatarVideos.forEach((av, idx) => {
            if (av.videoUrl) {
              segmentSources.push({
                videoUrl: av.videoUrl,
                startTime: av.startTime,
                endTime: av.endTime,
                segmentIndex: idx + 1,
                source: 'generated'
              });
              console.log(`Using generated segment ${idx + 1}: ${av.startTime.toFixed(2)}s - ${av.endTime.toFixed(2)}s`);
            }
          });
        }

        // Load all video elements with segment metadata
        if (segmentSources.length > 0) {
          const loadedElements = await Promise.all(
            segmentSources.map(async (seg) => {
              const el = await this.loadVideoElement(seg.videoUrl);
              return { element: el, ...seg };
            })
          );
          avatarVideoElements = loadedElements.filter(v => v.element);
          console.log(`Loaded ${avatarVideoElements.length} avatar video elements with actual durations`);
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
        const time = startTime + (frame / fps);
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

      // Write voiceover audio if available (use stitched audio with AI avatar segments)
      const hasVoiceover = !!this.audioBlob;
      if (hasVoiceover) {
        this.exportStatus.textContent = 'Preparing audio (stitching clean segments)...';
        let audioToExport = await this.stitchAudioForExport();

        // Trim audio if we have a start time offset
        if (startTime > 0) {
          this.exportStatus.textContent = 'Trimming audio for test export...';
          audioToExport = await this.trimAudioBlob(audioToExport, exportDuration, startTime);
        }

        const audioData = new Uint8Array(await audioToExport.arrayBuffer());
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
    // Check if captions are enabled
    if (this.captionsEnabledToggle && !this.captionsEnabledToggle.checked) return;

    if (!scene.caption) return;

    // Clean the caption text (remove visual cues)
    const cleanCaption = this.cleanCaptionText(scene.caption);
    if (!cleanCaption) return;

    // Check scene boundaries - don't draw caption if we're outside this scene's time range
    // This prevents captions from repeating/bleeding into the next scene
    const sceneStart = scene.startTime || 0;
    const sceneDuration = scene.duration || 6;
    const sceneEnd = sceneStart + sceneDuration;
    if (currentTime < sceneStart || currentTime >= sceneEnd) {
      return;
    }

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

    // Get words from captionWords if available, otherwise split caption text
    let allWords;
    if (scene.captionWords && scene.captionWords.length > 0) {
      allWords = scene.captionWords.map(w => w.word.trim()).filter(w => w.length > 0);
    } else {
      allWords = cleanCaption.split(/\s+/).filter(w => w.length > 0);
    }

    // Use scene-relative timing for word highlighting (prevents drift with stitched audio)
    // Add small offset (0.15s) to compensate for render latency - makes captions appear slightly ahead
    const renderOffset = 0.15;
    // sceneStart and sceneDuration already declared above for boundary check
    const timeInScene = Math.max(0, (currentTime + renderOffset) - sceneStart);
    const wordDuration = sceneDuration / allWords.length;
    const rawWordIndex = Math.floor(timeInScene / wordDuration);
    const currentWordIndex = Math.max(0, Math.min(allWords.length - 1, rawWordIndex));

    // Only show current line of words (no preview of next line) - same as preview
    const totalWordsToShow = wordsPerLine;
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
      // Validate URL
      if (!url || typeof url !== 'string') {
        console.error('Invalid video URL:', url, typeof url);
        return reject(new Error(`Invalid video URL: ${url}`));
      }

      console.log('Loading video from URL:', url.substring(0, 100) + '...');

      const video = document.createElement('video');
      // Only use crossOrigin for non-Replicate URLs (Replicate doesn't support CORS anonymous)
      // But we need it for canvas drawing, so try with it first
      video.crossOrigin = 'anonymous';
      video.muted = true; // Mute to allow auto-play
      video.preload = 'auto';
      video.playsInline = true;

      let resolved = false;

      // Wait for video to be fully ready to play
      video.oncanplaythrough = () => {
        if (resolved) return;
        resolved = true;
        console.log('Video ready:', url.substring(0, 50), 'duration:', video.duration);
        resolve(video);
      };

      video.onloadeddata = () => {
        // Fallback if canplaythrough doesn't fire
        if (!resolved && video.readyState >= 3) {
          resolved = true;
          console.log('Video loaded (fallback):', url.substring(0, 50), 'duration:', video.duration);
          resolve(video);
        }
      };

      video.onloadedmetadata = () => {
        console.log('Video metadata loaded:', url.substring(0, 50), 'duration:', video.duration, 'readyState:', video.readyState);
      };

      video.onerror = (e) => {
        if (resolved) return;
        const errorCode = video.error ? video.error.code : 'unknown';
        const errorMessage = video.error ? video.error.message : 'unknown error';
        console.error('Failed to load video:', url.substring(0, 80), 'error code:', errorCode, errorMessage);

        // If CORS failed, try without crossOrigin (won't work for canvas but at least we know)
        if (!video.dataset.retried && url.includes('replicate.delivery')) {
          console.log('Retrying without crossOrigin...');
          video.dataset.retried = 'true';
          video.crossOrigin = null;
          video.src = url;
          video.load();
          return;
        }

        resolved = true;
        reject(new Error(`Failed to load video: ${errorMessage}`));
      };

      // Timeout fallback - resolve if we have at least some data
      setTimeout(() => {
        if (!resolved && video.readyState >= 2) {
          resolved = true;
          console.log('Video loaded (timeout fallback):', url.substring(0, 50));
          resolve(video);
        }
      }, 5000);

      // Second fallback - accept metadata only after longer timeout
      // Some videos load metadata but take forever to buffer
      setTimeout(() => {
        if (!resolved && video.readyState >= 1) {
          resolved = true;
          console.log('Video loaded (metadata-only fallback):', url.substring(0, 50), 'readyState:', video.readyState);
          resolve(video);
        }
      }, 15000);

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
    // Clamp to valid range to prevent seeking past video end
    const videoDuration = videoElement.duration || (avatarVideo.endTime - avatarVideo.startTime);
    const localTime = Math.max(0, Math.min(time - avatarVideo.startTime, videoDuration - 0.01));

    // Always seek to exact time to prevent drift (use tight threshold of 0.016s = 1 frame at 60fps)
    if (Math.abs(videoElement.currentTime - localTime) > 0.016) {
      videoElement.currentTime = localTime;
      // Wait for seek to actually complete using seeked event
      await new Promise(resolve => {
        const onSeeked = () => {
          videoElement.removeEventListener('seeked', onSeeked);
          resolve();
        };
        videoElement.addEventListener('seeked', onSeeked);
        // Fallback timeout in case seeked doesn't fire
        setTimeout(() => {
          videoElement.removeEventListener('seeked', onSeeked);
          resolve();
        }, 100);
      });
    }

    // Get overlay position and size
    const rect = this.getAvatarOverlayRect(canvasWidth, canvasHeight);

    // Calculate aspect-ratio-preserving draw dimensions (cover mode - fill and crop)
    const videoW = videoElement.videoWidth || 1;
    const videoH = videoElement.videoHeight || 1;
    const videoAspect = videoW / videoH;
    const rectAspect = rect.width / rect.height;

    let drawW, drawH, drawX, drawY;
    if (videoAspect > rectAspect) {
      // Video is wider - fit height, center horizontally
      drawH = rect.height;
      drawW = rect.height * videoAspect;
      drawX = rect.x - (drawW - rect.width) / 2;
      drawY = rect.y;
    } else {
      // Video is taller - fit width, show TOP (face area) not center
      drawW = rect.width;
      drawH = rect.width / videoAspect;
      drawX = rect.x;
      drawY = rect.y; // Show top of video where face is
    }

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

      // Draw centered and cropped to circle (with aspect ratio preserved)
      ctx.drawImage(videoElement, drawX, drawY, drawW, drawH);

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

      // Draw with aspect ratio preserved
      ctx.drawImage(videoElement, drawX, drawY, drawW, drawH);

      // Add border
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

    } else {
      // Rectangle - clip to rect and draw with aspect ratio
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.width, rect.height);
      ctx.closePath();
      ctx.clip();

      ctx.drawImage(videoElement, drawX, drawY, drawW, drawH);

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

  // Reset caption animation to default (prevents browser auto-fill issues)
  const captionAnimation = document.getElementById('caption-animation');
  if (captionAnimation && captionAnimation.value === 'none') {
    captionAnimation.value = 'word-highlight';
    console.log('Reset caption animation from "none" to "word-highlight"');
  }

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

    // Get signed URL instead of public URL to reduce CDN egress
    const avatarPublicUrl = await getSignedReadUrl(avatarPath);
    if (!avatarPublicUrl) {
      throw new Error('Failed to get signed URL for avatar image');
    }

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

      // Get signed URL instead of public URL to reduce CDN egress
      const audioPublicUrl = await getSignedReadUrl(audioPath);
      if (!audioPublicUrl) {
        throw new Error(`Failed to get signed URL for audio segment ${i + 1}`);
      }

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

    // Get signed URL for avatar (reduces CDN egress vs public URLs)
    const avatarSignedUrl = await getSignedReadUrl(avatarPath);
    if (!avatarSignedUrl) {
      throw new Error('Failed to get signed URL for avatar');
    }

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

    // Get signed URL for audio (reduces CDN egress vs public URLs)
    const audioSignedUrl = await getSignedReadUrl(audioPath);
    if (!audioSignedUrl) {
      throw new Error('Failed to get signed URL for audio');
    }

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
        avatarUrl: avatarSignedUrl,
        audioUrl: audioSignedUrl
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
        url: audioSignedUrl
      };
      // Clear cached stitched audio so it gets re-generated with new replacement
      videoEditor.stitchedAudioBlob = null;
      console.log(`Stored replaced audio for segment ${segmentNum}`);
    }

    // Save to database for persistence across refreshes (with audio URL!)
    const userId = localStorage.getItem('ai_tool_user_id') || videoEditor?.userId;
    if (userId) {
      await fetch('/api/db/avatar-segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          segmentNum,
          videoUrl: videoUrl,
          fileName: `avatar_segment_${segmentNum}.mp4`,
          audioUrl: audioSignedUrl  // Save signed audio URL for persistence!
        })
      });
      console.log(`Saved segment ${segmentNum} to database with audio URL`);
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

// Repair existing segment by adding audio URL (no regeneration needed)
async function repairSegmentAudio(segmentNum, audioFile) {
  if (!audioFile) {
    showToast('Please select an audio file');
    return;
  }

  try {
    showToast(`Uploading audio for segment ${segmentNum}...`, 'info');

    // Get Supabase config
    const configResponse = await fetch('/api/supabase-config');
    const config = await configResponse.json();

    // Upload audio file to Supabase
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

    // Get signed URL for audio (reduces CDN egress vs public URLs)
    const audioSignedUrl = await getSignedReadUrl(audioPath);
    if (!audioSignedUrl) {
      throw new Error('Failed to get signed URL for audio');
    }
    console.log(`Audio uploaded for segment ${segmentNum}:`, audioSignedUrl);

    // Update database with audio URL
    const userId = localStorage.getItem('ai_tool_user_id') || videoEditor?.userId;
    if (userId) {
      // Get existing segment data
      const existingResponse = await fetch(`/api/db/avatar-segments/${userId}`);
      const existingData = await existingResponse.json();
      const existingSegment = existingData.segments?.find(s => s.segment_num === segmentNum);

      if (existingSegment) {
        // Re-save with audio URL
        await fetch('/api/db/avatar-segments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            segmentNum,
            videoUrl: existingSegment.video_url,
            fileName: existingSegment.file_name,
            audioUrl: audioSignedUrl
          })
        });
        console.log(`Database updated with audio URL for segment ${segmentNum}`);
      }
    }

    // Store in memory for immediate use
    if (typeof videoEditor !== 'undefined') {
      videoEditor.replacedAudioSegments[segmentNum] = {
        blob: audioFile,
        url: audioSignedUrl
      };
      videoEditor.stitchedAudioBlob = null;
    }

    showToast(`✅ Audio added to segment ${segmentNum}! Will persist across refreshes.`, 'success');
  } catch (error) {
    console.error('Repair error:', error);
    showToast(`Failed: ${error.message}`);
  }
}
window.repairSegmentAudio = repairSegmentAudio;

// Repair ALL segments - split TTS audio and upload for each segment
async function repairAllSegmentsAudio() {
  if (!videoEditor || !videoEditor.audioBlob) {
    showToast('No TTS audio loaded. Please load audio first.', 'error');
    return;
  }

  const userId = localStorage.getItem('ai_tool_user_id') || videoEditor?.userId;
  if (!userId) {
    showToast('User ID not found', 'error');
    return;
  }

  try {
    showToast('🔧 Repairing all segments... This may take a minute.', 'info');
    console.log('Starting repair of all segment audio...');

    // Get existing segments from database
    const existingResponse = await fetch(`/api/db/avatar-segments/${userId}`);
    const existingData = await existingResponse.json();
    const segments = existingData.segments || [];

    if (segments.length === 0) {
      showToast('No avatar segments found to repair', 'error');
      return;
    }

    console.log(`Found ${segments.length} segments to repair`);

    // Split the TTS audio into segments
    const audioSegments = await videoEditor.splitAudioForAvatar();
    console.log(`Split TTS audio into ${audioSegments.length} segments`);

    // Get Supabase config
    const configResponse = await fetch('/api/supabase-config');
    const config = await configResponse.json();

    let repaired = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segmentNum = seg.segment_num;
      const audioSegment = audioSegments[segmentNum - 1]; // segments are 1-indexed

      if (!audioSegment) {
        console.warn(`No audio segment for segment ${segmentNum}`);
        continue;
      }

      try {
        // Upload audio to Supabase
        const audioPath = `audio/segment-${segmentNum}-clean-${Date.now()}.mp3`;
        const audioUploadUrl = `${config.url}/storage/v1/object/${config.bucket}/${audioPath}`;

        await fetch(audioUploadUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.anonKey}`,
            'apikey': config.anonKey,
            'Content-Type': 'audio/mpeg',
            'x-upsert': 'true'
          },
          body: audioSegment.blob
        });

        // Get signed URL for audio (reduces CDN egress vs public URLs)
        const audioSignedUrl = await getSignedReadUrl(audioPath);
        if (!audioSignedUrl) {
          console.warn(`Failed to get signed URL for segment ${segmentNum}`);
          continue;
        }
        console.log(`✓ Uploaded clean audio for segment ${segmentNum}:`, audioSignedUrl);

        // Update database with audio URL
        await fetch('/api/db/avatar-segments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            segmentNum,
            videoUrl: seg.video_url,
            fileName: seg.file_name,
            audioUrl: audioSignedUrl
          })
        });

        // Store in memory for immediate use
        videoEditor.replacedAudioSegments[segmentNum] = {
          blob: audioSegment.blob,
          url: audioSignedUrl
        };

        repaired++;
        console.log(`✓ Segment ${segmentNum} repaired (${repaired}/${segments.length})`);
      } catch (e) {
        console.error(`Failed to repair segment ${segmentNum}:`, e);
      }
    }

    videoEditor.stitchedAudioBlob = null; // Clear cache
    showToast(`✅ Repaired ${repaired}/${segments.length} segments! Clean audio will persist.`, 'success');
    console.log(`Repair complete: ${repaired}/${segments.length} segments`);

  } catch (error) {
    console.error('Repair all error:', error);
    showToast(`Failed: ${error.message}`, 'error');
  }
}
window.repairAllSegmentsAudio = repairAllSegmentsAudio;

// FULL RESET: Clear all audio caches and force complete re-sync of segments
// Use this if audio is stuttering or looping at segment boundaries
async function fullAudioReset() {
  console.log('=== FULL AUDIO RESET ===');

  if (typeof videoEditor === 'undefined' || !videoEditor.audioBlob) {
    showToast('No video editor or audio loaded', 'error');
    return;
  }

  const segments = window.loadedAvatarSegments || [];
  const numSegments = segments.length || Math.ceil(videoEditor.audioDuration / 90) || 8;

  console.log(`Resetting audio for ${numSegments} segments...`);

  // Step 1: Clear ALL audio caches
  console.log('Step 1: Clearing all audio caches...');
  videoEditor.replacedAudioSegments = {};
  videoEditor.stitchedAudioBlob = null;
  videoEditor.stitchedAudioBuffer = null;
  console.log('  ✓ Cleared replacedAudioSegments, stitchedAudioBlob, stitchedAudioBuffer');

  // Step 2: Split TTS audio fresh for all segments
  console.log('Step 2: Splitting TTS audio for all segments...');
  const audioSegments = await videoEditor.splitAudioForAvatar(numSegments);
  if (!audioSegments || audioSegments.length === 0) {
    showToast('Failed to split TTS audio', 'error');
    return;
  }

  // Step 3: Store all segments with clean TTS audio
  console.log('Step 3: Storing clean audio for each segment...');
  for (let i = 0; i < audioSegments.length; i++) {
    const segmentNum = i + 1;
    const audioSeg = audioSegments[i];
    videoEditor.replacedAudioSegments[segmentNum] = {
      blob: audioSeg.blob,
      url: null,
      duration: 90 // Fixed 90s duration
    };
    console.log(`  ✓ Segment ${segmentNum}: ${audioSeg.blob.size} bytes, 90.00s`);
  }

  // Step 4: Re-sync avatar video boundaries with ACTUAL durations (fixes stutter)
  console.log('Step 4: Re-syncing avatar video boundaries with actual durations...');
  await videoEditor.syncUploadedAvatarSegmentsWithDurations();
  console.log('  ✓ Avatar video boundaries synced with actual durations');

  // Step 5: Pre-stitch audio to verify
  console.log('Step 5: Pre-stitching audio to verify...');
  const stitched = await videoEditor.stitchAudioForExport();
  if (stitched) {
    console.log(`  ✓ Pre-stitched audio: ${stitched.size} bytes`);
  }

  console.log('=== FULL AUDIO RESET COMPLETE ===');
  showToast(`✅ Reset complete! ${numSegments} segments re-synced with clean audio.`, 'success');

  // Log final state
  const keys = Object.keys(videoEditor.replacedAudioSegments).sort((a,b) => a-b);
  console.log('Final audio segment state:');
  keys.forEach(k => {
    const seg = videoEditor.replacedAudioSegments[k];
    console.log(`  Segment ${k}: ${seg.blob?.size || 0} bytes, ${seg.duration?.toFixed(2) || '?'}s`);
  });
}
window.fullAudioReset = fullAudioReset;

// QUICK FIX: Re-sync segment boundaries with actual video durations
// Use this if video stutters at 90s/180s/270s boundaries after reordering scenes
async function fixSegmentSync() {
  console.log('=== FIX SEGMENT SYNC ===');

  if (typeof videoEditor === 'undefined') {
    showToast('No video editor loaded', 'error');
    return;
  }

  const uploadedSegments = window.uploadedAvatarSegments || {};
  const segmentCount = Object.keys(uploadedSegments).length;

  if (segmentCount === 0) {
    showToast('No avatar segments found', 'error');
    return;
  }

  showToast('Detecting actual video durations...', 1500);

  // Load actual video durations and resync boundaries
  await videoEditor.syncUploadedAvatarSegmentsWithDurations();

  // Log the corrected boundaries
  console.log('Corrected segment boundaries:');
  if (videoEditor.avatarVideos) {
    videoEditor.avatarVideos.forEach((av, i) => {
      console.log(`  Segment ${av.segmentIndex}: ${av.startTime.toFixed(2)}s - ${av.endTime.toFixed(2)}s (${av.actualDuration?.toFixed(2) || '?'}s)`);
    });
  }

  console.log('=== FIX SEGMENT SYNC COMPLETE ===');
  showToast(`✅ Fixed ${segmentCount} segment boundaries!`, 'success');
}
window.fixSegmentSync = fixSegmentSync;

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

    // Get signed URL (reduces CDN egress vs public URLs)
    const signedUrl = await getSignedReadUrl(videoPath);
    if (!signedUrl) {
      throw new Error('Failed to get signed URL for video');
    }
    console.log(`Segment ${segmentNum} uploaded with signed URL:`, signedUrl);

    // Get actual video duration to fix segment boundary sync issues
    let actualDuration = 90; // Fallback
    try {
      actualDuration = await new Promise((resolve) => {
        const tempVideo = document.createElement('video');
        tempVideo.preload = 'metadata';
        tempVideo.muted = true;
        const timeout = setTimeout(() => resolve(90), 5000);
        tempVideo.onloadedmetadata = () => {
          clearTimeout(timeout);
          const dur = tempVideo.duration;
          tempVideo.src = '';
          resolve(dur || 90);
        };
        tempVideo.onerror = () => {
          clearTimeout(timeout);
          resolve(90);
        };
        tempVideo.src = URL.createObjectURL(file);
      });
      console.log(`Segment ${segmentNum} actual duration: ${actualDuration.toFixed(2)}s`);
    } catch (e) {
      console.log(`Could not detect duration for segment ${segmentNum}, using 90s fallback`);
    }

    // Store in memory for export (with signed URL and actual duration)
    window.uploadedAvatarSegments[segmentNum] = {
      url: signedUrl,
      fileName: file.name,
      duration: actualDuration,
      actualDuration: actualDuration
    };

    // NOTE: We do NOT extract audio from uploaded avatar videos
    // Avatar videos contain lip-sync audio which sounds bad
    // The clean TTS audio is already loaded via loadAudioForAvatarSegments()
    // which splits the original TTS audio by segment timing

    // Save to database for persistence across refreshes
    // audioUrl is null - we use clean TTS audio, not lip-sync audio from avatar videos
    const audioPublicUrl = null;
    console.log(`Saving segment ${segmentNum} to database (video only, using TTS audio)`);
    const dbResponse = await fetch('/api/db/avatar-segments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        segmentNum,
        videoUrl: signedUrl,
        fileName: file.name,
        audioUrl: audioPublicUrl  // null - using clean TTS audio
      })
    });
    const dbResult = await dbResponse.json();
    if (dbResponse.ok) {
      console.log(`✓ Segment ${segmentNum} saved to database with audio_url`);
    } else {
      console.error(`✗ Failed to save segment ${segmentNum} to database:`, dbResult);
    }

    // Update slot UI
    slot.style.background = 'rgba(34, 197, 94, 0.2)';
    slot.style.borderColor = '#22c55e';
    slot.innerHTML = `
      <input type="file" id="segment-upload-${segmentNum}" accept="video/*" hidden
        onchange="handleSegmentUpload(${segmentNum}, this.files[0])">
      <div style="font-size: 24px; margin-bottom: 5px;">✅</div>
      <div style="font-weight: bold; color: var(--text-primary, #fff);">Segment ${segmentNum}</div>
      <div style="font-size: 12px; color: #22c55e; margin-top: 5px;">${file.name}</div>
      <button onclick="previewSegment('${signedUrl}')" style="
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
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await videoFile.arrayBuffer();

    // Decode audio directly from video file
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Convert AudioBuffer to WAV blob
    const wavBlob = audioBufferToWav(audioBuffer);
    return wavBlob;
  } catch (err) {
    throw new Error(`Audio decode failed: ${err.message}`);
  }
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

    // Get signed URL for audio (reduces CDN egress vs public URLs)
    const audioSignedUrl = await getSignedReadUrl(audioPath);
    if (!audioSignedUrl) {
      throw new Error('Failed to get signed URL for audio');
    }

    // Generate new avatar video
    statusEl.textContent = `Generating new avatar for segment ${segmentIndex + 1}...`;

    const response = await fetch('/api/animate-avatar-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        avatarUrl: avatarUrl,
        audioUrl: audioSignedUrl
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
