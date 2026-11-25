import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { createFrontendApiClient } from "./api";
import { App } from "./App";
import { FiltersProvider } from "./state/filters";
import "./hero-utilities.css";
import "./dark-ui.css";
import "./hero.css";
import "./profile.css";
import "./ranking.css";
import "./admin.css";
import "./registration.css";

const isMock = import.meta.env.DEV && import.meta.env.VITE_LEADBOARD_API_MODE === "mock";
const api = createFrontendApiClient(isMock ? "mock" : "real");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <FiltersProvider>
        <App api={api} isMock={isMock} />
      </FiltersProvider>
    </BrowserRouter>
  </StrictMode>,
);
