const BASE = "/admin/api";

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

export const api = {
  ads: {
    list: () => request("/ads"),
    get: (id) => request(`/ads/${id}`),
    create: (payload) => request("/ads", { method: "POST", body: JSON.stringify(payload) }),
    update: (id, payload) => request(`/ads/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
    remove: (id) => request(`/ads/${id}`, { method: "DELETE" }),
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
  upload: async (file) => {
    const form = new FormData();
    form.append("file", file);
    return request("/upload", { method: "POST", body: form });
  },
};
