const databaseName = "ExtensionOfficerOffline";
const databaseVersion = 2;
const storeNames = ["entities", "outbox", "conflicts", "mappings"];
let databasePromise;
let connectivityHandler;

function openDatabase() {
    if (!databasePromise) {
        databasePromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(databaseName, databaseVersion);

            request.onupgradeneeded = () => {
                const database = request.result;
                for (const name of storeNames) {
                    if (!database.objectStoreNames.contains(name)) {
                        database.createObjectStore(name, { keyPath: "id" });
                    }
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                databasePromise = undefined;
                reject(request.error ?? new Error("Unable to open offline database."));
            };
            request.onblocked = () => {
                databasePromise = undefined;
                reject(new Error("Offline database upgrade is blocked by another tab."));
            };
        });
    }

    return databasePromise;
}

function assertStore(name) {
    if (!storeNames.includes(name)) throw new Error(`Unknown offline store: ${name}`);
}

export async function get(storeName, id) {
    assertStore(storeName);
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).get(id);
        request.onsuccess = () => resolve(request.result?.value ?? null);
        request.onerror = () => reject(request.error ?? new Error("Unable to read offline data."));
        transaction.onabort = () => reject(transaction.error ?? new Error("Offline read was aborted."));
    });
}

export async function getAll(storeName) {
    assertStore(storeName);
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result.map(record => record.value));
        request.onerror = () => reject(request.error ?? new Error("Unable to read offline data."));
        transaction.onabort = () => reject(transaction.error ?? new Error("Offline read was aborted."));
    });
}

export async function getAllByPrefix(storeName, keyPrefix) {
    assertStore(storeName);
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result
            .filter(record => record.id.startsWith(keyPrefix))
            .map(record => record.value));
        request.onerror = () => reject(request.error ?? new Error("Unable to read scoped offline data."));
        transaction.onabort = () => reject(transaction.error ?? new Error("Scoped offline read was aborted."));
    });
}

export async function put(storeName, id, value) {
    assertStore(storeName);
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).put({ id, value });
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => reject(transaction.error ?? new Error("Unable to save offline data."));
        transaction.onabort = () => reject(transaction.error ?? new Error("Offline write was aborted."));
    });
}

export async function deleteRecord(storeName, id) {
    assertStore(storeName);
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).delete(id);
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => reject(transaction.error ?? new Error("Unable to delete offline data."));
        transaction.onabort = () => reject(transaction.error ?? new Error("Offline delete was aborted."));
    });
}

export function getOnlineStatus() {
    return navigator.onLine;
}

export function subscribeConnectivity(dotNetReference) {
    unsubscribeConnectivity();
    connectivityHandler = () => dotNetReference.invokeMethodAsync("OnConnectivityChanged", navigator.onLine);
    window.addEventListener("online", connectivityHandler);
    window.addEventListener("offline", connectivityHandler);
}

export function unsubscribeConnectivity() {
    if (connectivityHandler) {
        window.removeEventListener("online", connectivityHandler);
        window.removeEventListener("offline", connectivityHandler);
        connectivityHandler = undefined;
    }
}
