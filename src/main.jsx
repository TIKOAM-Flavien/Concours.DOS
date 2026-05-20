import React from "react";
import ReactDOM from "react-dom/client";

import App from "./app/App";
import "./styles/base.css";
import "./styles/shared.css";
import "./styles/portal.css";
import "./styles/admin.css";
import "./styles/responsive.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
