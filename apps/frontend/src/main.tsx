import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import "./index.css";
import { ProcessesPage } from "./pages/processes-page";
import { ProcessPage } from "./pages/process-page";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <main className="mx-auto flex min-h-svh max-w-3xl flex-col gap-6 px-4 py-8">
        <Routes>
          <Route path="/" element={<ProcessesPage />} />
          <Route path="/processes/:id" element={<ProcessPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  </StrictMode>,
);
