(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean } = root.core.text;
  const { makeLookupSpec, splitLookupValue } = root.core.lookupSpec;
  const { ppmDirectFromRegistry } = root.data.fieldRegistry;

  function ppmDirectMapping(ppm) {
    return ppmDirectFromRegistry(ppm);
  }

  function ppmLookupMapping(ppm) {
    if (!ppm) return [];
    const mk = (field, value, options = {}) => makeLookupSpec(field, value, { tab: 'General', ...options });
    return [
      mk('Contract', ppm.contract, { description: ppm.contract }),
      mk('Instruction', ppm.instruction, {
        description: ppm.instruction,
        searchTerms: [/fire\s+doors?/i.test(clean(ppm.instruction)) ? 'fire doors' : clean(ppm.instruction).split(/\s+/).slice(0, 2).join(' '), ppm.instruction]
      }),
      mk('Priority', ppm.priority, { description: ppm.priority }),
      mk('Shift', ppm.shift, { description: ppm.shift }),
      mk('Compliance', ppm.compliance, { description: ppm.compliance }),
      mk('Cost Code', ppm.costCode, { description: ppm.costCode }),
      mk('Cost Centre', ppm.costCentre, { ...splitLookupValue(ppm.costCentre), description: splitLookupValue(ppm.costCentre).description })
    ].filter((item) => clean(item.value));
  }

  root.pages = root.pages || {};
  root.pages.ppmMappings = Object.freeze({ ppmDirectMapping, ppmLookupMapping });
})();
