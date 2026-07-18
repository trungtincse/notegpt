import { s as styles_default, c as classRenderer_v3_unified_default, a as classDiagram_default, C as ClassDB } from "./chunk-V7JOEXUC-B6kapXgb.js";
import { _ as __name } from "./index-BasOqtc3.js";
import "./chunk-5VM5RSS4-tTNUubKZ.js";
import "./chunk-XXDRQBXY-I4OEYSpy.js";
import "./chunk-VR4S4FIN-BztHF4y-.js";
import "./chunk-32BRIVSS-Bmrbha2U.js";
import "./index-BiRXvjOt.js";
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
