// Spend guards for paid capabilities (research providers, AI). The deployed app has no login yet,
// so a global daily cap and a per-IP hourly cap stop strangers from burning the owner's credits.
import { PluginError } from './plugins/http.js';

export async function charge(store, kind, ip, { daily, hourlyPerIp }) {
  const day = new Date().toISOString().slice(0, 10), hour = new Date().toISOString().slice(0, 13);
  const dk = `budget:${kind}:${day}`, hk = `budget:${kind}:${hour}:${ip || 'anon'}`;
  const d = Number(await store.get(dk)) || 0, h = Number(await store.get(hk)) || 0;
  if (d >= daily) throw new PluginError(`Daily ${kind} limit reached (${daily}). Resets at 00:00 UTC.`, 429);
  if (h >= hourlyPerIp) throw new PluginError(`Too many ${kind} requests from this network. Try again within the hour.`, 429);
  await store.set(dk, d + 1, 2 * 86400);
  await store.set(hk, h + 1, 7200);
  return { used: d + 1, daily };
}
export const limits = {
  scan: () => ({ daily: Number(process.env.RESEARCH_DAILY_SCANS) || 60, hourlyPerIp: 20 }),
  ai: () => ({ daily: Number(process.env.AI_DAILY_CALLS) || 300, hourlyPerIp: 60 }),
};
