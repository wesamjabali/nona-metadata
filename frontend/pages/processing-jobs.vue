<template>
  <div class="page">
    <div class="jobs__header">
      <h1 class="jobs__title">Processing Jobs</h1>
      <Button severity="secondary" @click="refreshJobs">Refresh</Button>
    </div>

    <div v-if="error" class="page__error">
      <Message severity="error" :closable="false">
        {{ error }}
      </Message>
    </div>

    <div v-else>
      <Card class="card">
        <template #title>
          <h2 class="card__title">All Jobs</h2>
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
                <div class="job-details__type-container">
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
                <div v-if="getJobTitle(slotProps.data)" class="job-details__text">
                  <span :title="getJobTitle(slotProps.data)">
                    {{
                      getJobTitle(slotProps.data).length > 60
                        ? getJobTitle(slotProps.data).substring(0, 60) + "..."
                        : getJobTitle(slotProps.data)
                    }}
                  </span>
                </div>
                <span v-else class="job-details__missing">-</span>
              </template>
            </Column>

            <Column field="url" header="URL" sortable>
              <template #body="slotProps">
                <div v-if="slotProps.data.url">
                  <Button
                    icon="pi pi-external-link"
                    class="p-button-text p-button-sm job-details__link"
                    style="width: 100%"
                    :aria-label="'Open URL: ' + slotProps.data.url"
                    @click="openUrl(slotProps.data.url)"
                  />
                </div>
                <span v-else class="job-details__missing">-</span>
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
                  class="progress__container"
                >
                  <ProgressBar
                    :value="slotProps.data.progress"
                    :show-value="true"
                    class="progress__bar"
                  />
                </div>
                <span v-else class="job-details__missing">-</span>
              </template>
            </Column>

            <Column field="startTime" header="Created" sortable>
              <template #body="slotProps">
                <span class="job-details__text">{{
                  formatDate(slotProps.data.startTime)
                }}</span>
              </template>
            </Column>

            <template #expansion="slotProps">
              <div
                v-if="
                  slotProps.data.type === 'playlist' && slotProps.data.results
                "
                class="expansion__container"
              >
                <h4 class="expansion__title">
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
                      <div class="video-details__title" :title="videoSlot.data.title">
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
                      <div class="video-details__artist">
                        {{ videoSlot.data.artist || "-" }}
                      </div>
                    </template>
                  </Column>

                  <Column field="album" header="Album" sortable>
                    <template #body="videoSlot">
                      <div class="video-details__album">
                        {{ videoSlot.data.album || "-" }}
                      </div>
                    </template>
                  </Column>

                  <Column field="duration" header="Duration">
                    <template #body="videoSlot">
                      <div class="video-details__duration">
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
                      <div class="video-details__genre">
                        {{ videoSlot.data.genre || "-" }}
                      </div>
                    </template>
                  </Column>

                  <Column field="albumArtPath" header="Album Art">
                    <template #body="videoSlot">
                      <div
                        v-if="videoSlot.data.albumArtPath"
                        class="album-art__button-container"
                      >
                        <Button 
                    class="p-button-text p-button-sm album-art__button"
                        
                        style="width: 100%" @click="viewAlbumArt(videoSlot.data.artist, videoSlot.data.album)"><i class="pi pi-image" /></Button>

                      </div>
                      <div v-else class="album-art__missing">
                        <i class="pi pi-times album-art__missing-icon"/>
                      </div>
                    </template>
                  </Column>
                </DataTable>
              </div>

              <div
                v-else-if="
                  slotProps.data.type === 'single' && slotProps.data.results
                "
                class="expansion__container"
              >
                <h4 class="expansion__title">
                  Video Details
                </h4>
                <div
                  v-if="slotProps.data.results.length > 0"
                  class="video-details__grid"
                >
                  <div v-for="field in videoFields" :key="field.key" class="video-details__field">
                    <div class="video-details__label">
                      <strong class="video-details__label-text">{{ field.label }}:</strong>
                      <span class="video-details__value">{{ getFieldValue(slotProps.data.results[0], field) }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else-if="slotProps.data.type === 'album-art'" class="expansion__container">
                <h4 class="expansion__title">
                  Album Art Processing Results
                </h4>
                <div
                  v-if="slotProps.data.albumArtResults"
                  class="album-art__results-grid"
                >
                  <div class="album-art__stat">
                    <div class="album-art__stat-number album-art__stat-number--blue">
                      {{ slotProps.data.albumArtResults.processed }}
                    </div>
                    <div class="album-art__stat-label">Processed</div>
                  </div>
                  <div class="album-art__stat">
                    <div class="album-art__stat-number album-art__stat-number--green">
                      {{ slotProps.data.albumArtResults.fetched }}
                    </div>
                    <div class="album-art__stat-label">Fetched</div>
                  </div>
                  <div class="album-art__stat">
                    <div class="album-art__stat-number album-art__stat-number--yellow">
                      {{ slotProps.data.albumArtResults.existed }}
                    </div>
                    <div class="album-art__stat-label">Already Existed</div>
                  </div>
                  <div class="album-art__stat">
                    <div class="album-art__stat-number album-art__stat-number--red">
                      {{ slotProps.data.albumArtResults.errors }}
                    </div>
                    <div class="album-art__stat-label">Errors</div>
                  </div>
                </div>
              </div>
            </template>
          </DataTable>

          <div v-if="jobs.length === 0" class="jobs__empty-state">
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

<style lang="scss" scoped>
/* Mobile responsive adjustments */
@media (max-width: 767px) {
  .jobs {
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
  
  /* Make DataTable more mobile-friendly */
  .p-datatable {
    .p-datatable-wrapper {
      overflow-x: auto;
    }
    
    .p-datatable-thead > tr > th,
    .p-datatable-tbody > tr > td {
      padding: 0.5rem 0.25rem;
      font-size: 0.875rem;
      min-width: 120px;
    }

    &-sm .p-datatable-tbody > tr > td {
      padding: 0.25rem;
      font-size: 0.75rem;
    }
  }
  
  /* Adjust grid layouts for mobile */
  .video-details {
    &__grid {
      grid-template-columns: repeat(1, minmax(0, 1fr));
    }
  }
  
  .album-art {
    &__results-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  
  /* Progress bar adjustments */
  .progress {
    &__bar {
      width: 100%;
      min-width: 80px;
    }
  }
  
  /* Text truncation for mobile */
  .text {
    &--sm {
      font-size: 0.75rem;
    }
  }
}
</style>
