<template>
  <div class="page-container">
    <div class="header-row">
      <h1 class="page-title">Processing Jobs</h1>
      <Button severity="secondary" @click="refreshJobs">Refresh</Button>
    </div>

    <div v-if="error" class="margin-bottom-6">
      <Message severity="error" :closable="false">
        {{ error }}
      </Message>
    </div>

    <div v-else>
      <Card class="shadow-lg">
        <template #title>
          <h2 class="text-xl font-semibold">All Jobs</h2>
        </template>
        <template #content>
          <DataTable
            v-model:expanded-rows="expandedRows"
            :value="jobs"
            :paginator="true"
            :rows="100"
            :rows-per-page-options="[50, 100, 1000, 10000]"
            paginator-template="RowsPerPageDropdown FirstPageLink PrevPageLink CurrentPageReport NextPageLink LastPageLink"
            current-page-report-template="Showing {first} to {last} of {totalRecords} jobs"
            class="p-datatable-sm"
            data-key="id"
          >

          <Column expander style="width: 5rem" />
          <Column field="type" header="Type" sortable>
              <template #body="slotProps">
                <div class="flex items-center gap-2">
                  <span>
                    {{
                      slotProps.data.type === "playlist"
                        ? `Playlist (${slotProps.data.results?.length || 0})`
                        : slotProps.data.type === "album-art"
                        ? "Album Art"
                        : "Video"
                    }}
                  </span>
                </div>
              </template>
            </Column>

            <Column field="title" header="Title" sortable>
              <template #body="slotProps">
                <div v-if="getJobTitle(slotProps.data)" class="text-sm">
                  <span :title="getJobTitle(slotProps.data)">
                    {{
                      getJobTitle(slotProps.data).length > 60
                        ? getJobTitle(slotProps.data).substring(0, 60) + "..."
                        : getJobTitle(slotProps.data)
                    }}
                  </span>
                </div>
                <span v-else class="text-gray-400 text-sm">-</span>
              </template>
            </Column>

            <Column field="url" header="URL" sortable>
              <template #body="slotProps">
                <div v-if="slotProps.data.url">
                  <Button
                    icon="pi pi-external-link"
                    class="p-button-text p-button-sm mr-2"
                    style="width: 100%"
                    :aria-label="'Open URL: ' + slotProps.data.url"
                    @click="openUrl(slotProps.data.url)"
                  />
                </div>
                <span v-else class="text-gray-400 text-sm">-</span>
              </template>
            </Column>

            <Column field="status" header="Status" sortable>
              <template #body="slotProps">
                <Tag
                  :severity="getStatusSeverity(slotProps.data.status)"
                  :value="slotProps.data.status"
                />
              </template>
            </Column>

            <Column field="progress" header="Progress">
              <template #body="slotProps">
                <div
                  v-if="slotProps.data.progress !== undefined"
                  class="flex items-center gap-2"
                >
                  <ProgressBar
                    :value="slotProps.data.progress"
                    :show-value="true"
                    class="w-20"
                  />
                </div>
                <span v-else class="text-gray-400">-</span>
              </template>
            </Column>

            <Column field="startTime" header="Created" sortable>
              <template #body="slotProps">
                <span class="text-sm">{{
                  formatDate(slotProps.data.startTime)
                }}</span>
              </template>
            </Column>

            <template #expansion="slotProps">
              <div
                v-if="
                  slotProps.data.type === 'playlist' && slotProps.data.results
                "
                class="p-4"
              >
                <h4 class="text-lg font-semibold mb-3 text-white">
                  Playlist Videos ({{ slotProps.data.results.length }})
                </h4>
                <DataTable
                  :value="slotProps.data.results"
                  class="p-datatable-sm"
                  :paginator="true"
                  :rows="10"
                  :rows-per-page-options="[10, 25, 50]"
                  paginator-template="RowsPerPageDropdown FirstPageLink PrevPageLink CurrentPageReport NextPageLink LastPageLink"
                  current-page-report-template="Showing {first} to {last} of {totalRecords} videos"
                >
                  <Column field="title" header="Title" sortable>
                    <template #body="videoSlot">
                      <div class="text-sm" :title="videoSlot.data.title">
                        {{
                          videoSlot.data.title.length > 80
                            ? videoSlot.data.title.substring(0, 80) + "..."
                            : videoSlot.data.title
                        }}
                      </div>
                    </template>
                  </Column>

                  <Column field="artist" header="Artist" sortable>
                    <template #body="videoSlot">
                      <div class="text-sm">
                        {{ videoSlot.data.artist || "-" }}
                      </div>
                    </template>
                  </Column>

                  <Column field="album" header="Album" sortable>
                    <template #body="videoSlot">
                      <div class="text-sm">
                        {{ videoSlot.data.album || "-" }}
                      </div>
                    </template>
                  </Column>

                  <Column field="duration" header="Duration">
                    <template #body="videoSlot">
                      <div class="text-sm">
                        {{
                          videoSlot.data.duration
                            ? formatDuration(videoSlot.data.duration)
                            : "-"
                        }}
                      </div>
                    </template>
                  </Column>

                  <Column field="genre" header="Genre">
                    <template #body="videoSlot">
                      <div class="text-sm">
                        {{ videoSlot.data.genre || "-" }}
                      </div>
                    </template>
                  </Column>

                  <Column field="albumArtPath" header="Album Art">
                    <template #body="videoSlot">
                      <div
                        v-if="videoSlot.data.albumArtPath"
                        style="display: flex; width: 100%; justify-content: center; align-items: center;"
                      >
                        <Button 
                    class="p-button-text p-button-sm mr-2"
                        
                        style="width: 100%" @click="viewAlbumArt(videoSlot.data.artist, videoSlot.data.album)"><i class="pi pi-image" /></Button>

                      </div>
                      <div v-else class="flex items-center">
                        <i class="pi pi-times text-gray-400"/>
                      </div>
                    </template>
                  </Column>
                </DataTable>
              </div>

              <div
                v-else-if="
                  slotProps.data.type === 'single' && slotProps.data.results
                "
                class="p-4"
              >
                <h4 class="text-lg font-semibold mb-3 text-white">
                  Video Details
                </h4>
                <div
                  v-if="slotProps.data.results.length > 0"
                  class="grid grid-cols-2 gap-4"
                >
                  <div v-for="field in videoFields" :key="field.key" class="space-y-1">
                    <div class="flex justify-between space-x-1">
                      <strong class="text-white">{{ field.label }}:</strong>
                      <span class="text-gray-300">{{ getFieldValue(slotProps.data.results[0], field) }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else-if="slotProps.data.type === 'album-art'" class="p-4">
                <h4 class="text-lg font-semibold mb-3 text-white">
                  Album Art Processing Results
                </h4>
                <div
                  v-if="slotProps.data.albumArtResults"
                  class="grid grid-cols-4 gap-4"
                >
                  <div class="text-center">
                    <div class="text-2xl font-bold text-blue-400">
                      {{ slotProps.data.albumArtResults.processed }}
                    </div>
                    <div class="text-sm text-gray-400">Processed</div>
                  </div>
                  <div class="text-center">
                    <div class="text-2xl font-bold text-green-400">
                      {{ slotProps.data.albumArtResults.fetched }}
                    </div>
                    <div class="text-sm text-gray-400">Fetched</div>
                  </div>
                  <div class="text-center">
                    <div class="text-2xl font-bold text-yellow-400">
                      {{ slotProps.data.albumArtResults.existed }}
                    </div>
                    <div class="text-sm text-gray-400">Already Existed</div>
                  </div>
                  <div class="text-center">
                    <div class="text-2xl font-bold text-red-400">
                      {{ slotProps.data.albumArtResults.errors }}
                    </div>
                    <div class="text-sm text-gray-400">Errors</div>
                  </div>
                </div>
              </div>
            </template>
          </DataTable>

          <div v-if="jobs.length === 0" class="text-center py-8 text-gray-500">
            <p>No jobs found</p>
          </div>
        </template>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { MetaData, ProcessingJob, ProcessingJobWithProgress } from "~/types/api";

const { getJobs } = useApi();
const loading = ref(true);
const error = ref("");
const jobs = ref<ProcessingJobWithProgress[]>([]);
const expandedRows = ref<Record<string, boolean>>({});

const videoFields = [
  { key: 'title', label: 'Title', value: (item: MetaData) => item.title },
  { key: 'artist', label: 'Artist', value: (item: MetaData) => item.artist || '-' },
  { key: 'album', label: 'Album', value: (item: MetaData) => item.album || '-' },
  { key: 'genre', label: 'Genre', value: (item: MetaData) => item.genre || '-' },
  { key: 'duration', label: 'Duration', value: (item: MetaData) => item.duration ? formatDuration(item.duration) : '-' },
  { key: 'bpm', label: 'BPM', value: (item: MetaData) => item.bpm || '-' },
  { key: 'mood', label: 'Mood', value: (item: MetaData) => item.mood || '-' },
  { key: 'language', label: 'Language', value: (item: MetaData) => item.language || '-' },
];

const getFieldValue = (item: MetaData, field: typeof videoFields[0]) => field.value(item);

const viewAlbumArt = (artist: string, album:string) => {
  const config = useRuntimeConfig();
  const baseURL = config.public.apiBase;
  const albumArtUrl = `${baseURL}/album-art/${artist}/${album}`;
  window.open(albumArtUrl, '_blank', 'noopener,noreferrer');
};

const fetchJobs = async () => {
  loading.value = true;
  error.value = "";

  const { data, error: apiError } = await getJobs();

  if (apiError) {
    error.value = apiError.message || "Failed to load jobs";
  } else if (data && data.jobs) {

    jobs.value = data.jobs.map(
      (job: ProcessingJob): ProcessingJobWithProgress => {
        const transformedJob: ProcessingJobWithProgress = {
          id: job.id,
          url: job.url,
          type: job.type,
          status: job.status,
          startTime: job.startTime,
          endTime: job.endTime,
          results: job.results,
          errors: job.errors,
          playlistTitle: job.playlistTitle,
          albumArtResults: job.albumArtResults,
          originalProgress: job.progress,
        };


        if (job.progress && job.progress.total > 0) {
          transformedJob.progress = Math.round(
            (job.progress.completed / job.progress.total) * 100
          );
        }

        return transformedJob;
      }
    );
  } else {

    jobs.value = [];
  }

  loading.value = false;
};

const formatDate = (dateString: string | Date): string => {
  return new Date(dateString).toLocaleString();
};

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds
      .toString()
      .padStart(2, "0")}`;
  } else {
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  }
};

const getStatusSeverity = (status: string): string => {
  switch (status) {
    case "pending":
      return "warning";
    case "processing":
      return "info";
    case "completed":
      return "success";
    case "failed":
      return "danger";
    default:
      return "secondary";
  }
};

const getJobTitle = (job: ProcessingJobWithProgress): string => {

  if (job.type === "playlist" && job.playlistTitle) {
    return job.playlistTitle;
  }


  if (
    job.type === "single" &&
    job.results &&
    job.results.length > 0 &&
    job.results[0]
  ) {
    return job.results[0].title;
  }


  if (job.type === "album-art") {
    return "Album Art Processing";
  }


  return "";
};

const refreshJobs = () => {
  fetchJobs();
};

const openUrl = (url: string) => {
  window.open(url, "_blank", "noopener,noreferrer");
};

onMounted(() => {
  fetchJobs();

  const interval = setInterval(() => {
    if (!loading.value) {
      fetchJobs();
    }
  }, 1000);

  onUnmounted(() => {
    clearInterval(interval);
  });
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
.text-3xl {
  font-size: 1.875rem;
  line-height: 2.25rem;
}
.font-bold {
  font-weight: 700;
}
.text-blue-600 {
  color: #2563eb;
}
.text-yellow-600 {
  color: #d97706;
}
.text-green-600 {
  color: #16a34a;
}
.text-xl {
  font-size: 1.25rem;
  line-height: 1.75rem;
}
.font-semibold {
  font-weight: 600;
}
.text-sm {
  font-size: 0.875rem;
  line-height: 1.25rem;
}
.text-gray-400 {
  color: #9ca3af;
}
.text-gray-500 {
  color: #6b7280;
}
.py-8 {
  padding-top: 2rem;
  padding-bottom: 2rem;
}
.margin-top-3 {
  margin-top: 0.75rem;
}
.text-blue-600 {
  color: #2563eb;
}
.hover\:text-blue-800:hover {
  color: #1d4ed8;
}
.underline {
  text-decoration: underline;
}
.w-20 {
  width: 5rem;
}
.grid {
  display: grid;
}
.grid-cols-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.grid-cols-4 {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.gap-4 {
  gap: 1rem;
}
.space-y-2 > * + * {
  margin-top: 0.5rem;
}
.space-x-1 > * + * {
  margin-left: 0.25rem;
}
.flex {
  display: flex;
}
.items-center {
  align-items: center;
}
.gap-2 {
  gap: 0.5rem;
}
.ml-2 {
  margin-left: 0.5rem;
}
.mb-3 {
  margin-bottom: 0.75rem;
}
.text-lg {
  font-size: 1.125rem;
  line-height: 1.75rem;
}
.text-2xl {
  font-size: 1.5rem;
  line-height: 2rem;
}
.font-bold {
  font-weight: 700;
}
.text-center {
  text-align: center;
}
.text-white {
  color: white;
}
.text-gray-300 {
  color: #d1d5db;
}
.text-gray-400 {
  color: #9ca3af;
}
.text-blue-400 {
  color: #60a5fa;
}
.text-green-400 {
  color: #34d399;
}
.text-green-500 {
  color: #10b981;
}
.text-yellow-400 {
  color: #fbbf24;
}
.text-red-400 {
  color: #f87171;
}
</style>
