<template>
  <div class="page">
    <Card>
      <template #title>
        <h2 class="card__title">Process YouTube Content</h2>
      </template>
      <template #content>
        <form
          class="process-form"
          @submit.prevent="handleSubmitYoutubeLink"
        >
          <div class="process-form__group">
            <label for="youtube-url" class="process-form__label"> YouTube URL </label>
            <InputText
              id="youtube-url"
              v-model="youtubeUrl"
              type="url"
              placeholder="https://www.youtube.com/watch?v=..."
              class="process-form__input"
              required
            />
          </div>

          <div class="process-form__checkbox-group">
            <Checkbox
              v-model="processAsPlaylist"
              input-id="process-playlist"
              :binary="true"
            />
            <label for="process-playlist" class="process-form__checkbox-label">Process as playlist</label>
          </div>

          <Button
            type="submit"
            :loading="isProcessing"
            :disabled="!youtubeUrl"
            class="process-form__submit"
            severity="success"
          >
            {{ isProcessing ? "Processing..." : "Start Processing" }}
          </Button>
        </form>

        <Message
          v-if="submitResult"
          :severity="submitResult.severity"
          :closable="false"
          class="process-form__result"
        >
          <div class="process-form__result-content">
            <strong class="process-form__result-header">{{ submitResult.title }}</strong>
            <p class="process-form__result-message">{{ submitResult.message }}</p>
          </div>
        </Message>
      </template>
    </Card>

    <div v-if="loading" class="page__loading">
      <ProgressSpinner />
      <p class="page__loading-text">Loading files...</p>
    </div>

    <div v-else-if="error" class="page__error">
      <Message severity="error" :closable="false">
        {{ error }}
      </Message>
    </div>

    <div v-else>
      <!-- Summary Section -->
      <Card class="card">
        <template #title>
          <h2>Summary</h2>
        </template>
        <template #content>
          <div class="summary__grid">
            <div class="summary__metric">
              <div class="summary__metric-value">
                {{ filesData.totalFiles }}
              </div>
              <div class="summary__metric-label">Total Files</div>
            </div>
            <div class="summary__directory">
              <div class="summary__directory-path">
                {{ filesData.baseDirectory }}
              </div>
              <div class="summary__directory-label">Base Directory</div>
            </div>
            <div class="summary__actions">
              <NuxtLink to="/processing-jobs">
                <Button size="large" severity="secondary" class="summary__actions-button">
                  View Jobs
                </Button>
              </NuxtLink>
              <NuxtLink to="/cache">
                <Button size="large" severity="secondary" class="summary__actions-button">
                  Cache Management
                </Button>
              </NuxtLink>
                <Button
                  size="large"
                  severity="secondary"
                  class="summary__actions-button"
                  :loading="fetchingAlbumArt"
                  @click="handleFetchAlbumArt"
                >
                  Fetch Album Art
                </Button>
            </div>
          </div>
          <div v-if="fetchAlbumArtResult" class="summary__result">
          <Message style="margin-top: 1rem" :severity="fetchAlbumArtResult.severity" :closable="true">
            {{ fetchAlbumArtResult.message }}
          </Message>
        </div>
        </template>
      </Card>
      <div class="metadata__panel">
        <div class="metadata__files">
          <Card class="card">
            <template #title>
              <div class="files__header">
                <h2 class="card__title">Files</h2>
                <div class="files__controls">
                  <Button
                    v-if="selectedFiles.length > 1"
                    severity="danger"
                    size="small"
                    class="files__bulk-actions-button mobile-mb-2"
                    @click="showDeleteConfirm = true"
                  >
                    <span class="desktop-text">Bulk Delete ({{ selectedFiles.length }})</span>
                    <span class="mobile-text">Delete ({{ selectedFiles.length }})</span>
                  </Button>
                  <Button
                    severity="secondary"
                    size="small"
                    class="mobile-mb-2"
                    @click="refreshFiles"
                    >Refresh</Button
                  >
                  <div class="files__multiselect">
                    <span class="files__multiselect-label">Multi-Select</span>
                    <InputSwitch
                      v-model="multiSelectEnabled"
                      @change="onToggleMultiSelect"
                    />
                  </div>
                </div>
              </div>
            </template>
            <template #content>
              <div class="files__search">
                <InputText
                  v-model="searchQuery"
                  placeholder="Search files..."
                  class="files__search-input"
                />
              </div>
              <DataTable
                v-model:selection="tableSelection"
                :selection-mode="multiSelectEnabled ? 'multiple' : null"
                :value="filteredFiles"
                :paginator="true"
                :rows="pageSize"
                :rows-per-page-options="[25, 50, 100, 1000, 10000]"
                paginator-template="RowsPerPageDropdown FirstPageLink PrevPageLink CurrentPageReport NextPageLink LastPageLink"
                current-page-report-template="Showing {first} to {last} of {totalRecords} files"
                data-key="path"
                :loading="loading"
                class="p-datatable-sm"
                row-hover
                @row-click="onRowClick"
              >
                <Column
                  v-if="multiSelectEnabled"
                  selection-mode="multiple"
                  header-style="width: 3rem"
                />
                <Column field="path" header="Path">
                  <template #body="slotProps">
                    <div
                      class="datatable__cell"
                      :class="{
                        'datatable__cell--active':
                          slotProps.data.path === selectedFile ||
                          (multiSelectEnabled &&
                            selectedFiles.some(
                              (f) => f.path === slotProps.data.path
                            )),
                      }"
                      :title="slotProps.data.path"
                    >
                      {{ slotProps.data.path }}
                    </div>
                  </template>
                </Column>
              </DataTable>
            </template>
          </Card>
        </div>

        <!-- Metadata Panel -->
        <div class="metadata__sidebar">
          <Card class="card">
            <template #title>
              <div class="metadata__header">
                <div class="metadata__info">
                  <h2 class="metadata__title">
                    {{
                      isMultiFileMode
                        ? `Bulk Metadata (${selectedFiles.length} files)`
                        : selectedFile && isImageFile(selectedFile)
                        ? "Image Viewer"
                        : "Metadata"
                    }}
                  </h2>
                  <div
                    v-if="selectedFile && !isMultiFileMode"
                    class="metadata__filepath"
                  >
                    {{ selectedFile }}
                  </div>
                  <div v-if="isMultiFileMode" class="metadata__mode-indicator">
                    Editing {{ selectedFiles.length }} files
                  </div>
                </div>
                <div class="metadata__actions">
                  <Button
                    v-if="selectedFile"
                    size="small"
                    severity="danger"
                    @click="handleDeleteFile(selectedFile)"
                    >Delete</Button
                  >
                  <Button
                    v-if="
                      (selectedFile || isMultiFileMode) &&
                      selectedFiles.length === 0
                    "
                    size="small"
                    severity="secondary"
                    @click="clearSelection"
                    >Clear</Button
                  >
                  <Button
                    v-if="isMultiFileMode && selectedFiles.length > 0"
                    size="small"
                    severity="danger"
                    @click="showDeleteConfirm = true"
                    >Delete All</Button
                  >
                </div>
              </div>
            </template>
            <template #content>
              <div
                v-if="!selectedFile && !isMultiFileMode && !metadataLoading"
                class="metadata__placeholder"
              >
                Select a file to view and edit its metadata.
              </div>
              <div v-if="metadataLoading" class="metadata__loading">
                <ProgressSpinner />
                <p class="metadata__loading-text">Loading...</p>
              </div>
              <div v-else-if="metadataError">
                <Message severity="error" :closable="false">{{
                  metadataError
                }}</Message>
              </div>
              <div
                v-else-if="selectedFile && isImageFile(selectedFile)"
                class="image-viewer"
              >
                <div class="image-viewer__container">
                  <img
                    :src="getImageUrl(selectedFile)"
                    :alt="selectedFile"
                    class="image-viewer__image"
                    @error="imageError = true"
                  >
                  <div v-if="imageError" class="image-viewer__error">
                    <Message severity="error" :closable="false">
                      Failed to load image
                    </Message>
                  </div>
                </div>
              </div>
              <div v-else-if="fileMetadata || isMultiFileMode">
                <!-- Custom Metadata Tags Section -->
                <div class="tags__section">
                  <label class="tags__label">Add Custom Fields</label>
                  <div class="tags__chips">
                    <Button
                      v-for="tag in availableTags"
                      :key="tag"
                      size="small"
                      severity="secondary"
                      outlined
                      @click="addCustomField(tag)"
                    >
                      {{ tag }}
                    </Button>
                  </div>
                </div>

                <div class="metadata__form">
                  <div
                    v-for="(value, key) in editableMetadata"
                    :key="key"
                    class="metadata__field"
                  >
                    <label class="metadata__label">{{ key }}</label>
                    <InputText
                      v-model="editableMetadata[key]"
                      class="metadata__input"
                    />
                  </div>
                </div>
                <div class="metadata__save">
                  <Button
                    severity="success"
                    :loading="savingMetadata"
                    size="small"
                    :disabled="
                      isMultiFileMode &&
                      Object.keys(getChangedFields()).length === 0
                    "
                    @click="saveMetadata"
                  >
                    {{
                      isMultiFileMode
                        ? `Save ${
                            Object.keys(getChangedFields()).length
                          } Changes`
                        : "Save"
                    }}
                  </Button>
                </div>
                <div v-if="saveResult" class="metadata__result">
                  <Message :severity="saveResult.severity" :closable="false">{{
                    saveResult.message
                  }}</Message>
                </div>
              </div>
            </template>
          </Card>
        </div>
      </div>
    </div>

    <!-- Delete Confirmation Dialog -->
    <Dialog
      v-model:visible="showDeleteConfirm"
      modal
      header="Confirm Deletion"
      :style="{ width: '30rem' }"
    >
      <p class="dialog__content">
        Are you sure you want to delete {{ selectedFiles.length }} selected
        file(s)?
      </p>
      <div class="dialog__file-list">
        <div
          v-for="file in selectedFiles"
          :key="file.path"
          class="dialog__file-item"
        >
          {{ file.path }}
        </div>
      </div>

      <template #footer>
        <div class="dialog__actions">
          <Button
            :loading="deletingFiles"
            severity="danger"
            @click="confirmBulkDelete"
          >
            Delete Files
          </Button>
          <Button severity="secondary" @click="showDeleteConfirm = false">
            Cancel
          </Button>
        </div>
      </template>
    </Dialog>

    <!-- Playlist Confirmation Dialog -->
    <Dialog
      v-model:visible="showPlaylistConfirm"
      modal
      header="Confirm Playlist Processing"
      :style="{ width: '35rem' }"
    >
      <div v-if="playlistInfo" class="dialog__info">
        <p v-if="playlistInfo.videoCount !== null" class="dialog__content">
          This playlist contains
          <strong>{{ playlistInfo.videoCount }}</strong> videos.
        </p>
        <p v-else class="dialog__content">
          Unable to determine the exact number of videos in this playlist.
          {{ playlistInfo.warning || playlistInfo.message }}
        </p>
        <p class="dialog__warning">
          Processing a playlist may take a significant amount of time depending
          on the number of videos. Do you want to proceed?
        </p>
      </div>

      <template #footer>
        <div class="dialog__actions">
          <Button
            :loading="confirmingPlaylist"
            severity="success"
            @click="handleConfirmPlaylist(true)"
          >
            {{ confirmingPlaylist ? "Processing..." : "Start Processing" }}
          </Button>
          <Button severity="secondary" @click="handleConfirmPlaylist(false)">
            Cancel
          </Button>
        </div>
      </template>
    </Dialog>
  </div>
