// PDF payloads exceed localStorage's usual quota. Persist exact bytes in IndexedDB
// before the small command identity is prepared. Keep content by preview hash so
// another tab settling its ACK cannot destroy a still displayed retry's payload.
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('workagent-pdf-import', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('uploads');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('PDF retry storage is unavailable. No new import was sent.'));
    request.onblocked = () => reject(new Error('Close other Workagent tabs to enable PDF retry storage.'));
  });
}
export const pdfUpload = {
  async put(key: string, base64: string) {
    const db = await database();
    try { await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('uploads', 'readwrite'); tx.objectStore('uploads').put(base64, key);
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new Error('Cannot retain this PDF for retry. No import was sent; check device storage.'));
    }); } finally { db.close(); }
  },
  async get(key: string): Promise<string> {
    const db = await database();
    try { return await new Promise<string>((resolve, reject) => {
      const tx = db.transaction('uploads', 'readonly'), request = tx.objectStore('uploads').get(key);
      tx.oncomplete = () => typeof request.result === 'string' ? resolve(request.result) : reject(new Error('The retained PDF is missing on this device. The unresolved import identity is kept.'));
      tx.onabort = tx.onerror = () => reject(new Error('Cannot read retained PDF; retry when device storage is available.'));
    }); } finally { db.close(); }
  },
};
