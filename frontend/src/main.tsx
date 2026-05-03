import React, { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Brain,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Loader2,
  Send,
  Server,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import "./styles.css";

type Role = "user" | "assistant";

interface Message {
  id: string;
  role: Role;
  content: string;
  images?: GeneratedImage[];
}

interface StreamEvent {
  id: string;
  messageId: string;
  type: string;
  title: string;
  detail: string;
  order: number;
}

interface GeneratedImage {
  title: string;
  description: string;
  imageUrl?: string;
}

interface ExamplePrompt {
  label: string;
  category: string;
  prompt: string;
  workflow?: Workflow;
}

interface GuidedExample {
  id: string;
  title: string;
  summary: string;
  prompts: [ExamplePrompt, ExamplePrompt];
}

type Workflow = "chat" | "financial";

interface ActiveGuide {
  flowId: string;
  stepIndex: number;
  status: "streaming" | "ready-next" | "complete";
  workflow: Workflow;
}

interface TutorialStep {
  title: string;
  body: string;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const TUTORIAL_STORAGE_KEY = "mcpChatTutorialDismissed";

const GUIDED_EXAMPLES: GuidedExample[] = [
  {
    id: "financial-full-analysis",
    title: "Financial analysis report",
    summary: "Run the skilled financial agents for a complete Traditional Chinese report.",
    prompts: [
      {
        label: "Full financial report",
        category: "Financial Agents",
        prompt: "完整分析 2330 台積電的財務體質與合理價。",
        workflow: "financial",
      },
      {
        label: "Six-way PE valuation",
        category: "Financial Agents",
        prompt: "估算 2330 的本益比合理價，並給我六種估值表。",
        workflow: "financial",
      },
    ],
  },
  {
    id: "arithmetic",
    title: "Arithmetic with memory",
    summary: "Run a calculation, then ask a follow-up that depends on the previous answer.",
    prompts: [
      {
        label: "Calculate an expression",
        category: "Arithmetic",
        prompt: "What is (18 + 24) * 3 divided by 7?",
      },
      {
        label: "Use the previous result",
        category: "Arithmetic",
        prompt: "Now add 6 to the previous answer using MCP tools.",
      },
    ],
  },
  {
    id: "stock-lookup",
    title: "Taiwan stock lookup",
    summary: "Look up company metadata, then check the realtime quote.",
    prompts: [
      {
        label: "Stock metadata",
        category: "Taiwan Stocks",
        prompt: "查詢 2330 台積電的股票基本資料。",
      },
      {
        label: "Realtime quote",
        category: "Taiwan Stocks",
        prompt: "查詢 2330 的即時股價資訊。",
      },
    ],
  },
  {
    id: "stock-analysis",
    title: "Taiwan stock analysis",
    summary: "Calculate a moving average, then ask for a Best Four Point signal.",
    prompts: [
      {
        label: "Moving average",
        category: "Taiwan Stocks",
        prompt: "計算 2330 最近收盤價的 5 日移動平均。",
      },
      {
        label: "Best Four Point",
        category: "Taiwan Stocks",
        prompt: "幫我分析 2330 的四大買賣點訊號。",
      },
    ],
  },
];

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: "Pick a guided example",
    body: "Click a sample question to submit it immediately through the chat stream.",
  },
  {
    title: "Watch the answer stream",
    body: "Assistant text appears directly in the chat bubble as the model responds.",
  },
  {
    title: "Review tool activity",
    body: "Specialist agents, tool calls, tool outputs, and reasoning events are grouped by round in the event history.",
  },
  {
    title: "Continue with the next prompt",
    body: "After the response completes, use the suggested second question to try a different MCP or financial-agent capability.",
  },
];