</template>

<script setup>
const {
  getFiles,
  deleteFile,
  getMetadata,
  updateMetadata,
  processYouTubeUrl,
  getPlaylistInfo,
} = useApi();

const fetchingAlbumArt = ref(false);
const fetchAlbumArtResult = ref(null);

const handleFetchAlbumArt = async () => {
  fetchAlbumArtResult.value = null;
  fetchingAlbumArt.value = true;
  try {
    const response = await fetch(`${apiBase}/fetch-album-art`, {
      method: "POST",
    });
    const data = await response.json();
    if (!response.ok) {
      fetchAlbumArtResult.value = {
        severity: "error",
        message: data?.message || "Failed to fetch album art",
      };
    } else {
      fetchAlbumArtResult.value = {
        severity: "success",
        message: data?.message || "Album art fetch started!",
      };
    }
  } catch (error) {
    fetchAlbumArtResult.value = {
      severity: "error",
      message: error?.message || "Failed to fetch album art",
    };
  }
  fetchingAlbumArt.value = false;
};

const youtubeUrl = ref("");
const isProcessing = ref(false);
const submitResult = ref(null);
const config = useRuntimeConfig();
const apiBase = config.public.apiBase;
const loading = ref(true);
const error = ref("");
const filesData = ref({ baseDirectory: "", totalFiles: 0, files: [] });
const searchQuery = ref("");
const selectedFiles = ref([]);
const pageSize = ref(50);
const multiSelectEnabled = ref(false);

