import { s as styles_default, b as stateRenderer_v3_unified_default, a as stateDiagram_default, S as StateDB } from "./chunk-EX3LRPZG-DwgLIvT0.js";
import { _ as __name } from "./index-Dyjb4HE7.js";
import "./chunk-XXDRQBXY-BvqeU3u0.js";
import "./chunk-VR4S4FIN-Bv5wEH18.js";
import "./chunk-32BRIVSS-Y1LHmcVu.js";
import "./index-COPilJin.js";
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
