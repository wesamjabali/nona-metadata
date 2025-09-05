<template>
  <div class="page-container">
    <div style="width: 100% !important; margin-bottom: 1.5rem">
      <Card>
        <template #title>
          <h2 class="text-xl font-semibold">Process YouTube Content</h2>
        </template>
        <template #content>
          <form
            style="display: flex; gap: 1.5rem; flex-direction: column"
            @submit.prevent="handleSubmitYoutubeLink"
          >
            <div>
              <label for="youtube-url"> YouTube URL </label>
              <InputText
                id="youtube-url"
                v-model="youtubeUrl"
                type="url"
                placeholder="https://www.youtube.com/watch?v=..."
                style="width: 100%"
                required
              />
            </div>

            <div>
              <Checkbox
                id="process-playlist"
                v-model="processAsPlaylist"
                :binary="true"
              />
              <label for="process-playlist" style="margin-left: 0.5rem"
                >Process as playlist</label
              >
            </div>

            <Button
              type="submit"
              :loading="isProcessing"
              :disabled="!youtubeUrl"
              class="full-width"
              severity="success"
            >
              {{ isProcessing ? "Processing..." : "Start Processing" }}
            </Button>
          </form>

          <Message
            v-if="submitResult"
            :severity="submitResult.severity"
            :closable="false"
            class="margin-top-4"
          >
            <div class="flex-col-gap">
              <strong>{{ submitResult.title }}</strong>
              <p>{{ submitResult.message }}</p>
            </div>
          </Message>
        </template>
      </Card>
    </div>

    <div v-if="loading" class="text-center padding-y-8">
      <ProgressSpinner />
      <p class="margin-top-3 text-gray-600">Loading files...</p>
    </div>

    <div v-else-if="error" class="margin-bottom-6">
      <Message severity="error" :closable="false">
        {{ error }}
      </Message>
    </div>

    <div v-else>
      <!-- Left: Files -->
      <Card class="shadow-lg">
        <template #title>
          <h2>Summary</h2>
        </template>
        <template #content>
          <div class="summary-grid">
            <div class="text-center">
              <div class="text-3xl font-bold">
                {{ filesData.totalFiles }}
              </div>
              <div>Total Files</div>
            </div>
            <div class="text-center break-all">
              <div class="text-sm font-medium">
                {{ filesData.baseDirectory }}
              </div>
              <div>Base Directory</div>
            </div>
            <div class="text-center">
              <NuxtLink to="/processing-jobs">
                <Button size="large" severity="secondary" class="jobs-button">
                  View Jobs
                </Button>
              </NuxtLink>
            </div>
          </div>
        </template>
      </Card>
      <div class="split-panels" style="margin-top: 1.5rem">
        <div class="primary-column stack">
          <Card class="shadow-lg">
            <template #title>
              <div class="flex-between">
                <h2 class="text-xl font-semibold">Files</h2>
                <div class="files-header-controls">
                  <Button
                    v-if="selectedFiles.length > 1"
                    severity="danger"
                    size="small"
                    class="mobile-mb-2"
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
                  <div class="multi-select-toggle">
                    <span class="text-xs">Multi-Select</span>
                    <InputSwitch
                      v-model="multiSelectEnabled"
                      @change="onToggleMultiSelect"
                    />
                  </div>
                </div>
              </div>
            </template>
            <template #content>
              <div class="flex-col-md-row">
                <div class="flex-1">
                  <InputText
                    v-model="searchQuery"
                    placeholder="Search files..."
                    class="full-width"
                  />
                </div>
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
                      class="path-cell"
                      :class="{
                        active:
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

        <!-- Right: Metadata Panel -->
        <div class="meta-panel">
          <Card class="shadow-lg h-full">
            <template #title>
              <div class="flex-between-start">
                <div class="flex-1-mb">
                  <h2 class="text-lg font-semibold mb-1">
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
                    class="text-xs break-all"
                  >
                    {{ selectedFile }}
                  </div>
                  <div v-if="isMultiFileMode" class="text-xs text-gray-600">
                    Editing {{ selectedFiles.length }} files
                  </div>
                </div>
                <div class="flex-row-center">
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
                class="text-sm opacity-80"
              >
                Select a file to view and edit its metadata.
              </div>
              <div v-if="metadataLoading" class="text-center padding-y-6">
                <ProgressSpinner />
                <p class="margin-top-3 text-xs">Loading...</p>
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
                <div class="image-container">
                  <img
                    :src="getImageUrl(selectedFile)"
                    :alt="selectedFile"
                    class="display-image"
                    @error="imageError = true"
                  >
                  <div v-if="imageError" class="image-error">
                    <Message severity="error" :closable="false">
                      Failed to load image
                    </Message>
                  </div>
                </div>
              </div>
              <div v-else-if="fileMetadata || isMultiFileMode" class="stack">
                <!-- Custom Metadata Tags Section -->
                <div class="custom-tags-section">
                  <label class="field-label">Add Custom Fields</label>
                  <div class="tag-chips">
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

                <div class="meta-fields scrollable-meta-fields">
                  <div
                    v-for="(value, key) in editableMetadata"
                    :key="key"
                    class="meta-field"
                  >
                    <label class="field-label">{{ key }}</label>
                    <InputText
                      v-model="editableMetadata[key]"
                      class="field-input"
                    />
                  </div>
                </div>
                <div class="flex-end-gap">
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
                <div v-if="saveResult" class="margin-top-1">
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
      <p class="margin-bottom-4">
        Are you sure you want to delete {{ selectedFiles.length }} selected
        file(s)?
      </p>
      <div class="max-h-40 overflow-y-auto">
        <div
          v-for="file in selectedFiles"
          :key="file.path"
          class="padding-y-1 border-b-gray"
        >
          {{ file.path }}
        </div>
      </div>

      <template #footer>
        <Button
          :loading="deletingFiles"
          severity="danger"
          class=""
          @click="confirmBulkDelete"
        >
          Delete Files
        </Button>
        <Button severity="secondary" @click="showDeleteConfirm = false">
          Cancel
        </Button>
      </template>
    </Dialog>

    <!-- Playlist Confirmation Dialog -->
    <Dialog
      v-model:visible="showPlaylistConfirm"
      modal
      header="Confirm Playlist Processing"
      :style="{ width: '35rem' }"
    >
      <div v-if="playlistInfo" class="flex-col-gap">
        <p v-if="playlistInfo.videoCount !== null" class="margin-bottom-4">
          This playlist contains
          <strong>{{ playlistInfo.videoCount }}</strong> videos.
        </p>
        <p v-else class="margin-bottom-4">
          Unable to determine the exact number of videos in this playlist.
          {{ playlistInfo.warning || playlistInfo.message }}
        </p>
        <p class="text-sm text-gray-600">
          Processing a playlist may take a significant amount of time depending
          on the number of videos. Do you want to proceed?
        </p>
      </div>

      <template #footer>
        <Button
          :loading="confirmingPlaylist"
          severity="success"
          class=""
          @click="handleConfirmPlaylist(true)"
        >
          {{ confirmingPlaylist ? "Processing..." : "Start Processing" }}
        </Button>
        <Button severity="secondary" @click="handleConfirmPlaylist(false)">
          Cancel
        </Button>
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