const selectedFile = ref("");
const metadataLoading = ref(false);
const metadataError = ref("");
const fileMetadata = ref(null);
const editableMetadata = ref({});
const originalMetadata = ref({});
const savingMetadata = ref(false);
const saveResult = ref(null);

// Multiple file metadata state
const selectedFilesMetadata = ref([]);
const isMultiFileMode = computed(() => selectedFiles.value.length > 1);

const showDeleteConfirm = ref(false);
const deletingFiles = ref(false);
const imageError = ref(false);
const processAsPlaylist = ref(false);

// Playlist confirmation state
const showPlaylistConfirm = ref(false);
const playlistInfo = ref(null);
const confirmingPlaylist = ref(false);

// Popular metadata tags for quick addition (standard ffmpeg tag names)
const popularTags = [
  "title",
  "artist",
  "album",
  "album_artist",
  "track",
  "disc",
  "genre",
  "date",
  "comment",
  "lyrics",
  "composer",
  "performer",
  "publisher",
  "copyright",
  "encoded_by",
];

const handleSubmitYoutubeLink = async () => {
  if (!youtubeUrl.value) return;

  isProcessing.value = true;
  submitResult.value = null;

  let urlToProcess = youtubeUrl.value;

  if (processAsPlaylist.value) {
    const { data, error } = await getPlaylistInfo(urlToProcess);

    if (error) {
      submitResult.value = {
        severity: "error",
        title: "Error",
        message: error.message || "Failed to get playlist information",
      };
      isProcessing.value = false;
      return;
    }

    playlistInfo.value = data;
    showPlaylistConfirm.value = true;
    isProcessing.value = false;
    return;
  }

  try {
    const url = new URL(youtubeUrl.value);
    url.searchParams.delete("list");
    url.searchParams.delete("playlist");
    urlToProcess = url.toString();
  } catch (error) {
    console.error("Invalid URL:", error);
  }

  const { data, error } = await processYouTubeUrl(urlToProcess);

  if (error) {
    submitResult.value = {
      severity: "error",
      title: "Error",
      message: error.message || "Failed to process YouTube URL",
    };
  } else {
    submitResult.value = {
      severity: "success",
      title: "Success!",
      message: data.message,
      statusUrl: data.statusUrl,
    };

    youtubeUrl.value = "";
    processAsPlaylist.value = false;
  }

  isProcessing.value = false;
};

