<template>
  <div class="page">
    <div class="page__header">
      <h1 class="page__title">Cache Management</h1>
      <Button severity="secondary" @click="refreshStats">
        Refresh Stats
      </Button>
    </div>

    <div class="cache__section">
      <div class="cache__overview-grid">
        <!-- Cache Statistics -->
        <Card class="card">
          <template #title>
            <h2 class="card__title">Cache Statistics</h2>
          </template>
          <template #content>
            <div v-if="loadingStats" class="cache__stats-loading">
              <ProgressSpinner />
              <p class="cache__stats-loading-text">Loading statistics...</p>
            </div>

            <div v-else-if="statsError">
              <Message severity="error" :closable="false">
                {{ statsError }}
              </Message>
            </div>

            <div
              v-else-if="cacheStats"
              class="stats__grid"
            >
              <div
                v-for="(value, key) in cacheStats"
                :key="key"
                class="stats__item"
              >
                <div class="stats__label">
                  {{ formatStatLabel(key) }}
                </div>
                <div class="stats__value">
                  {{ formatStatValue(key, value) }}
                </div>
              </div>
            </div>
          </template>
        </Card>

        <!-- Cache Cleanup -->
        <Card class="card">
          <template #title>
            <h2 class="card__title">Cache Cleanup</h2>
          </template>
          <template #content>
            <form class="cache__cleanup-form" @submit.prevent="performCleanup">
              <div class="cache__cleanup-field">
                <label
                  for="days-old"
                  class="cache__cleanup-label"
                >
                  Delete entries older than (days)
                </label>
                <InputNumber
                  id="days-old"
                  v-model="cleanupDays"
                  :min="0"
                  :max="365"
                  placeholder="30"
                  class="cache__cleanup-input"
                  suffix=" days"
                />
                <small class="cache__cleanup-help"
                  >Set to 0 to delete all entries</small
                >
              </div>

              <Button
                type="submit"
                :loading="performingCleanup"
                severity="danger"
                class="cache__cleanup-submit"
              >
                {{ performingCleanup ? "Cleaning..." : "Perform Cleanup" }}
              </Button>
            </form>

            <Message
              v-if="cleanupResult"
              :severity="cleanupResult.severity"
              :closable="false"
              class="cache__cleanup-result"
            >
              <i :class="cleanupResult.icon" />
              {{ cleanupResult.message }}
            </Message>
          </template>
        </Card>
      </div>
    </div>

    <!-- Tabbed view for cache entries -->
    <Card class="card">
      <template #title>
        <h2 class="card__title">Cache Entries</h2>
      </template>
      <template #content>
        <TabView>
          <TabPanel header="URL Cache">
            <div class="cache-entries">
              <div class="cache-entries__controls">
                <div class="cache-entries__search">
                  <InputText
                    v-model="urlSearchTerm"
                    placeholder="Search URLs..."
                    class="cache-entries__search-input"
                    @input="searchUrlEntries"
                  />
                  <Button
                    icon="pi pi-search"
                    @click="searchUrlEntries"
                  />
                </div>
                <Button
                  v-if="selectedUrlEntries.length > 0"
                  severity="danger"
                  icon="pi pi-trash"
                  :loading="deletingUrlEntries"
                  @click="deleteSelectedUrlEntries"
                >
                  Delete Selected ({{ selectedUrlEntries.length }})
                </Button>
              </div>

              <DataTable
                v-model:selection="selectedUrlEntries"
                :value="urlEntries"
                :loading="loadingUrlEntries"
                selection-mode="multiple"
                data-key="id"
                paginator
                :rows="urlEntriesPerPage"
                :rows-per-page-options="[25, 50, 100, 1000, 10000]"
                paginator-template="RowsPerPageDropdown FirstPageLink PrevPageLink CurrentPageReport NextPageLink LastPageLink"
                current-page-report-template="Showing {first} to {last} of {totalRecords} entries"
                :total-records="urlTotalRecords"
                :lazy="true"
                class="cache-entries__table"
                @page="onUrlPageChange"
              >
                <Column selection-mode="multiple" header-style="width: 3rem" />
                <Column field="url" header="URL" sortable>
                  <template #body="{ data }">
                    <div class="cache-entry__url">
                      {{ truncateUrl(data.url) }}
                    </div>
                  </template>
                </Column>
                <Column field="created_at" header="Created" sortable>
                  <template #body="{ data }">
                    {{ formatDate(data.created_at) }}
                  </template>
                </Column>
                <Column field="last_accessed" header="Last Accessed" sortable>
                  <template #body="{ data }">
                    {{ formatDate(data.last_accessed) }}
                  </template>
                </Column>
                <Column header="Actions">
                  <template #body="{ data }">
                    <Button
                      icon="pi pi-trash"
                      severity="danger"
                      size="small"
                      text
                      @click="deleteUrlEntry(data.id)"
                    />
                  </template>
                </Column>
              </DataTable>
            </div>
          </TabPanel>

          <TabPanel header="Job Cache">
            <div class="cache-entries">
              <div class="cache-entries__controls">
                <div class="cache-entries__filters">
                  <Dropdown
                    v-model="jobStatusFilter"
                    :options="jobStatusOptions"
                    option-label="label"
                    option-value="value"
                    placeholder="Filter by status"
                    show-clear
                    @change="searchJobEntries"
                  />
                </div>
                <Button
                  v-if="selectedJobEntries.length > 0"
                  severity="danger"
                  icon="pi pi-trash"
                  :loading="deletingJobEntries"
                  @click="deleteSelectedJobEntries"
                >
                  Delete Selected ({{ selectedJobEntries.length }})
                </Button>
              </div>

              <DataTable
                v-model:selection="selectedJobEntries"
                :value="jobEntries"
                :loading="loadingJobEntries"
                selection-mode="multiple"
                data-key="id"
                paginator
                :rows="jobEntriesPerPage"
                :rows-per-page-options="[25, 50, 100, 1000, 10000]"
                paginator-template="RowsPerPageDropdown FirstPageLink PrevPageLink CurrentPageReport NextPageLink LastPageLink"
                current-page-report-template="Showing {first} to {last} of {totalRecords} entries"
                :total-records="jobTotalRecords"
                :lazy="true"
                class="cache-entries__table"
                @page="onJobPageChange"
              >
                <Column selection-mode="multiple" header-style="width: 3rem" />
                <Column field="id" header="Job ID" sortable>
                  <template #body="{ data }">
                    <div class="cache-entry__job-id">
                      {{ data.id }}
                    </div>
                  </template>
                </Column>
                <Column field="type" header="Type" sortable>
                  <template #body="{ data }">
                    <Tag :value="data.type" :severity="getJobTypeSeverity(data.type)" />
                  </template>
                </Column>
                <Column field="status" header="Status" sortable>
                  <template #body="{ data }">
                    <Tag :value="data.status" :severity="getJobStatusSeverity(data.status)" />
                  </template>
                </Column>
                <Column field="start_time" header="Started" sortable>
                  <template #body="{ data }">
                    {{ formatDate(data.start_time) }}
                  </template>
                </Column>
                <Column field="end_time" header="Ended" sortable>
                  <template #body="{ data }">
                    {{ data.end_time ? formatDate(data.end_time) : '-' }}
                  </template>
                </Column>
                <Column header="Actions">
                  <template #body="{ data }">
                    <Button
                      icon="pi pi-trash"
                      severity="danger"
                      size="small"
                      text
                      @click="deleteJobEntry(data.id)"
                    />
                  </template>
                </Column>
              </DataTable>
            </div>
          </TabPanel>
        </TabView>
      </template>
    </Card>
  </div>
