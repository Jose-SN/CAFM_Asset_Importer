(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  root.runtime = {
    _bindings: null,
    bind(bindings) {
      this._bindings = bindings;
    },
    get b() {
      if (!this._bindings) throw new Error('CAFMImporter runtime is not bound yet.');
      return this._bindings;
    }
  };
})();