// Handle playlist confirmation
const handleConfirmPlaylist = async (confirmed) => {
  showPlaylistConfirm.value = false;

  if (!confirmed) {
    playlistInfo.value = null;
    return;
  }

  confirmingPlaylist.value = true;

  const urlToProcess = youtubeUrl.value;

  const { data, error } = await processYouTubeUrl(urlToProcess);

  if (error) {
    submitResult.value = {
      severity: "error",
      title: "Error",
      message: error.message || "Failed to process playlist",
    };
  } else {
    submitResult.value = {
      severity: "success",
      title: "Success!",
      message: data.message,
      statusUrl: data.statusUrl,
    };

    youtubeUrl.value = "";
    processAsPlaylist.value = false;
  }

  confirmingPlaylist.value = false;
  playlistInfo.value = null;
};

// Check if file is an image
const isImageFile = (filePath) => {
  if (!filePath) return false;
  const ext = filePath.split(".").pop()?.toLowerCase();
  return [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "webp",
    "svg",
    "bmp",
    "tiff",
    "tif",
  ].includes(ext);
};

// Get image URL for display
const getImageUrl = (filePath) => {
  if (!filePath) return "";

  const cleanPath = filePath.replace(filesData.value.baseDirectory + "/", "");
  return `${apiBase}/album-art/${cleanPath}`;
};

// Merge metadata from multiple files
const mergeMetadata = (metadataArray) => {
  if (!metadataArray || metadataArray.length === 0) return {};

  const merged = {};
  const allTags = new Set();

  metadataArray.forEach((meta) => {
    if (meta.tags) {
      Object.keys(meta.tags).forEach((tag) => allTags.add(tag));
    }
  });

  allTags.forEach((tag) => {
    const values = metadataArray
      .map((meta) => meta.tags?.[tag])
      .filter((val) => val !== undefined && val !== null);

    if (values.length === 0) {
      merged[tag] = "";
    } else {
      const firstValue = values[0];
      const allSame = values.every((val) => val === firstValue);
      merged[tag] = allSame ? firstValue : "";
    }
  });

  return merged;
};

const fetchFiles = async () => {
  loading.value = true;
  error.value = "";

  const { data, error: apiError } = await getFiles();

  if (apiError) {
    error.value = apiError.message || "Failed to load files";
  } else {
    filesData.value = data;
  }

  loading.value = false;
};

