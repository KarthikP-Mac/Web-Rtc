import React from "react";

function VideoPlayer({
  videoRef,
  username,
  isLocal,
  hasCamera,
  cameraEnabled,
  micEnabled,
  hasMic,
  connectionState,
}) {
  // If local: show placeholder if camera is missing or disabled
  // If remote: show placeholder if peer connection is not active
  const showPlaceholder = isLocal 
    ? (!hasCamera || !cameraEnabled) 
    : (connectionState !== "connected");

  // SVG Icons
  const MicIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="btn-icon">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );

  const MicOffIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="btn-icon">
      <line x1="2" x2="22" y1="2" y2="22" />
      <path d="M18.89 13.23A7.12 7.12 0 0 0 19 11v-1" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
      <path d="M15 9.34V5a3 3 0 0 0-5.94-.6" />
      <path d="M5 10v1a7 7 0 0 0 8 6.92" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );

  return (
    <div className="video-card">
      <div className="card-label">
        {isLocal ? `You (${username})` : username}
      </div>

      <video
        ref={videoRef}
        autoPlay
        muted={isLocal}
        playsInline
        className={`video-feed ${showPlaceholder ? "hidden" : ""}`}
      />

      {showPlaceholder && (
        isLocal ? (
          <div className="video-placeholder">
            <div className="avatar-orb">
              <span>{username.substring(0, 2).toUpperCase()}</span>
            </div>
            <div className="placeholder-label">
              {!hasCamera ? "Camera not found" : "Camera turned off"}
            </div>
          </div>
        ) : (
          <div className="video-placeholder remote-waiting">
            <div className="pulse-rings">
              <div className="ring ring1"></div>
              <div className="ring ring2"></div>
              <div className="ring ring3"></div>
            </div>
            <div className="avatar-orb loading">
              <span>{username.substring(0, 2).toUpperCase()}</span>
            </div>
            <div className="placeholder-label animate-pulse">
              {connectionState === "connecting"
                ? "Establishing peer connection..."
                : `Waiting for ${username} to connect...`}
            </div>
          </div>
        )
      )}

      {/* Mini mic state tag for local user */}
      {isLocal && (
        <div className="media-state-tag">
          {!micEnabled || !hasMic ? (
            <span className="mic-muted-badge">
              <MicOffIcon />
            </span>
          ) : (
            <span className="mic-active-badge">
              <MicIcon />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default VideoPlayer;
