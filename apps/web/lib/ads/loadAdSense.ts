let loadingPromise: Promise<void> | null = null;

declare global {
  interface Window {
    adsbygoogle?: Array<Record<string, unknown>>;
  }
}

export function loadAdSense(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();

  if (loadingPromise) {
    return loadingPromise;
  }

  if (document.querySelector('script[data-blobinfini="adsense"]')) {
    loadingPromise = Promise.resolve();
    return loadingPromise;
  }

  loadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
    script.async = true;
    script.setAttribute('data-blobinfini', 'adsense');

    script.onload = () => {
      if (!window.adsbygoogle) {
        window.adsbygoogle = [];
      }
      resolve();
    };

    script.onerror = () => {
      console.warn('Failed to load AdSense script');
      reject(new Error('AdSense script failed to load'));
    };

    document.head.appendChild(script);
  });

  return loadingPromise;
}
