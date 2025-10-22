import { Routes, Route, Navigate } from "react-router-dom";
import Conexao from "./pages/whatsapp/Conexao";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/whatsapp/conexao" replace />} />
      <Route path="/whatsapp/conexao" element={<Conexao />} />
    </Routes>
  );
}
