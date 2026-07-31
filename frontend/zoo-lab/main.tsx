import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ZooLab } from "./ZooLab";
import "./zoo.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ZooLab />
  </StrictMode>
);