const filteredFiles = computed(() => {
  let files = filesData.value.files.map((file) => ({
    path: file,
  }));

  if (searchQuery.value) {
    files = files.filter((file) =>
      file.path.toLowerCase().includes(searchQuery.value.toLowerCase())
    );
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  return files;
});

const tableSelection = computed({
  get: () => {
    return multiSelectEnabled.value ? selectedFiles.value : null;
  },
  set: (value) => {
    if (multiSelectEnabled.value) {
      selectedFiles.value = value || [];
    }
  },
});

const availableTags = computed(() => {
  return popularTags.filter((tag) => !(tag in editableMetadata.value));
});

const viewMetadata = async (file) => {
  selectedFile.value = file;
  metadataLoading.value = true;
  metadataError.value = "";
  imageError.value = false;

  if (isImageFile(file)) {
    metadataLoading.value = false;
    fileMetadata.value = null;
    editableMetadata.value = {};
    originalMetadata.value = {};
    return;
  }

  const { data, error: apiError } = await getMetadata(file);

  if (apiError) {
    metadataError.value = apiError.message || "Failed to load metadata";
  } else {
    fileMetadata.value = data;
    editableMetadata.value = { ...data.tags };
    originalMetadata.value = { ...data.tags };
  }

  metadataLoading.value = false;
};

// Load metadata for multiple files
const loadBulkMetadata = async () => {
  if (selectedFiles.value.length === 0) return;

  metadataLoading.value = true;
  metadataError.value = "";
  imageError.value = false;

  try {
    const metadataPromises = selectedFiles.value.map(async (file) => {
      if (isImageFile(file.path)) return null;

      const { data, error: apiError } = await getMetadata(file.path);
      if (apiError) {
        console.error(
          `Failed to load metadata for ${file.path}:`,
          apiError.message
        );
        return null;
      }
      return data;
    });

    const metadataResults = await Promise.all(metadataPromises);
    const validMetadata = metadataResults.filter((meta) => meta !== null);

    if (validMetadata.length === 0) {
      metadataError.value = "No valid metadata found for selected files";
      selectedFilesMetadata.value = [];
      editableMetadata.value = {};
      originalMetadata.value = {};
    } else {
      selectedFilesMetadata.value = validMetadata;
      const merged = mergeMetadata(validMetadata);
      editableMetadata.value = { ...merged };
      originalMetadata.value = { ...merged };
    }
  } catch (error) {
    metadataError.value = "Failed to load metadata for selected files";
    console.error("Bulk metadata loading error:", error);
  }

  metadataLoading.value = false;
};

const onRowClick = (event) => {
  if (!multiSelectEnabled.value) {
    const file = event.data.path;
    viewMetadata(file);
  }
};

const saveMetadata = async () => {
  savingMetadata.value = true;
  saveResult.value = null;

  if (isMultiFileMode.value) {
    await saveBulkMetadata();
  } else {
    const { data, error: apiError } = await updateMetadata(
      selectedFile.value,
      editableMetadata.value
    );

    if (apiError) {
      console.error("Failed to update metadata:", apiError.message);
      saveResult.value = {
        severity: "error",
        message: apiError.message || "Failed to save",
      };
    } else {
      saveResult.value = {
        severity: "success",
        message: data.message || "Saved",
      };
      if (data.filePath && data.filePath !== selectedFile.value) {
        selectedFile.value = data.filePath;
      }
      await fetchFiles();
    }
  }

  savingMetadata.value = false;
};

// Save metadata for multiple files
const saveBulkMetadata = async () => {
  const changedFields = getChangedFields();

  if (Object.keys(changedFields).length === 0) {
    saveResult.value = {
      severity: "info",
      message: "No changes detected",
    };
    return;
  }

  let successCount = 0;
  let errorCount = 0;
  const errors = [];

  for (const file of selectedFiles.value) {
    try {
      const { error: apiError } = await updateMetadata(
        file.path,
        changedFields
      );

      if (apiError) {
        errorCount++;
        errors.push(`${file.path}: ${apiError.message}`);
      } else {
        successCount++;
      }
    } catch (error) {
      errorCount++;
      errors.push(`${file.path}: ${error.message}`);
    }
  }

  if (errorCount === 0) {
    saveResult.value = {
      severity: "success",
      message: `Successfully updated ${successCount} file(s)`,
    };
    await fetchFiles();
  } else if (successCount === 0) {
    saveResult.value = {
      severity: "error",
      message: `Failed to update all files: ${errors.join("; ")}`,
    };
  } else {
    saveResult.value = {
      severity: "warn",
      message: `Updated ${successCount} file(s), ${errorCount} failed: ${errors.join(
        "; "
      )}`,
    };
    await fetchFiles();
  }
};

// Get only the fields that have changed
const getChangedFields = () => {
  const changed = {};

  for (const [key, value] of Object.entries(editableMetadata.value)) {
    const originalValue = originalMetadata.value[key];
    if (value !== originalValue) {
      changed[key] = value;
    }
  }

  return changed;
};

const clearSelection = () => {
  selectedFile.value = "";
  selectedFiles.value = [];
  fileMetadata.value = null;
  selectedFilesMetadata.value = [];
  editableMetadata.value = {};
  originalMetadata.value = {};
  metadataError.value = "";
  saveResult.value = null;
  imageError.value = false;
};

const addCustomField = (tag) => {
  if (!(tag in editableMetadata.value)) {
    editableMetadata.value[tag] = "";
  }
};

const onToggleMultiSelect = () => {
  if (!multiSelectEnabled.value) {
    selectedFiles.value = [];
    selectedFile.value = "";

    fileMetadata.value = null;
    editableMetadata.value = {};
    originalMetadata.value = {};
    metadataError.value = "";
    saveResult.value = null;
  } else {
    selectedFiles.value = [];
    selectedFile.value = "";
    selectedFilesMetadata.value = [];
    editableMetadata.value = {};
    originalMetadata.value = {};
    metadataError.value = "";
    saveResult.value = null;
  }
};

const handleDeleteFile = async (file) => {
  if (!confirm(`Are you sure you want to delete "${file}"?`)) {
    return;
  }

  const { error: apiError } = await deleteFile(file);

  if (apiError) {
    console.error("Failed to delete file:", apiError.message);
  } else {
    console.log("File deleted successfully!");
    await fetchFiles();
  }
};

const confirmBulkDelete = async () => {
  deletingFiles.value = true;

  for (const file of selectedFiles.value) {
    const { error: apiError } = await deleteFile(file.path);
    if (apiError) {
      console.error(`Failed to delete ${file.path}:`, apiError.message);
    }
  }

  console.log(`${selectedFiles.value.length} files processed!`);
  selectedFiles.value = [];
  showDeleteConfirm.value = false;
  deletingFiles.value = false;

  fileMetadata.value = null;
  selectedFilesMetadata.value = [];
  editableMetadata.value = {};
  originalMetadata.value = {};
  metadataError.value = "";
  saveResult.value = null;

  await fetchFiles();
};

const refreshFiles = () => {
  fetchFiles();
};

onMounted(() => {
  fetchFiles();
});

// Watch for changes in selectedFiles to load metadata automatically
watch(selectedFiles, (newSelection) => {
  if (multiSelectEnabled.value) {
    if (newSelection.length > 0) {
      loadBulkMetadata();
    } else {
      fileMetadata.value = null;
      selectedFilesMetadata.value = [];
      editableMetadata.value = {};
      originalMetadata.value = {};
      metadataError.value = "";
      saveResult.value = null;
    }
  }
});
</script>

<style lang="scss" scoped>
/* Mobile responsive styles */
@media (max-width: 767px) {
  .metadata {
    &__panel {
      flex-direction: column;
    }
    
    &__sidebar {
      width: 100%;
      position: static;
    }
  }
  
  .files {
    &__controls {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      align-items: stretch;
    }
    
    &__multiselect {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.5rem;
    }
    
    &__header {
      flex-direction: column;
      align-items: stretch;
      gap: 1rem;

      h2 {
        margin-bottom: 0;
      }
    }
  }
  
  .desktop-text {
    display: none;
  }
  
  .mobile-text {
    display: inline;
  }
  
  .mobile-mb-2 {
    margin-bottom: 0.5rem;
  }
  
  .summary {
    &__grid {
      grid-template-columns: repeat(1, minmax(0, 1fr));
      gap: 0.75rem;
    }
  }
  
  .p-dialog {
    width: 95vw !important;
    max-width: 95vw !important;
  }
}

@media (min-width: 768px) {
  .files {
    &__controls {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 0.5rem;
    }
    
    &__multiselect {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    &__header {
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
    }
  }
  
  .desktop-text {
    display: inline;
  }
  
  .mobile-text {
    display: none;
  }
  
  .mobile-mb-2 {
    margin-bottom: 0;
  }
}
</style>