</template>

<script setup>
const { getCacheStats, cleanupCache, getCacheEntries, getJobEntries, deleteCacheEntries, deleteJobEntries } = useApi();

// Existing state
const loadingStats = ref(true);
const statsError = ref("");
const cacheStats = ref(null);
const cleanupDays = ref(30);
const performingCleanup = ref(false);
const cleanupResult = ref(null);

// URL entries state
const urlEntries = ref([]);
const selectedUrlEntries = ref([]);
const loadingUrlEntries = ref(false);
const deletingUrlEntries = ref(false);
const urlSearchTerm = ref("");
const urlCurrentPage = ref(1);
const urlEntriesPerPage = ref(100);
const urlTotalRecords = ref(0);

// Job entries state
const jobEntries = ref([]);
const selectedJobEntries = ref([]);
const loadingJobEntries = ref(false);
const deletingJobEntries = ref(false);
const jobStatusFilter = ref(null);
const jobCurrentPage = ref(1);
const jobEntriesPerPage = ref(25);
const jobTotalRecords = ref(0);

// Job status options for dropdown
const jobStatusOptions = ref([
  { label: 'Processing', value: 'processing' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
  { label: 'Stopped', value: 'stopped' }
]);

const fetchStats = async () => {
  loadingStats.value = true;
  statsError.value = "";

  const { data, error: apiError } = await getCacheStats();

  if (apiError) {
    statsError.value = apiError.message || "Failed to load cache statistics";
  } else {
    cacheStats.value = data.stats;
  }

  loadingStats.value = false;
};

const fetchUrlEntries = async () => {
  loadingUrlEntries.value = true;

  const { data, error: apiError } = await getCacheEntries(
    urlCurrentPage.value,
    urlEntriesPerPage.value,
    urlSearchTerm.value || undefined
  );

  if (apiError) {
    console.error("Failed to load URL entries:", apiError);
  } else {
    urlEntries.value = data.entries;
    urlTotalRecords.value = data.pagination.total;
  }

  loadingUrlEntries.value = false;
};

const fetchJobEntries = async () => {
  loadingJobEntries.value = true;

  const { data, error: apiError } = await getJobEntries(
    jobCurrentPage.value,
    jobEntriesPerPage.value,
    jobStatusFilter.value || undefined
  );

  if (apiError) {
    console.error("Failed to load job entries:", apiError);
  } else {
    jobEntries.value = data.entries;
    jobTotalRecords.value = data.pagination.total;
  }

  loadingJobEntries.value = false;
};

const searchUrlEntries = () => {
  urlCurrentPage.value = 1;
  fetchUrlEntries();
};

const searchJobEntries = () => {
  jobCurrentPage.value = 1;
  fetchJobEntries();
};

const onUrlPageChange = (event) => {
  urlCurrentPage.value = event.page + 1;
  fetchUrlEntries();
};

const onJobPageChange = (event) => {
  jobCurrentPage.value = event.page + 1;
  fetchJobEntries();
};

const deleteUrlEntry = async (id) => {
  const { error: apiError } = await deleteCacheEntries([id]);

  if (apiError) {
    console.error("Failed to delete URL entry:", apiError);
  } else {
    await fetchUrlEntries();
    await fetchStats();
  }
};

const deleteJobEntry = async (id) => {
  const { error: apiError } = await deleteJobEntries([id]);

  if (apiError) {
    console.error("Failed to delete job entry:", apiError);
  } else {
    await fetchJobEntries();
    await fetchStats();
  }
};

const deleteSelectedUrlEntries = async () => {
  if (selectedUrlEntries.value.length === 0) return;

  deletingUrlEntries.value = true;
  const ids = selectedUrlEntries.value.map(entry => entry.id);

  const { error: apiError } = await deleteCacheEntries(ids);

  if (apiError) {
    console.error("Failed to delete URL entries:", apiError);
  } else {
    selectedUrlEntries.value = [];
    await fetchUrlEntries();
    await fetchStats();
  }

  deletingUrlEntries.value = false;
};

const deleteSelectedJobEntries = async () => {
  if (selectedJobEntries.value.length === 0) return;

  deletingJobEntries.value = true;
  const ids = selectedJobEntries.value.map(entry => entry.id);

  const { error: apiError } = await deleteJobEntries(ids);

  if (apiError) {
    console.error("Failed to delete job entries:", apiError);
  } else {
    selectedJobEntries.value = [];
    await fetchJobEntries();
    await fetchStats();
  }

  deletingJobEntries.value = false;
};

const performCleanup = async () => {
  performingCleanup.value = true;
  cleanupResult.value = null;

  const { data, error: apiError } = await cleanupCache(cleanupDays.value);

  if (apiError) {
    cleanupResult.value = {
      severity: "error",
      icon: "pi pi-exclamation-triangle",
      message: apiError.message || "Failed to perform cache cleanup",
    };
  } else {
    cleanupResult.value = {
      severity: "success",
      icon: "pi pi-check-circle",
      message: data.message,
    };

    await fetchStats();
    await fetchUrlEntries();
    await fetchJobEntries();
  }

  performingCleanup.value = false;
};

const formatStatLabel = (key) => {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .replace(/([a-z])([A-Z])/g, "$1 $2");
};

const formatStatValue = (key, value) => {
  if (typeof value === "number") {
    if (
      key.toLowerCase().includes("size") ||
      key.toLowerCase().includes("bytes")
    ) {
      return formatBytes(value);
    }
    return value.toLocaleString();
  }
  return value;
};

const formatBytes = (bytes) => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

const formatDate = (dateStr) => {
  const date = new Date(dateStr);
  return date.toLocaleString();
};

const truncateUrl = (url) => {
  if (url.length > 60) {
    return url.substring(0, 57) + "...";
  }
  return url;
};

const getJobTypeSeverity = (type) => {
  switch (type) {
    case 'single': return 'info';
    case 'playlist': return 'success';
    case 'album-art': return 'warn';
    default: return 'secondary';
  }
};

const getJobStatusSeverity = (status) => {
  switch (status) {
    case 'processing': return 'info';
    case 'completed': return 'success';
    case 'failed': return 'danger';
    case 'stopped': return 'warn';
    default: return 'secondary';
  }
};

const refreshStats = () => {
  fetchStats();
  fetchUrlEntries();
  fetchJobEntries();
};

onMounted(() => {
  fetchStats();
  fetchUrlEntries();
  fetchJobEntries();
});
</script>

<style lang="scss" scoped>
.cache__section {
  margin-bottom: 1.5rem;
}

.cache__overview-grid {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 1.5rem;
  margin-bottom: 1.5rem;

  @media (min-width: 768px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
    
    .card {
      display: flex;
      // sticky
      position: -webkit-sticky;
      position: sticky;
      top: 1.5rem;
      flex-direction: column;
      margin-top: 0 !important;
      
      :deep(.p-card-body) {
        flex: 1;
        display: flex;
        flex-direction: column;
      }
      
      :deep(.p-card-content) {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
      }
    }
  }
}

.cache-entries {
  &__controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    gap: 1rem;
    
    @media (max-width: 767px) {
      flex-direction: column;
      align-items: stretch;
    }
  }

  &__search {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    min-width: 300px;

    @media (max-width: 767px) {
      min-width: auto;
      width: 100%;
    }
  }

  &__search-input {
    flex: 1;
  }

  &__filters {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    min-width: 200px;

    @media (max-width: 767px) {
      min-width: auto;
      width: 100%;
    }
  }

  &__table {
    margin-top: 1rem;
  }
}

