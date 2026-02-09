import { useState } from "react";

import ChatInterface from "./components/ChatInterface";

export default function App() {
  const [chatKey, setChatKey] = useState(0);
  const [chatHistory, setChatHistory] = useState<string[]>([
    "Financial risk related to supply...",
    "How does the Fed assess...",
  ]);
  const [activeChat, setActiveChat] = useState<string>("Financial risk related to supply...");

  function handlePromptLogged(prompt: string) {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return;
    }
    const title = trimmed.length > 32 ? `${trimmed.slice(0, 32)}...` : trimmed;
    setChatHistory((prev) => {
      const next = [title, ...prev.filter((item) => item !== title)];
      return next.slice(0, 10);
    });
    setActiveChat(title);
  }

  return (
    <main className="pi-layout">
      <aside className="pi-sidebar">
        <div className="pi-logo">Y</div>
        <nav className="pi-nav">
          <button
            className="pi-nav-item active"
            onClick={() => {
              setChatKey((prev) => prev + 1);
              setActiveChat("New Chat");
            }}
          >
            New Chat
          </button>
          <button className="pi-nav-item">Documents</button>
          <button className="pi-nav-item">Library</button>
        </nav>

        <div className="pi-sidebar-section">
          <div className="pi-sidebar-label">Chats</div>
          {chatHistory.map((item) => (
            <button
              key={item}
              className={`pi-chat-item ${activeChat === item ? "active" : ""}`}
              onClick={() => setActiveChat(item)}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="pi-sidebar-footer">
          <button className="pi-icon-btn" title="Settings">⚙</button>
          <button className="pi-icon-btn" title="Inbox">✉</button>
          <button className="pi-icon-btn" title="Help">⌘</button>
        </div>
      </aside>

      <section className="pi-main">
        <header className="pi-topbar">
          <div className="pi-topbar-left">
            <button className="pi-collapse-btn">▮</button>
            <span className="pi-chat-title">{activeChat}</span>
          </div>
          <div className="pi-topbar-right">
            <button className="pi-pill-btn">Contact Us</button>
            <button className="pi-pill-btn accent">Upgrade</button>
            <div className="pi-user-chip">Zul Hafiz</div>
          </div>
        </header>

        <div className="pi-canvas">
          <ChatInterface
            key={chatKey}
            onPromptLogged={handlePromptLogged}
          />
        </div>
      </section>
    </main>
  );
}
