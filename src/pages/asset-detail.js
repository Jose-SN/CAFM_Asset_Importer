(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { wait, visible, isAssistantElement, dispatchClick } = root.core.dom;
  const { entityIdFromUrl, isSavedAssetPage } = root.core.pages;
  const $ = () => root.runtime.b;

  const PPM_NAV_ID = 'Fsi.Concept.Asset.Entities.FASSET.Common.PPMs';
  const LINK_WAIT_MS = 4000;
  const LINK_POLL_MS = 150;

  function findPpmNavLink() {
    const byId = document.getElementById(PPM_NAV_ID);
    if (byId && visible(byId) && !isAssistantElement(byId)) return byId;
    const byTitle = document.querySelector('a.fsiNavItem[title="PPM"]');
    if (byTitle && visible(byTitle) && !isAssistantElement(byTitle)) return byTitle;
    return null;
  }

  async function waitForPpmNav() {
    const deadline = Date.now() + LINK_WAIT_MS;
    while (Date.now() < deadline) {
      const link = findPpmNavLink();
      if (link) return link;
      await wait(LINK_POLL_MS);
    }
    return findPpmNavLink();
  }

  async function processOpenPpm(record) {
    const b = $();
    const auto = b.state.session.auto || {};
    if (!auto.active || auto.phase !== 'wait_asset') return;
    if (!isSavedAssetPage()) return;

    const entityId = entityIdFromUrl();
    b.showActivity?.('Clicking', 'PPM', record?.assetCode || '', { wait: true, meta: record?.assetCode || '', tick: true });
    const link = await waitForPpmNav();
    if (!link) throw new Error('PPM side navigation was not found on the asset details page.');

    b.state.session.auto = {
      ...auto,
      phase: 'wait_ppm',
      assetEntityId: entityId || auto.assetEntityId || '',
      assetCode: record.assetCode
    };
    b.addEvent('asset-open-ppm', {
      assetCode: record.assetCode,
      entityId,
      href: link.getAttribute('href') || ''
    });
    await b.persistSession();
    dispatchClick(link, false, 'PPM');
    b.render();
    b.showToast(`${record.assetCode}: opened PPM from the asset side navigation.`, 'success', 8000);
  }

  root.pages = root.pages || {};
  root.pages.assetDetail = Object.freeze({ processOpenPpm });
})();
