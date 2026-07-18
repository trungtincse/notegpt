import { s as styles_default, c as classRenderer_v3_unified_default, a as classDiagram_default, C as ClassDB } from "./chunk-V7JOEXUC-BDBPu1KR.js";
import { _ as __name } from "./index-Dyjb4HE7.js";
import "./chunk-5VM5RSS4-DjmVZ-Oc.js";
import "./chunk-XXDRQBXY-BvqeU3u0.js";
import "./chunk-VR4S4FIN-Bv5wEH18.js";
import "./chunk-32BRIVSS-Y1LHmcVu.js";
import "./index-COPilJin.js";
var diagram = {
  parser: classDiagram_default,
  get db() {
    return new ClassDB();
  },
  renderer: classRenderer_v3_unified_default,
  styles: styles_default,
  init: /* @__PURE__ */ __name((cnf) => {
    if (!cnf.class) {
      cnf.class = {};
    }
    cnf.class.arrowMarkerAbsolute = cnf.arrowMarkerAbsolute;
  }, "init")
};
export {
  diagram
};
