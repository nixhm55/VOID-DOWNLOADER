/** Download metadata and IndexedDB persistence, retaining original image/coverBlob fields. */
export type VoidDownloadRecord = {
  id: string;
  title: string;
  artist: string;
  album: string;
  image?: string;
  coverBlob?: Blob;
  duration?: number;
  mimeType: string;
  source?: string;
  qualityBadge?: string;
  bitrate?: number;
  codec?: string;
  format?: string;
  qualityVerified?: boolean;
  exactYtBlob?: boolean;
  favorite?: boolean;
  blob: Blob;
  downloadedAt: number;
};

export const VOID_DOWNLOAD_DB = 'void-offline-downloads';

export function openVoidDownloadDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Offline storage is unavailable in this browser.'));
      return;
    }
    const request = indexedDB.open(VOID_DOWNLOAD_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('tracks')) {
        request.result.createObjectStore('tracks', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open offline storage.'));
  });
}

export async function putVoidDownload(record: VoidDownloadRecord): Promise<void> {
  const db = await openVoidDownloadDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('tracks', 'readwrite');
      const store = tx.objectStore('tracks');
      // Track IDs are the storage identity. Never remove a different download just
      // because its title/artist text matches; providers can return distinct tracks
      // with identical metadata.
      const request = store.put(record);
      request.onerror = () => {
        try {
          tx.abort();
        } catch {}
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not save download.'));
      tx.onabort = () => reject(tx.error || new Error('Download save was cancelled.'));
    });
  } finally {
    db.close();
  }
}

export async function getVoidDownloads(): Promise<VoidDownloadRecord[]> {
  const db = await openVoidDownloadDb();
  try {
    return await new Promise<VoidDownloadRecord[]>((resolve, reject) => {
      const request = db.transaction('tracks', 'readonly').objectStore('tracks').getAll();
      request.onsuccess = () => resolve(request.result as VoidDownloadRecord[]);
      request.onerror = () => reject(request.error || new Error('Could not read downloads.'));
    });
  } finally {
    db.close();
  }
}

export async function removeVoidDownload(id: string): Promise<void> {
  const db = await openVoidDownloadDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('tracks', 'readwrite');
      tx.objectStore('tracks').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not remove download.'));
    });
  } finally {
    db.close();
  }
}
