(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean } = root.core.text;
  const { visible } = root.core.dom;
  const {
    assetPagePattern,
    assetListPagePattern,
    ppmListPagePattern,
    ppmItemPagePattern
  } = root.core.constants;

  function isAssetPage() {
    return assetPagePattern.test(location.pathname);
  }

  function entityIdFromUrl() {
    try {
      const url = new URL(location.href);
      return url.searchParams.get('id') || '';
    } catch (_) {
      return '';
    }
  }

  function isNewEntityPage() {
    if (!isAssetPage()) return false;
    const id = entityIdFromUrl();
    if (id === '-1') return true;
    const text = [...document.querySelectorAll('h1,h2,h3,a,span,div')]
      .filter(visible)
      .map((el) => clean(el.textContent))
      .find((textValue) => textValue === 'New Entity');
    return Boolean(text);
  }

  function isSavedAssetPage() {
    if (!isAssetPage()) return false;
    const id = entityIdFromUrl();
    return Boolean(id && id !== '-1');
  }

  function isPpmListPage() {
    return ppmListPagePattern.test(location.pathname);
  }

  function isHashPpmParentPage() {
    return isPpmListPage() && String(location.href || '').endsWith('#');
  }

  function isPpmItemPage() {
    return ppmItemPagePattern.test(location.pathname);
  }

  function isPpmNewEntityPage() {
    if (!isPpmItemPage()) return false;
    return entityIdFromUrl() === '-1' || /new entity/i.test(clean(document.body?.innerText || '').slice(0, 1500));
  }

  function isAssetListPage() {
    return assetListPagePattern.test(location.pathname);
  }

  function isWorkflowPage() {
    return isAssetPage() || isPpmListPage() || isPpmItemPage();
  }

  /** Pages where the floating importer panel (workbook upload) should appear. */
  function isPanelPage() {
    return isWorkflowPage() || isAssetListPage();
  }

  function assetEntityUrl(assetEntityId) {
    const id = clean(assetEntityId);
    return `${location.origin}/Evolution/!System/Asset/FASSET/ViewFASSETItem.aspx?id=${encodeURIComponent(id)}&SubNav=true`;
  }

  function ppmListUrl(assetEntityId) {
    const id = clean(assetEntityId);
    return `${location.origin}/Evolution/!System/Asset/FASSET/ViewFASSETItemPPMs.aspx?id=${encodeURIComponent(id)}&SubNav=true#`;
  }

  function ppmEntityUrl(ppmEntityId) {
    const id = clean(ppmEntityId);
    return `${location.origin}/Evolution/!System/PPMs/FPPM/ViewFPPMItem.aspx?id=${encodeURIComponent(id)}&SubNav=true`;
  }

  function isSavedPpmPage() {
    if (!isPpmItemPage()) return false;
    const id = entityIdFromUrl();
    return Boolean(id && id !== '-1');
  }

  function deriveNewEntityUrl() {
    try {
      const url = new URL(location.href);
      if (!assetPagePattern.test(url.pathname)) return '';
      url.searchParams.set('id', '-1');
      return url.toString();
    } catch (_) {
      return '';
    }
  }

  root.core.pages = Object.freeze({
    isAssetPage,
    entityIdFromUrl,
    isNewEntityPage,
    isSavedAssetPage,
    isPpmListPage,
    isHashPpmParentPage,
    isPpmItemPage,
    isPpmNewEntityPage,
    isAssetListPage,
    isWorkflowPage,
    isPanelPage,
    assetEntityUrl,
    ppmListUrl,
    ppmEntityUrl,
    isSavedPpmPage,
    deriveNewEntityUrl
  });
})();