function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "Ask me to calculate something or look up a Taiwan stock. I will route work through FastMCP tools.",
    },
  ]);
  const [input, setInput] = useState("");
  const [currentEvent, setCurrentEvent] = useState<StreamEvent | null>(null);
  const [eventHistory, setEventHistory] = useState<StreamEvent[]>([]);
  const [collapsedRounds, setCollapsedRounds] = useState<Set<string>>(new Set());
  const [tutorialStep, setTutorialStep] = useState(0);
  const [showTutorial, setShowTutorial] = useState(() => localStorage.getItem(TUTORIAL_STORAGE_KEY) !== "true");
  const [activeGuide, setActiveGuide] = useState<ActiveGuide | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [status, setStatus] = useState("Ready");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const eventOrderRef = useRef(0);
  const streamingRef = useRef(false);
  const shouldShowStarters = !isStreaming;
  const activeExample = activeGuide ? GUIDED_EXAMPLES.find((example) => example.id === activeGuide.flowId) : null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      const form = event.currentTarget.closest("form");
      form?.requestSubmit();
    }
  }

  function startGuidedExample(example: GuidedExample) {
    const firstPrompt = example.prompts[0];
    submitPrompt(firstPrompt.prompt, { flowId: example.id, stepIndex: 0, workflow: firstPrompt.workflow ?? "chat" });
  }

  function continueGuidedExample() {
    if (!activeExample || !activeGuide || activeGuide.status !== "ready-next") {
      return;
    }
    const nextPrompt = activeExample.prompts[activeGuide.stepIndex];
    submitPrompt(nextPrompt.prompt, {
      flowId: activeExample.id,
      stepIndex: activeGuide.stepIndex,
      workflow: nextPrompt.workflow ?? activeGuide.workflow,
    });
  }

  function showGuide() {
    setTutorialStep(0);
    setActiveGuide(null);
    setShowTutorial(true);
  }

  function dismissTutorial() {
    localStorage.setItem(TUTORIAL_STORAGE_KEY, "true");
    setShowTutorial(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitPrompt(input);
  }

  async function submitPrompt(prompt: string, guideAction?: { flowId: string; stepIndex: number; workflow: Workflow }) {
    const trimmed = prompt.trim();
    if (!trimmed || streamingRef.current) {
      return;
    }
    streamingRef.current = true;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };
    const assistantId = crypto.randomUUID();
    const assistantMessage: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
    };
    const nextMessages = [...messages, userMessage, assistantMessage];
    const workflow = guideAction?.workflow ?? inferWorkflow(trimmed);

    if (guideAction) {
      setActiveGuide({ ...guideAction, status: "streaming" });
    }
    setMessages(nextMessages);
    setInput("");
    setIsStreaming(true);
    setStatus("Streaming");

    let completed = false;
    try {
      const response = await fetch(`${API_BASE}${endpointForWorkflow(workflow)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadForWorkflow(workflow, trimmed, nextMessages)),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Chat stream failed with HTTP ${response.status}`);
      }

      await readNdjsonStream(response.body, (payload) => {
        processStreamPayload(payload, assistantId);
      });
      completed = true;
      setStatus("Complete");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendAssistantText(assistantId, `\n\n${message}`);
      appendEvent(assistantId, "error", "Stream error", message);
      setStatus("Error");
    } finally {
      streamingRef.current = false;
      setIsStreaming(false);
      if (guideAction && completed) {
        setActiveGuide({
          flowId: guideAction.flowId,
          stepIndex: guideAction.stepIndex + 1,
          workflow: guideAction.workflow,
          status: guideAction.stepIndex + 1 >= 2 ? "complete" : "ready-next",
        });
      }
    }
  }

  function processStreamPayload(payload: Record<string, unknown>, assistantId: string) {
    const type = String(payload.type ?? "event");

    if (type === "text_delta") {
      const delta = String(payload.delta ?? "");
      appendAssistantText(assistantId, delta);
      return;
    }

    if (type === "reasoning_delta") {
      const delta = String(payload.delta ?? "");
      if (delta.trim()) {
        appendEvent(assistantId, type, "Reasoning", delta);
      }
      return;
    }

    if (type === "tool_called") {
      appendEvent(assistantId, type, "Tool called", summarize(payload.item));
      return;
    }

    if (type === "tool_output") {
      appendEvent(assistantId, type, "Tool output", summarize(payload.output));
      return;
    }

    if (type === "agent_started") {
      appendEvent(assistantId, type, `Agent started: ${String(payload.agent ?? "unknown")}`, summarize(payload));
      return;
    }

    if (type === "agent_completed") {
      appendEvent(assistantId, type, `Agent completed: ${String(payload.agent ?? "unknown")}`, summarize(payload));
      return;
    }

    if (type === "source_found") {
      appendEvent(assistantId, type, `Source: ${String(payload.title ?? payload.url ?? "source")}`, summarize(payload));
      return;
    }

    if (type === "image_generated") {
      appendEvent(assistantId, type, `Image generated: ${String(payload.title ?? "visual summary")}`, summarize(payload));
      appendAssistantImage(assistantId, {
        title: String(payload.title ?? "Financial visual summary"),
        description: String(payload.description ?? ""),
        imageUrl: imageUrlFromPayload(payload.image),
      });
      return;
    }

    if (type === "mcp_ready") {
      return;
    }

    if (type === "done") {
      return;
    }

    if (type === "error") {
      appendEvent(assistantId, type, "Backend error", String(payload.message ?? "Unknown error"));
      return;
    }

    if (type === "reasoning_event") {
      appendEvent(assistantId, type, "Reasoning event", summarize(payload));
    }
  }

  function appendAssistantText(id: string, delta: string) {
    setMessages((current) =>
      current.map((message) => (message.id === id ? { ...message, content: message.content + delta } : message)),
    );
  }

  function appendAssistantImage(id: string, image: GeneratedImage) {
    setMessages((current) =>
      current.map((message) =>
        message.id === id ? { ...message, images: [...(message.images ?? []), image] } : message,
      ),
    );
  }

  function appendEvent(messageId: string, type: string, title: string, detail: string) {
    const nextEvent = {
      id: crypto.randomUUID(),
      messageId,
      type,
      title,
      detail,
      order: eventOrderRef.current,
    };
    eventOrderRef.current += 1;

    setCurrentEvent((previous) => {
      if (previous) {
        setEventHistory((history) => [previous, ...history]);
      }
      return nextEvent;
    });
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <div className="eyebrow">
              <Server size={13} />
              FastMCP Tools
            </div>
            <h1>Arithmetic + Taiwan Stocks</h1>
          </div>
          <div className="topbar-actions">
            <button className="guide-button" type="button" onClick={showGuide}>
              <CircleHelp size={15} />
              Guide
            </button>
            <div className="status-pill" data-active={isStreaming}>
              {isStreaming ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} />}
              {status}
            </div>
          </div>
        </header>

        <div className="main-grid">
          <section className="chat-panel" aria-label="Chat conversation">
            <div className="message-list">
              {messages.map((message) => (
                <article key={message.id} className={`message ${message.role}`}>
                  <span className="role-label">{message.role}</span>
                  <p>{message.content || (message.role === "assistant" && isStreaming ? "..." : "")}</p>
                  {message.images?.map((image) => (
                    <div className="image-attachment" key={`${message.id}-${image.title}`}>
                      <strong>{image.title}</strong>
                      {image.imageUrl ? <img src={image.imageUrl} alt={image.title} /> : null}
                      {image.description ? <small>{image.description}</small> : null}
                    </div>
                  ))}
                </article>
              ))}
              <div ref={bottomRef} />
            </div>

            {(showTutorial || shouldShowStarters) && (
              <section className="starter-area" aria-label="Getting started">
                {showTutorial && (
                  <TutorialPanel
                    step={tutorialStep}
                    steps={TUTORIAL_STEPS}
                    onBack={() => setTutorialStep((current) => Math.max(0, current - 1))}
                    onNext={() =>
                      setTutorialStep((current) => Math.min(TUTORIAL_STEPS.length - 1, current + 1))
                    }
                    onDone={dismissTutorial}
                  />
                )}

                {shouldShowStarters && (
                  <GuidedStarter
                    examples={GUIDED_EXAMPLES}
                    activeExample={activeExample}
                    activeGuide={activeGuide}
                    onStart={startGuidedExample}
                    onContinue={continueGuidedExample}
                    onReset={() => setActiveGuide(null)}
                  />
                )}
              </section>
            )}

            <form className="composer" onSubmit={handleSubmit}>
              <label className="sr-only" htmlFor="message">
                Message
              </label>
              <textarea
                id="message"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask for arithmetic that should use MCP tools…"
                rows={3}
              />
              <button type="submit" disabled={isStreaming || !input.trim()} aria-label="Send message">
                <Send size={16} />
                Send
              </button>
            </form>
          </section>

          <aside className="event-panel" aria-label="Reasoning and tool event history">
            <section className="history-section">
              <div className="panel-title">
                <Brain size={15} />
                Event History
              </div>
              <div className="event-list">
                {allEvents(currentEvent, eventHistory).length === 0 ? (
                  <p className="empty-event">Reasoning and tool events will appear here.</p>
                ) : (
                  groupedEvents(allEvents(currentEvent, eventHistory), messages).map((group) => (
                    <RoundEventGroup
                      key={group.messageId}
                      group={group}
                      currentEventId={currentEvent?.id}
                      collapsed={collapsedRounds.has(group.messageId)}
                      onToggle={() => toggleRound(group.messageId)}
                    />
                  ))
                )}
              </div>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );

  function toggleRound(messageId: string) {
    setCollapsedRounds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }
}

