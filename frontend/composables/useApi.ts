import type {
  CacheEntriesResponse,
  DeleteEntriesResponse,
  JobEntriesResponse,
  JobsResponse,
  ProcessingJob,
} from "~/types/api";

// API composable for YouTube Metadata API
export const useApi = () => {
  const config = useRuntimeConfig();
  const baseURL = config.public.apiBase;

  const apiCall = async <T>(endpoint: string, options = {}) => {
    try {
      const response = await $fetch<T>(endpoint, {
        baseURL,
        ...options,
      });
      return { data: response, error: null };
    } catch (error: unknown) {
      const apiError = error as { data?: unknown } | Error;
      return {
        data: null,
        error: ("data" in apiError && apiError.data) || apiError,
      };
    }
  };

  const processYouTubeUrl = async (url: string) => {
    return await apiCall("/", {
      method: "POST",
      body: { prompt: url },
    });
  };

  const getFiles = async () => {
    return await apiCall("/files");
  };

  const deleteFile = async (filePath: string) => {
    return await apiCall("/files", {
      method: "DELETE",
      query: { file: filePath },
    });
  };

  const getMetadata = async (filePath: string) => {
    return await apiCall("/metadata", {
      query: { file: filePath },
    });
  };

  const updateMetadata = async (
    filePath: string,
    tags: Record<string, string>
  ) => {
    return await apiCall("/metadata", {
      method: "PATCH",
      body: { file: filePath, tags },
    });
  };

  const getPlaylistInfo = async (url: string) => {
    return await apiCall("/playlist-info", {
      query: { url },
    });
  };

  const getJobs = async () => {
    return await apiCall<JobsResponse>("/jobs");
  };

  const getJob = async (jobId: string) => {
    return await apiCall<ProcessingJob>(`/jobs/${jobId}`);
  };

  const fetchAlbumArt = async () => {
    return await apiCall("/fetch-album-art", {
      method: "POST",
    });
  };

  const getCacheStats = async () => {
    return await apiCall("/cache/stats");
  };

  const cleanupCache = async (daysOld = 0) => {
    return await apiCall("/cache/cleanup", {
      method: "POST",
      body: { daysOld },
    });
  };

  const getCacheEntries = async (page = 1, limit = 20, search?: string) => {
    const params: Record<string, string> = {
      page: page.toString(),
      limit: limit.toString(),
    };
    if (search) {
      params.search = search;
    }

    return await apiCall<CacheEntriesResponse>("/cache/entries", {
      query: params,
    });
  };

  const getJobEntries = async (page = 1, limit = 20, status?: string) => {
    const params: Record<string, string> = {
      page: page.toString(),
      limit: limit.toString(),
    };
    if (status) {
      params.status = status;
    }

    return await apiCall<JobEntriesResponse>("/cache/jobs", {
      query: params,
    });
  };

  const deleteCacheEntries = async (ids: number[]) => {
    return await apiCall<DeleteEntriesResponse>("/cache/entries", {
      method: "DELETE",
      body: { ids },
    });
  };

  const deleteJobEntries = async (ids: string[]) => {
    return await apiCall<DeleteEntriesResponse>("/cache/jobs", {
      method: "DELETE",
      body: { ids },
    });
  };

  return {
    processYouTubeUrl,
    getFiles,
    deleteFile,
    getMetadata,
    updateMetadata,
    getPlaylistInfo,
    getJobs,
    getJob,
    fetchAlbumArt,
    getCacheStats,
    cleanupCache,
    getCacheEntries,
    getJobEntries,
    deleteCacheEntries,
    deleteJobEntries,
  };
};
