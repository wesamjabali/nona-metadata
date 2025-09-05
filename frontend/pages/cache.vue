<template>
  <div class="page-container stack">
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-3xl font-bold text-gray-800">Cache Management</h1>
      <Button @click="refreshStats" severity="secondary">
        Refresh Stats
      </Button>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
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
            class="grid grid-cols-1 sm:grid-cols-2 gap-4"
          >
            <div
              v-for="(value, key) in cacheStats"
              :key="key"
              class="text-center p-4 border border-gray-200 rounded-lg"
            >
              <div class="text-sm text-gray-600 mb-1">
                {{ formatStatLabel(key) }}
              </div>
              <div class="text-xl font-bold text-blue-600">
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
          <form @submit.prevent="performCleanup" class="space-y-4">
            <div>
              <label
                for="days-old"
                class="block text-sm font-medium text-gray-700 mb-2"
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
              <small class="text-gray-500 text-xs mt-1 block"
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
            <i :class="cleanupResult.icon" class=""></i>
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

<style scoped></style>
