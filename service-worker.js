const cachePrefix = "extension-officer-shell-";
const cacheName = `${cachePrefix}v2`;
const runtimeCacheName = `${cacheName}-runtime`;
const appBaseUrl = new URL("./", self.location.href);
const maxRuntimeEntries = 300;

self.addEventListener("install", event => {
    event.waitUntil((async () => {
        const cache = await caches.open(cacheName);
        const shellUrl = new URL("index.html", appBaseUrl);
        const shellResponse = await fetch(shellUrl, { cache: "no-cache" });
        if (!shellResponse.ok)
            throw new Error(`Extension Officer app shell could not be loaded (${shellResponse.status}).`);

        const shellMarkup = await shellResponse.clone().text();
        await cache.put(shellUrl, shellResponse);

        const bootUrl = new URL("_framework/blazor.boot.json", appBaseUrl);
        const bootResponse = await fetch(bootUrl, { cache: "no-cache" });
        if (!bootResponse.ok)
            throw new Error(`Extension Officer boot manifest could not be loaded (${bootResponse.status}).`);

        const bootManifest = await bootResponse.clone().json();
        await cache.put(bootUrl, bootResponse);
        const assets = new Set([
            new URL("manifest.json", appBaseUrl).href,
            new URL("sample-data/extension-visits.json", appBaseUrl).href,
            bootUrl.href,
            ...getShellAssets(shellMarkup),
            ...getBootAssets(bootManifest)
        ]);
        await cache.addAll([...assets].map(asset => new Request(asset, { credentials: "same-origin" })));
        await self.skipWaiting();
    })());
});

self.addEventListener("activate", event => {
    event.waitUntil((async () => {
        const cacheKeys = await caches.keys();
        const activeCaches = new Set([cacheName, runtimeCacheName]);
        await Promise.all(cacheKeys
            .filter(key => key.startsWith(cachePrefix) && !activeCaches.has(key))
            .map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});

self.addEventListener("fetch", event => {
    const request = event.request;
    const requestUrl = new URL(request.url);
    if (request.method !== "GET" ||
        requestUrl.origin !== appBaseUrl.origin ||
        !requestUrl.pathname.startsWith(appBaseUrl.pathname) ||
        isApiPath(requestUrl.pathname) ||
        requestUrl.pathname.endsWith("/service-worker.js")) return;

    if (request.mode === "navigate") {
        event.respondWith((async () => {
            try {
                const response = await fetch(request);
                if (response.ok) {
                    const cache = await caches.open(cacheName);
                    await cache.put(new URL("index.html", appBaseUrl), response.clone());
                }
                return response;
            } catch {
                const shell = await caches.match(new URL("index.html", appBaseUrl));
                if (shell) return shell;
                throw new Error("Install Extension Officer Mobile while online before using it offline.");
            }
        })());
        return;
    }

    const isAppAsset = requestUrl.pathname.includes("/_framework/") ||
        requestUrl.pathname.includes("/_content/") ||
        requestUrl.pathname.endsWith(".json") ||
        ["script", "style", "image", "font", "worker"].includes(request.destination);
    if (!isAppAsset) return;

    event.respondWith((async () => {
        const runtimeCache = await caches.open(runtimeCacheName);
        try {
            const response = await fetch(request);
            if (response.ok && response.type === "basic") {
                await runtimeCache.put(request, response.clone());
                await trimRuntimeEntries(runtimeCache);
            }
            return response;
        } catch {
            const cached = await runtimeCache.match(request) ??
                await (await caches.open(cacheName)).match(request);
            if (cached) return cached;
            throw new Error(`App asset is not available offline: ${requestUrl.pathname}`);
        }
    })());
});

function getShellAssets(markup) {
    const assets = [];
    for (const [, reference] of markup.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) {
        const url = new URL(reference, appBaseUrl);
        if (isCacheableAsset(url)) assets.push(url.href);
    }
    return assets;
}

function getBootAssets(manifest) {
    const assets = [];

    function visit(value) {
        if (!value || typeof value !== "object") return;
        for (const [key, child] of Object.entries(value)) {
            if (typeof child === "string" && /\.(?:dll|wasm|js|dat|json|pdb|blat|woff2)$/i.test(key)) {
                const url = new URL(`_framework/${key}`, appBaseUrl);
                if (isCacheableAsset(url)) assets.push(url.href);
            } else if (child && typeof child === "object") {
                visit(child);
            }
        }
    }

    visit(manifest?.resources);
    return assets;
}

function isCacheableAsset(url) {
    return url.origin === appBaseUrl.origin &&
        url.pathname.startsWith(appBaseUrl.pathname) &&
        !isApiPath(url.pathname) &&
        !url.pathname.endsWith("/service-worker.js");
}

function isApiPath(pathname) {
    const relativePath = pathname.slice(appBaseUrl.pathname.length).replace(/^\/+/, "");
    return relativePath === "api" || relativePath.startsWith("api/");
}

async function trimRuntimeEntries(cache) {
    const keys = await cache.keys();
    const runtimeKeys = keys.filter(request => {
        const url = new URL(request.url);
        return url.pathname.includes("/_framework/") ||
            url.pathname.includes("/_content/") ||
            url.pathname.endsWith(".json");
    });
    if (runtimeKeys.length > maxRuntimeEntries)
        await Promise.all(runtimeKeys.slice(0, runtimeKeys.length - maxRuntimeEntries).map(request => cache.delete(request)));
}
