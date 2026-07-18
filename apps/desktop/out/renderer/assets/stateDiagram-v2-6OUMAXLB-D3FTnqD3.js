import { s as styles_default, b as stateRenderer_v3_unified_default, a as stateDiagram_default, S as StateDB } from "./chunk-EX3LRPZG-DEW6w-2E.js";
import { _ as __name } from "./index-BasOqtc3.js";
import "./chunk-XXDRQBXY-I4OEYSpy.js";
import "./chunk-VR4S4FIN-BztHF4y-.js";
import "./chunk-32BRIVSS-Bmrbha2U.js";
import "./index-BiRXvjOt.js";
var diagram = {
  parser: stateDiagram_default,
  get db() {
    return new StateDB(2);
  },
  renderer: stateRenderer_v3_unified_default,
  styles: styles_default,
  init: /* @__PURE__ */ __name((cnf) => {
    if (!cnf.state) {
      cnf.state = {};
    }
    cnf.state.arrowMarkerAbsolute = cnf.arrowMarkerAbsolute;
  }, "init")
};
export {
  diagram
};
