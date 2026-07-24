// Scene Library Manager - Save and reuse favorite scenes across videos
class SceneLibraryManager {
  constructor() {
    this.scenes = [];
    this.tags = ['reaction', 'office', 'thinking', 'celebration', 'transition', 'other'];
  }

  // Load library scenes from Supabase
  async loadFromSupabase() {
    try {
      const userId = localStorage.getItem('ai_tool_user_id');
      if (!userId) {
        console.log('[Library] No user ID found');
        return [];
      }

      const response = await fetch(`/api/db/batch-scenes/${userId}?limit=50`);
      const data = await response.json();

      if (!data.success || !data.batches) {
        console.log('[Library] No batches found');
        return [];
      }

      // Filter for library batches (batchId starts with 'library_')
      const libraryBatches = data.batches.filter(b => b.batchId && b.batchId.startsWith('library_'));

      // Flatten all scenes from all library batches
      const libraryScenes = [];
      for (const batch of libraryBatches) {
        const scenes = batch.scenes || [];
        for (const scene of scenes) {
          // Parse library metadata from style JSON
          let metadata = {};
          try {
            metadata = JSON.parse(scene.style || '{}');
          } catch (e) {
            console.error('[Library] Failed to parse scene metadata:', e);
          }

          libraryScenes.push({
            id: `${batch.batchId}_${scene.index}`,
            batchId: batch.batchId,
            index: scene.index,
            imageUrl: scene.imageUrl,
            prompt: scene.text || scene.prompt || '',
            libraryTag: metadata.libraryTag || 'other',
            libraryName: metadata.libraryName || 'Untitled Scene',
            savedAt: metadata.savedAt || batch.createdAt,
            originalBatchId: metadata.originalBatchId || '',
            caption: metadata.caption || '',
            duration: metadata.duration || 6,
            visualDescription: metadata.visualDescription || ''
          });
        }
      }

      this.scenes = libraryScenes;
      console.log(`[Library] Loaded ${libraryScenes.length} scenes from ${libraryBatches.length} batches`);
      return libraryScenes;
    } catch (error) {
      console.error('[Library] Failed to load from Supabase:', error);
      return [];
    }
  }

  // Add a scene to the library
  async addSceneToLibrary(scene, tag, name) {
    try {
      const userId = localStorage.getItem('ai_tool_user_id');
      if (!userId) {
        showToast('User ID not found', true);
        return null;
      }

      // Create unique library batchId
      const batchId = `library_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Prepare metadata for style JSON
      const metadata = {
        libraryTag: tag || 'other',
        libraryName: name || 'Untitled Scene',
        savedAt: new Date().toISOString(),
        originalBatchId: scene.originalBatchId || '',
        caption: scene.caption || scene.text || '',
        duration: scene.duration || 6,
        visualDescription: scene.visualDescription || ''
      };

      // Save to Supabase
      const response = await fetch('/api/db/batch-scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          batchId,
          scenes: [{
            imageUrl: scene.imageUrl,
            text: scene.text || scene.prompt || '',
            style: JSON.stringify(metadata),
            model: scene.model || 'dall-e-3'
          }]
        })
      });

      const data = await response.json();

      if (data.success) {
        // Add to local array
        const libraryScene = {
          id: `${batchId}_0`,
          batchId,
          index: 0,
          imageUrl: scene.imageUrl,
          prompt: scene.text || scene.prompt || '',
          libraryTag: tag,
          libraryName: name,
          savedAt: metadata.savedAt,
          originalBatchId: metadata.originalBatchId,
          caption: metadata.caption,
          duration: metadata.duration,
          visualDescription: metadata.visualDescription
        };

        this.scenes.unshift(libraryScene);
        this.refreshUI();

        console.log('[Library] Scene added:', libraryScene);
        return libraryScene;
      } else {
        console.error('[Library] Failed to save scene:', data.error);
        return null;
      }
    } catch (error) {
      console.error('[Library] Error adding scene:', error);
      return null;
    }
  }

  // Remove scene from library
  async removeFromLibrary(sceneId) {
    try {
      const scene = this.scenes.find(s => s.id === sceneId);
      if (!scene) {
        console.error('[Library] Scene not found:', sceneId);
        return false;
      }

      const userId = localStorage.getItem('ai_tool_user_id');
      if (!userId) {
        showToast('User ID not found', true);
        return false;
      }

      // Delete from Supabase
      const response = await fetch(`/api/db/batch-scenes/${userId}/${scene.batchId}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (data.success) {
        // Remove from local array
        this.scenes = this.scenes.filter(s => s.id !== sceneId);
        this.refreshUI();
        console.log('[Library] Scene removed:', sceneId);
        return true;
      } else {
        console.error('[Library] Failed to delete scene:', data.error);
        return false;
      }
    } catch (error) {
      console.error('[Library] Error removing scene:', error);
      return false;
    }
  }

