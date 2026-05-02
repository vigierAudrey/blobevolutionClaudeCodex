import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient, type ConsentMode, type ConsentSignal } from '../lib/apiClient';

// External API types
interface TCData {
  tcString?: string;
  gdprApplies?: boolean;
  purpose?: {
    consents?: Record<string, boolean>;
  };
  purposeConsents?: Record<string, boolean>;
  specialFeatureOptins?: Record<string, boolean>;
  // Add other TCF fields as needed
}

interface WindowWithTCF extends Window {
  __tcfapi?: (command: string, version: number, callback: (tcData: TCData, success: boolean) => void) => void;
}

interface WindowWithGtag extends Window {
  gtag?: (...args: unknown[]) => void;
  /** Set to true when state.ready becomes true (bootstrap async chain resolved, mode is
   *  final). Positioned synchronously before the gtag:consent:update call in the same
   *  Effect 2 execution — by the time any external code observes true, gtag has fired.
   *  Observable by e2e tests only — never read by product code. */
  __CONSENT_READY?: boolean;
  /** Mirrors state.mode at the moment __CONSENT_READY is set. Observable by e2e tests only. */
  __CONSENT_MODE?: ConsentMode;
}

type ConsentSource = 'tcf' | 'local' | 'remote' | 'default' | 'manual';

type ConsentSignals = {
  ad_storage: ConsentSignal;
  ad_user_data: ConsentSignal;
  ad_personalization: ConsentSignal;
};

type StoredConsent = {
  mode: ConsentMode;
  signals: ConsentSignals;
  cmpVersion?: string | null;
  updatedAt: string;
};

const STORAGE_KEY = 'blob_consent';
const LEGACY_KEY = 'cookie-consent';
const DEVICE_ID_KEY = 'blob_device_id';
const DEFAULT_SIGNALS: ConsentSignals = {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
};
const CMP_VERSION = 'blobinfini-consent-v1';

const modeToSignals = (mode: ConsentMode): ConsentSignals => {
  switch (mode) {
    case 'personalized':
      return { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' };
    case 'npa':
      return { ad_storage: 'granted', ad_user_data: 'denied', ad_personalization: 'denied' };
    case 'limited':
      return { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' };
    case 'none':
    default:
      return { ...DEFAULT_SIGNALS };
  }
};

const signalsToMode = (signals: ConsentSignals | null | undefined): ConsentMode => {
  if (!signals) return 'none';
  if (signals.ad_storage === 'granted' && signals.ad_user_data === 'granted' && signals.ad_personalization === 'granted') {
    return 'personalized';
  }
  if (signals.ad_storage === 'granted' && signals.ad_user_data === 'denied' && signals.ad_personalization === 'denied') {
    return 'npa';
  }
  if (signals.ad_storage === 'denied' && signals.ad_user_data === 'denied' && signals.ad_personalization === 'denied') {
    return 'limited';
  }
  return 'none';
};

const decodeStoredConsent = (raw: string | null): StoredConsent | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.mode) return null;
    const mode = parsed.mode as ConsentMode;
    const signals = parsed.signals as ConsentSignals | undefined;
    if (!mode || !signals) return null;
    return {
      mode,
      signals,
      cmpVersion: parsed.cmpVersion ?? null,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
};

const encodeStoredConsent = (mode: ConsentMode, signals: ConsentSignals, cmpVersion?: string | null): StoredConsent => ({
  mode,
  signals,
  cmpVersion: cmpVersion ?? null,
  updatedAt: new Date().toISOString(),
});

const sha256 = async (value: string) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

type ConsentState = {
  mode: ConsentMode;
  signals: ConsentSignals;
  source: ConsentSource;
  ready: boolean;
  userHash: string | null;
};

const DEFAULT_STATE: ConsentState = {
  mode: 'none',
  signals: DEFAULT_SIGNALS,
  source: 'default',
  ready: false,
  userHash: null,
};

const readTcString = async (): Promise<StoredConsent | null> =>
  new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof (window as WindowWithTCF).__tcfapi !== 'function') {
      resolve(null);
      return;
    }

    try {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) resolve(null);
      }, 800);

      (window as WindowWithTCF).__tcfapi!('getTCData', 2, (tcData: TCData, success: boolean) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        if (!success || !tcData) {
          resolve(null);
          return;
        }

        const purposeConsents = tcData.purpose?.consents || {};
        const adStorageGranted = Boolean(purposeConsents['1']); // Storage and/or access of information
        const personalizationGranted = Boolean(purposeConsents['4']); // Personalised ads

        const signals: ConsentSignals = {
          ad_storage: adStorageGranted ? 'granted' : 'denied',
          ad_user_data: personalizationGranted ? 'granted' : 'denied',
          ad_personalization: personalizationGranted ? 'granted' : 'denied',
        };

        resolve(
          encodeStoredConsent(signalsToMode(signals), signals, tcData.tcString ? `tcf-${tcData.tcString.slice(0, 8)}` : null),
        );
      });
    } catch {
      resolve(null);
    }
  });

const ensureDeviceId = () => {
  if (typeof window === 'undefined') return null;
  let deviceId = window.localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
};

const syncLegacyStorage = (mode: ConsentMode) => {
  if (typeof window === 'undefined') return;
  const legacyValue = mode === 'personalized' ? 'personalized' : mode === 'npa' || mode === 'limited' ? 'essential' : 'none';
  window.localStorage.setItem(LEGACY_KEY, legacyValue);
};