const isMobile = () => window?.innerWidth || 100000 < 768;

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
const pageSize = ref(isMobile() ? 25 : 100);
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

<style scoped>
.page-container {
  display: flex;
  flex-direction: column;
}
.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}
.page-title {
  font-size: 1.875rem;
  line-height: 2.25rem;
  font-weight: 700;
  color: white;
}
.full-width {
  width: 100%;
}
.margin-top-4 {
  margin-top: 1rem;
}
.text-center {
  text-align: center;
}
.padding-y-8 {
  padding-top: 2rem;
  padding-bottom: 2rem;
}
.text-gray-600 {
  color: #4b5563;
}
.margin-bottom-6 {
  margin-bottom: 1.5rem;
}
.shadow-lg {
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1),
    0 4px 6px -2px rgba(0, 0, 0, 0.05);
}
.summary-grid {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 1rem;
}
@media (min-width: 768px) {
  .summary-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
.text-3xl {
  font-size: 1.875rem;
  line-height: 2.25rem;
}
.font-bold {
  font-weight: 700;
}
.text-gray-800 {
  color: #1f2937;
}
.text-sm {
  font-size: 0.875rem;
  line-height: 1.25rem;
}
.font-medium {
  font-weight: 500;
}
.break-all {
  word-break: break-all;
}
.margin-top-1-5rem {
  margin-top: 1.5rem;
}
.flex-between {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.text-xl {
  font-size: 1.25rem;
  line-height: 1.75rem;
}
.font-semibold {
  font-weight: 600;
}
.flex-row-center {
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  gap: 0.5rem;
}
.text-xs {
  font-size: 0.75rem;
  line-height: 1rem;
}
.flex-col-md-row {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 1rem;
}
@media (min-width: 768px) {
  .flex-col-md-row {
    flex-direction: row;
  }
}
.flex-1 {
  flex: 1 1 0%;
}
.margin-bottom-4 {
  margin-bottom: 1rem;
}
.h-full {
  height: 100%;
}
.flex-between-start {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.flex-1-mb {
  flex: 1;
  margin-bottom: 0.25rem;
}
.text-lg {
  font-size: 1.125rem;
  line-height: 1.75rem;
}
.opacity-80 {
  opacity: 0.8;
}
.padding-y-6 {
  padding-top: 1.5rem;
  padding-bottom: 1.5rem;
}
.margin-top-3 {
  margin-top: 0.75rem;
}
.flex-col-gap {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.text-blue-link {
  color: #2563eb;
}
.text-blue-link:hover {
  color: #1d4ed8;
}
.underline {
  text-decoration: underline;
}
.max-h-40 {
  max-height: 10rem;
}
.overflow-y-auto {
  overflow-y: auto;
}
.padding-y-1 {
  padding-top: 0.25rem;
  padding-bottom: 0.25rem;
}
.border-b-gray {
  border-bottom: 1px solid #e5e7eb;
}
.flex-end-gap {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.split-panels {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  align-items: flex-start;
}
.primary-column {
  flex: 1;
  min-width: 0;
}
.meta-panel {
  width: 100%;
}
@media (min-width: 768px) {
  .split-panels {
    flex-wrap: nowrap;
  }
  .meta-panel {
    width: 20rem;
    flex-shrink: 0;
    position: sticky;
    top: 1rem;
    align-self: flex-start;
  }
}
@media (min-width: 1024px) {
  .meta-panel {
    width: 26rem;
  }
}
@media (min-width: 1280px) {
  .meta-panel {
    width: 28rem;
  }
}
.meta-panel .p-card {
  height: 100%;
}

.custom-tags-section {
  margin-bottom: 1rem;
}

.tag-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.tag-chips .p-button {
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  border-radius: 1rem;
}

.meta-fields {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.meta-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.field-label {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}
.field-input {
  width: 100%;
}

.path-cell {
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 0.25rem;
  transition: background-color 0.2s ease;
  font-size: 0.9rem;
  line-height: 1.25rem;
  word-break: break-all;
}

.path-cell:hover {
  background-color: rgba(59, 130, 246, 0.1);
}

.path-cell.active {
  background-color: rgba(59, 130, 246, 0.2);
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.image-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.image-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  min-height: 200px;
}

.display-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 0.5rem;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.image-error {
  width: 100%;
  text-align: center;
}

.scrollable-meta-fields {
  max-height: 60dvh;
  overflow-y: auto;
}

.jobs-button {
  min-height: 3rem;
  width: 100%;
  font-size: 1rem;
  font-weight: 600;
}

/* Mobile responsive styles */
@media (max-width: 767px) {
  .split-panels {
    flex-direction: column;
  }
  
  .meta-panel {
    width: 100%;
    position: static;
  }
  
  .files-header-controls {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: stretch;
  }
  
  .multi-select-toggle {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }
  
  .flex-between {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }
  
  .flex-between h2 {
    margin-bottom: 0;
  }
  
  .desktop-text {
    display: none;
  }
  
  .mobile-text {
    display: inline;
  }
  
  .summary-grid {
    grid-template-columns: repeat(1, minmax(0, 1fr));
    gap: 0.75rem;
  }
  
  .p-dialog {
    width: 95vw !important;
    max-width: 95vw !important;
  }
}

@media (min-width: 768px) {
  .files-header-controls {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
  }
  
  .multi-select-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  
  .desktop-text {
    display: inline;
  }
  
  .mobile-text {
    display: none;
  }
}
</style>
