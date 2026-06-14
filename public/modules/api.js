/* ─── API HELPER ────────────────────────────────────────────────────────────── */
export async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}
