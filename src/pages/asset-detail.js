(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { wait, visible, isAssistantElement, dispatchClick } = root.core.dom;
  const { entityIdFromUrl, isSavedAssetPage, isPpmListPage, ppmListUrl } = root.core.pages;
  const $ = () => root.runtime.b;

  function showStep(b, verb, target, detail, options) {
    return root.ui.workflowSteps?.show(b, verb, target, detail, options);
  }

  const PPM_NAV_ID = 'Fsi.Concept.Asset.Entities.FASSET.Common.PPMs';
  const LINK_WAIT_MS = 8000;
  const LINK_POLL_MS = 100;

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
    if (!isSavedAssetPage() && !isPpmListPage()) return;

    const entityId = entityIdFromUrl() || auto.assetEntityId || '';
    if (!entityId) throw new Error('Asset entity id was not found on the asset details page.');

    showStep(b, 'Asset editor ready', 'Switching to PPM tab', record?.assetCode || '', {
      meta: record?.assetCode || '',
      wait: true,
      tick: true
    });

    b.state.session.auto = {
      ...auto,
      phase: 'wait_ppm',
      assetEntityId: entityId,
      assetCode: record.assetCode,
      ppmIndex: 0,
      phaseProgressAt: Date.now()
    };
    b.addEvent('asset-open-ppm', {
      assetCode: record.assetCode,
      entityId,
      method: 'direct-nav'
    });
    await b.persistSession();
    b.render();

    if (isPpmListPage()) {
      showStep(b, 'PPM tab switched', 'PPM register open', 'Creating workbook PPM rows next', {
        meta: record?.assetCode || '',
        wait: false,
        duration: 3500
      });
      b.scheduleAuto(0);
      return;
    }

    const target = ppmListUrl(entityId);
    showStep(b, 'PPM tab switching', 'Opening PPM register page', record?.assetCode || '', {
      meta: record?.assetCode || '',
      wait: true,
      tick: true
    });
    try {
      const current = new URL(location.href);
      const next = new URL(target);
      if (current.pathname !== next.pathname || current.searchParams.get('id') !== next.searchParams.get('id')) {
        location.href = target;
        return;
      }
    } catch (_) {
      location.href = target;
      return;
    }

    const link = await waitForPpmNav();
    if (!link) throw new Error('PPM side navigation was not found on the asset details page.');
    b.addEvent('asset-open-ppm', {
      assetCode: record.assetCode,
      entityId,
      method: 'side-nav-click',
      href: link.getAttribute('href') || ''
    });
    dispatchClick(link, false, 'PPM');
    showStep(b, 'PPM tab switched', 'Side navigation clicked', 'Create New for workbook PPM rows next', {
      meta: record?.assetCode || '',
      wait: false,
      duration: 4000,
      type: 'success'
    });
    b.scheduleAuto(400);
  }

  root.pages = root.pages || {};
  root.pages.assetDetail = Object.freeze({ processOpenPpm });
})();