  // Update scene tags and name
  async updateSceneTags(sceneId, newTag, newName) {
    try {
      const scene = this.scenes.find(s => s.id === sceneId);
      if (!scene) {
        console.error('[Library] Scene not found:', sceneId);
        return false;
      }

      // Remove old scene
      await this.removeFromLibrary(sceneId);

      // Add with new tags
      const updatedScene = await this.addSceneToLibrary({
        imageUrl: scene.imageUrl,
        text: scene.prompt,
        caption: scene.caption,
        duration: scene.duration,
        visualDescription: scene.visualDescription,
        originalBatchId: scene.originalBatchId,
        model: 'dall-e-3'
      }, newTag, newName);

      return updatedScene !== null;
    } catch (error) {
      console.error('[Library] Error updating tags:', error);
      return false;
    }
  }

  // Search scenes
  search(query) {
    const lowerQuery = query.toLowerCase();
    return this.scenes.filter(scene =>
      scene.libraryName?.toLowerCase().includes(lowerQuery) ||
      scene.prompt?.toLowerCase().includes(lowerQuery) ||
      scene.caption?.toLowerCase().includes(lowerQuery) ||
      scene.libraryTag?.toLowerCase().includes(lowerQuery)
    );
  }

  // Get scenes by tag
  getByTag(tag) {
    if (tag === 'all') return this.scenes;
    return this.scenes.filter(scene => scene.libraryTag === tag);
  }

  // Get scene by ID
  getById(sceneId) {
    return this.scenes.find(s => s.id === sceneId);
  }

  // Get statistics
  getStats() {
    const stats = {
      total: this.scenes.length,
      byTag: {}
    };

    this.scenes.forEach(scene => {
      const tag = scene.libraryTag || 'other';
      stats.byTag[tag] = (stats.byTag[tag] || 0) + 1;
    });

    return stats;
  }

  // Refresh UI
  refreshUI() {
    if (typeof renderLibraryGrid === 'function') {
      renderLibraryGrid();
    }
  }
}

// Global instance
const sceneLibraryManager = new SceneLibraryManager();

// Render library grid
function renderLibraryGrid(filter = 'all', searchQuery = '') {
  const grid = document.getElementById('library-grid');
  const emptyState = document.getElementById('library-empty');
  const statsEl = document.getElementById('library-stats');

  if (!grid) return;

  let items = sceneLibraryManager.scenes;

  // Apply tag filter
  if (filter !== 'all') {
    items = items.filter(scene => scene.libraryTag === filter);
  }

  // Apply search filter
  if (searchQuery) {
    items = sceneLibraryManager.search(searchQuery);
  }

  // Update stats
  if (statsEl) {
    const stats = sceneLibraryManager.getStats();
    statsEl.textContent = `${stats.total} saved scene${stats.total === 1 ? '' : 's'}`;
  }

  // Show empty state or grid
  if (items.length === 0) {
    grid.innerHTML = '';
    if (emptyState) emptyState.hidden = false;
    return;
  }

  if (emptyState) emptyState.hidden = true;

  grid.innerHTML = items.map(scene => `
    <div class="library-item" data-id="${scene.id}">
      <div class="library-image-wrapper">
        <img src="${scene.imageUrl}" alt="${scene.libraryName}" loading="lazy">
        <div class="library-overlay">
          <button class="library-btn preview-btn" title="Preview">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
          <button class="library-btn use-btn" title="Use in Video">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14"/>
              <path d="M12 5l7 7-7 7"/>
            </svg>
          </button>
          <button class="library-btn edit-btn" title="Edit Tags">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="library-btn delete-btn" title="Remove from Library">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="library-info">
        <span class="library-tag ${scene.libraryTag}">${scene.libraryTag}</span>
      </div>
      <p class="library-name">${scene.libraryName}</p>
    </div>
  `).join('');

  // Add event listeners
  grid.querySelectorAll('.library-item').forEach(item => {
    const id = item.dataset.id;

    item.querySelector('.preview-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      showLibraryPreview(id);
    });

    item.querySelector('.use-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      useSceneInVideo(id);
    });

    item.querySelector('.edit-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      showEditTagsDialog(id);
    });

    item.querySelector('.delete-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('Remove this scene from library?')) {
        sceneLibraryManager.removeFromLibrary(id);
        showToast('Scene removed from library', false);
      }
    });

    // Click on item to preview
    item.addEventListener('click', () => showLibraryPreview(id));
  });
}

