import { useState } from "react";
import { useNavigate } from "react-router-dom";

function HomePage() {
  const navigate = useNavigate();

  // Load last used username from localStorage if available
  const [username, setUsername] = useState(localStorage.getItem("username") || "");
  const [roomIdInput, setRoomIdInput] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [roomError, setRoomError] = useState("");

  function saveUsername(name) {
    const trimmed = name.trim();
    setUsername(trimmed);
    localStorage.setItem("username", trimmed);
    if (trimmed) {
      setUsernameError("");
    }
  }

  function handleCreateMeeting() {
    if (!username.trim()) {
      setUsernameError("Please enter a username to proceed.");
      return;
    }
    const newRoomId = Math.random().toString(36).substring(2, 10);
    navigate(`/room/${newRoomId}`);
  }

  function handleJoinMeeting(e) {
    e.preventDefault();
    let hasError = false;
    if (!username.trim()) {
      setUsernameError("Please enter a username to proceed.");
      hasError = true;
    }
    if (!roomIdInput.trim()) {
      setRoomError("Please enter a valid Room ID to join.");
      hasError = true;
    }
    if (hasError) return;

    navigate(`/room/${roomIdInput.trim().toLowerCase()}`);
  }

  return (
    <div className="home">
      <div className="card">
        <h1>Live Call</h1>
        <p>Premium real-time video meetings</p>

        <div className="lobby-form">
          {/* Username Input */}
          <div className="input-group">
            <label htmlFor="username" className="input-label">Your Name</label>
            <input
              type="text"
              id="username"
              placeholder="e.g. KarthikP-Mac"
              value={username}
              onChange={(e) => saveUsername(e.target.value)}
              className="lobby-input"
              maxLength={20}
              autoComplete="off"
              title="Enter your name (max 20 characters) to join or create a meeting"
            />
          </div>

          {usernameError && (
            <div className="error-message">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="error-icon">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" x2="12" y1="8" y2="12" />
                <line x1="12" x2="12.01" y1="16" y2="16" />
              </svg>
              <span>{usernameError}</span>
            </div>
          )}

          <div className="lobby-divider">
            <span className="divider-text">Create or Join</span>
          </div>

          {/* Option A: Create Meeting */}
          <button onClick={handleCreateMeeting} className="btn-primary-glow">
            Start a New Meeting
          </button>

          <div className="lobby-divider">
            <span className="divider-text">or enter a code</span>
          </div>

          {/* Option B: Join Meeting by Room ID */}
          <form onSubmit={handleJoinMeeting} className="join-form">
            <input
              type="text"
              placeholder="Enter Room ID"
              title="Enter the Room ID you wish to join"
              autoComplete="off"
              value={roomIdInput}
              onChange={(e) => {
                setRoomIdInput(e.target.value);
                if (e.target.value.trim()) setRoomError("");
              }}
              className="lobby-input room-code-input"
            />
            {roomError && (
              <div className="error-message" style={{ marginTop: "4px" }}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="error-icon">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" x2="12" y1="8" y2="12" />
                  <line x1="12" x2="12.01" y1="16" y2="16" />
                </svg>
                <span>{roomError}</span>
              </div>
            )}
            <button type="submit" className="btn-secondary-glow">
              Join Room
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default HomePage;