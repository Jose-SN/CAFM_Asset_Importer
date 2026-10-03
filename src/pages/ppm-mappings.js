(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean } = root.core.text;
  const { makeLookupSpec, splitLookupValue } = root.core.lookupSpec;

  function ppmDirectMapping(ppm) {
    return [
      { kind: 'text', label: ['Family'], value: ppm.family },
      { kind: 'text', label: ['Stock Cost'], value: ppm.stockCost },
      { kind: 'text', label: ['Labour Cost'], value: ppm.labourCost },
      { kind: 'text', label: ['Est. Staff', 'Est Staff'], value: ppm.estStaff },
      { kind: 'checkbox', label: ['Permit'], value: ppm.permit },
      { kind: 'checkbox', label: ['H & S Task', 'H&S Task'], value: ppm.healthSafetyTask },
      { kind: 'checkbox', label: ['Controller'], value: ppm.controller },
      { kind: 'select', label: ['Class'], value: ppm.classValue },
      { kind: 'checkbox', label: ['Action before Task complete'], value: ppm.actionBeforeComplete },
      { kind: 'checkbox', label: ['Action before Task sign off'], value: ppm.actionBeforeSignoff },
      { kind: 'select', label: ['Generate Task Actions'], value: ppm.generateTaskActions },
      { kind: 'text', label: ['Last Service'], value: ppm.lastService },
      { kind: 'text', label: ['Next Service'], value: ppm.nextService },
      { kind: 'select', label: ['Default Day'], value: ppm.defaultDay },
      { kind: 'text', label: ['Period'], value: ppm.period },
      { kind: 'select', label: ['Frequency'], value: ppm.frequency }
    ];
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
