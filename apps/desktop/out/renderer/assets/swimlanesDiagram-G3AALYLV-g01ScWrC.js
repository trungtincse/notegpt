import { c as createFlowDiagram, s as styles_default } from "./flowDiagram-23GEKE2U-D1g2L7bg.js";
import { _ as __name } from "./index-Dyjb4HE7.js";
import "./chunk-5VM5RSS4-DjmVZ-Oc.js";
import "./chunk-XXDRQBXY-BvqeU3u0.js";
import "./chunk-VR4S4FIN-Bv5wEH18.js";
import "./chunk-32BRIVSS-Y1LHmcVu.js";
import "./channel-B8y-wOJ-.js";
import "./index-COPilJin.js";
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
