import { c as createFlowDiagram, s as styles_default } from "./flowDiagram-23GEKE2U-CLwQ8Q7_.js";
import { _ as __name } from "./index-BasOqtc3.js";
import "./chunk-5VM5RSS4-tTNUubKZ.js";
import "./chunk-XXDRQBXY-I4OEYSpy.js";
import "./chunk-VR4S4FIN-BztHF4y-.js";
import "./chunk-32BRIVSS-Bmrbha2U.js";
import "./channel-DlRTI84W.js";
import "./index-BiRXvjOt.js";
var getStyles = /* @__PURE__ */ __name((options) => `${styles_default(options)}
  .swimlane.cluster rect {
    stroke: ${options.clusterBorder} !important;
  }
  [data-look="neo"].cluster rect {
    filter: none;
  }
`, "getStyles");
var styles_default2 = getStyles;
var diagram = createFlowDiagram({ defaultLayout: "swimlane", styles: styles_default2 });
export {
  diagram
};
