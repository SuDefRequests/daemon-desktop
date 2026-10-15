import { useEffect, useRef, useState } from "react";
import AnimatedMenu from "./AnimatedMenu";
import {
  ArrowUp,
  ArrowRight,
  Plus,
  Home,
  Folder,
  Smartphone,
  Settings,
  MessageSquare,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  Check,
  Box,
  Code2,
  FileText,
  Presentation,
  Table2,
  Sparkles,
  Lightbulb,
  CalendarDays,
  Brain,
  X,
  Pencil,
  Trash2,
  MoreHorizontal,
  Download,
  ExternalLink,
  FolderOpen,
  AlertCircle,
  LoaderCircle,
} from "lucide-react";
import type {
  Artifact,
  Conversation,
  Task,
  Workspace,
  InferenceProvider,
} from "./types";
import {
  emptyWorkspace,
  loadWorkspace,
  saveWorkspace,
  saveArtifact,
  downloadArtifact,
} from "./storage";
import { configuredProvider, createProvider } from "./inference";
import { models, thinkingModes, type ThinkingMode } from "./preferences";

type View = "home" | "chat" | "files" | "device" | "settings";
const cards = [
  {
    task: "code" as Task,
    title: "Write code",
    description: "Create, debug and save Python scripts",
    icon: Code2,
    color: "blue",
    prompt: "Write Python code to ",
  },
  {
    task: "document" as Task,
    title: "Draft a document",
    description: "Turn ideas into structured text",
    icon: FileText,
    color: "green",
    prompt: "Draft a document about ",
  },
  {
    task: "presentation" as Task,
    title: "Make a presentation",
    description: "Shape your ideas into a slide outline",
    icon: Presentation,
    color: "purple",
    prompt: "Create a presentation about ",
  },
  {
    task: "spreadsheet" as Task,
    title: "Create a spreadsheet",
    description: "Organize your data in a CSV file",
    icon: Table2,
    color: "amber",
    prompt: "Create a spreadsheet for ",
  },
];
const quick = [
  { title: "Notes", icon: FileText, prompt: "Write notes about " },
  { title: "Summarize", icon: Sparkles, prompt: "Summarize this text: " },
  { title: "Explain", icon: Lightbulb, prompt: "Explain " },
  { title: "Plan", icon: CalendarDays, prompt: "Help me plan " },
  { title: "Brainstorm", icon: Brain, prompt: "Brainstorm ideas for " },
];
const uid = () => crypto.randomUUID();
export default function App() {
  const [provider, setProvider] = useState<InferenceProvider>(() =>
    createProvider("mock"),
  );
  const [selectedModel, setSelectedModel] = useState(models[0].id);
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>("Low");
  const [thinkingMenu, setThinkingMenu] = useState(false);
  const isMock = provider.mode === "mock";
  const deviceLabel = isMock
    ? "Device disconnected"
    : "Phone connection unverified";
  const [data, setData] = useState<Workspace>(emptyWorkspace),
    [ready, setReady] = useState(false),
    [view, setView] = useState<View>("home"),
    [active, setActive] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(""),
    [task, setTask] = useState<Task>("chat"),
    [busy, setBusy] = useState(false),
    [modelMenu, setModelMenu] = useState(false),
    [collapsed, setCollapsed] = useState(() => window.innerWidth < 850),
    [search, setSearch] = useState("");
  const [notice, setNotice] = useState<{
      text: string;
      error: boolean;
      id: string;
    } | null>(null),
    [preview, setPreview] = useState<Artifact | null>(null),
    [action, setAction] = useState<{
      kind: "rename" | "delete";
      chat: Conversation;
    } | null>(null),
    [rename, setRename] = useState(""),
    [menu, setMenu] = useState<string | null>(null),
    [directory, setDirectory] = useState(
      "Browser storage · download files to save a copy",
    );
  const textRef = useRef<HTMLTextAreaElement>(null),
    dataRef = useRef(data),
    saveQueue = useRef<Promise<unknown>>(Promise.resolve()),
    animatedMessages = useRef(new Set<string>()),
    messagesEnd = useRef<HTMLDivElement>(null);
  function notify(text: string, error = false) {
    setNotice({ text, error, id: uid() });
  }
  function commit(next: Workspace) {
    dataRef.current = next;
    setData(next);
    saveQueue.current = saveQueue.current
      .catch(() => {})
      .then(async () => {
        await saveWorkspace(next);
        return true;
      })
      .catch((e) => {
        notify(`Could not save history: ${e.message}`, true);
        return false;
      });
    return saveQueue.current;
  }
  useEffect(() => {
    Promise.all([loadWorkspace(), configuredProvider()])
      .then(([d, configured]) => {
        setProvider(configured);
        dataRef.current = d;
        setData(d);
        setReady(true);
      })
      .catch((e) =>
        notify(
          `Could not load history or inference configuration: ${e.message}. Restart after repairing the saved workspace.`,
          true,
        ),
      );
    window.daemon
      ?.getOutputDirectory()
      .then(setDirectory)
      .catch((e) => notify(e.message, true));
  }, []);
  useEffect(() => {
    if (!action && !preview) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const controls = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, textarea, [tabindex="0"]',
        ),
      );
    (dialog.querySelector<HTMLElement>("input") || controls()[0])?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = controls();
      const first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      if (previous?.isConnected) previous.focus();
    };
  }, [action, preview]);
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [data, busy, view]);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setModelMenu(false);
        setThinkingMenu(false);
        setPreview(null);
        setAction(null);
        setMenu(null);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  const conversation = data.conversations.find((c) => c.id === active);
  function newChat() {
    setActive(null);
    setView("home");
    setPrompt("");
    setTask("chat");
    textRef.current?.focus();
  }
  function prepare(value: string, kind: Task = "chat") {
    setPrompt(value);
    setTask(kind);
    textRef.current?.focus();
  }
  async function send() {
    const content = prompt.trim();
    if (!content || busy || !ready) return;
    const now = new Date().toISOString(),
      id = active || uid();
    const chat = dataRef.current.conversations.find((c) => c.id === id) || {
      id,
      title: content.slice(0, 45),
      updatedAt: now,
      messages: [],
    };
    const userMessageId = uid();
    animatedMessages.current.add(userMessageId);
    const updated = {
      ...chat,
      updatedAt: now,
      messages: [
        ...chat.messages,
        {
          id: userMessageId,
          role: "user" as const,
          content,
          createdAt: now,
          source: provider.mode,
        },
      ],
    };
    commit({
      ...dataRef.current,
      conversations: [
        updated,
        ...dataRef.current.conversations.filter((c) => c.id !== id),
      ],
    });
    setActive(id);
    setView("chat");
    setPrompt("");
    setBusy(true);
    setModelMenu(false);
    try {
      const result = await provider.generate({
        prompt: content,
        task,
      });
      let artifact: Artifact | undefined;
      if (result.file) {
        artifact = await saveArtifact(
          {
            id: uid(),
            conversationId: id,
            name: result.file.name,
            kind: result.file.kind,
            source: provider.mode,
            content: result.file.content,
            createdAt: new Date().toISOString(),
          },
          dataRef.current.artifacts,
        );
      }
      const current = dataRef.current;
      const assistantMessageId = uid();
      animatedMessages.current.add(assistantMessageId);
      const persisted = await commit({
        ...current,
        artifacts: artifact
          ? [artifact, ...current.artifacts]
          : current.artifacts,
        conversations: current.conversations.map((c) =>
          c.id === id
            ? {
                ...c,
                updatedAt: new Date().toISOString(),
                messages: [
                  ...c.messages,
                  {
                    id: assistantMessageId,
                    role: "assistant",
                    source: provider.mode,
                    content: result.reply,
                    createdAt: new Date().toISOString(),
                    artifactId: artifact?.id,
                  },
                ],
              }
            : c,
        ),
      });
      if (artifact && persisted)
        notify(
          window.daemon
            ? `Saved ${artifact.name} to your output directory.`
            : `Saved ${artifact.name} in browser storage. Download to save a copy.`,
        );
    } catch (e) {
      notify(
        `Request failed: ${(e as Error).message}. Your prompt is retained in the conversation.`,
        true,
      );
      setPrompt(content);
    } finally {
      setBusy(false);
      setTask("chat");
    }
  }
  async function fileAction(a: Artifact, kind: "open" | "reveal" | "download") {
    try {
      if (kind === "download") downloadArtifact(a);
      else if (window.daemon) {
        if (kind === "open") await window.daemon.openArtifact(a.id);
        else await window.daemon.revealArtifact(a.id);
      }
    } catch (e) {
      notify((e as Error).message, true);
    }
  }
  function confirmAction() {
    if (!action) return;
    if (action.kind === "rename") {
      if (!rename.trim()) return;
      commit({
        ...dataRef.current,
        conversations: dataRef.current.conversations.map((c) =>
          c.id === action.chat.id
            ? { ...c, title: rename.trim().slice(0, 100) }
            : c,
        ),
      });
    } else {
      commit({
        ...dataRef.current,
        conversations: dataRef.current.conversations.filter(
          (c) => c.id !== action.chat.id,
        ),
      });
      if (active === action.chat.id) newChat();
      notify("Conversation deleted. Your files are preserved.");
    }
    setAction(null);
  }
  const composer = (
    <div className="composer">
      <textarea
        ref={textRef}
        maxLength={12000}
        aria-label="Your prompt"
        placeholder="Ask VIDUR AI to create something…"
        value={prompt}
        disabled={busy || !ready}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <div className="composer-toolbar">
        <div className="model-wrap">
          <button
            className="model-button"
            aria-expanded={modelMenu}
            aria-label="Select model"
            title="Demo selection only; backend model unchanged"
            onClick={() => {
              setModelMenu(!modelMenu);
              setThinkingMenu(false);
            }}
          >
            <Box size={17} />
            <span>{models.find((m) => m.id === selectedModel)?.name}</span>
            <ChevronDown size={15} />
          </button>
          {modelMenu && (
            <button
              className="dropdown-backdrop"
              aria-label="Close model menu"
              onClick={() => setModelMenu(false)}
            />
          )}
          <AnimatedMenu open={modelMenu} className="model-menu">
            <p className="eyebrow">MODEL DEMONSTRATION</p>
            {models.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setSelectedModel(m.id);
                  setModelMenu(false);
                }}
              >
                <Check
                  size={17}
                  style={{
                    visibility: selectedModel === m.id ? "visible" : "hidden",
                  }}
                />
                <span>
                  {m.name} — {m.configured ? "Local" : "Demo option"}
                  <small>{m.description}</small>
                </span>
              </button>
            ))}
            <div className="menu-note">
              Demo setting only · does not switch the actual model
            </div>
          </AnimatedMenu>
        </div>
        <div className="model-wrap">
          <button
            className="thinking-button"
            aria-label="Thinking mode"
            title="Thinking mode is a UI preference only"
            aria-expanded={thinkingMenu}
            onClick={() => {
              setThinkingMenu(!thinkingMenu);
              setModelMenu(false);
            }}
          >
            <Brain size={16} />
            <span>{thinkingMode}</span>
            <ChevronDown size={14} />
          </button>
          {thinkingMenu && (
            <button
              className="dropdown-backdrop"
              aria-label="Close thinking menu"
              onClick={() => setThinkingMenu(false)}
            />
          )}
          <AnimatedMenu
            open={thinkingMenu}
            className="model-menu thinking-menu"
          >
            <p className="eyebrow">THINKING · UI PREFERENCE ONLY</p>
            {thinkingModes.map((mode) => (
              <button
                key={mode}
                onClick={() => {
                  setThinkingMode(mode);
                  setThinkingMenu(false);
                }}
              >
                <Check
                  size={16}
                  style={{
                    visibility: thinkingMode === mode ? "visible" : "hidden",
                  }}
                />
                <span>{mode}</span>
              </button>
            ))}
            <div className="menu-note">
              Not sent to Python · does not change reasoning
            </div>
          </AnimatedMenu>
        </div>
        <span className="composer-hint">Demo settings · UI only</span>
        <button
          className="send"
          aria-label="Send prompt"
          onClick={() => void send()}
          disabled={!prompt.trim() || busy || !ready}
        >
          {busy ? (
            <LoaderCircle className="spin" size={20} />
          ) : (
            <ArrowUp size={22} />
          )}
        </button>
      </div>
    </div>
  );
  const fileButtons = (a: Artifact) => (
    <div className="file-actions">
      <button onClick={() => setPreview(a)}>
        <FileText size={15} />
        Preview
      </button>
      {!window.daemon && (
        <button onClick={() => void fileAction(a, "download")}>
          <Download size={15} />
          Download
        </button>
      )}
      {window.daemon && (
        <>
          <button
            disabled={a.name.endsWith(".py")}
            title={
              a.name.endsWith(".py")
                ? "Use Preview or Show in folder. System associations can execute Python."
                : "Open with the default application"
            }
            onClick={() => void fileAction(a, "open")}
          >
            <ExternalLink size={15} />
            Open file
          </button>
          <button onClick={() => void fileAction(a, "reveal")}>
            <FolderOpen size={15} />
            Show in folder
          </button>
        </>
      )}
    </div>
  );
  return (
    <div className={`app ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <img src="./daemon-logo.svg" alt="" />
          <span>VIDUR AI</span>
          <button
            className="icon-button sidebar-toggle"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <PanelLeftOpen size={19} />
            ) : (
              <PanelLeftClose size={19} />
            )}
          </button>
        </div>
        <button className="new-chat" onClick={newChat}>
          <Plus size={20} />
          <span>New chat</span>
        </button>
        <nav>
          {(
            [
              { id: "home", label: "Home", icon: Home },
              { id: "files", label: "My files", icon: Folder },
              { id: "device", label: "Device & model", icon: Smartphone },
              { id: "settings", label: "Settings", icon: Settings },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              title={item.label}
              className={view === item.id ? "selected" : ""}
              onClick={() => {
                setView(item.id);
                setMenu(null);
              }}
            >
              <item.icon size={20} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="recent">
          <div className="recent-heading">
            <span>Recent conversations</span>
            <Search size={15} />
          </div>
          <input
            aria-label="Search conversations"
            placeholder="Search conversations"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="chat-list">
            {data.conversations
              .filter((c) =>
                c.title.toLowerCase().includes(search.toLowerCase()),
              )
              .map((c) => (
                <div
                  className={`chat-row ${active === c.id && view === "chat" ? "active" : ""}`}
                  key={c.id}
                >
                  <button
                    className="chat-select"
                    title={c.title}
                    onClick={() => {
                      setActive(c.id);
                      setView("chat");
                      setTask("chat");
                      setMenu(null);
                    }}
                  >
                    <MessageSquare size={17} />
                    <span>{c.title}</span>
                  </button>
                  <button
                    className="icon-button chat-more"
                    aria-label={`Actions for ${c.title}`}
                    onClick={() => setMenu(menu === c.id ? null : c.id)}
                  >
                    <MoreHorizontal size={17} />
                  </button>
                  <AnimatedMenu open={menu === c.id} className="chat-menu">
                    <button
                      onClick={() => {
                        setAction({ kind: "rename", chat: c });
                        setRename(c.title);
                        setMenu(null);
                      }}
                    >
                      <Pencil size={14} />
                      Rename
                    </button>
                    <button
                      onClick={() => {
                        setAction({ kind: "delete", chat: c });
                        setMenu(null);
                      }}
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </AnimatedMenu>
                </div>
              ))}
            {!data.conversations.length && (
              <div className="empty-recent">
                A fresh start.
                <br />
                Your conversations will appear here.
              </div>
            )}
            {data.conversations.length > 0 &&
              !data.conversations.some((c) =>
                c.title.toLowerCase().includes(search.toLowerCase()),
              ) && (
                <div className="empty-recent">No matching conversations.</div>
              )}
          </div>
        </div>
        <button className="sidebar-status" onClick={() => setView("device")}>
          <span className="status-dot" />
          <Smartphone size={23} />
          <span>
            {deviceLabel}
            <small>
              {isMock ? "Mock mode available" : "Android provider selected"}
            </small>
          </span>
          <ArrowRight size={15} />
        </button>
      </aside>
      <main>
        <header className="topbar">
          <span className="breadcrumb">
            Workspace <span>/</span>{" "}
            {view === "chat"
              ? "Conversation"
              : view === "files"
                ? "My files"
                : view === "device"
                  ? "Device & model"
                  : view === "settings"
                    ? "Settings"
                    : "Home"}
          </span>
          <button className="connection-pill" onClick={() => setView("device")}>
            <span className="status-dot" />
            <span>{deviceLabel}</span>
            <span className="mock-tag">
              {isMock ? "MOCK MODE" : "ANDROID PROVIDER"}
            </span>
          </button>
        </header>
        {view === "home" && (
          <div className="home-content">
            <div className="welcome">
              <img
                className="hero-logo"
                src="./daemon-logo.svg"
                alt="DAEMON logo"
              />
              <span className="eyebrow">YOUR IDEAS. YOUR DEVICE.</span>
              <h1>VIDUR AI</h1>
              <h2>Your local AI workstation</h2>
              <p>
                Create, automate and get things done, powered by your device.
              </p>
            </div>
            {composer}
            <div className="cards">
              {cards.map((c) => (
                <button
                  className="productivity-card"
                  key={c.task}
                  onClick={() => prepare(c.prompt, c.task)}
                >
                  <span className={`card-icon ${c.color}`}>
                    <c.icon size={27} />
                  </span>
                  <h3>{c.title}</h3>
                  <p>{c.description}</p>
                  <span className="card-arrow">
                    <ArrowRight size={18} />
                  </span>
                </button>
              ))}
            </div>
            <div className="quick-tools">
              <div className="section-label">
                Quick tools<span>A little help to get started</span>
              </div>
              <div className="quick-grid">
                {quick.map((q) => (
                  <button
                    key={q.title}
                    onClick={() =>
                      prepare(
                        q.prompt,
                        q.title === "Notes" ? "document" : "chat",
                      )
                    }
                  >
                    <q.icon size={19} />
                    {q.title}
                  </button>
                ))}
              </div>
            </div>
            <div className="home-footnote">
              <span className="tiny-dot" />
              Private workspace · History stays on this device
              <span>
                {isMock
                  ? "Prototype with mock responses"
                  : "Android provider · setup required"}
              </span>
            </div>
          </div>
        )}
        {view === "chat" && (
          <div className="conversation">
            <div className="conversation-title">
              <h2>{conversation?.title || "New conversation"}</h2>
              <span className="badge">
                {isMock ? "Mock responses" : "Android provider"}
              </span>
            </div>
            <div className="messages">
              {conversation?.messages.map((m) => (
                <article
                  key={m.id}
                  className={`message ${m.role} ${animatedMessages.current.has(m.id) ? "message-new" : ""}`}
                  onAnimationEnd={(event) => {
                    if (event.target === event.currentTarget)
                      animatedMessages.current.delete(m.id);
                  }}
                >
                  <div className="message-avatar">
                    {m.role === "assistant" ? (
                      <img src="./daemon-logo.svg" alt="" />
                    ) : (
                      "You"
                    )}
                  </div>
                  <div className="message-body">
                    <div className="message-label">
                      {m.role === "assistant" ? "VIDUR AI" : "You"}
                      <time>
                        {new Date(m.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    <p>{m.content}</p>
                    {m.artifactId &&
                      (() => {
                        const a = data.artifacts.find(
                          (a) => a.id === m.artifactId,
                        );
                        return a ? (
                          <div className="artifact-inline">
                            <FileText size={22} />
                            <div>
                              <strong>{a.name}</strong>
                              <small>
                                {a.source === "android"
                                  ? "Brain artifact"
                                  : "Sample artifact"}{" "}
                                · {a.content.length.toLocaleString()} characters
                              </small>
                              {fileButtons(a)}
                            </div>
                          </div>
                        ) : null;
                      })()}
                  </div>
                </article>
              ))}
              {busy && (
                <div className="loading" role="status" aria-live="polite">
                  <LoaderCircle size={17} className="spin" />
                  {isMock
                    ? "Preparing a mock response…"
                    : "Waiting for the Android brain…"}
                </div>
              )}
              <div ref={messagesEnd} />
            </div>
            <div className="chat-composer">
              {composer}
              <p className="composer-disclaimer">
                {isMock
                  ? "Mock mode. No request is sent to the device."
                  : "Requests use the Android brain. Model and thinking controls are UI-only."}
              </p>
            </div>
          </div>
        )}
        {view === "files" && (
          <section className="page-content">
            <span className="eyebrow">YOUR WORK, IN ONE PLACE</span>
            <h1>My files</h1>
            <p className="page-subtitle">
              Artifacts created in your conversations. Kept separately from chat
              history.
            </p>
            <div className="library-summary">
              <Folder size={20} />
              <span>
                {data.artifacts.length}{" "}
                {data.artifacts.length === 1 ? "file" : "files"} in your
                workspace
              </span>
              <span className="badge">
                {window.daemon ? "Saved on disk" : "Browser storage"}
              </span>
            </div>
            {!data.artifacts.length ? (
              <div className="empty-state">
                <FolderOpen size={42} />
                <h2>Make something yours.</h2>
                <p>
                  Create a file with a productivity card.
                  <br />
                  Your files will be ready to preview here.
                </p>
                <button
                  className="primary-button"
                  onClick={() => setView("home")}
                >
                  Start creating <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              <div className="file-grid">
                {data.artifacts.map((a) => (
                  <article className="file-card" key={a.id}>
                    <div
                      className={`card-icon ${cards.find((c) => c.task === a.kind)?.color || "blue"}`}
                    >
                      <FileText size={24} />
                    </div>
                    <h3>{a.name}</h3>
                    <p>
                      {new Date(a.createdAt).toLocaleDateString()} ·{" "}
                      {a.source === "android" ? "Brain output" : "Mock example"}
                    </p>
                    <small className="file-path">
                      {a.path || "Stored locally in this browser"}
                    </small>
                    {fileButtons(a)}
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
        {view === "device" && (
          <section className="page-content">
            <span className="eyebrow">LOCAL BY DESIGN</span>
            <h1>Device & model</h1>
            <p className="page-subtitle">
              A clear view of your local inference setup.
            </p>
            <div className="settings-panel">
              <div className="panel-heading">
                <Smartphone size={25} />
                <div>
                  <h3>{deviceLabel}</h3>
                  <p>
                    {isMock
                      ? "Mock mode is active; the phone is not used."
                      : "USB forwarding and phone services must be configured separately."}
                  </p>
                </div>
                <span className="badge">{isMock ? "mock" : "unverified"}</span>
              </div>
              <div className="info-row">
                <span>Inference status</span>
                <strong>
                  {isMock
                    ? "Local model unavailable"
                    : "Phone inference not independently verified"}
                </strong>
              </div>
              <div className="info-row">
                <span>Expected backend model</span>
                <strong>{models[0].name} · not detected</strong>
              </div>
              <div className="info-row">
                <span>Active provider</span>
                <strong>
                  {isMock ? "Mock responses" : "Android Python brain"}
                </strong>
              </div>
              <div className="panel-note">
                <AlertCircle size={18} />
                <p>
                  {isMock
                    ? "Mock mode does not contact the device."
                    : "Android mode sends prompts through the existing Python brain. Provider selection and ADB forwarding do not prove a phone is connected."}{" "}
                  The Python scripts remain unchanged. Model and thinking
                  selectors are demonstrations; they do not alter the backend.
                </p>
              </div>
            </div>
          </section>
        )}
        {view === "settings" && (
          <section className="page-content">
            <span className="eyebrow">MAKE IT YOUR WORKSPACE</span>
            <h1>Settings</h1>
            <p className="page-subtitle">
              Simple defaults. Local storage. Your choice of output folder.
            </p>
            <div className="settings-panel">
              <h3>Generated files</h3>
              <p>
                New artifacts will be saved to this directory. Existing files
                stay in their original location.
              </p>
              <div className="directory">
                <FolderOpen size={20} />
                <span>{directory}</span>
              </div>
              <button
                className="secondary-button"
                disabled={!window.daemon}
                onClick={async () => {
                  try {
                    const dir = await window.daemon?.chooseOutputDirectory();
                    if (dir) {
                      setDirectory(dir);
                      notify("Output directory updated.");
                    }
                  } catch (e) {
                    notify((e as Error).message, true);
                  }
                }}
              >
                Choose output directory
              </button>
              {!window.daemon && (
                <p className="browser-note">
                  Directory selection, open-file and show-in-folder are
                  available in Electron. Use Download in browser preview.
                </p>
              )}
            </div>
            <div className="settings-panel">
              <h3>About this prototype</h3>
              <div className="info-row">
                <span>Provider</span>
                <strong>
                  {isMock
                    ? "Mock · no device connection"
                    : "Android · connection unverified"}
                </strong>
              </div>
              <div className="info-row">
                <span>History</span>
                <strong>
                  {window.daemon
                    ? "Local application data"
                    : "Browser local storage"}
                </strong>
              </div>
              <div className="info-row">
                <span>Appearance</span>
                <strong>Charcoal</strong>
              </div>
            </div>
          </section>
        )}
      </main>
      {notice && (
        <div
          key={notice.id}
          className={`toast ${notice.error ? "error" : "success"}`}
          role={notice.error ? "alert" : "status"}
        >
          {notice.error ? <AlertCircle size={18} /> : <Check size={18} />}
          <span>{notice.text}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {(action || preview) && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setAction(null);
            setPreview(null);
          }}
        >
          <section
            className={`modal ${preview ? "preview-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              preview
                ? `Preview ${preview.name}`
                : action?.kind === "rename"
                  ? "Rename conversation"
                  : "Delete conversation"
            }
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon-button modal-close"
              aria-label="Close dialog"
              onClick={() => {
                setAction(null);
                setPreview(null);
              }}
            >
              <X size={20} />
            </button>
            {preview ? (
              <>
                <span className="eyebrow">
                  FILE PREVIEW ·{" "}
                  {preview.source === "android"
                    ? "BRAIN OUTPUT"
                    : "MOCK EXAMPLE"}
                </span>
                <h2>{preview.name}</h2>
                <pre>{preview.content}</pre>
                {fileButtons(preview)}
              </>
            ) : (
              <>
                <h2>
                  {action?.kind === "rename"
                    ? "Rename conversation"
                    : "Delete conversation?"}
                </h2>
                {action?.kind === "rename" ? (
                  <input
                    autoFocus
                    aria-label="Conversation name"
                    value={rename}
                    maxLength={100}
                    onChange={(e) => setRename(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmAction();
                    }}
                  />
                ) : (
                  <p>
                    “{action?.chat.title}” will be permanently removed from your
                    history. Generated files will be kept.
                  </p>
                )}
                <div className="modal-actions">
                  <button
                    className="secondary-button"
                    onClick={() => setAction(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className={
                      action?.kind === "delete"
                        ? "danger-button"
                        : "primary-button"
                    }
                    disabled={action?.kind === "rename" && !rename.trim()}
                    onClick={confirmAction}
                  >
                    {action?.kind === "rename"
                      ? "Save name"
                      : "Delete conversation"}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
