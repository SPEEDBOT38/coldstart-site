// Meta Marketing API adapter built on Meta's own SDK (facebook-nodejs-business-sdk).
// It only ever creates PAUSED drafts. Activation is deliberately not implemented here.
import adsSdk from 'facebook-nodejs-business-sdk';
import { PluginError } from '../plugins/http.js';
import { withRetry } from './retry.js';

const { FacebookAdsApi, AdAccount } = adsSdk;
export const REQUIRED_SCOPES = ['ads_management', 'ads_read', 'business_management'];
const OBJECTIVE = { sales: 'OUTCOME_SALES', traffic: 'OUTCOME_TRAFFIC', awareness: 'OUTCOME_AWARENESS' };

export const makeApi = token => FacebookAdsApi.init(token);   // injected in tests

/** payload is the approved, canonical launch payload. */
export async function createDraft({ api, payload, retries = 2 }) {
  const acct = payload.destination?.adAccountId;
  if (!/^act_\d+$/.test(acct || '')) throw new PluginError('Choose a Meta ad account (act_…) before creating a draft.', 400, { code: 'no_ad_account' });
  if (!payload.audience?.countries?.length) throw new PluginError('Choose at least one target country before creating a draft.', 400, { code: 'no_country' });
  const objective = OBJECTIVE[payload.objective] || 'OUTCOME_TRAFFIC';
  const account = new AdAccount(acct, {}, null, api);
  const campaign = await withRetry(() => account.createCampaign([], { name: payload.name, objective, status: 'PAUSED', special_ad_categories: [] }), { retries });
  const adset = await withRetry(() => account.createAdSet([], {
    name: payload.name + ' · ad set', campaign_id: campaign.id, status: 'PAUSED', billing_event: 'IMPRESSIONS', optimization_goal: payload.objective === 'sales' ? 'OFFSITE_CONVERSIONS' : 'LINK_CLICKS',
    daily_budget: Math.round(((payload.budget?.amount || 0) / (payload.budget?.period === 'month' ? 30 : 1)) * 100), bid_strategy: 'LOWEST_COST_WITHOUT_CAP', targeting: { geo_locations: { countries: payload.audience.countries } },
  }), { retries });
  return { campaignId: campaign.id, adSetId: adset.id, status: 'PAUSED', creatives: 'pending', note: 'Draft only. Ad creatives are not uploaded and nothing is delivering.' };
}
