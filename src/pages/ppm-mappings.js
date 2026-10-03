(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean } = root.core.text;
  const { makeLookupSpec, splitLookupValue } = root.core.lookupSpec;
  const { ppmDirectFromRegistry } = root.data.fieldRegistry;

  const REQUIRED_PPM_LOOKUP_FIELDS = Object.freeze(['Instruction Set', 'PPM Priority']);

  function instructionSearchTerms(instruction) {
    const text = clean(instruction);
    if (!text) return [];
    if (/fire\s+doors?/i.test(text)) return ['fire doors', text];
    return [text.split(/\s+/).slice(0, 2).join(' '), text];
  }

  function resolvePpmPriority(ppm, settings = {}) {
    return clean(ppm?.priority)
      || clean(settings.defaultPpmPriority)
      || '3';
  }

  function ppmDirectMapping(ppm) {
    return ppmDirectFromRegistry(ppm);
  }

  function ppmLookupMapping(ppm, settings = {}) {
    if (!ppm) return [];
    const mk = (field, value, options = {}) => makeLookupSpec(field, value, { tab: 'General', ...options });
    const instruction = clean(ppm.instruction);
    const priority = resolvePpmPriority(ppm, settings);
    const specs = [
      mk('Contract', ppm.contract, { description: ppm.contract }),
      mk('Instruction Set', instruction, {
        description: instruction,
        labelAliases: ['Instruction Set'],
        searchTerms: instructionSearchTerms(instruction)
      }),
      mk('PPM Priority', priority, {
        description: priority,
        labelAliases: ['Priority', 'PPM Priority'],
        searchTerms: uniqueSearchTerms(priority)
      }),
      mk('Shift', ppm.shift, { description: ppm.shift }),
      mk('Compliance', ppm.compliance, { description: ppm.compliance }),
      mk('Cost Code', ppm.costCode, { description: ppm.costCode }),
      mk('Cost Centre', ppm.costCentre, { ...splitLookupValue(ppm.costCentre), description: splitLookupValue(ppm.costCentre).description })
    ];
    return specs.filter((item) => REQUIRED_PPM_LOOKUP_FIELDS.includes(item.field) || clean(item.value));
  }

  function uniqueSearchTerms(value) {
    const text = clean(value);
    const code = text.match(/^(\d+)/)?.[1] || '';
    return code && code !== text ? [code, text] : [text];
  }

  root.pages = root.pages || {};
  root.pages.ppmMappings = Object.freeze({
    ppmDirectMapping,
    ppmLookupMapping,
    resolvePpmPriority,
    REQUIRED_PPM_LOOKUP_FIELDS
  });
})();
