import { BrowserRouter, Routes, Route } from "react-router-dom";

import HomePage from "./pages/HomePage";
import MeetingPage from "./pages/MeetingPage";

function App() {

  return (
    <BrowserRouter>

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/room/:roomId" element={<MeetingPage />} />
      </Routes>

    </BrowserRouter>
  );
}

export default App;