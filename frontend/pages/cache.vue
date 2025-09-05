<template>
  <div class="page">
    <div class="page__header">
      <h1 class="page__title">Cache Management</h1>
      <Button severity="secondary" @click="refreshStats">
        Refresh Stats
      </Button>
    </div>

    <div class="cache__section">
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

    <!-- Cache Information -->
    <Card class="card">
      <template #title>
        <h2 class="card__title">Cache Information</h2>
      </template>
      <template #content>
        <div class="cache__info-grid">
          <div class="cache__info-section">
            <h3 class="cache__info-title">
              What is the cache?
            </h3>
            <p class="cache__info-content">
              The cache stores metadata and processing information to improve
              performance and reduce API calls to external services like YouTube
              and music databases.
            </p>
          </div>

          <div class="cache__info-section">
            <h3 class="cache__info-title">Cache types:</h3>
            <ul class="cache__info-list">
              <li>
                <strong>YouTube data:</strong> Video and playlist information
              </li>
              <li><strong>Metadata:</strong> Audio file tags and properties</li>
              <li><strong>Album art:</strong> Downloaded cover images</li>
              <li>
                <strong>Processing results:</strong> Job status and results
              </li>
            </ul>
          </div>

          <div class="cache__info-section">
            <h3 class="cache__info-title">
              Why clean the cache?
            </h3>
            <ul class="cache__info-list">
              <li>Remove outdated information</li>
              <li>Free up disk space</li>
              <li>Ensure fresh data from external services</li>
              <li>Resolve potential data inconsistencies</li>
            </ul>
          </div>
        </div>
      </template>
    </Card>
  </div>
</template>

<script setup>
const { getCacheStats, cleanupCache } = useApi();
const loadingStats = ref(true);
const statsError = ref("");
const cacheStats = ref(null);
const cleanupDays = ref(30);
const performingCleanup = ref(false);
const cleanupResult = ref(null);

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

const refreshStats = () => {
  fetchStats();
};

onMounted(() => {
  fetchStats();
});
</script>

<style lang="scss" scoped>
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
  .grid {
    &--cols-1 {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
}
</style>
