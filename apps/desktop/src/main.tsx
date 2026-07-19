import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { PrintView } from "./PrintView.js";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const isPrintView = params.get("print") === "1";
const printFolder = params.get("folder");
const printFile = params.get("file");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isPrintView && printFolder && printFile ? (
      <PrintView folderPath={printFolder} filePath={printFile} />
    ) : (
      <App />
    )}
  </StrictMode>
);
