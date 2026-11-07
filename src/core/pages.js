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

  function copyOfFromUrl(href = location.href) {
    try {
      return clean(new URL(href, location.href).searchParams.get('CopyOf') || '');
    } catch (_) {
      return '';
    }
  }

  function isAssetCopyChildEditorPage(href = location.href) {
    try {
      const url = new URL(href, location.href);
      if (!assetPagePattern.test(url.pathname)) return false;
      const id = clean(url.searchParams.get('id') || '');
      const copyOf = clean(url.searchParams.get('CopyOf') || '');
      if (href === location.href && !isAssetPage()) return false;
      return id === '-1' && Boolean(copyOf);
    } catch (_) {
      return false;
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

  /** Copied asset editor (unsaved duplicate) — may share a positive id before first save. */
  function isAssetCopyEditorPage() {
    if (!isAssetPage()) return false;
    if (isAssetCopyChildEditorPage()) return true;
    if (isNewEntityPage()) return true;
    const bodyPrefix = clean(document.body?.innerText || '').slice(0, 2500);
    if (/new entity/i.test(bodyPrefix)) return true;
    return false;
  }

  function isSavedAssetPage() {
    if (!isAssetPage()) return false;
    const id = entityIdFromUrl();
    return Boolean(id && id !== '-1');
  }

  function hasEmbeddedPpmGrid() {
    return Boolean(document.querySelector('[id*="fsiGridPPMs"]'));
  }

  function isEmbeddedAssetPpmPage() {
    return isSavedAssetPage() && hasEmbeddedPpmGrid();
  }

  function isPpmListPage() {
    return ppmListPagePattern.test(location.pathname) || isEmbeddedAssetPpmPage();
  }

  function isHashPpmParentPage() {
    return ppmListPagePattern.test(location.pathname) && String(location.href || '').endsWith('#');
  }

  /** Parent surface for PPM Create New / Refresh — dedicated register or embedded asset PPM tab. */
  function isPpmRegisterParentPage() {
    return isHashPpmParentPage() || isEmbeddedAssetPpmPage();
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
    return isAssetPage() || isAssetListPage() || isPpmListPage() || isPpmItemPage();
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
      if (assetListPagePattern.test(url.pathname)) {
        return `${url.origin}/Evolution/!System/Asset/FASSET/ViewFASSETItem.aspx?id=-1`;
      }
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
    copyOfFromUrl,
    isAssetCopyChildEditorPage,
    isNewEntityPage,
    isAssetCopyEditorPage,
    isSavedAssetPage,
    isPpmListPage,
    hasEmbeddedPpmGrid,
    isEmbeddedAssetPpmPage,
    isHashPpmParentPage,
    isPpmRegisterParentPage,
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