.cache-entry {
  &__url {
    font-family: monospace;
    font-size: 0.875rem;
    word-break: break-all;
  }

  &__job-id {
    font-family: monospace;
    font-size: 0.875rem;
  }
}

.cache__stats-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  gap: 1rem;
}

.cache__stats-loading-text {
  margin: 0;
  color: var(--text-color-secondary);
}

.cache__cleanup-form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  min-height: 200px;
}

.cache__cleanup-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.cache__cleanup-label {
  font-weight: 500;
  color: var(--text-color);
}

.cache__cleanup-help {
  color: var(--text-color-secondary);
  font-size: 0.875rem;
}

.cache__cleanup-submit {
  margin-top: auto;
}

.cache__cleanup-result {
  margin-top: 1rem;
}

.stats {
  &__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }
  
  &__item {
    padding: 1rem;
    background: var(--surface-100);
    border-radius: 6px;
    border: 1px solid var(--surface-200);
  }
  
  &__label {
    font-size: 0.875rem;
    color: var(--text-color-secondary);
    margin-bottom: 0.5rem;
  }
  
  &__value {
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-color);
  }
}

/* Mobile-specific adjustments */
@media (max-width: 767px) {
  .page {
    &__header {
      flex-direction: column;
      align-items: stretch;
      gap: 1rem;
    }
    
    &__title {
      font-size: 1.5rem;
      margin-bottom: 0;
    }
  }

  .cache__overview-grid {
    grid-template-columns: repeat(1, minmax(0, 1fr));
    gap: 1rem;
  }
  
  .grid {
    &--cols-1 {
      gap: 0.75rem;
    }
  }
  
  .stats {
    &__grid {
      grid-template-columns: repeat(1, minmax(0, 1fr));
      gap: 0.75rem;
    }
    
    &__item {
      padding: 0.75rem;
    }
    
    &__label {
      font-size: 0.75rem;
    }
    
    &__value {
      font-size: 1.125rem;
    }
  }
}

@media (min-width: 768px) {
  .cache__overview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .grid {
    &--cols-1 {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
}

@media (min-width: 1024px) {
  .stats {
    &__grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    
    &__item {
      padding: 1rem;
    }
  }
}
</style>
