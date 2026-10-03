(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { wait, dispatchClick } = root.core.dom;
  const $ = () => root.runtime.b;

  async function fillExistingSavedAsset() {
    const b = $();
    if (!b.state.assets.length) throw new Error('Load the CAFM import workbook first.');
    const matched = root.data.records.recordForCurrentSavedAsset();
    const record = matched.record;
    const issues = root.data.records.validateRecord(record);
    if (issues.length) throw new Error(`Workbook row ${record.workbookRow}: ${issues.join('; ')}`);

    b.state.session.currentLookupEvidence = [];
    await b.persistSession();
    b.showToast(`Updating saved asset ${record.assetCode} from Excel...`, 'info', 6000);

    const filled = await root.pages.assetNew.fillAssetFieldsByTab(record, { skipAssetCode: true });
    const direct = filled.direct;
    const lookups = filled.lookups;
    await wait(0);
    await root.pages.assetNew.verifyBeforeSave(record);

    b.state.session.manualAwaitSave = null;
    await b.persistSession();
    b.showToast(`${record.assetCode} has been updated from workbook row ${record.workbookRow}. Review the fields, then click the normal CAFM Save button. This edits the existing asset only; status and existing PPMs are not changed.`, 'success', 12000);
    return { record, workbookIndex: matched.index, direct, lookups };
  }

  async function saveExistingAssetChanges() {
    const b = $();
    if (!b.state.assets.length) throw new Error('Load the CAFM import workbook first.');
    const { record } = root.data.records.recordForCurrentSavedAsset();
    await wait(0);
    await root.pages.assetNew.verifyBeforeSave(record);
    const save = b.findSaveButton();
    if (!save) throw new Error('CAFM Save button was not detected.');

    b.state.session.manualAwaitSave = null;
    await b.persistSession();
    b.showToast(`Saving changes to existing asset ${record.assetCode}...`, 'info', 5000);
    dispatchClick(save);
    await wait(0);
    const error = b.validationMessage();
    if (error) throw new Error(error);
    b.showToast(`${record.assetCode}: existing-asset Save sent. No new asset, status change or PPM creation was triggered.`, 'success', 9000);
    return true;
  }

  root.pages = root.pages || {};
  root.pages.assetManual = Object.freeze({
    fillExistingSavedAsset,
    saveExistingAssetChanges
  });
})();