function TutorialPanel({
  step,
  steps,
  onBack,
  onNext,
  onDone,
}: {
  step: number;
  steps: TutorialStep[];
  onBack: () => void;
  onNext: () => void;
  onDone: () => void;
}) {
  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <article className="tutorial-panel">
      <div>
        <span className="section-kicker">Step {step + 1} of {steps.length}</span>
        <strong>{current.title}</strong>
        <p>{current.body}</p>
      </div>
      <div className="tutorial-controls">
        <button type="button" onClick={onBack} disabled={step === 0}>
          Back
        </button>
        {isLast ? (
          <button type="button" onClick={onDone}>
            Done
          </button>
        ) : (
          <button type="button" onClick={onNext}>
            Next
          </button>
        )}
      </div>
    </article>
  );
}

function GuidedStarter({
  examples,
  activeExample,
  activeGuide,
  onStart,
  onContinue,
  onReset,
}: {
  examples: GuidedExample[];
  activeExample: GuidedExample | null | undefined;
  activeGuide: ActiveGuide | null;
  onStart: (example: GuidedExample) => void;
  onContinue: () => void;
  onReset: () => void;
}) {
  if (activeExample && activeGuide?.status === "ready-next") {
    const nextPrompt = activeExample.prompts[activeGuide.stepIndex];
    return (
      <section className="starter-prompts" aria-label="Next guided question">
        <div className="starter-header">
          <span className="section-kicker">Next suggested question</span>
        </div>
        <button className="next-guide-card" type="button" onClick={onContinue}>
          <span>{nextPrompt.category}</span>
          <strong>{nextPrompt.label}</strong>
          <small>{nextPrompt.prompt}</small>
        </button>
      </section>
    );
  }

  if (activeExample && activeGuide?.status === "complete") {
    return (
      <section className="starter-prompts" aria-label="Completed guided example">
        <div className="guide-complete">
          <div>
            <span className="section-kicker">Example complete</span>
            <strong>{activeExample.title}</strong>
            <p>Start another guided example, or continue with your own question in the composer.</p>
          </div>
          <button type="button" onClick={onReset}>
            More examples
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="starter-prompts" aria-label="Guided starter examples">
      <div className="starter-header">
        <span className="section-kicker">Choose a guided example</span>
      </div>
      <div className="starter-grid">
        {examples.map((example) => (
          <button key={example.id} type="button" onClick={() => onStart(example)}>
            <span>{example.prompts[0].category}</span>
            <strong>{example.title}</strong>
            <small>{example.summary}</small>
            <em>{example.prompts[0].prompt}</em>
          </button>
        ))}
      </div>
    </section>
  );
}

function EventIcon({ type }: { type: string }) {
  if (type.includes("tool")) {
    return <Wrench size={15} />;
  }
  if (type.includes("reasoning")) {
    return <Brain size={15} />;
  }
  return <TerminalSquare size={15} />;
}

function EventCard({
  event,
  roundLabel,
  prominent = false,
}: {
  event: StreamEvent;
  roundLabel?: string;
  prominent?: boolean;
}) {
  return (
    <article className={`event-card ${prominent ? "prominent" : ""}`}>
      <EventIcon type={event.type} />
      <div>
        <strong>{event.title}</strong>
        <span>{roundLabel ? `${roundLabel} · ${event.type}` : event.type}</span>
        <code>{event.detail}</code>
      </div>
    </article>
  );
}

interface EventGroup {
  messageId: string;
  label: string;
  roundIndex: number;
  events: StreamEvent[];
}

function RoundEventGroup({
  group,
  collapsed,
  onToggle,
  currentEventId,
}: {
  group: EventGroup;
  collapsed: boolean;
  onToggle: () => void;
  currentEventId?: string;
}) {
  return (
    <section className="event-round-group">
      <button
        className="round-expander"
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${group.label} events`}
      >
        <ChevronDown className={collapsed ? "collapsed" : ""} size={14} />
        <span>{group.label}</span>
        <strong>{group.events.length}</strong>
      </button>
      {!collapsed &&
        group.events.map((event) => (
          <EventCard key={event.id} event={event} prominent={event.id === currentEventId} />
        ))}
    </section>
  );
}

function roundLabel(messageId: string, messages: Message[]): string {
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  const index = assistantMessages.findIndex((message) => message.id === messageId);
  if (index <= 0) {
    return "Intro";
  }
  return `Round ${index}`;
}

function groupedEvents(events: StreamEvent[], messages: Message[]): EventGroup[] {
  const groups: EventGroup[] = [];
  for (const event of [...events].sort((left, right) => left.order - right.order)) {
    const existing = groups.find((group) => group.messageId === event.messageId);
    if (existing) {
      existing.events.push(event);
    } else {
      groups.push({
        messageId: event.messageId,
        label: roundLabel(event.messageId, messages),
        roundIndex: roundIndex(event.messageId, messages),
        events: [event],
      });
    }
  }
  return groups.sort((left, right) => left.roundIndex - right.roundIndex);
}

function allEvents(currentEvent: StreamEvent | null, eventHistory: StreamEvent[]): StreamEvent[] {
  return currentEvent ? [...eventHistory, currentEvent] : eventHistory;
}

function roundIndex(messageId: string, messages: Message[]): number {
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  return assistantMessages.findIndex((message) => message.id === messageId);
}

function endpointForWorkflow(workflow: Workflow): string {
  return workflow === "financial" ? "/api/financial-analysis/stream" : "/api/chat/stream";
}

function payloadForWorkflow(workflow: Workflow, prompt: string, messages: Message[]) {
  if (workflow === "financial") {
    return {
      stock: extractStockInput(prompt),
      question: prompt,
    };
  }

  return {
    messages: messages
      .filter((message) => message.content.trim())
      .map(({ role, content }) => ({ role, content })),
  };
}

function inferWorkflow(prompt: string): Workflow {
  return /財務|合理價|本益比|估值|同業|現金流|分批|完整分析/.test(prompt) ? "financial" : "chat";
}

function extractStockInput(prompt: string): string {
  const match = prompt.match(/\b\d{4,6}\b/);
  return match?.[0] ?? prompt;
}

function imageUrlFromPayload(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["url", "image_url", "b64_json"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate) {
      return key === "b64_json" ? `data:image/png;base64,${candidate}` : candidate;
    }
  }
  return undefined;
}

async function readNdjsonStream(stream: ReadableStream<Uint8Array>, onPayload: (payload: Record<string, unknown>) => void) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        onPayload(JSON.parse(trimmed));
      }
    }
  }

  const trailing = buffer.trim();
  if (trailing) {
    onPayload(JSON.parse(trailing));
  }
}

function summarize(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
