import { useEffect } from "react";
import { BrowserRouter, MemoryRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";

// The single-file preview build uses MemoryRouter (the viewer does not forward hash URLs)
const Router = import.meta.env.VITE_MEMORY === "1" ? MemoryRouter : BrowserRouter;
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");
import { AnimatePresence, motion } from "framer-motion";
import { Nav, Footer, MobileNav } from "./components/Shell";
import { Toasts } from "./components/ui";
import { useTicker } from "./store";
import Home from "./pages/Home";
import Trade from "./pages/Trade";
import Earn from "./pages/Earn";
import Create from "./pages/Create";
import Portfolio from "./pages/Portfolio";
import TokenPage from "./pages/TokenPage";
import Docs from "./pages/Docs";
import Legal from "./pages/Legal";
import { StatusBanner } from "./components/WalletUI";
import { WelcomeGuide } from "./components/Welcome";

function Routed() {
  const loc = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [loc.pathname]);
  return (
    <AnimatePresence mode="wait">
      <motion.main
        className="overflow-x-clip"
        key={loc.pathname}
        initial={{ opacity: 0, filter: "blur(10px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, filter: "blur(10px)" }}
        transition={{ duration: 0.35 }}
      >
        <Routes location={loc}>
          <Route path="/" element={<Home />} />
          <Route path="/trade" element={<Trade />} />
          <Route path="/earn" element={<Earn />} />
          <Route path="/create" element={<Create />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/token/:addr" element={<TokenPage />} />
          <Route path="/setup" element={<Navigate to="/docs/contracts" replace />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/docs/:slug" element={<Docs />} />
          <Route path="/legal" element={<Legal />} />
          <Route path="/legal/:slug" element={<Legal />} />
        </Routes>
      </motion.main>
    </AnimatePresence>
  );
}

export default function App() {
  useTicker();
  return (
    <Router basename={basename}>
      <Nav />
      <StatusBanner />
      <Routed />
      <Footer />
      <MobileNav />
      <Toasts />
      <WelcomeGuide />
    </Router>
  );
}
