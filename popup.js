'use strict';

const ASSET_LIST_PATH = '/Evolution/!System/Asset/FASSET/ViewFASSETItems.aspx';
const NEW_ENTITY_PATH = '/Evolution/!System/Asset/FASSET/ViewFASSETItem.aspx';

function isConceptUrl(url) {
  try {
    const host = new URL(String(url || '')).hostname.toLowerCase();
    return host === 'concept' || String(url || '').toLowerCase().includes('/evolution/');
  } catch (_) {
    return false;
  }
}

function conceptOrigin(tabs) {
  const match = tabs.find((tab) => isConceptUrl(tab.url));
  if (match?.url) {
    try {
      return new URL(match.url).origin;
    } catch (_) {}
  }
  return 'http://concept';
}

async function openConceptPath(pathSuffix, query = '') {
  const tabs = await chrome.tabs.query({});
  const origin = conceptOrigin(tabs);
  const url = `${origin}${pathSuffix}${query ? (query.startsWith('?') ? query : `?${query}`) : ''}`;
  const conceptTab = tabs.find((tab) => isConceptUrl(tab.url));
  if (conceptTab?.id) {
    await chrome.tabs.update(conceptTab.id, { active: true, url });
    if (conceptTab.windowId) await chrome.windows.update(conceptTab.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url });
}

document.getElementById('openAssetList')?.addEventListener('click', () => {
  openConceptPath(ASSET_LIST_PATH).catch(() => {});
});
document.getElementById('openNewEntity')?.addEventListener('click', () => {
  openConceptPath(NEW_ENTITY_PATH, 'id=-1&SubNav=true').catch(() => {});
});
