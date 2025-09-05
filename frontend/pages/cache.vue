<template>
  <div class="page-container stack">
    <div class="cache-header">
      <h1 class="cache-title">Cache Management</h1>
      <Button severity="secondary" @click="refreshStats">
        Refresh Stats
      </Button>
    </div>

    <div class="cache-grid">
      <!-- Cache Statistics -->
      <Card class="shadow-lg">
        <template #title>
          <h2 class="text-xl font-semibold">Cache Statistics</h2>
        </template>
        <template #content>
          <div v-if="loadingStats" class="text-center py-8">
            <ProgressSpinner />
            <p class="mt-4 text-gray-600">Loading statistics...</p>
          </div>

          <div v-else-if="statsError">
            <Message severity="error" :closable="false">
              {{ statsError }}
            </Message>
          </div>

          <div
            v-else-if="cacheStats"
            class="stats-grid"
          >
            <div
              v-for="(value, key) in cacheStats"
              :key="key"
              class="stat-item"
            >
              <div class="stat-label">
                {{ formatStatLabel(key) }}
              </div>
              <div class="stat-value">
                {{ formatStatValue(key, value) }}
              </div>
            </div>
          </div>
        </template>
      </Card>

      <!-- Cache Cleanup -->
      <Card class="shadow-lg">
        <template #title>
          <h2 class="text-xl font-semibold">Cache Cleanup</h2>
        </template>
        <template #content>
          <form class="cleanup-form" @submit.prevent="performCleanup">
            <div>
              <label
                for="days-old"
                class="cleanup-label"
              >
                Delete entries older than (days)
              </label>
              <InputNumber
                id="days-old"
                v-model="cleanupDays"
                :min="0"
                :max="365"
                placeholder="30"
                class="w-full"
                suffix=" days"
              />
              <small class="cleanup-help"
                >Set to 0 to delete all entries</small
              >
            </div>

            <Button
              type="submit"
              :loading="performingCleanup"
              severity="danger"
              class="w-full"
            >
              {{ performingCleanup ? "Cleaning..." : "Perform Cleanup" }}
            </Button>
          </form>

          <Message
            v-if="cleanupResult"
            :severity="cleanupResult.severity"
            :closable="false"
            class="mt-4"
          >
            <i :class="cleanupResult.icon" />
            {{ cleanupResult.message }}
          </Message>
        </template>
      </Card>
    </div>

    <!-- Cache Information -->
    <Card class="shadow-lg">
      <template #title>
        <h2 class="text-xl font-semibold">Cache Information</h2>
      </template>
      <template #content>
        <div class="space-y-6">
          <div>
            <h3 class="text-lg font-medium text-gray-800 mb-2">
              What is the cache?
            </h3>
            <p class="text-gray-600">
              The cache stores metadata and processing information to improve
              performance and reduce API calls to external services like YouTube
              and music databases.
            </p>
          </div>

          <div>
            <h3 class="text-lg font-medium text-gray-800 mb-2">Cache types:</h3>
            <ul class="text-gray-600 space-y-1">
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

          <div>
            <h3 class="text-lg font-medium text-gray-800 mb-2">
              Why clean the cache?
            </h3>
            <ul class="text-gray-600 space-y-1">
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

<style scoped>
.cache-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.cache-title {
  font-size: 1.875rem;
  line-height: 2.25rem;
  font-weight: 700;
  color: white;
}

.cache-grid {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 1.5rem;
  margin-bottom: 1.5rem;
}

@media (min-width: 768px) {
  .cache-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 1rem;
}

@media (min-width: 640px) {
  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.stat-item {
  text-align: center;
  padding: 1rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
}

.stat-label {
  font-size: 0.875rem;
  color: #6b7280;
  margin-bottom: 0.25rem;
}

.stat-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: #2563eb;
}

.cleanup-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.cleanup-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: #374151;
  margin-bottom: 0.5rem;
}

.cleanup-help {
  color: #6b7280;
  font-size: 0.75rem;
  margin-top: 0.25rem;
  display: block;
}

/* Mobile-specific adjustments */
@media (max-width: 767px) {
  .cache-header {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }
  
  .cache-title {
    font-size: 1.5rem;
    margin-bottom: 0;
  }
  
  .stats-grid {
    grid-template-columns: repeat(1, minmax(0, 1fr));
    gap: 0.75rem;
  }
  
  .stat-item {
    padding: 0.75rem;
  }
  
  .stat-label {
    font-size: 0.75rem;
  }
  
  .stat-value {
    font-size: 1.125rem;
  }
}
</style>
