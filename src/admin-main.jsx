import React from "react";
import ReactDOM from "react-dom/client";

import AdminApp from "./app/AdminApp";
import "./styles/base.css";
import "./styles/shared.css";
import "./styles/admin.css";
import "./styles/responsive.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>
);
