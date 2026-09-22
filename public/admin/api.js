const BASE = "/admin/api";
const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB per part — comfortably above R2's 5MB multipart minimum

async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: options.body instanceof FormData ? options.headers : { "Content-Type": "application/json", ...options.headers },
  });
  if (!res.ok) {
    let message = `Fehler ${res.status}`;
    try {
      const data = await res.json();
      if (data.error) message = data.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function uploadChunked(file, onProgress) {
  const { key, uploadId } = await request("/upload/init", {
    method: "POST",
    body: JSON.stringify({ filename: file.name, mime: file.type, size: file.size }),
  });

  const parts = [];
  try {
    let partNumber = 1;
    for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
      const chunk = file.slice(offset, Math.min(offset + CHUNK_SIZE, file.size));
      const res = await fetch(`${BASE}/upload/part?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`, {
        method: "PUT",
        body: chunk,
      });
      if (!res.ok) throw new Error(`Upload fehlgeschlagen (Teil ${partNumber}).`);
      const { etag } = await res.json();
      parts.push({ partNumber, etag });
      onProgress?.(Math.min(1, (offset + chunk.size) / file.size));
      partNumber++;
    }
    return await request("/upload/complete", {
      method: "POST",
      body: JSON.stringify({ key, uploadId, parts, mime: file.type, size: file.size }),
    });
  } catch (err) {
    await request("/upload/abort", { method: "POST", body: JSON.stringify({ key, uploadId }) }).catch(() => {});
    throw err;
  }
}

const SIMPLE_UPLOAD_MAX = 15 * 1024 * 1024;

export const api = {
  ads: {
    list: () => request("/ads"),
    get: (id) => request(`/ads/${id}`),
    create: (payload) => request("/ads", { method: "POST", body: JSON.stringify(payload) }),
    update: (id, payload) => request(`/ads/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
    remove: (id) => request(`/ads/${id}`, { method: "DELETE" }),
    duplicate: (id) => request(`/ads/${id}/duplicate`, { method: "POST" }),
    bulk: (ids, action) => request("/ads/bulk", { method: "POST", body: JSON.stringify({ ids, action }) }),
  },
  campaigns: {
    list: () => request("/campaigns"),
    create: (payload) => request("/campaigns", { method: "POST", body: JSON.stringify(payload) }),
    update: (id, payload) => request(`/campaigns/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
    remove: (id) => request(`/campaigns/${id}`, { method: "DELETE" }),
  },
  sites: {
    list: () => request("/sites"),
    create: (payload) => request("/sites", { method: "POST", body: JSON.stringify(payload) }),
    update: (id, payload) => request(`/sites/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
    remove: (id) => request(`/sites/${id}`, { method: "DELETE" }),
  },
  settings: {
    get: () => request("/settings"),
    update: (payload) => request("/settings", { method: "PUT", body: JSON.stringify(payload) }),
  },
  stats: (query) => request(`/stats?${new URLSearchParams(query)}`),
  purgeEvents: (olderThanDays) => request("/events/purge", { method: "POST", body: JSON.stringify({ olderThanDays }) }),
  upload: async (file, onProgress) => {
    if (file.size > SIMPLE_UPLOAD_MAX) return uploadChunked(file, onProgress);
    onProgress?.(0);
    const form = new FormData();
    form.append("file", file);
    const result = await request("/upload", { method: "POST", body: form });
    onProgress?.(1);
    return result;
  },
};