// Show preview modal
function showLibraryPreview(sceneId) {
  const scene = sceneLibraryManager.getById(sceneId);
  if (!scene) return;

  const modal = document.getElementById('library-preview-modal');
  if (!modal) return;

  const modalImage = document.getElementById('library-modal-image');
  const modalName = document.getElementById('library-modal-name');
  const modalTag = document.getElementById('library-modal-tag');
  const modalPrompt = document.getElementById('library-modal-prompt');

  if (modalImage) modalImage.src = scene.imageUrl;
  if (modalName) modalName.textContent = scene.libraryName;
  if (modalTag) {
    modalTag.textContent = scene.libraryTag;
    modalTag.className = `library-tag ${scene.libraryTag}`;
  }
  if (modalPrompt) modalPrompt.textContent = scene.prompt || scene.caption || 'No prompt';

  modal.dataset.currentId = sceneId;
  modal.hidden = false;
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

// Close preview modal
function closeLibraryPreview() {
  const modal = document.getElementById('library-preview-modal');
  if (modal) {
    modal.hidden = true;
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

// Use scene in video
function useSceneInVideo(sceneId) {
  const scene = sceneLibraryManager.getById(sceneId);
  if (!scene) return;

  // Check if video editor is available
  if (typeof videoEditor === 'undefined' || !videoEditor) {
    showToast('Please open Video Editor tab first', true);
    return;
  }

  // Convert library scene to video editor format
  const editorScene = {
    id: `library-scene-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    imageUrl: scene.imageUrl,
    text: scene.caption || scene.prompt || '',
    caption: scene.caption || scene.prompt || '',
    duration: scene.duration || 6,
    startTime: 0  // Will be recalculated by editor
  };

  // Add to video editor
  videoEditor.importScenes([editorScene]);
  showToast(`Added "${scene.libraryName}" to video editor`, false);

  // Switch to video editor tab
  const videoTab = document.querySelector('.tab[data-tab="video-editor"]');
  if (videoTab) videoTab.click();
}

// Show edit tags dialog
function showEditTagsDialog(sceneId) {
  const scene = sceneLibraryManager.getById(sceneId);
  if (!scene) return;

  const modal = document.getElementById('edit-tags-modal');
  if (!modal) return;

  const nameInput = document.getElementById('edit-scene-name');
  const tagSelect = document.getElementById('edit-scene-tag');

  if (nameInput) nameInput.value = scene.libraryName;
  if (tagSelect) tagSelect.value = scene.libraryTag;

  modal.dataset.currentId = sceneId;
  modal.hidden = false;
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

// Close edit tags modal
function closeEditTagsModal() {
  const modal = document.getElementById('edit-tags-modal');
  if (modal) {
    modal.hidden = true;
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

// Save edited tags
async function saveEditedTags() {
  const modal = document.getElementById('edit-tags-modal');
  if (!modal) return;

  const sceneId = modal.dataset.currentId;
  const nameInput = document.getElementById('edit-scene-name');
  const tagSelect = document.getElementById('edit-scene-tag');

  const newName = nameInput?.value || 'Untitled Scene';
  const newTag = tagSelect?.value || 'other';

  showToast('Updating scene...', false);
  const success = await sceneLibraryManager.updateSceneTags(sceneId, newTag, newName);

  if (success) {
    showToast('Scene updated', false);
    closeEditTagsModal();
  } else {
    showToast('Failed to update scene', true);
  }
}

// Initialize library UI
function initLibraryUI() {
  const filterBtns = document.querySelectorAll('.library-filter-btn');
  const searchInput = document.getElementById('library-search');
  const addToLibraryBtn = document.getElementById('add-to-library-btn');

  // Filter buttons
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.dataset.filter;
      renderLibraryGrid(filter, searchInput?.value || '');
    });
  });

  // Search input
  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        const activeFilter = document.querySelector('.library-filter-btn.active')?.dataset.filter || 'all';
        renderLibraryGrid(activeFilter, searchInput.value);
      }, 300);
    });
  }

  // Add to library button - show batch selection
  if (addToLibraryBtn) {
    addToLibraryBtn.addEventListener('click', () => {
      showAddToLibraryDialog();
    });
  }

  // Preview modal handlers
  const previewModal = document.getElementById('library-preview-modal');
  if (previewModal) {
    previewModal.addEventListener('click', (e) => {
      if (e.target === previewModal) closeLibraryPreview();
    });

    document.getElementById('library-modal-close')?.addEventListener('click', closeLibraryPreview);
    document.getElementById('library-modal-use')?.addEventListener('click', () => {
      const sceneId = previewModal.dataset.currentId;
      if (sceneId) {
        useSceneInVideo(sceneId);
        closeLibraryPreview();
      }
    });
    document.getElementById('library-modal-delete')?.addEventListener('click', async () => {
      const sceneId = previewModal.dataset.currentId;
      if (sceneId && confirm('Remove this scene from library?')) {
        await sceneLibraryManager.removeFromLibrary(sceneId);
        closeLibraryPreview();
        showToast('Scene removed from library', false);
      }
    });
  }

  // Edit tags modal handlers
  const editModal = document.getElementById('edit-tags-modal');
  if (editModal) {
    editModal.addEventListener('click', (e) => {
      if (e.target === editModal) closeEditTagsModal();
    });

    document.getElementById('edit-tags-cancel')?.addEventListener('click', closeEditTagsModal);
    document.getElementById('edit-tags-save')?.addEventListener('click', saveEditedTags);
  }

  // Load library scenes on init
  sceneLibraryManager.loadFromSupabase().then(() => {
    renderLibraryGrid();
  });
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLibraryUI);
} else {
  initLibraryUI();
}
