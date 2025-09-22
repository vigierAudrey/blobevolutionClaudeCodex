/**
 * Global skeleton state management hook
 * Provides intelligent loading states with minimum display time
 * to prevent flicker on fast responses
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface SkeletonConfig {
  minDisplayTime?: number; // Minimum time to show skeleton (ms)
  gracePeriod?: number; // Grace period before showing skeleton (ms)
  debugMode?: boolean; // Enable debug logging
}

interface SkeletonState {
  isLoading: boolean;
  showSkeleton: boolean;
  error: string | null;
  loadingMessage?: string;
}

const DEFAULT_CONFIG: Required<SkeletonConfig> = {
  minDisplayTime: 500, // Show skeleton for at least 500ms
  gracePeriod: 100, // Wait 100ms before showing skeleton
  debugMode: process.env.NODE_ENV === 'development',
};

export function useSkeletonState(config: SkeletonConfig = {}) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const [state, setState] = useState<SkeletonState>({
    isLoading: false,
    showSkeleton: false,
    error: null,
  });

  const timersRef = useRef<{
    graceTimer?: NodeJS.Timeout;
    minDisplayTimer?: NodeJS.Timeout;
    startTime?: number;
  }>({});

  const debugLog = useCallback((message: string, data?: any) => {
    if (finalConfig.debugMode) {
      console.log(`🏗️ Skeleton: ${message}`, data);
    }
  }, [finalConfig.debugMode]);

  const startLoading = useCallback((loadingMessage?: string) => {
    debugLog('Starting loading', { loadingMessage });

    // Clear any existing timers
    if (timersRef.current.graceTimer) {
      clearTimeout(timersRef.current.graceTimer);
    }
    if (timersRef.current.minDisplayTimer) {
      clearTimeout(timersRef.current.minDisplayTimer);
    }

    timersRef.current.startTime = Date.now();

    setState(prev => ({
      ...prev,
      isLoading: true,
      error: null,
      loadingMessage,
    }));

    // Start grace period timer
    timersRef.current.graceTimer = setTimeout(() => {
      debugLog('Grace period ended, showing skeleton');
      setState(prev => ({ ...prev, showSkeleton: true }));
    }, finalConfig.gracePeriod);

  }, [debugLog, finalConfig.gracePeriod]);

  const stopLoading = useCallback((error?: string) => {
    const elapsedTime = timersRef.current.startTime
      ? Date.now() - timersRef.current.startTime
      : 0;

    debugLog('Stopping loading', { elapsedTime, error });

    // Clear grace timer if still pending
    if (timersRef.current.graceTimer) {
      clearTimeout(timersRef.current.graceTimer);
      timersRef.current.graceTimer = undefined;
    }

    const finishLoading = () => {
      debugLog('Loading finished');
      setState({
        isLoading: false,
        showSkeleton: false,
        error: error || null,
        loadingMessage: undefined,
      });
    };

    // If skeleton was shown, respect minimum display time
    if (state.showSkeleton && elapsedTime < finalConfig.minDisplayTime) {
      const remainingTime = finalConfig.minDisplayTime - elapsedTime;
      debugLog(`Waiting ${remainingTime}ms for minimum display time`);

      timersRef.current.minDisplayTimer = setTimeout(finishLoading, remainingTime);
    } else {
      finishLoading();
    }
  }, [state.showSkeleton, finalConfig.minDisplayTime, debugLog]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (timersRef.current.graceTimer) {
        clearTimeout(timersRef.current.graceTimer);
      }
      if (timersRef.current.minDisplayTimer) {
        clearTimeout(timersRef.current.minDisplayTimer);
      }
    };
  }, []);

  return {
    ...state,
    startLoading,
    stopLoading,
    // Convenience methods
    isShowingSkeleton: state.showSkeleton,
    hasError: !!state.error,
  };
}

// Hook for API requests with automatic skeleton management
export function useSkeletonQuery<T>(
  queryFn: () => Promise<T>,
  deps: React.DependencyList = [],
  config: SkeletonConfig & {
    loadingMessage?: string;
    enabled?: boolean;
  } = {}
) {
  const { enabled = true, loadingMessage, ...skeletonConfig } = config;
  const skeletonState = useSkeletonState(skeletonConfig);
  const [data, setData] = useState<T | null>(null);

  const execute = useCallback(async () => {
    if (!enabled) return;

    try {
      skeletonState.startLoading(loadingMessage);
      const result = await queryFn();
      setData(result);
      skeletonState.stopLoading();
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      skeletonState.stopLoading(errorMessage);
      throw error;
    }
  }, [enabled, loadingMessage, queryFn, skeletonState]);

  useEffect(() => {
    execute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return {
    ...skeletonState,
    data,
    refetch: execute,
  };
}

// Pre-configured hooks for common use cases
export function useInitializationSkeleton() {
  return useSkeletonState({
    minDisplayTime: 300,
    gracePeriod: 50,
  });
}

export function useSearchSkeleton() {
  return useSkeletonState({
    minDisplayTime: 400,
    gracePeriod: 200, // Longer grace for search (user might type more)
  });
}

export function useFormSkeleton() {
  return useSkeletonState({
    minDisplayTime: 200,
    gracePeriod: 100,
  });
}

export function useDashboardSkeleton() {
  return useSkeletonState({
    minDisplayTime: 600,
    gracePeriod: 100,
  });
}

// Global skeleton state for coordinated loading across components
const globalSkeletonState = {
  activeSkeleton: null as string | null,
  listeners: new Set<(skeletonId: string | null) => void>(),
};

export function useGlobalSkeleton(skeletonId: string) {
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const listener = (activeId: string | null) => {
      setIsActive(activeId === skeletonId);
    };

    globalSkeletonState.listeners.add(listener);
    listener(globalSkeletonState.activeSkeleton);

    return () => {
      globalSkeletonState.listeners.delete(listener);
    };
  }, [skeletonId]);

  const activate = useCallback(() => {
    globalSkeletonState.activeSkeleton = skeletonId;
    globalSkeletonState.listeners.forEach(listener => listener(skeletonId));
  }, [skeletonId]);

  const deactivate = useCallback(() => {
    if (globalSkeletonState.activeSkeleton === skeletonId) {
      globalSkeletonState.activeSkeleton = null;
      globalSkeletonState.listeners.forEach(listener => listener(null));
    }
  }, [skeletonId]);

  return {
    isActive,
    activate,
    deactivate,
  };
}