export function useConsent() {
  const [state, setState] = useState<ConsentState>(DEFAULT_STATE);
  const [cmpVersion, setCmpVersion] = useState<string | null>(null);
  const gtagSnapshotRef = useRef<string | null>(null);

  const applyConsent = useCallback(
    (mode: ConsentMode, signals: ConsentSignals, source: ConsentSource, hash?: string | null, cmp?: string | null) => {
      setState((prev) => ({
        mode,
        signals,
        source,
        ready: true,
        userHash: typeof hash === 'string' ? hash : prev.userHash,
      }));
      if (cmp) setCmpVersion(cmp);
      syncLegacyStorage(mode);
      if (typeof window !== 'undefined') {
        const payload = encodeStoredConsent(mode, signals, cmp ?? cmpVersion ?? CMP_VERSION);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        if (typeof hash === 'string' && hash.trim().length > 0) {
          window.localStorage.setItem('blob_consent_hash', hash);
        }
      }
    },
    [cmpVersion],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;
    const bootstrap = async () => {
      // Reset observable signal at bootstrap start so stale values from SPA navigation
      // or previous bootstrap runs cannot be observed as truthy before this run resolves.
      (window as WindowWithGtag).__CONSENT_READY = false;
      const deviceId = ensureDeviceId();
      if (!deviceId) return;

      const userAgent = window.navigator.userAgent || 'unknown-agent';
      const hash = await sha256(`${deviceId}:${userAgent}`);

      if (cancelled) return;

      let resolved: StoredConsent | null = null;

      const tcfConsent = await readTcString();
      if (tcfConsent) {
        resolved = tcfConsent;
        applyConsent(tcfConsent.mode, tcfConsent.signals, 'tcf', hash, tcfConsent.cmpVersion ?? null);
      }

      if (!resolved) {
        const cached = decodeStoredConsent(window.localStorage.getItem(STORAGE_KEY));
        if (cached) {
          resolved = cached;
          applyConsent(cached.mode, cached.signals, 'local', hash, cached.cmpVersion ?? null);
        }
      }

      if (!resolved) {
        try {
          const response = await apiClient.getConsent(hash);
          if (response?.consent) {
            const remote = response.consent;
            const mode = remote.consentLevel;
            const signals: ConsentSignals = {
              ad_storage: remote.ad_storage,
              ad_user_data: remote.ad_user_data,
              ad_personalization: remote.ad_personalization,
            };
            applyConsent(mode, signals, 'remote', hash, remote.cmpVersion ?? null);
            resolved = { mode, signals, cmpVersion: remote.cmpVersion ?? null, updatedAt: remote.updatedAt };
          }
        } catch (error) {
          console.warn('Unable to fetch consent from API', error);
        }
      }

      if (!resolved) {
        applyConsent('none', DEFAULT_SIGNALS, 'default', hash, CMP_VERSION);
      }
    };

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, [applyConsent]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!state.ready) return;

    const windowWithGtag = window as WindowWithGtag;

    // Bootstrap-complete signal: always updated when ready, decoupled from the gtag
    // dedup guard below. A cmpVersion-triggered re-bootstrap resets this to false before
    // restarting, so true here always reflects the current bootstrap run's resolved mode.
    windowWithGtag.__CONSENT_READY = true;
    windowWithGtag.__CONSENT_MODE = state.mode;

    // Dedup guard: gtag consent:update fires once per unique signal combination.
    // Prevents double-fire on React StrictMode remounts and cmpVersion re-bootstraps.
    const snapshot = `${state.mode}:${state.signals.ad_storage}:${state.signals.ad_user_data}:${state.signals.ad_personalization}`;
    if (gtagSnapshotRef.current === snapshot) return;
    gtagSnapshotRef.current = snapshot;

    if (typeof windowWithGtag.gtag === 'function') {
      windowWithGtag.gtag('consent', 'update', {
        ad_storage: state.signals.ad_storage,
        ad_user_data: state.signals.ad_user_data,
        ad_personalization: state.signals.ad_personalization,
      });
    }
  }, [state]);

  const updateConsent = useCallback(
    async (mode: ConsentMode, options?: { cmpVersion?: string | null }) => {
      const signals = modeToSignals(mode);
      applyConsent(mode, signals, 'manual', state.userHash, options?.cmpVersion ?? cmpVersion ?? CMP_VERSION);

      if (!state.userHash) return;
      try {
        await apiClient.updateConsent(state.userHash, {
          consentLevel: mode,
          ad_storage: signals.ad_storage,
          ad_user_data: signals.ad_user_data,
          ad_personalization: signals.ad_personalization,
          cmpVersion: options?.cmpVersion ?? cmpVersion ?? CMP_VERSION,
        });
      } catch (error) {
        console.warn('Unable to persist consent choice', error);
      }
    },
    [applyConsent, cmpVersion, state.userHash],
  );

  const houseAdsEnabled = useMemo(() => state.mode === 'none', [state.mode]);

  return {
    consentMode: state.mode,
    consentSignals: state.signals,
    consentSource: state.source,
    consentReady: state.ready,
    userHash: state.userHash,
    cmpVersion: cmpVersion ?? CMP_VERSION,
    updateConsent,
    houseAdsEnabled,
  };
}
