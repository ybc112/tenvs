import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { WalletProvider } from "./wallet";
import { ToastProvider } from "./components/Toast";
import { Nav } from "./components/Nav";
import { Footer } from "./components/Footer";
import Home from "./pages/Home";
import Launch from "./pages/Launch";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <WalletProvider>
      <ToastProvider>
        <ScrollTop />
        <Nav />
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/launch" element={<Launch />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/project/:address" element={<ProjectDetail />} />
          </Routes>
        </main>
        <Footer />
      </ToastProvider>
    </WalletProvider>
  );
}