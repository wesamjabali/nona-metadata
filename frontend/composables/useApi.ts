import type { JobsResponse, ProcessingJob } from "~/types/api";

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
    } catch (error: any) {
      return { data: null, error: error.data || error };
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
  };
};
