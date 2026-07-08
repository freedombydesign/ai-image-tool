// Generation History Manager
class GenerationHistory {
  constructor() {
    this.storageKey = 'ai_image_tool_history';
    this.maxItems = 100;
    this.history = this.load();
  }

  load() {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to load history:', e);
      return [];
    }
  }

  save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.history));
    } catch (e) {
      console.error('Failed to save history:', e);
      // If storage is full, remove oldest items
      if (e.name === 'QuotaExceededError') {
        this.history = this.history.slice(0, Math.floor(this.history.length / 2));
        this.save();
      }
    }
  }

  add(item) {
    const historyItem = {
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      type: item.type, // 'single', 'batch', 'thumbnail', 'banner'
      prompt: item.prompt,
      imageUrl: item.imageUrl,
      settings: {
        model: item.model || 'dall-e-3',
        size: item.size,
        quality: item.quality,
        style: item.style
      },
      metadata: item.metadata || {}
    };

    this.history.unshift(historyItem);

    // Keep only maxItems
    if (this.history.length > this.maxItems) {
      this.history = this.history.slice(0, this.maxItems);
    }

    this.save();
    this.refreshUI();
    return historyItem;
  }

  remove(id) {
    this.history = this.history.filter(item => item.id !== id);
    this.save();
    this.refreshUI();
  }

  clear() {
    this.history = [];
    this.save();
    this.refreshUI();
  }

  getAll() {
    return this.history;
  }

  getByType(type) {
    return this.history.filter(item => item.type === type);
  }

  getById(id) {
    return this.history.find(item => item.id === id);
  }

  search(query) {
    const lowerQuery = query.toLowerCase();
    return this.history.filter(item =>
      item.prompt?.toLowerCase().includes(lowerQuery) ||
      item.type?.toLowerCase().includes(lowerQuery)
    );
  }

  refreshUI() {
    if (typeof renderHistoryGrid === 'function') {
      renderHistoryGrid();
    }
  }

  // Export history item as image
  async exportItem(id) {
    const item = this.getById(id);
    if (!item) return;

    try {
      const response = await fetch(item.imageUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `${item.type}_${item.id}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to export:', e);
    }
  }

  // Get statistics
  getStats() {
    const stats = {
      total: this.history.length,
      byType: {},
      byModel: {}
    };

    this.history.forEach(item => {
      stats.byType[item.type] = (stats.byType[item.type] || 0) + 1;
      const model = item.settings?.model || 'unknown';
      stats.byModel[model] = (stats.byModel[model] || 0) + 1;
    });

    return stats;
  }
}

// Global history instance
const generationHistory = new GenerationHistory();

// Render history grid
function renderHistoryGrid(filter = 'all', searchQuery = '') {
  const grid = document.getElementById('history-grid');
  const emptyState = document.getElementById('history-empty');
  const statsEl = document.getElementById('history-stats');

  if (!grid) return;

  let items = generationHistory.getAll();

  // Apply type filter
  if (filter !== 'all') {
    items = items.filter(item => item.type === filter);
  }

  // Apply search filter
  if (searchQuery) {
    const lowerQuery = searchQuery.toLowerCase();
    items = items.filter(item =>
      item.prompt?.toLowerCase().includes(lowerQuery)
    );
  }

  // Update stats
  if (statsEl) {
    const stats = generationHistory.getStats();
    statsEl.textContent = `${stats.total} total generations`;
  }

  // Show empty state or grid
  if (items.length === 0) {
    grid.innerHTML = '';
    if (emptyState) emptyState.hidden = false;
    return;
  }

  if (emptyState) emptyState.hidden = true;

  grid.innerHTML = items.map(item => `
    <div class="history-item" data-id="${item.id}">
      <div class="history-image-wrapper">
        <img src="${item.imageUrl}" alt="${item.prompt || 'Generated image'}" loading="lazy">
        <div class="history-overlay">
          <button class="history-btn preview-btn" title="Preview">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
          <button class="history-btn download-btn" title="Download">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
          <button class="history-btn delete-btn" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="history-info">
        <span class="history-type ${item.type}">${item.type}</span>
        <span class="history-model">${item.settings?.model || 'dall-e-3'}</span>
      </div>
      <p class="history-prompt">${item.prompt || 'No prompt'}</p>
      <span class="history-date">${formatDate(item.timestamp)}</span>
    </div>
  `).join('');

  // Add event listeners
  grid.querySelectorAll('.history-item').forEach(item => {
    const id = item.dataset.id;

    item.querySelector('.preview-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      showHistoryPreview(id);
    });

    item.querySelector('.download-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      generationHistory.exportItem(id);
    });

    item.querySelector('.delete-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('Delete this item from history?')) {
        generationHistory.remove(id);
      }
    });

    // Click on item to preview
    item.addEventListener('click', () => showHistoryPreview(id));
  });
}

// Format date for display
function formatDate(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

  return date.toLocaleDateString();
}

// Show preview modal
function showHistoryPreview(id) {
  const item = generationHistory.getById(id);
  if (!item) return;

  const modal = document.getElementById('history-modal');
  if (!modal) return;

  document.getElementById('modal-image').src = item.imageUrl;
  document.getElementById('modal-prompt').textContent = item.prompt || 'No prompt';
  document.getElementById('modal-type').textContent = item.type;
  document.getElementById('modal-model').textContent = item.settings?.model || 'dall-e-3';
  document.getElementById('modal-size').textContent = item.settings?.size || 'N/A';
  document.getElementById('modal-quality').textContent = item.settings?.quality || 'N/A';
  document.getElementById('modal-date').textContent = new Date(item.timestamp).toLocaleString();

  modal.dataset.currentId = id;
  modal.hidden = false;
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

// Close preview modal
function closeHistoryModal() {
  const modal = document.getElementById('history-modal');
  if (modal) {
    modal.hidden = true;
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

// Reuse prompt from history
function reuseHistoryPrompt(id) {
  const item = generationHistory.getById(id);
  if (!item) return;

  // Switch to appropriate tab based on type
  let tabName = 'single';
  let promptFieldId = 'prompt';

  switch (item.type) {
    case 'single':
      tabName = 'single';
      promptFieldId = 'prompt';
      break;
    case 'batch':
      tabName = 'batch';
      promptFieldId = 'batch-topic';
      break;
    case 'thumbnail':
      tabName = 'thumbnail';
      promptFieldId = 'thumbnail-title';
      break;
    case 'banner':
      tabName = 'yt-banner';
      break;
  }

  // Switch tab
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

  const targetTab = document.querySelector(`.tab[data-tab="${tabName}"]`);
  const targetContent = document.getElementById(tabName);

  if (targetTab) targetTab.classList.add('active');
  if (targetContent) targetContent.classList.add('active');

  // Fill in prompt
  const promptField = document.getElementById(promptFieldId);
  if (promptField) {
    promptField.value = item.prompt;
    promptField.focus();
  }

  // Apply settings if available
  if (item.settings) {
    const modelSelect = document.getElementById('batch-model');
    if (modelSelect && item.settings.model) {
      modelSelect.value = item.settings.model;
    }
  }

  closeHistoryModal();
  showToast('Prompt loaded! Modify and generate.', false);
}

// Initialize history UI
function initHistoryUI() {
  const filterBtns = document.querySelectorAll('.history-filter-btn');
  const searchInput = document.getElementById('history-search');
  const clearBtn = document.getElementById('clear-history-btn');

  // Filter buttons
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.dataset.filter;
      renderHistoryGrid(filter, searchInput?.value || '');
    });
  });

  // Search input
  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        const activeFilter = document.querySelector('.history-filter-btn.active')?.dataset.filter || 'all';
        renderHistoryGrid(activeFilter, searchInput.value);
      }, 300);
    });
  }

  // Clear all button
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (confirm('Clear all generation history? This cannot be undone.')) {
        generationHistory.clear();
        showToast('History cleared', false);
      }
    });
  }

  // Modal close handlers
  const modal = document.getElementById('history-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeHistoryModal();
    });

    document.getElementById('modal-close-btn')?.addEventListener('click', closeHistoryModal);

    document.getElementById('modal-download-btn')?.addEventListener('click', () => {
      const id = modal.dataset.currentId;
      if (id) generationHistory.exportItem(id);
    });

    document.getElementById('modal-reuse-btn')?.addEventListener('click', () => {
      const id = modal.dataset.currentId;
      if (id) reuseHistoryPrompt(id);
    });

    document.getElementById('modal-delete-btn')?.addEventListener('click', () => {
      const id = modal.dataset.currentId;
      if (id && confirm('Delete this item from history?')) {
        generationHistory.remove(id);
        closeHistoryModal();
      }
    });
  }

  // Initial render
  renderHistoryGrid();
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHistoryUI);
} else {
  initHistoryUI();
}
