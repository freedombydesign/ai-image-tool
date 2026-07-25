/**
 * Shorts Clipper Module
 * Handles UI and API communication for generating YouTube Shorts from long-form videos
 */

class ShortsClipper {
  constructor() {
    this.isProcessing = false;
  }

  init() {
    // Bind event listeners
    document.getElementById('generate-shorts-btn')?.addEventListener('click', () => this.generateShorts());
    document.getElementById('browse-source-video')?.addEventListener('click', () => this.browseSourceVideo());
    document.getElementById('open-shorts-folder')?.addEventListener('click', () => this.openOutputFolder());
  }

  browseSourceVideo() {
    // Note: File browsing would need a native file picker
    // For now, user must paste the path
    showToast('Please paste the full path to your video file', 'info');
  }

  async generateShorts() {
    if (this.isProcessing) {
      showToast('Already processing...', 'warning');
      return;
    }

    // Collect form data
    const sourceVideo = document.getElementById('shorts-source-video').value.trim();
    const outputDir = document.getElementById('shorts-output-dir').value.trim();
    const hasCaptions = document.getElementById('shorts-has-captions').checked;

    // Validate
    if (!sourceVideo) {
      showToast('Please enter the source video path', 'error');
      return;
    }

    // Collect clip configurations
    const clips = [
      {
        start_time: document.getElementById('hook-start').value.trim() || '00:00:00',
        end_time: document.getElementById('hook-end').value.trim() || '00:00:40',
        label: 'hook',
        crop_mode: 'crop',
        x_offset: parseInt(document.getElementById('hook-offset').value) || 0
      },
      {
        start_time: document.getElementById('reframe-start').value.trim() || '00:03:30',
        end_time: document.getElementById('reframe-end').value.trim() || '00:04:10',
        label: 'reframe',
        crop_mode: 'crop',
        x_offset: parseInt(document.getElementById('reframe-offset').value) || 0
      },
      {
        start_time: document.getElementById('swap-start').value.trim() || '00:05:00',
        end_time: document.getElementById('swap-end').value.trim() || '00:05:40',
        label: 'swap',
        crop_mode: 'crop',
        x_offset: parseInt(document.getElementById('swap-offset').value) || 0
      }
    ];

    // Build config
    const config = {
      source_video: sourceVideo,
      source_has_captions: hasCaptions,
      output_dir: outputDir || '/Users/ruthlarbie/shorts_output',
      clips
    };

    // Show progress
    this.showProgress('Starting...');
    this.isProcessing = true;

    const btn = document.getElementById('generate-shorts-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Processing...';

    try {
      // Use SSE streaming for real-time progress updates
      const response = await fetch('/api/generate-shorts/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });

      if (!response.ok) {
        throw new Error('Failed to start shorts generation');
      }

      // Read the SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE messages (data: {...}\n\n)
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || ''; // Keep incomplete message in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));

            if (data.error) {
              throw new Error(data.error);
            }

            if (data.progress !== undefined) {
              this.updateProgress(data.progress, data.message || 'Processing...');
            }

            if (data.complete) {
              // Show results
              this.showResults(data.files, data.outputDir);
              showToast('✓ All 3 shorts generated successfully!', 'success');
            }
          }
        }
      }

    } catch (error) {
      console.error('Shorts generation error:', error);
      showToast(`Error: ${error.message}`, 'error');
      this.hideProgress();
    } finally {
      this.isProcessing = false;
      btn.disabled = false;
      btn.textContent = 'Generate 3 Shorts (1080x1920)';
    }
  }

  showProgress(message) {
    const progressEl = document.getElementById('shorts-progress');
    const progressText = document.getElementById('shorts-progress-text');
    const progressBar = document.getElementById('shorts-progress-bar');
    const resultsEl = document.getElementById('shorts-results');

    progressEl.style.display = 'block';
    resultsEl.style.display = 'none';
    progressText.textContent = message;
    progressBar.style.width = '30%';
  }

  updateProgress(percent, message) {
    const progressBar = document.getElementById('shorts-progress-bar');
    const progressText = document.getElementById('shorts-progress-text');

    progressBar.style.width = `${percent}%`;
    progressText.textContent = message;
  }

  hideProgress() {
    const progressEl = document.getElementById('shorts-progress');
    progressEl.style.display = 'none';
  }

  showResults(files, outputDir) {
    const progressEl = document.getElementById('shorts-progress');
    const resultsEl = document.getElementById('shorts-results');
    const filesList = document.getElementById('shorts-files-list');

    progressEl.style.display = 'none';
    resultsEl.style.display = 'block';

    // Display file list
    filesList.innerHTML = files.map(f => `
      <p><strong>${f.label}:</strong> ${f.filename} (${f.duration}s, ${f.size})</p>
    `).join('');

    // Store output dir for opening later
    this.lastOutputDir = outputDir;
  }

  async openOutputFolder() {
    if (!this.lastOutputDir) {
      showToast('No output directory available', 'error');
      return;
    }

    try {
      const response = await fetch('/api/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: this.lastOutputDir })
      });

      if (!response.ok) {
        throw new Error('Failed to open folder');
      }

      showToast('Opened output folder', 'success');
    } catch (error) {
      console.error('Open folder error:', error);
      showToast('Could not open folder automatically. Check: ' + this.lastOutputDir, 'warning');
    }
  }
}

// Initialize when DOM is ready
let shortsClipperInstance = null;

function initShortsClipper() {
  if (!shortsClipperInstance) {
    shortsClipperInstance = new ShortsClipper();
    shortsClipperInstance.init();
  }
}

// Auto-init if document already loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initShortsClipper);
} else {
  initShortsClipper();
}
