// Insights plugin (the MetaCroc intelligence, inside Coldstart): brand profile, Instagram ICPs, competitor ads,
// per-ad reads, the competitor analysis and three ads for the existing products.
// The browser drives it: create once, then call step until the run is done. Each step is one bounded unit of work.
import { create, step } from '../intel/run.js';
import { hasApify } from '../intel/apify.js';
import { charge } from '../budget.js';
import { paintImage, toDataUrl, hasGeminiImage } from '../gemini-image.js';
import { scenePrompt } from '../intel/scene.js';
import { PluginError } from './http.js';

const hasAi = () => !!(process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY);

export default {
  id: 'intel', name: 'Insights', vendor: 'Gemini · Apify', category: 'Research',
  description: 'Reads your brand, your Instagram, and each competitor\'s live Meta ads, then writes the competitive analysis and three ads for your existing products.',
  capabilities: ['insights.brand', 'insights.instagram_icp', 'insights.competitor_ads', 'insights.analysis', 'insights.ads'],
  env: [], optionalEnv: ['APIFY_TOKEN', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_IMAGE_MODELS', 'INSIGHTS_DAILY_RUNS'],
  docs: 'https://openrouter.ai/keys', auth: { type: 'server', scopes: [] },
  liveReady: () => hasAi(),
  actions: {
    status: { method: 'GET', run: async () => ({ ai: hasAi(), apify: hasApify(), image: !!process.env.OPENROUTER_API_KEY }) },
    create: { method: 'POST', run: async (ctx, input) => {
      if (!hasAi()) throw new PluginError('Insights needs OPENROUTER_API_KEY or GEMINI_API_KEY on the server.', 503);
      await charge(ctx.store, 'insights', ctx.req.ip, { daily: Number(process.env.INSIGHTS_DAILY_RUNS) || 40, hourlyPerIp: 6 });
      return { run: create(input || {}) };
    } },
    // One ad image: the real product photo as the reference, the scene written from the ad's angle and the brand palette.
    scene: { method: 'POST', run: async (ctx, input) => {
      if (!hasGeminiImage()) throw new PluginError('Ad images need OPENROUTER_API_KEY on the server.', 503);
      await charge(ctx.store, 'scene', ctx.req.ip, { daily: Number(process.env.SCENES_DAILY) || 300, hourlyPerIp: 60 });
      const body = input || {};
      const prompt = scenePrompt({ product: body.product || {}, variant: body.variant || {}, brand: body.brand || {}, palette: body.palette || {} });
      const reference = body.product && body.product.image ? await toDataUrl(body.product.image, { fetchImpl: ctx.fetch }) : null;
      const out = await paintImage({ prompt, reference, fetchImpl: ctx.fetch });
      return { image: out.image, model: out.model, prompt, product_photo: !!reference };
    } },
    step: { method: 'POST', run: async (ctx, input) => {
      await charge(ctx.store, 'insights-step', ctx.req.ip, { daily: Number(process.env.INSIGHTS_DAILY_STEPS) || 800, hourlyPerIp: 400 });
      return step((input || {}).run, { fetch: ctx.fetch });
    } },
  },
};
