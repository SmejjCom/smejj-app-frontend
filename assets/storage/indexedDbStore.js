const DB_NAME = "smejj-local-workspace";
const DB_VERSION = 2;
const STORES = [
  "projects",
  "manifests",
  "status",
  "objects",
  "users",
  "workspaces",
  "providerSettings",
  "localSettings",
  "aiSettings",
  "rights"
];

export function createIndexedDbStore({ indexedDBImpl = globalThis.indexedDB } = {}) {
  if (!indexedDBImpl) return createMemoryStore();
  let dbPromise;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDBImpl.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of STORES) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB open failed."));
    });
    return dbPromise;
  }

  async function transaction(store, mode, action) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const objectStore = tx.objectStore(store);
      const request = action(objectStore);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB operation failed."));
    });
  }

  return {
    kind: "indexeddb",
    async get(store, key) {
      return transaction(store, "readonly", (objectStore) => objectStore.get(key));
    },
    async put(store, key, value) {
      await transaction(store, "readwrite", (objectStore) => objectStore.put(value, key));
      return value;
    },
    async delete(store, key) {
      await transaction(store, "readwrite", (objectStore) => objectStore.delete(key));
    },
    async list(store) {
      return transaction(store, "readonly", (objectStore) => objectStore.getAll());
    }
  };
}

export function createMemoryStore() {
  const stores = new Map(STORES.map((store) => [store, new Map()]));
  const ensure = (store) => {
    if (!stores.has(store)) stores.set(store, new Map());
    return stores.get(store);
  };
  return {
    kind: "memory-indexeddb-fallback",
    async get(store, key) {
      return ensure(store).get(key);
    },
    async put(store, key, value) {
      ensure(store).set(key, value);
      return value;
    },
    async delete(store, key) {
      ensure(store).delete(key);
    },
    async list(store) {
      return Array.from(ensure(store).values());
    }
  };
}
