import React, { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowDown,
  Brain,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Copy,
  Download,
  ExternalLink,
  KeyRound,
  Languages,
  Loader2,
  MessageSquare,
  Mic,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Server,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  WandSparkles,
  Wrench,
  X,
  ZoomIn,
} from "lucide-react";
import "./styles.css";

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

type Role = "user" | "assistant";

interface Message {
  id: string;
  role: Role;
  content: string;
  images?: GeneratedImage[];
  activities?: ActivityItem[];
  activitiesComplete?: boolean;
  sourcePrompt?: string;
  stock?: string;
  requiredSkillIds?: string[];
  requiredSkillsSnapshot?: SkillSnapshot[];
  workflow?: Workflow;
  visualStatus?: "idle" | "generating" | "complete" | "error";
  errored?: boolean;
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
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
  previewUrl?: string;
  agent?: string;
  skillId?: string;
  traceId?: string;
  traceUrl?: string;
  createdAt?: string;
  status?: "loading" | "ready";
}

interface ActivityItem {
  id: string;
  type: string;
  label: string;
  createdAt: string;
}

interface ChatSessionSummary {
  id: string;
  title: string;
  message_count: number;
  event_count: number;
  created_at: string;
  updated_at: string;
}

interface ChatSessionRead extends ChatSessionSummary {
  messages_json: Message[];
  events_json: StreamEvent[];
  is_active: boolean;
}

interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  is_active: boolean;
}

interface SkillSnapshot {
  id: string;
  name: string;
  description: string;
}

interface SkillDraft {
  name: string;
  description: string;
  instructions: string;
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

type Workflow = "chat" | "financial" | "agentic";
type Locale = "en" | "zh-TW" | "ja";
type StatusKey = "ready" | "streaming" | "complete" | "error";
type ActivityTab = "sessions" | "events";
type ImageZoomMode = "fit" | "actual";

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
const LOCALE_STORAGE_KEY = "mcpChatLocale";
const MAX_SELECTED_SKILLS = 5;
const SKILLS_PAGE_SIZE = 4;
const EMPTY_SKILL_DRAFT: SkillDraft = {
  name: "",
  description: "",
  instructions: "",
};

const GUIDED_EXAMPLES: GuidedExample[] = [
  {
    id: "financial-full-analysis",
    title: "Financial analysis",
    summary: "The agent uses MCP stock tools and WebSearch to analyze the stock and write a report.",
    prompts: [
      {
        label: "Full financial report",
        category: "Financial Analyst",
        prompt: "請為股票 2330 台積電產生完整的財務分析報告，包含公司概要、財務體質、成長動能、估值、現金流、同業比較、六種本益比估值與買進策略。",
        workflow: "financial",
      },
      {
        label: "Focused valuation only",
        category: "Financial Analyst",
        prompt: "只分析 2454 聯發科的估值狀態與六種本益比合理價，不需要其他段落。",
        workflow: "financial",
      },
    ],
  },
  {
    id: "selective-analysis",
    title: "Selective analysis",
    summary: "Ask for just two dimensions and the backend narrows the analysis scope.",
    prompts: [
      {
        label: "Health + growth only",
        category: "Financial Analyst",
        prompt: "只看 2330 台積電的財務體質達標狀態和成長動能，其他不用分析。",
        workflow: "financial",
      },
      {
        label: "Add peer comparison",
        category: "Financial Analyst",
        prompt: "再幫我加上 2330 的同業比較分析。",
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
];

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: "Pick a guided example",
    body: "Click a sample question to submit it. The agent decides which tools to call.",
  },
  {
    title: "Watch the workflow",
    body: "Selected skills run as specialist agents, then the manager streams a synthesized answer.",
  },
  {
    title: "Review aggregated results",
    body: "Specialist lifecycle and tool events appear in the event history as the task runs.",
  },
  {
    title: "Try a selective analysis",
    body: "Mark must-run skills when needed; otherwise the manager can pick relevant skills automatically.",
  },
];

const LANGUAGE_LABELS: Record<Locale, string> = {
  en: "English",
  "zh-TW": "繁體中文",
  ja: "日本語",
};

const TRANSLATIONS = {
  en: {
    eyebrow: "Financial Analyst + FastMCP Tools",
    title: "Financial Analysis · Arithmetic · Taiwan Stocks",
    guide: "Guide",
    ready: "Ready",
    streaming: "Streaming",
    complete: "Complete",
    error: "Error",
    assistantIntro: "Ask me to run a financial analysis, calculate something, or look up a Taiwan stock.",
    messageLabel: "Message",
    placeholder: "Ask for analysis, arithmetic, or a Taiwan stock lookup...",
    apiKeyTitle: "OpenAI API key",
    apiKeyConfigured: "A key is configured for this backend session.",
    apiKeyNeeded: "Required for agent responses, skill drafts, WebSearch, and ImageGeneration.",
    apiKeyPlaceholder: "sk-...",
    saveKey: "Save key",
    apiKeyPasteFirst: "Paste an OpenAI API key first.",
    apiKeySaved: "API key is set for this backend session.",
    apiKeyHint: "Open the key button under the chat input and paste your OpenAI API key.",
    apiKeyMissing: "OpenAI API key is missing. Use the key button under the chat input to paste your key, then run the request again.",
    openApiSettings: "Open API key settings",
    voiceInput: "Voice input",
    stopVoiceInput: "Stop voice input",
    listening: "Listening...",
    voiceUnavailable: "Voice input is not available in this browser.",
    sendMessage: "Send message",
    send: "Send",
    requiredSkillsCount: (count: number) => count > 0 ? `${count} required skills` : "Manager auto-pick",
    managerAgent: "Manager agent",
    requiredSkills: "Required skills",
    requiredSummary: (count: number) => `${count} required · manager can add more`,
    newSkill: "New skill",
    edit: "Edit",
    delete: "Delete",
    prev: "Prev",
    next: "Next",
    page: (current: number, total: number) => `Page ${current} / ${total}`,
    skillName: "Skill name",
    skillDescription: "Short description",
    skillInstructions: "Specialist instructions",
    cancel: "Cancel",
    generateDraft: "Generate draft",
    saveChanges: "Save changes",
    createSkill: "Create skill",
    skillModalTitleNew: "Create skill",
    skillModalTitleEdit: "Edit skill",
    skillDraftHelp: "Generate draft calls the backend Skill Prompt Builder agent. It creates an unsaved draft for review.",
    close: "Close",
    skillRequired: "Skill name and instructions are required.",
    skillDraftPrompt: "Describe the skill you want to draft first.",
    skillLimit: (max: number) => `Select up to ${max} required skills for one run.`,
    examples: "Examples",
    nextSuggestedQuestion: "Next suggested question",
    exampleComplete: "Example complete",
    moreExamples: "More examples",
    exampleCompleteBody: "Start another guided example, or continue with your own question in the composer.",
    back: "Back",
    done: "Done",
    eventHistory: "Event History",
    chatSessions: "Chat Sessions",
    newChat: "New chat",
    noSessions: "No saved chats yet.",
    openChatSession: "Open chat session",
    deleteChatSession: "Delete chat session",
    messageCount: (count: number) => `${count} messages`,
    eventCount: (count: number) => `${count} events`,
    noEvents: "Reasoning and tool events will appear here.",
    currentEvent: "Current Event",
    collapse: "Collapse",
    expand: "Expand",
    latestEvent: "Latest event",
    openRoundLogs: "Open round logs",
    roundLogs: "Round logs",
    round: (index: number) => `Round ${index}`,
    language: "Language",
    visualArtifacts: "Visual artifacts",
    generateImages: "Generate Images",
    generatingImages: "Generating images",
    noSavedRequiredSkills: "This answer has no saved required skills.",
    deleteRoundLogs: "Delete round logs",
    eventSession: "Event session",
    imageGenerating: "Generating image...",
    viewImage: "View",
    downloadImage: "Download",
    copyImage: "Copy image",
    openImage: "Open",
    imageLightboxTitle: "Generated visual",
    zoomFit: "Fit",
    zoomActual: "Actual size",
    liveActivity: "Agent activity",
    activityPlanning: "Planning specialist skills",
    activityPlanReady: "Execution plan ready",
    activityManagerStarted: "Running specialist agents",
    activitySynthesizing: "Synthesizing final answer",
    activityTraceReady: "Trace ready",
    activityGeneratingVisualization: "Generating visualization",
    activityNoSkills: "No matching skills; researching directly",
    activityCompleted: "Completed",
    viewEvents: "View events",
    activityRunningAgent: (name: string) => `Running ${name}`,
    activityFinishedAgent: (name: string) => `Completed ${name}`,
    activitySelectedSkill: (name: string) => `Selected ${name}`,
    roleYou: "You",
    roleAssistant: "Assistant",
    retry: "Retry",
    copyMessage: "Copy message",
    scrollToBottom: "Scroll to latest",
    errorRetryHint: "Something went wrong. Use the retry button to try again.",
    skillDraftOverwrite: "Replace your current draft with a new AI-generated one?",
  },
  "zh-TW": {
    eyebrow: "財務分析 + FastMCP 工具",
    title: "財務分析 · 算術 · 台灣股票",
    guide: "導覽",
    ready: "就緒",
    streaming: "串流中",
    complete: "完成",
    error: "錯誤",
    assistantIntro: "請我執行財務分析、計算，或查詢台灣股票。",
    messageLabel: "訊息",
    placeholder: "輸入分析、計算，或台灣股票查詢...",
    apiKeyTitle: "OpenAI API 金鑰",
    apiKeyConfigured: "此後端工作階段已設定金鑰。",
    apiKeyNeeded: "Agent 回覆、技能草稿、WebSearch 與 ImageGeneration 需要此金鑰。",
    apiKeyPlaceholder: "sk-...",
    saveKey: "儲存金鑰",
    apiKeyPasteFirst: "請先貼上 OpenAI API 金鑰。",
    apiKeySaved: "API 金鑰已設定到此後端工作階段。",
    apiKeyHint: "點擊聊天輸入框下方的金鑰按鈕並貼上 OpenAI API 金鑰。",
    apiKeyMissing: "缺少 OpenAI API 金鑰。請使用聊天輸入框下方的金鑰按鈕貼上金鑰，然後重新送出請求。",
    openApiSettings: "開啟 API 金鑰設定",
    voiceInput: "語音輸入",
    stopVoiceInput: "停止語音輸入",
    listening: "正在聆聽...",
    voiceUnavailable: "此瀏覽器不支援語音輸入。",
    sendMessage: "送出訊息",
    send: "送出",
    requiredSkillsCount: (count: number) => count > 0 ? `${count} 個必用技能` : "Manager 自動挑選",
    managerAgent: "Manager Agent",
    requiredSkills: "必用技能",
    requiredSummary: (count: number) => `${count} 個必用 · manager 可再加入`,
    newSkill: "新技能",
    edit: "編輯",
    delete: "刪除",
    prev: "上一頁",
    next: "下一頁",
    page: (current: number, total: number) => `第 ${current} / ${total} 頁`,
    skillName: "技能名稱",
    skillDescription: "簡短描述",
    skillInstructions: "Specialist 指令",
    cancel: "取消",
    generateDraft: "產生草稿",
    saveChanges: "儲存變更",
    createSkill: "建立技能",
    skillModalTitleNew: "建立技能",
    skillModalTitleEdit: "編輯技能",
    skillDraftHelp: "產生草稿會呼叫後端 Skill Prompt Builder agent，建立未儲存的草稿供你審閱。",
    close: "關閉",
    skillRequired: "技能名稱與指令為必填。",
    skillDraftPrompt: "請先描述你想產生的技能。",
    skillLimit: (max: number) => `每次最多選擇 ${max} 個必用技能。`,
    examples: "範例",
    nextSuggestedQuestion: "下一個建議問題",
    exampleComplete: "範例完成",
    moreExamples: "更多範例",
    exampleCompleteBody: "開始另一個導覽範例，或直接在輸入框繼續提問。",
    back: "返回",
    done: "完成",
    eventHistory: "事件紀錄",
    chatSessions: "聊天紀錄",
    newChat: "新聊天",
    noSessions: "尚無已儲存聊天。",
    openChatSession: "開啟聊天紀錄",
    deleteChatSession: "刪除聊天紀錄",
    messageCount: (count: number) => `${count} 則訊息`,
    eventCount: (count: number) => `${count} 個事件`,
    noEvents: "推理與工具事件會顯示在這裡。",
    currentEvent: "目前事件",
    collapse: "收合",
    expand: "展開",
    latestEvent: "最新事件",
    openRoundLogs: "開啟回合紀錄",
    roundLogs: "回合紀錄",
    round: (index: number) => `第 ${index} 回合`,
    language: "語言",
    visualArtifacts: "視覺產物",
    generateImages: "產生圖片",
    generatingImages: "正在產生圖片",
    noSavedRequiredSkills: "此回答沒有儲存的必用技能。",
    deleteRoundLogs: "刪除回合紀錄",
    eventSession: "事件聊天",
    imageGenerating: "正在產生圖片...",
    viewImage: "檢視",
    downloadImage: "下載",
    copyImage: "複製圖片",
    openImage: "開啟",
    imageLightboxTitle: "生成圖片",
    zoomFit: "符合視窗",
    zoomActual: "原始大小",
    liveActivity: "Agent 動態",
    activityPlanning: "正在規劃 specialist 技能",
    activityPlanReady: "執行計畫已建立",
    activityManagerStarted: "正在執行 specialist agents",
    activitySynthesizing: "正在整合最終回答",
    activityTraceReady: "Trace 已建立",
    activityGeneratingVisualization: "正在產生視覺化",
    activityNoSkills: "沒有符合技能，改由 manager 直接研究",
    activityCompleted: "已完成",
    viewEvents: "查看事件",
    activityRunningAgent: (name: string) => `正在執行 ${name}`,
    activityFinishedAgent: (name: string) => `${name} 已完成`,
    activitySelectedSkill: (name: string) => `已選擇 ${name}`,
    roleYou: "你",
    roleAssistant: "助理",
    retry: "重試",
    copyMessage: "複製訊息",
    scrollToBottom: "捲動到最新",
    errorRetryHint: "發生錯誤。請使用重試按鈕再試一次。",
    skillDraftOverwrite: "要用新的 AI 草稿取代目前內容嗎？",
  },
  ja: {
    eyebrow: "財務分析 + FastMCP ツール",
    title: "財務分析 · 計算 · 台湾株",
    guide: "ガイド",
    ready: "待機中",
    streaming: "出力中",
    complete: "完了",
    error: "エラー",
    assistantIntro: "財務分析、計算、台湾株の検索を依頼してください。",
    messageLabel: "メッセージ",
    placeholder: "分析、計算、台湾株検索を入力...",
    apiKeyTitle: "OpenAI API キー",
    apiKeyConfigured: "このバックエンドセッションにキーが設定されています。",
    apiKeyNeeded: "Agent 応答、スキル下書き、WebSearch、ImageGeneration に必要です。",
    apiKeyPlaceholder: "sk-...",
    saveKey: "キーを保存",
    apiKeyPasteFirst: "OpenAI API キーを貼り付けてください。",
    apiKeySaved: "API キーをこのバックエンドセッションに設定しました。",
    apiKeyHint: "チャット入力欄の下にあるキーボタンを開き、OpenAI API キーを貼り付けてください。",
    apiKeyMissing: "OpenAI API キーが未設定です。チャット入力欄の下のキーボタンからキーを貼り付け、もう一度実行してください。",
    openApiSettings: "API キー設定を開く",
    voiceInput: "音声入力",
    stopVoiceInput: "音声入力を停止",
    listening: "聞き取り中...",
    voiceUnavailable: "このブラウザーでは音声入力を利用できません。",
    sendMessage: "送信",
    send: "送信",
    requiredSkillsCount: (count: number) => count > 0 ? `${count} 個の必須スキル` : "Manager が自動選択",
    managerAgent: "Manager agent",
    requiredSkills: "必須スキル",
    requiredSummary: (count: number) => `${count} 必須 · manager が追加可能`,
    newSkill: "新規スキル",
    edit: "編集",
    delete: "削除",
    prev: "前へ",
    next: "次へ",
    page: (current: number, total: number) => `${current} / ${total} ページ`,
    skillName: "スキル名",
    skillDescription: "短い説明",
    skillInstructions: "Specialist 指示",
    cancel: "キャンセル",
    generateDraft: "下書きを生成",
    saveChanges: "変更を保存",
    createSkill: "スキル作成",
    skillModalTitleNew: "スキル作成",
    skillModalTitleEdit: "スキル編集",
    skillDraftHelp: "下書き生成はバックエンドの Skill Prompt Builder agent を呼び出し、保存前の下書きを作成します。",
    close: "閉じる",
    skillRequired: "スキル名と指示は必須です。",
    skillDraftPrompt: "作成したいスキルを先に説明してください。",
    skillLimit: (max: number) => `1 回に選択できる必須スキルは最大 ${max} 個です。`,
    examples: "例",
    nextSuggestedQuestion: "次のおすすめ質問",
    exampleComplete: "例が完了",
    moreExamples: "他の例",
    exampleCompleteBody: "別のガイド例を開始するか、入力欄から続けて質問してください。",
    back: "戻る",
    done: "完了",
    eventHistory: "イベント履歴",
    chatSessions: "チャット履歴",
    newChat: "新規チャット",
    noSessions: "保存済みチャットはありません。",
    openChatSession: "チャット履歴を開く",
    deleteChatSession: "チャット履歴を削除",
    messageCount: (count: number) => `${count} 件のメッセージ`,
    eventCount: (count: number) => `${count} 件のイベント`,
    noEvents: "推論とツールイベントがここに表示されます。",
    currentEvent: "現在のイベント",
    collapse: "折りたたむ",
    expand: "展開",
    latestEvent: "最新イベント",
    openRoundLogs: "ラウンドログを開く",
    roundLogs: "ラウンドログ",
    round: (index: number) => `ラウンド ${index}`,
    language: "言語",
    visualArtifacts: "ビジュアル成果物",
    generateImages: "画像を生成",
    generatingImages: "画像を生成中",
    noSavedRequiredSkills: "この回答には保存済みの必須スキルがありません。",
    deleteRoundLogs: "ラウンドログを削除",
    eventSession: "イベントセッション",
    imageGenerating: "画像を生成中...",
    viewImage: "表示",
    downloadImage: "ダウンロード",
    copyImage: "画像をコピー",
    openImage: "開く",
    imageLightboxTitle: "生成画像",
    zoomFit: "フィット",
    zoomActual: "実寸",
    liveActivity: "Agent アクティビティ",
    activityPlanning: "Specialist スキルを計画中",
    activityPlanReady: "実行計画を作成済み",
    activityManagerStarted: "Specialist agents を実行中",
    activitySynthesizing: "最終回答を統合中",
    activityTraceReady: "Trace 準備完了",
    activityGeneratingVisualization: "ビジュアルを生成中",
    activityNoSkills: "一致するスキルなし。Manager が直接調査中",
    activityCompleted: "完了",
    viewEvents: "イベントを見る",
    activityRunningAgent: (name: string) => `${name} を実行中`,
    activityFinishedAgent: (name: string) => `${name} が完了`,
    activitySelectedSkill: (name: string) => `${name} を選択`,
    roleYou: "あなた",
    roleAssistant: "アシスタント",
    retry: "再試行",
    copyMessage: "メッセージをコピー",
    scrollToBottom: "最新にスクロール",
    errorRetryHint: "エラーが発生しました。再試行ボタンをご利用ください。",
    skillDraftOverwrite: "現在のドラフトを新しい AI 生成ドラフトで置き換えますか？",
  },
} satisfies Record<Locale, Record<string, string | ((...args: never[]) => string)>>;

function initialLocale(): Locale {
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  return stored === "zh-TW" || stored === "ja" || stored === "en" ? stored : "en";
}

function initialMessages(locale: Locale): Message[] {
  return [
    {
      id: crypto.randomUUID(),
      role: "assistant",
      content: TRANSLATIONS[locale].assistantIntro,
    },
  ];
}

function App() {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const t = TRANSLATIONS[locale] as typeof TRANSLATIONS.en;
  const [messages, setMessages] = useState<Message[]>(() => initialMessages(initialLocale()));
  const [input, setInput] = useState("");
  const [currentEvent, setCurrentEvent] = useState<StreamEvent | null>(null);
  const [eventHistory, setEventHistory] = useState<StreamEvent[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [eventSessionId, setEventSessionId] = useState<string | null>(null);
  const [eventSessionMessages, setEventSessionMessages] = useState<Message[]>([]);
  const [eventSessionEvents, setEventSessionEvents] = useState<StreamEvent[]>([]);
  const [eventSessionPickerOpen, setEventSessionPickerOpen] = useState(false);
  const [activityTab, setActivityTab] = useState<ActivityTab>("sessions");
  const [showSkillDrawer, setShowSkillDrawer] = useState(false);
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [showTutorial, setShowTutorial] = useState(false);
  const [activeGuide, setActiveGuide] = useState<ActiveGuide | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [status, setStatus] = useState<StatusKey>("ready");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [skillDraft, setSkillDraft] = useState<SkillDraft>(EMPTY_SKILL_DRAFT);
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [skillError, setSkillError] = useState("");
  const [showSkillEditor, setShowSkillEditor] = useState(false);
  const [skillPage, setSkillPage] = useState(0);
  const [isDraftingSkill, setIsDraftingSkill] = useState(false);
  const [showApiKeyPanel, setShowApiKeyPanel] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKeyMessage, setApiKeyMessage] = useState("");
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [selectedImageGallery, setSelectedImageGallery] = useState<GeneratedImage[]>([]);
  const [visualizingMessageIds, setVisualizingMessageIds] = useState<string[]>([]);
  const [imageZoomMode, setImageZoomMode] = useState<ImageZoomMode>("fit");
  const [voiceMessage, setVoiceMessage] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; message: string; type: "success" | "error" }[]>([]);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const eventOrderRef = useRef(0);
  const streamingRef = useRef(false);
  const sessionLoadingRef = useRef(false);
  const sessionSaveTimerRef = useRef<number | null>(null);
  const toastTimersRef = useRef<Map<string, number>>(new Map());
  const shouldShowStarters = !isStreaming;
  const activeExample = activeGuide ? GUIDED_EXAMPLES.find((example) => example.id === activeGuide.flowId) : null;
  const visibleEvents = allEvents(currentEvent, eventHistory);
  const selectedEventSessionIsActive = !eventSessionId || eventSessionId === activeSessionId;
  const eventSessionVisibleEvents = selectedEventSessionIsActive ? visibleEvents : eventSessionEvents;
  const eventSessionVisibleMessages = selectedEventSessionIsActive ? messages : eventSessionMessages;
  const eventGroups = groupedEvents(eventSessionVisibleEvents, eventSessionVisibleMessages);
  const selectedRound = eventGroups.find((group) => group.messageId === selectedRoundId) ?? null;

  useEffect(() => {
    // Smart auto-scroll: only scroll if user is already near the bottom.
    // This prevents hijacking user's scroll while they read earlier content.
    const el = messageListRef.current;
    if (!el) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 160) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages]);

  useEffect(() => {
    loadSkills();
    loadOpenAIKeyStatus();
    initializeChatSessions();
    // Auto-show tutorial for first-time users (respects dismissal).
    if (!localStorage.getItem(TUTORIAL_STORAGE_KEY)) {
      setShowTutorial(true);
    }
  }, []);

  useEffect(() => {
    if (!activeSessionId || sessionLoadingRef.current) {
      return;
    }
    if (sessionSaveTimerRef.current) {
      window.clearTimeout(sessionSaveTimerRef.current);
    }
    sessionSaveTimerRef.current = window.setTimeout(() => {
      saveActiveSession().catch((error) => console.error("Chat session autosave failed", error));
    }, 650);

    return () => {
      if (sessionSaveTimerRef.current) {
        window.clearTimeout(sessionSaveTimerRef.current);
      }
    };
  }, [activeSessionId, messages, currentEvent, eventHistory]);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(skills.length / SKILLS_PAGE_SIZE) - 1);
    setSkillPage((current) => Math.min(current, maxPage));
  }, [skills.length]);

  useEffect(() => {
    if (!eventSessionId && activeSessionId) {
      setEventSessionId(activeSessionId);
    }
  }, [activeSessionId, eventSessionId]);

  useEffect(() => {
    // Reset status pill to "Ready" a few seconds after a completed run.
    if (status !== "complete" && status !== "error") return;
    const timer = window.setTimeout(() => setStatus("ready"), 4000);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    // Auto-dismiss voice notice so it doesn't linger forever.
    if (!voiceMessage) return;
    const timer = window.setTimeout(() => setVoiceMessage(""), 4000);
    return () => window.clearTimeout(timer);
  }, [voiceMessage]);

  useEffect(() => {
    // Auto-dismiss api key inline message (toast handles confirmation now).
    if (!apiKeyMessage) return;
    const timer = window.setTimeout(() => setApiKeyMessage(""), 5000);
    return () => window.clearTimeout(timer);
  }, [apiKeyMessage]);

  function showToast(message: string, type: "success" | "error" = "success") {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, type }]);
    const timer = window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
      toastTimersRef.current.delete(id);
    }, 3000);
    toastTimersRef.current.set(id, timer);
  }

  useEffect(() => {
    return () => {
      for (const timer of toastTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      toastTimersRef.current.clear();
    };
  }, []);

  function changeLocale(nextLocale: Locale) {
    const previousLocale = locale;
    localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    setLocale(nextLocale);
    // Only rewrite the first assistant message if it's the untouched intro.
    // This prevents clobbering real assistant replies in loaded sessions.
    const previousIntro = TRANSLATIONS[previousLocale].assistantIntro;
    setMessages((current) =>
      current.map((message, index) => {
        if (index !== 0 || message.role !== "assistant") return message;
        if (message.content.trim() !== previousIntro.trim()) return message;
        return { ...message, content: TRANSLATIONS[nextLocale].assistantIntro };
      }),
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter to send, Shift+Enter for newline (standard chat UX)
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
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
    await submitPrompt(input, undefined, "agentic");
  }

  async function submitPrompt(
    prompt: string,
    guideAction?: { flowId: string; stepIndex: number; workflow: Workflow },
    workflowOverride?: Workflow,
  ) {
    const trimmed = prompt.trim();
    if (!trimmed || streamingRef.current) {
      return;
    }
    streamingRef.current = true;

    const workflow = workflowOverride ?? guideAction?.workflow ?? inferWorkflow(trimmed);
    const stock = extractStockInput(trimmed, messages);
    const requiredSkillIds = [...selectedSkillIds];
    const requiredSkillsSnapshot = skills
      .filter((skill) => requiredSkillIds.includes(skill.id))
      .map((skill) => ({ id: skill.id, name: skill.name, description: skill.description }));
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
      sourcePrompt: trimmed,
      stock,
      requiredSkillIds,
      requiredSkillsSnapshot,
      workflow,
      visualStatus: "idle",
    };
    const nextMessages = [...messages, userMessage, assistantMessage];

    if (guideAction) {
      setActiveGuide({ ...guideAction, status: "streaming" });
    }
    setMessages(nextMessages);
    setInput("");
    setIsStreaming(true);
    setStatus("streaming");

    let completed = false;
    let streamErrored = false;
    try {
      const response = await fetch(`${API_BASE}${endpointForWorkflow(workflow)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadForWorkflow(workflow, trimmed, nextMessages, selectedSkillIds, activeSessionId)),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Chat stream failed with HTTP ${response.status}`);
      }

      await readNdjsonStream(response.body, (payload) => {
        streamErrored = processStreamPayload(payload, assistantId) || streamErrored;
      });
      if (streamErrored) {
        setMessages((current) =>
          current.map((candidate) => (candidate.id === assistantId ? { ...candidate, errored: true } : candidate)),
        );
        setStatus("error");
      } else {
        completed = true;
        setStatus("complete");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendAssistantText(assistantId, `\n\n${message}`);
      appendEvent(assistantId, "error", "Stream error", message);
      setMessages((current) =>
        current.map((candidate) => (candidate.id === assistantId ? { ...candidate, errored: true } : candidate)),
      );
      setStatus("error");
      streamErrored = true;
    } finally {
      if (streamErrored) {
        setMessages((current) =>
          current.map((candidate) => (candidate.id === assistantId ? { ...candidate, errored: true } : candidate)),
        );
      }
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

  async function retryMessage(assistantMessage: Message) {
    if (!assistantMessage.sourcePrompt || streamingRef.current) return;
    // Remove the failed assistant message and its preceding user message,
    // then resubmit the original prompt using the same workflow.
    const failedIndex = messages.findIndex((m) => m.id === assistantMessage.id);
    if (failedIndex < 1) return;
    const userMessage = messages[failedIndex - 1];
    if (!userMessage || userMessage.role !== "user") return;
    // Clear related events and messages.
    setEventHistory((current) => current.filter((e) => e.messageId !== assistantMessage.id));
    setCurrentEvent((current) => (current?.messageId === assistantMessage.id ? null : current));
    setMessages((current) => current.slice(0, failedIndex - 1));
    await submitPrompt(assistantMessage.sourcePrompt, undefined, assistantMessage.workflow);
  }

  async function generateImagesForMessage(message: Message) {
    if (
      message.role !== "assistant" ||
      !message.sourcePrompt ||
      !message.content.trim() ||
      !message.requiredSkillIds?.length ||
      visualizingMessageIds.includes(message.id)
    ) {
      return;
    }

    setVisualizingMessageIds((current) => [...current, message.id]);
    setMessages((current) =>
      current.map((candidate) => (candidate.id === message.id ? { ...candidate, visualStatus: "generating" } : candidate)),
    );

    try {
      const response = await fetch(`${API_BASE}/api/visualizations/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: message.sourcePrompt,
          answer: message.content,
          required_skill_ids: message.requiredSkillIds,
          stock: message.stock,
          context: financialContext(messages),
          session_id: activeSessionId,
          message_id: message.id,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Visualization stream failed with HTTP ${response.status}`);
      }

      let streamErrored = false;
      await readNdjsonStream(response.body, (payload) => {
        streamErrored = processStreamPayload(payload, message.id) || streamErrored;
      });
      setMessages((current) =>
        current.map((candidate) =>
          candidate.id === message.id ? { ...candidate, visualStatus: streamErrored ? "error" : "complete" } : candidate,
        ),
      );
      setStatus(streamErrored ? "error" : "complete");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      appendEvent(message.id, "error", "Visualization error", detail);
      setMessages((current) =>
        current.map((candidate) => (candidate.id === message.id ? { ...candidate, visualStatus: "error" } : candidate)),
      );
      setStatus("error");
    } finally {
      setVisualizingMessageIds((current) => current.filter((id) => id !== message.id));
    }
  }

  async function loadSkills() {
    try {
      const response = await fetch(`${API_BASE}/api/skills`);
      if (!response.ok) {
        throw new Error(`Skill load failed with HTTP ${response.status}`);
      }
      const data = (await response.json()) as Skill[];
      setSkills(data);
      setSelectedSkillIds((current) => current.filter((id) => data.some((skill) => skill.id === id)));
      setSkillError("");
    } catch (error) {
      setSkillError(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadOpenAIKeyStatus() {
    try {
      const response = await fetch(`${API_BASE}/api/settings/openai-key`);
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { configured: boolean };
      setApiKeyConfigured(data.configured);
    } catch {
      // Non-critical status check; stream errors still surface the setup panel.
    }
  }

  async function initializeChatSessions() {
    try {
      const sessions = await fetchChatSessions();
      if (sessions.length > 0) {
        await openChatSession(sessions[0].id, sessions);
      } else {
        await createChatSession();
      }
    } catch (error) {
      console.error("Chat session initialization failed", error);
    }
  }

  async function fetchChatSessions(): Promise<ChatSessionSummary[]> {
    const response = await fetch(`${API_BASE}/api/chat-sessions`);
    if (!response.ok) {
      throw new Error(`Chat sessions load failed with HTTP ${response.status}`);
    }
    const sessions = (await response.json()) as ChatSessionSummary[];
    setChatSessions(sessions);
    return sessions;
  }

  async function createChatSession() {
    const seedMessages = initialMessages(locale);
    sessionLoadingRef.current = true;
    try {
      const response = await fetch(`${API_BASE}/api/chat-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: t.newChat,
          messages_json: seedMessages,
          events_json: [],
        }),
      });
      if (!response.ok) {
        throw new Error(`Chat session create failed with HTTP ${response.status}`);
      }
      const created = (await response.json()) as ChatSessionRead;
      setActiveSessionId(created.id);
      setEventSessionId(created.id);
      setEventSessionMessages([]);
      setEventSessionEvents([]);
      setMessages(sanitizeMessages(created.messages_json, locale));
      setEventHistory([]);
      setCurrentEvent(null);
      setSelectedRoundId(null);
      setActiveGuide(null);
      setInput("");
      eventOrderRef.current = 0;
      await fetchChatSessions();
    } finally {
      sessionLoadingRef.current = false;
    }
  }

  async function openChatSession(sessionId: string, knownSessions = chatSessions) {
    if (sessionId === activeSessionId) {
      return;
    }
    sessionLoadingRef.current = true;
    try {
      const response = await fetch(`${API_BASE}/api/chat-sessions/${sessionId}`);
      if (!response.ok) {
        throw new Error(`Chat session load failed with HTTP ${response.status}`);
      }
      const loaded = (await response.json()) as ChatSessionRead;
      const loadedEvents = sanitizeEvents(loaded.events_json);
      setActiveSessionId(loaded.id);
      setEventSessionId(loaded.id);
      setEventSessionMessages([]);
      setEventSessionEvents([]);
      setMessages(sanitizeMessages(loaded.messages_json, locale));
      setEventHistory(loadedEvents);
      setCurrentEvent(null);
      setSelectedRoundId(null);
      setActiveGuide(null);
      setInput("");
      eventOrderRef.current = nextEventOrder(loadedEvents);
      if (knownSessions.length === 0) {
        await fetchChatSessions();
      }
    } finally {
      sessionLoadingRef.current = false;
    }
  }

  async function saveActiveSession() {
    if (!activeSessionId) {
      return;
    }
    const events = sanitizeEvents(allEvents(currentEvent, eventHistory));
    const title = sessionTitle(messages, t.newChat);
    const response = await fetch(`${API_BASE}/api/chat-sessions/${activeSessionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        messages_json: messages,
        events_json: events,
      }),
    });
    if (!response.ok) {
      throw new Error(`Chat session save failed with HTTP ${response.status}`);
    }
    setChatSessions((current) =>
      current
        .map((session) =>
          session.id === activeSessionId
            ? {
                ...session,
                title,
                message_count: messages.length,
                event_count: events.length,
                updated_at: new Date().toISOString(),
              }
            : session,
        )
        .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at)),
    );
  }

  async function deleteChatSession(sessionId: string) {
    const response = await fetch(`${API_BASE}/api/chat-sessions/${sessionId}`, { method: "DELETE" });
    if (!response.ok) {
      throw new Error(`Chat session delete failed with HTTP ${response.status}`);
    }
    const remaining = await fetchChatSessions();
    if (sessionId === activeSessionId) {
      if (remaining.length > 0) {
        await openChatSession(remaining[0].id, remaining);
      } else {
        await createChatSession();
      }
    }
  }

async function openEventSession(sessionId: string) {
    setEventSessionId(sessionId);
    setEventSessionPickerOpen(false);
    setSelectedRoundId(null);
    if (sessionId === activeSessionId) {
      setEventSessionMessages([]);
      setEventSessionEvents([]);
      return;
    }
    const response = await fetch(`${API_BASE}/api/chat-sessions/${sessionId}`);
    if (!response.ok) {
      throw new Error(`Chat session load failed with HTTP ${response.status}`);
    }
    const loaded = (await response.json()) as ChatSessionRead;
    setEventSessionMessages(sanitizeMessages(loaded.messages_json, locale));
    setEventSessionEvents(sanitizeEvents(loaded.events_json));
  }

  async function deleteRoundLogs(sessionId: string, messageId: string) {
    const isActive = sessionId === activeSessionId;
    const sourceMessages = isActive ? messages : eventSessionMessages;
    const sourceEvents = isActive ? allEvents(currentEvent, eventHistory) : eventSessionEvents;
    const nextEvents = sourceEvents.filter((event) => event.messageId !== messageId);
    const nextMessages = sourceMessages.map((message) =>
      message.id === messageId ? { ...message, activities: [], activitiesComplete: false } : message,
    );
    const title = sessionTitle(nextMessages, t.newChat);

    const response = await fetch(`${API_BASE}/api/chat-sessions/${sessionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        messages_json: nextMessages,
        events_json: nextEvents,
      }),
    });
    if (!response.ok) {
      throw new Error(`Round log delete failed with HTTP ${response.status}`);
    }

    if (isActive) {
      setMessages(nextMessages);
      setCurrentEvent((current) => (current?.messageId === messageId ? null : current));
      setEventHistory((current) => current.filter((event) => event.messageId !== messageId));
    } else {
      setEventSessionMessages(nextMessages);
      setEventSessionEvents(nextEvents);
    }
    setSelectedRoundId((current) => (current === messageId ? null : current));
    setChatSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? { ...session, title, event_count: nextEvents.length, message_count: nextMessages.length, updated_at: new Date().toISOString() }
          : session,
      ),
    );
  }

  async function saveOpenAIKey() {
    const apiKey = apiKeyInput.trim();
    if (!apiKey) {
      setApiKeyMessage(t.apiKeyPasteFirst);
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/settings/openai-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey }),
      });
      if (!response.ok) {
        throw new Error(`API key save failed with HTTP ${response.status}`);
      }
      setApiKeyInput("");
      setApiKeyConfigured(true);
      setApiKeyMessage(t.apiKeySaved);
      setShowApiKeyPanel(false);
      showToast(t.apiKeySaved);
    } catch (error) {
      setApiKeyMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveSkill() {
    const name = skillDraft.name.trim();
    const instructions = skillDraft.instructions.trim();
    if (!name || !instructions) {
      setSkillError(t.skillRequired);
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/skills${editingSkillId ? `/${editingSkillId}` : ""}`, {
        method: editingSkillId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...skillDraft,
          name,
          instructions,
          description: skillDraft.description.trim(),
        }),
      });
      if (!response.ok) {
        throw new Error(`Skill save failed with HTTP ${response.status}`);
      }
      setSkillDraft(EMPTY_SKILL_DRAFT);
      setEditingSkillId(null);
      setShowSkillEditor(false);
      showToast(editingSkillId ? "Skill updated" : "Skill created");
      await loadSkills();
    } catch (error) {
      setSkillError(error instanceof Error ? error.message : String(error));
    }
  }

  async function deleteSkill(id: string) {
    try {
      const response = await fetch(`${API_BASE}/api/skills/${id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(`Skill delete failed with HTTP ${response.status}`);
      }
      setSelectedSkillIds((current) => current.filter((skillId) => skillId !== id));
      await loadSkills();
    } catch (error) {
      setSkillError(error instanceof Error ? error.message : String(error));
    }
  }

  function editSkill(skill: Skill) {
    setEditingSkillId(skill.id);
    setSkillDraft({
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
    });
    setShowSkillEditor(true);
  }

  function toggleSkill(id: string) {
    if (!selectedSkillIds.includes(id) && selectedSkillIds.length >= MAX_SELECTED_SKILLS) {
      setSkillError(t.skillLimit(MAX_SELECTED_SKILLS));
      return;
    }
    setSelectedSkillIds((current) => {
      if (current.includes(id)) {
        return current.filter((skillId) => skillId !== id);
      }
      setSkillError("");
      return [...current, id];
    });
  }

  function newSkill() {
    setEditingSkillId(null);
    setSkillDraft(EMPTY_SKILL_DRAFT);
    setShowSkillEditor(true);
  }

  async function draftSkill() {
    const prompt = input.trim() || skillDraft.description.trim() || skillDraft.name.trim();
    if (!prompt) {
      setSkillError(t.skillDraftPrompt);
      return;
    }

    // Warn before overwriting user's in-progress draft.
    const hasExistingContent =
      skillDraft.name.trim() || skillDraft.description.trim() || skillDraft.instructions.trim();
    if (hasExistingContent && !window.confirm(t.skillDraftOverwrite)) {
      return;
    }

    setIsDraftingSkill(true);
    try {
      const response = await fetch(`${API_BASE}/api/skills/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          context: financialContext(messages),
        }),
      });
      if (!response.ok) {
        throw new Error(`Skill draft failed with HTTP ${response.status}`);
      }
      const draft = (await response.json()) as SkillDraft;
      setSkillDraft(draft);
      setEditingSkillId(null);
      setShowSkillEditor(true);
      setSkillError("");
    } catch (error) {
      setSkillError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsDraftingSkill(false);
    }
  }

  function toggleVoiceInput() {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setVoiceMessage(t.voiceUnavailable);
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = locale === "ja" ? "ja-JP" : locale === "zh-TW" ? "zh-TW" : "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) {
        setInput((current) => `${current}${current ? " " : ""}${transcript}`);
      }
    };
    recognition.onerror = (event) => {
      setVoiceMessage(event.error ? `Voice input: ${event.error}` : t.voiceUnavailable);
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening(false);
    };
    recognitionRef.current = recognition;
    setVoiceMessage(t.listening);
    setIsListening(true);
    recognition.start();
  }

  function processStreamPayload(payload: Record<string, unknown>, assistantId: string): boolean {
    const type = String(payload.type ?? "event");

    if (type === "text_delta") {
      const delta = String(payload.delta ?? "");
      appendAssistantText(assistantId, delta);
      return false;
    }

    if (type === "reasoning_delta") {
      const delta = String(payload.delta ?? "");
      if (delta.trim()) {
        appendEvent(assistantId, type, "Reasoning", delta);
      }
      return false;
    }

    if (type === "tool_called") {
      appendEvent(assistantId, type, "Tool called", summarize(payload.item));
      return false;
    }

    if (type === "tool_output") {
      appendEvent(assistantId, type, "Tool output", summarize(payload.output));
      return false;
    }

    if (type === "agent_started") {
      appendAssistantActivity(assistantId, type, activityLabel(type, payload, t));
      appendEvent(assistantId, type, `Agent started: ${String(payload.agent ?? "unknown")}`, summarize(payload));
      return false;
    }

    if (type === "agent_completed") {
      appendAssistantActivity(assistantId, type, activityLabel(type, payload, t));
      appendEvent(assistantId, type, `Agent completed: ${String(payload.agent ?? "unknown")}`, summarize(payload));
      return false;
    }

    if (type === "manager_started") {
      appendAssistantActivity(assistantId, type, activityLabel(type, payload, t));
      appendEvent(assistantId, type, "Manager started", summarize(payload));
      return false;
    }

    if (type === "manager_planning_started") {
      appendAssistantActivity(assistantId, type, activityLabel(type, payload, t));
      appendEvent(assistantId, type, "Manager planning started", summarize(payload));
      return false;
    }

    if (type === "execution_plan_created") {
      appendAssistantActivity(assistantId, type, activityLabel(type, payload, t));
      appendEvent(assistantId, type, "Execution plan created", summarize(payload));
      return false;
    }

    if (type === "skill_selected_by_manager") {
      appendAssistantActivity(assistantId, type, activityLabel(type, payload, t));
      appendEvent(
        assistantId,
        type,
        `Manager selected: ${String(payload.skill_name ?? payload.skill_id ?? "skill")}`,
        summarize(payload),
      );
      return false;
    }

    if (type === "skill_skipped_by_manager") {
      appendEvent(
        assistantId,
        type,
        `Manager skipped: ${String(payload.skill_name ?? payload.skill_id ?? "skill")}`,
        summarize(payload),
      );
      return false;
    }

    if (type === "no_relevant_skills") {
      appendAssistantActivity(assistantId, type, activityLabel(type, payload, t));
      appendEvent(assistantId, type, "No matching skills", summarize(payload));
      return false;
    }

    if (type === "trace_started") {
      appendAssistantActivity(assistantId, type, activityLabel(type, payload, t));
      appendEvent(assistantId, type, `Trace started: ${String(payload.workflow ?? "workflow")}`, summarize(payload));
      return false;
    }

    if (type === "trace_completed") {
      appendEvent(assistantId, type, `Trace completed: ${String(payload.workflow ?? "workflow")}`, summarize(payload));
      return false;
    }

    if (type === "manager_completed") {
      appendAssistantActivity(assistantId, type, activityLabel(type, payload, t));
      appendEvent(assistantId, type, "Manager completed", summarize(payload));
      return false;
    }

    if (type === "specialist_started") {
      appendAssistantActivity(assistantId, type, activityLabel(type, payload, t));
      appendEvent(assistantId, type, `Specialist started: ${String(payload.agent ?? "unknown")}`, summarize(payload));
      return false;
    }

    if (type === "specialist_completed") {
      appendAssistantActivity(assistantId, type, activityLabel(type, payload, t));
      appendEvent(assistantId, type, `Specialist completed: ${String(payload.agent ?? "unknown")}`, summarize(payload));
      return false;
    }

    if (type === "source_found") {
      appendEvent(assistantId, type, `Source: ${String(payload.title ?? payload.url ?? "source")}`, summarize(payload));
      return false;
    }

    if (type === "image_generated") {
      appendEvent(assistantId, type, `Image generated: ${String(payload.title ?? "visual summary")}`, summarize(payload));
      const imageUrl = imageUrlFromPayload(payload.image);
      const imageId = String(payload.id ?? crypto.randomUUID());
      upsertAssistantImage(assistantId, {
        id: imageId,
        title: String(payload.title ?? "Financial visual summary"),
        description: String(payload.description ?? ""),
        imageUrl,
        agent: typeof payload.agent === "string" ? payload.agent : undefined,
        skillId: typeof payload.skill_id === "string" ? payload.skill_id : undefined,
        traceId: typeof payload.trace_id === "string" ? payload.trace_id : undefined,
        traceUrl: typeof payload.trace_url === "string" ? payload.trace_url : undefined,
        createdAt: new Date().toISOString(),
        status: "ready",
      });
      if (imageUrl) {
        createImagePreview(imageUrl).then((previewUrl) => {
          if (previewUrl) {
            upsertAssistantImage(assistantId, { id: imageId, title: "", description: "", previewUrl });
          }
        });
      }
      return false;
    }

    if (type === "image_generation_started") {
      appendAssistantActivity(assistantId, type, activityLabel(type, payload, t));
      appendEvent(assistantId, type, `Image generation started: ${String(payload.title ?? "visual summary")}`, summarize(payload));
      upsertAssistantImage(assistantId, {
        id: String(payload.id ?? crypto.randomUUID()),
        title: String(payload.title ?? "Financial visual summary"),
        description: String(payload.description ?? t.imageGenerating),
        agent: typeof payload.agent === "string" ? payload.agent : undefined,
        skillId: typeof payload.skill_id === "string" ? payload.skill_id : undefined,
        traceId: typeof payload.trace_id === "string" ? payload.trace_id : undefined,
        traceUrl: typeof payload.trace_url === "string" ? payload.trace_url : undefined,
        createdAt: new Date().toISOString(),
        status: "loading",
      });
      return false;
    }

    if (type === "mcp_ready") {
      return false;
    }

    if (type === "done") {
      completeAssistantActivities(assistantId);
      return false;
    }

    if (type === "error") {
      const message = String(payload.message ?? "Unknown error");
      const errorType = String(payload.error_type ?? "");
      const traceback = typeof payload.traceback === "string" ? payload.traceback.trim() : "";
      const detail = traceback ? `${message}\n\n${traceback}` : message;
      if (message.includes("OPENAI_API_KEY")) {
        setShowApiKeyPanel(true);
        setApiKeyConfigured(false);
        setApiKeyMessage(t.apiKeyHint);
        appendAssistantText(
          assistantId,
          `\n\n${t.apiKeyMissing}`,
        );
      } else {
        const heading = errorType ? `${errorType}: ${message}` : message;
        appendAssistantText(
          assistantId,
          traceback ? `\n\n${heading}\n\n\`\`\`text\n${traceback}\n\`\`\`` : `\n\n${heading}`,
        );
      }
      appendEvent(assistantId, type, errorType ? `Backend error: ${errorType}` : "Backend error", detail);
      return true;
    }

    if (type === "reasoning_event") {
      appendEvent(assistantId, type, "Reasoning event", summarize(payload));
    }
    return false;
  }

  function appendAssistantText(id: string, delta: string) {
    setMessages((current) =>
      current.map((message) => (message.id === id ? { ...message, content: message.content + delta } : message)),
    );
  }

  function upsertAssistantImage(id: string, image: GeneratedImage) {
    setMessages((current) =>
      current.map((message) =>
        message.id === id
          ? {
              ...message,
              images: (message.images ?? []).some((existing) => existing.id === image.id)
                ? (message.images ?? []).map((existing) =>
                    existing.id === image.id
                      ? {
                          ...existing,
                          ...image,
                          title: image.title || existing.title,
                          description: image.description || existing.description,
                          imageUrl: image.imageUrl || existing.imageUrl,
                        }
                      : existing,
                  )
                : [...(message.images ?? []), image],
            }
          : message,
      ),
    );
  }

  function appendAssistantActivity(id: string, type: string, label: string) {
    if (!label) {
      return;
    }
    setMessages((current) =>
      current.map((message) => {
        if (message.id !== id) {
          return message;
        }
        const activities = message.activities ?? [];
        const previous = activities[activities.length - 1];
        if (previous?.type === type && previous.label === label) {
          return message;
        }
        return {
          ...message,
          activities: [...activities, { id: crypto.randomUUID(), type, label, createdAt: new Date().toISOString() }],
          activitiesComplete: false,
        };
      }),
    );
  }

  function completeAssistantActivities(id: string) {
    setMessages((current) =>
      current.map((message) => (message.id === id ? { ...message, activitiesComplete: true } : message)),
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
    <>
    <main className="app-shell">
      <section className="workspace">
        <AppHeader
          locale={locale}
          status={status}
          isStreaming={isStreaming}
          onLocaleChange={changeLocale}
          onShowGuide={showGuide}
          t={t}
        />

        <div className="main-grid">
          <ActivityRail
            activeTab={activityTab}
            sessions={chatSessions}
            activeSessionId={activeSessionId}
            eventSessionId={eventSessionId}
            eventSessionPickerOpen={eventSessionPickerOpen}
            eventGroups={eventGroups}
            currentEventId={currentEvent?.id}
            onTabChange={setActivityTab}
            onNewSession={createChatSession}
            onOpenSession={openChatSession}
            onDeleteSession={deleteChatSession}
            onOpenEventSession={openEventSession}
            onToggleEventSessionPicker={() => setEventSessionPickerOpen((current) => !current)}
            onDeleteRoundLogs={(messageId) => eventSessionId && deleteRoundLogs(eventSessionId, messageId)}
            t={t}
          />

          <ChatWorkspace
            messages={messages}
            isStreaming={isStreaming}
            input={input}
            showTutorial={showTutorial}
            shouldShowStarters={shouldShowStarters}
            tutorialStep={tutorialStep}
            activeExample={activeExample}
            activeGuide={activeGuide}
            showApiKeyPanel={showApiKeyPanel}
            apiKeyConfigured={apiKeyConfigured}
            apiKeyInput={apiKeyInput}
            apiKeyMessage={apiKeyMessage}
            selectedSkillCount={selectedSkillIds.length}
            isListening={isListening}
            voiceMessage={voiceMessage}
            bottomRef={bottomRef}
            messageListRef={messageListRef}
            onInputChange={setInput}
            onKeyDown={handleKeyDown}
            onSubmit={handleSubmit}
            onTutorialBack={() => setTutorialStep((current) => Math.max(0, current - 1))}
            onTutorialNext={() => setTutorialStep((current) => Math.min(TUTORIAL_STEPS.length - 1, current + 1))}
            onTutorialDone={dismissTutorial}
            onStartGuide={startGuidedExample}
            onContinueGuide={continueGuidedExample}
            onResetGuide={() => setActiveGuide(null)}
            onToggleApiKeyPanel={() => setShowApiKeyPanel((current) => !current)}
            onApiKeyInputChange={setApiKeyInput}
            onSaveOpenAIKey={saveOpenAIKey}
            onOpenSkills={() => setShowSkillDrawer(true)}
            onToggleVoiceInput={toggleVoiceInput}
            onViewImage={(image, gallery) => {
              setImageZoomMode("fit");
              setSelectedImage(image);
              setSelectedImageGallery(gallery);
            }}
            onOpenEvents={(messageId) => setSelectedRoundId(messageId)}
            onGenerateImages={generateImagesForMessage}
            onRetry={retryMessage}
            visualizingMessageIds={visualizingMessageIds}
            t={t}
          />

          <aside className={`side-panel ${showSkillDrawer ? "open" : ""}`} aria-label="Task setup">
            <SkillDrawer
              skills={skills}
              selectedSkillIds={selectedSkillIds}
              editingSkillId={editingSkillId}
              error={skillError}
              page={skillPage}
              onToggleSkill={toggleSkill}
              onEditSkill={editSkill}
              onDeleteSkill={deleteSkill}
              onNewSkill={newSkill}
              onPageChange={setSkillPage}
              onClose={() => setShowSkillDrawer(false)}
              t={t}
            />
          </aside>
          {showSkillDrawer && (
            <div
              className="side-panel-backdrop"
              onClick={() => setShowSkillDrawer(false)}
              aria-hidden="true"
            />
          )}
        </div>
      </section>
    </main>
    {showSkillEditor ? (
      <SkillEditorModal
        skillDraft={skillDraft}
        editingSkillId={editingSkillId}
        isDrafting={isDraftingSkill}
        onDraftSkill={draftSkill}
        onCancelEdit={() => {
          setShowSkillEditor(false);
          setEditingSkillId(null);
          setSkillDraft(EMPTY_SKILL_DRAFT);
        }}
        onDraftChange={setSkillDraft}
        onSaveSkill={saveSkill}
        t={t}
      />
    ) : null}
    {selectedRound ? (
      <RoundLogModal
        group={selectedRound}
        currentEventId={currentEvent?.id}
        onClose={() => setSelectedRoundId(null)}
        t={t}
      />
    ) : null}
    {selectedImage ? (
      <ImageLightbox
        image={selectedImage}
        gallery={selectedImageGallery.length ? selectedImageGallery : [selectedImage]}
        zoomMode={imageZoomMode}
        onZoomModeChange={setImageZoomMode}
        onSelect={(next) => setSelectedImage(next)}
        onClose={() => {
          setSelectedImage(null);
          setSelectedImageGallery([]);
        }}
        t={t}
      />
    ) : null}
    <ToastContainer toasts={toasts} />
    </>
  );
}

function AppHeader({
  locale,
  status,
  isStreaming,
  onLocaleChange,
  onShowGuide,
  t,
}: {
  locale: Locale;
  status: StatusKey;
  isStreaming: boolean;
  onLocaleChange: (locale: Locale) => void;
  onShowGuide: () => void;
  t: typeof TRANSLATIONS.en;
}) {
  return (
    <header className="topbar">
      <div className="brand-block">
        <div className="eyebrow">
          <Server size={13} />
          {t.eyebrow}
        </div>
        <h1>{t.title}</h1>
      </div>
      <div className="topbar-actions">
        <label className="language-switcher" aria-label={t.language}>
          <Languages size={15} />
          <select value={locale} onChange={(event) => onLocaleChange(event.target.value as Locale)}>
            {Object.entries(LANGUAGE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button className="guide-button" type="button" onClick={onShowGuide}>
          <CircleHelp size={15} />
          {t.guide}
        </button>
        <div className="status-pill" data-active={isStreaming}>
          {isStreaming ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} />}
          {t[status]}
        </div>
      </div>
    </header>
  );
}

function ActivityRail({
  activeTab,
  sessions,
  activeSessionId,
  eventSessionId,
  eventSessionPickerOpen,
  eventGroups,
  currentEventId,
  onTabChange,
  onNewSession,
  onOpenSession,
  onDeleteSession,
  onOpenEventSession,
  onToggleEventSessionPicker,
  onDeleteRoundLogs,
  t,
}: {
  activeTab: ActivityTab;
  sessions: ChatSessionSummary[];
  activeSessionId: string | null;
  eventSessionId: string | null;
  eventSessionPickerOpen: boolean;
  eventGroups: EventGroup[];
  currentEventId?: string;
  onTabChange: (tab: ActivityTab) => void;
  onNewSession: () => void;
  onOpenSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onOpenEventSession: (id: string) => void;
  onToggleEventSessionPicker: () => void;
  onDeleteRoundLogs: (messageId: string) => void;
  t: typeof TRANSLATIONS.en;
}) {
  const selectedEventSession = sessions.find((session) => session.id === eventSessionId) ?? sessions[0] ?? null;

  return (
    <aside className="activity-rail" aria-label={`${t.chatSessions} and ${t.eventHistory}`}>
      <div className="activity-tabs" role="tablist">
        <button
          type="button"
          className={activeTab === "sessions" ? "active" : ""}
          onClick={() => onTabChange("sessions")}
          role="tab"
          aria-selected={activeTab === "sessions"}
        >
          <MessageSquare size={15} />
          {t.chatSessions}
        </button>
        <button
          type="button"
          className={activeTab === "events" ? "active" : ""}
          onClick={() => onTabChange("events")}
          role="tab"
          aria-selected={activeTab === "events"}
        >
          <Brain size={15} />
          {t.eventHistory}
        </button>
      </div>

      {activeTab === "sessions" ? (
        <section className="activity-panel" aria-label={t.chatSessions}>
          <button type="button" className="new-session-button" onClick={onNewSession}>
            <Plus size={15} />
            {t.newChat}
          </button>
          <div className="session-list">
            {sessions.length === 0 ? (
              <p className="empty-event">{t.noEvents}</p>
            ) : (
              sessions.map((session) => (
                <article className={`session-row ${session.id === activeSessionId ? "active" : ""}`} key={session.id}>
                  <button
                    type="button"
                    onClick={() => onOpenSession(session.id)}
                    aria-label={`${t.openChatSession}: ${session.title}`}
                  >
                    <strong>{session.title}</strong>
                    <span>
                      {t.messageCount(session.message_count)} · {t.eventCount(session.event_count)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="delete-session-button"
                    onClick={() => onDeleteSession(session.id)}
                    aria-label={`${t.deleteChatSession}: ${session.title}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </article>
              ))
            )}
          </div>
        </section>
      ) : (
        <section className="activity-panel" aria-label={t.eventHistory}>
          <div className={`event-session-container ${eventSessionPickerOpen ? "picker-open" : ""}`}>
            <div className={`event-session-dropdown ${eventSessionPickerOpen ? "open" : ""}`} aria-label={t.eventSession}>
              {selectedEventSession ? (
                <button
                  type="button"
                  className="event-session-trigger"
                  onClick={onToggleEventSessionPicker}
                  aria-expanded={eventSessionPickerOpen}
                >
                  <span>
                    <strong>{selectedEventSession.title}</strong>
                    <small>
                      {t.messageCount(selectedEventSession.message_count)} · {t.eventCount(selectedEventSession.event_count)}
                    </small>
                  </span>
                  <em>{selectedEventSession.event_count}</em>
                  <ChevronDown size={14} />
                </button>
              ) : (
                <p className="empty-event">{t.noEvents}</p>
              )}
              {eventSessionPickerOpen && sessions.filter((s) => s.id !== eventSessionId).length > 0 ? (
                <div className="event-session-menu">
                  {sessions
                    .filter((session) => session.id !== eventSessionId)
                    .map((session) => (
                      <button
                        type="button"
                        key={session.id}
                        onClick={() => onOpenEventSession(session.id)}
                        title={session.title}
                      >
                        <span>
                          <strong>{session.title}</strong>
                          <small>
                            {t.messageCount(session.message_count)} · {t.eventCount(session.event_count)}
                          </small>
                        </span>
                      </button>
                    ))}
                </div>
              ) : null}
            </div>
            {!eventSessionPickerOpen && (
              <div className="event-list">
                {eventGroups.length === 0 ? (
                  <p className="empty-event">{t.noEvents}</p>
                ) : (
                  eventGroups.map((group) => (
                    <RoundEventGroup
                      key={group.messageId}
                      group={group}
                      currentEventId={currentEventId}
                      onDelete={() => onDeleteRoundLogs(group.messageId)}
                      t={t}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </section>
      )}
    </aside>
  );
}

function ChatWorkspace({
  messages,
  isStreaming,
  input,
  showTutorial,
  shouldShowStarters,
  tutorialStep,
  activeExample,
  activeGuide,
  showApiKeyPanel,
  apiKeyConfigured,
  apiKeyInput,
  apiKeyMessage,
  selectedSkillCount,
  isListening,
  voiceMessage,
  bottomRef,
  messageListRef,
  onInputChange,
  onKeyDown,
  onSubmit,
  onTutorialBack,
  onTutorialNext,
  onTutorialDone,
  onStartGuide,
  onContinueGuide,
  onResetGuide,
  onToggleApiKeyPanel,
  onApiKeyInputChange,
  onSaveOpenAIKey,
  onOpenSkills,
  onToggleVoiceInput,
  onViewImage,
  onOpenEvents,
  onGenerateImages,
  onRetry,
  visualizingMessageIds,
  t,
}: {
  messages: Message[];
  isStreaming: boolean;
  input: string;
  showTutorial: boolean;
  shouldShowStarters: boolean;
  tutorialStep: number;
  activeExample: GuidedExample | null | undefined;
  activeGuide: ActiveGuide | null;
  showApiKeyPanel: boolean;
  apiKeyConfigured: boolean;
  apiKeyInput: string;
  apiKeyMessage: string;
  selectedSkillCount: number;
  isListening: boolean;
  voiceMessage: string;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  messageListRef: React.RefObject<HTMLDivElement | null>;
  onInputChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTutorialBack: () => void;
  onTutorialNext: () => void;
  onTutorialDone: () => void;
  onStartGuide: (example: GuidedExample) => void;
  onContinueGuide: () => void;
  onResetGuide: () => void;
  onToggleApiKeyPanel: () => void;
  onApiKeyInputChange: (value: string) => void;
  onSaveOpenAIKey: () => void;
  onOpenSkills: () => void;
  onToggleVoiceInput: () => void;
  onViewImage: (image: GeneratedImage, gallery: GeneratedImage[]) => void;
  onOpenEvents: (messageId: string) => void;
  onGenerateImages: (message: Message) => void;
  onRetry: (message: Message) => void;
  visualizingMessageIds: string[];
  t: typeof TRANSLATIONS.en;
}) {
  return (
    <section className="chat-workspace" aria-label="Chat conversation">
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        bottomRef={bottomRef}
        messageListRef={messageListRef}
        onOpenEvents={onOpenEvents}
        onViewImage={onViewImage}
        onGenerateImages={onGenerateImages}
        onRetry={onRetry}
        visualizingMessageIds={visualizingMessageIds}
        t={t}
      />

      {(showTutorial || shouldShowStarters) && (
        <section className={`starter-area ${showTutorial ? "with-tutorial" : ""}`} aria-label="Getting started">
          {showTutorial && (
            <TutorialPanel
              step={tutorialStep}
              steps={TUTORIAL_STEPS}
              t={t}
              onBack={onTutorialBack}
              onNext={onTutorialNext}
              onDone={onTutorialDone}
            />
          )}

          {shouldShowStarters && (
            <PromptSuggestions
              examples={GUIDED_EXAMPLES}
              activeExample={activeExample}
              activeGuide={activeGuide}
              t={t}
              onStart={onStartGuide}
              onContinue={onContinueGuide}
              onReset={onResetGuide}
            />
          )}
        </section>
      )}

      <Composer
        input={input}
        showApiKeyPanel={showApiKeyPanel}
        apiKeyConfigured={apiKeyConfigured}
        apiKeyInput={apiKeyInput}
        apiKeyMessage={apiKeyMessage}
        selectedSkillCount={selectedSkillCount}
        isStreaming={isStreaming}
        isListening={isListening}
        voiceMessage={voiceMessage}
        onInputChange={onInputChange}
        onKeyDown={onKeyDown}
        onSubmit={onSubmit}
        onToggleApiKeyPanel={onToggleApiKeyPanel}
        onApiKeyInputChange={onApiKeyInputChange}
        onSaveOpenAIKey={onSaveOpenAIKey}
        onOpenSkills={onOpenSkills}
        onToggleVoiceInput={onToggleVoiceInput}
        t={t}
      />
    </section>
  );
}

function MessageList({
  messages,
  isStreaming,
  bottomRef,
  messageListRef,
  onOpenEvents,
  onViewImage,
  onGenerateImages,
  onRetry,
  visualizingMessageIds,
  t,
}: {
  messages: Message[];
  isStreaming: boolean;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  messageListRef: React.RefObject<HTMLDivElement | null>;
  onOpenEvents: (messageId: string) => void;
  onViewImage: (image: GeneratedImage, gallery: GeneratedImage[]) => void;
  onGenerateImages: (message: Message) => void;
  onRetry: (message: Message) => void;
  visualizingMessageIds: string[];
  t: typeof TRANSLATIONS.en;
}) {
  const [showScrollButton, setShowScrollButton] = useState(false);

  const handleScroll = useCallback(() => {
    const el = messageListRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollButton(distanceFromBottom > 120);
  }, [messageListRef]);

  useEffect(() => {
    const el = messageListRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll, messageListRef]);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  return (
    <div className="message-list" ref={messageListRef}>
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          isStreaming={isStreaming}
          onOpenEvents={() => onOpenEvents(message.id)}
          onViewImage={onViewImage}
          onGenerateImages={() => onGenerateImages(message)}
          onRetry={() => onRetry(message)}
          isGenerating={visualizingMessageIds.includes(message.id)}
          t={t}
        />
      ))}
      <div ref={bottomRef} />
      {showScrollButton && (
        <button
          type="button"
          className="scroll-to-bottom"
          onClick={scrollToBottom}
          aria-label={t.scrollToBottom}
          title={t.scrollToBottom}
        >
          <ArrowDown size={16} />
        </button>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  isStreaming,
  onOpenEvents,
  onViewImage,
  onGenerateImages,
  onRetry,
  isGenerating,
  t,
}: {
  message: Message;
  isStreaming: boolean;
  onOpenEvents: () => void;
  onViewImage: (image: GeneratedImage, gallery: GeneratedImage[]) => void;
  onGenerateImages: () => void;
  onRetry: () => void;
  isGenerating: boolean;
  t: typeof TRANSLATIONS.en;
}) {
  const [copied, setCopied] = useState(false);
  const content = visibleMessageContent(message, isStreaming);
  const roleLabel = message.role === "user" ? t.roleYou : t.roleAssistant;

  const handleCopy = async () => {
    if (!message.content.trim()) return;
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <article className={`message ${message.role} ${message.errored ? "errored" : ""}`}>
      <div className="message-header">
        <span className="role-label">{roleLabel}</span>
        {message.content.trim() && (
          <div className="message-actions">
            {message.role === "assistant" && message.errored && message.sourcePrompt && (
              <button
                type="button"
                className="message-action-button message-retry-button"
                onClick={onRetry}
                aria-label={t.retry}
                title={t.retry}
              >
                <RefreshCw size={13} />
              </button>
            )}
            <button
              type="button"
              className={`message-action-button ${copied ? "copied" : ""}`}
              onClick={handleCopy}
              aria-label={t.copyMessage}
              title={t.copyMessage}
            >
              {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
            </button>
          </div>
        )}
      </div>
      {content ? (
        message.role === "assistant" ? (
          <div className="message-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{normalizeMarkdown(content)}</ReactMarkdown>
          </div>
        ) : (
          <p>{content}</p>
        )
      ) : null}
      {message.activities?.length && !message.content.trim() && !message.activitiesComplete ? (
        <ActivityStrip message={message} onOpenEvents={onOpenEvents} t={t} />
      ) : null}
      {message.images?.length ? (
        <ImageArtifactGallery images={message.images} onViewImage={onViewImage} t={t} />
      ) : null}
      <MessageVisualActions
        message={message}
        isGenerating={isGenerating}
        onGenerateImages={onGenerateImages}
        t={t}
      />
    </article>
  );
}

function ActivityStrip({
  message,
  onOpenEvents,
  t,
}: {
  message: Message;
  onOpenEvents: () => void;
  t: typeof TRANSLATIONS.en;
}) {
  const visibleActivities = (message.activities ?? []).slice(-5);

  return (
    <section className="activity-strip" aria-label={t.liveActivity} data-complete={message.activitiesComplete}>
      <div className="activity-strip-header">
        <span>{message.activitiesComplete ? t.activityCompleted : t.liveActivity}</span>
        <button type="button" onClick={onOpenEvents}>
          {t.viewEvents}
        </button>
      </div>
      {!message.activitiesComplete ? (
        <div className="activity-strip-list">
          {visibleActivities.map((activity) => (
            <span key={activity.id}>
              <Loader2 size={12} className="spin" />
              {activity.label}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MessageVisualActions({
  message,
  isGenerating,
  onGenerateImages,
  t,
}: {
  message: Message;
  isGenerating: boolean;
  onGenerateImages: () => void;
  t: typeof TRANSLATIONS.en;
}) {
  if (message.role !== "assistant" || !message.content.trim() || message.content.trim() === TRANSLATIONS.en.assistantIntro) {
    return null;
  }
  if (!message.requiredSkillIds?.length) {
    return null;
  }
  const disabled = isGenerating || message.visualStatus === "generating";
  return (
    <div className="message-visual-actions">
      <button type="button" onClick={onGenerateImages} disabled={disabled}>
        {disabled ? <Loader2 className="spin" size={14} /> : <WandSparkles size={14} />}
        {disabled ? t.generatingImages : t.generateImages}
      </button>
      <span>{message.requiredSkillsSnapshot?.map((skill) => skill.name).join(" · ") || t.noSavedRequiredSkills}</span>
    </div>
  );
}

function ImageArtifactGallery({
  images,
  onViewImage,
  t,
}: {
  images: GeneratedImage[];
  onViewImage: (image: GeneratedImage, gallery: GeneratedImage[]) => void;
  t: typeof TRANSLATIONS.en;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedImage = images.find((image) => image.id === selectedId) ?? images.find((image) => image.imageUrl) ?? images[0];

  if (!selectedImage) {
    return null;
  }

  return (
    <section className="visual-gallery" aria-label={t.visualArtifacts}>
      <div className="visual-gallery-header">
        <div>
          <span className="section-kicker">{t.visualArtifacts}</span>
          <strong>{images.length} visualizations</strong>
        </div>
        <span>{selectedImage.agent || t.managerAgent}</span>
      </div>

      <article className="visual-gallery-stage" data-loading={selectedImage.status === "loading"}>
        <button
          type="button"
          className="visual-gallery-preview"
          onClick={() => selectedImage.imageUrl && onViewImage(selectedImage, images)}
          disabled={!selectedImage.imageUrl}
          aria-label={`${t.viewImage}: ${selectedImage.title}`}
        >
          {selectedImage.imageUrl ? (
            <img src={selectedImage.previewUrl || selectedImage.imageUrl} alt={selectedImage.title} />
          ) : (
            <span className="image-skeleton" />
          )}
        </button>
        <div className="visual-gallery-detail">
          <strong>{selectedImage.title}</strong>
          <span>{selectedImage.agent || t.managerAgent}</span>
          <p>{selectedImage.status === "loading" ? t.imageGenerating : selectedImage.description}</p>
          <div className="image-artifact-actions">
            <button type="button" onClick={() => onViewImage(selectedImage, images)} disabled={!selectedImage.imageUrl}>
              <ZoomIn size={13} />
              {t.viewImage}
            </button>
            {selectedImage.imageUrl ? (
              <a href={selectedImage.imageUrl} download={`${safeFileName(selectedImage.title)}.png`}>
                <Download size={13} />
                {t.downloadImage}
              </a>
            ) : null}
            <button type="button" onClick={() => copyImageToClipboard(selectedImage)} disabled={!selectedImage.imageUrl}>
              <Copy size={13} />
              {t.copyImage}
            </button>
            {selectedImage.imageUrl ? (
              <a href={selectedImage.imageUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={13} />
                {t.openImage}
              </a>
            ) : null}
          </div>
        </div>
      </article>

      <div className="visual-gallery-thumbs" role="list" aria-label={t.visualArtifacts}>
        {images.map((image, index) => (
          <button
            type="button"
            className={`visual-thumb ${image.id === selectedImage.id ? "active" : ""}`}
            key={image.id}
            onClick={() => setSelectedId(image.id)}
            role="listitem"
            aria-pressed={image.id === selectedImage.id}
          >
            <span className="visual-thumb-image">
              {image.imageUrl ? <img src={image.previewUrl || image.imageUrl} alt="" /> : <span className="image-skeleton" />}
            </span>
            <span className="visual-thumb-copy">
              <strong>{image.title}</strong>
              <small>{index + 1} / {images.length}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Composer({
  input,
  showApiKeyPanel,
  apiKeyConfigured,
  apiKeyInput,
  apiKeyMessage,
  selectedSkillCount,
  isStreaming,
  isListening,
  voiceMessage,
  onInputChange,
  onKeyDown,
  onSubmit,
  onToggleApiKeyPanel,
  onApiKeyInputChange,
  onSaveOpenAIKey,
  onOpenSkills,
  onToggleVoiceInput,
  t,
}: {
  input: string;
  showApiKeyPanel: boolean;
  apiKeyConfigured: boolean;
  apiKeyInput: string;
  apiKeyMessage: string;
  selectedSkillCount: number;
  isStreaming: boolean;
  isListening: boolean;
  voiceMessage: string;
  onInputChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onToggleApiKeyPanel: () => void;
  onApiKeyInputChange: (value: string) => void;
  onSaveOpenAIKey: () => void;
  onOpenSkills: () => void;
  onToggleVoiceInput: () => void;
  t: typeof TRANSLATIONS.en;
}) {
  return (
    <form className="composer" onSubmit={onSubmit}>
      <label className="sr-only" htmlFor="message">
        {t.messageLabel}
      </label>
      <textarea
        id="message"
        value={input}
        onChange={(event) => onInputChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t.placeholder}
        rows={1}
      />
      <div className={`api-key-panel ${showApiKeyPanel ? "open" : ""}`} aria-hidden={!showApiKeyPanel}>
        <div>
          <strong>{t.apiKeyTitle}</strong>
          <small>{apiKeyConfigured ? t.apiKeyConfigured : t.apiKeyNeeded}</small>
        </div>
        <div className="api-key-controls">
          <input
            type="password"
            value={apiKeyInput}
            onChange={(event) => onApiKeyInputChange(event.target.value)}
            placeholder={t.apiKeyPlaceholder}
            autoComplete="off"
          />
          <button type="button" onClick={onSaveOpenAIKey}>
            {t.saveKey}
          </button>
        </div>
        {apiKeyMessage ? <p>{apiKeyMessage}</p> : null}
      </div>
      <div className="composer-toolbar" aria-label="Composer controls">
        <div className="composer-tools">
          <button
            type="button"
            className={`composer-icon-button api-key-button ${showApiKeyPanel ? "open" : ""} ${!apiKeyConfigured ? "attention" : ""}`}
            aria-label={t.openApiSettings}
            aria-expanded={showApiKeyPanel}
            onClick={onToggleApiKeyPanel}
          >
            <KeyRound size={17} />
            {!apiKeyConfigured ? <span className="api-key-dot" aria-hidden="true" /> : null}
          </button>
          <button type="button" className="composer-mode-pill" onClick={onOpenSkills}>
            <ShieldCheck size={14} />
            {t.requiredSkillsCount(selectedSkillCount)}
            <ChevronDown size={14} />
          </button>
        </div>
        <div className="composer-actions">
          <span className="composer-model-pill">{t.managerAgent}</span>
          <button
            type="button"
            className={`composer-icon-button ${isListening ? "listening" : ""}`}
            aria-label={isListening ? t.stopVoiceInput : t.voiceInput}
            title={isListening ? t.stopVoiceInput : t.voiceInput}
            onClick={onToggleVoiceInput}
          >
            <Mic size={16} />
          </button>
          <button
            type="submit"
            className="composer-send-button"
            disabled={isStreaming || !input.trim()}
            aria-label={t.sendMessage}
          >
            <Send size={17} />
            <span>{t.send}</span>
          </button>
        </div>
      </div>
      {voiceMessage ? <p className="composer-notice">{voiceMessage}</p> : null}
    </form>
  );
}

function SkillDrawer({
  skills,
  selectedSkillIds,
  editingSkillId,
  error,
  page,
  onToggleSkill,
  onEditSkill,
  onDeleteSkill,
  onNewSkill,
  onPageChange,
  onClose,
  t,
}: {
  skills: Skill[];
  selectedSkillIds: string[];
  editingSkillId: string | null;
  error: string;
  page: number;
  onToggleSkill: (id: string) => void;
  onEditSkill: (skill: Skill) => void;
  onDeleteSkill: (id: string) => void;
  onNewSkill: () => void;
  onPageChange: (page: number) => void;
  onClose: () => void;
  t: typeof TRANSLATIONS.en;
}) {
  const pageCount = Math.max(1, Math.ceil(skills.length / SKILLS_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visibleSkills = skills.slice(safePage * SKILLS_PAGE_SIZE, safePage * SKILLS_PAGE_SIZE + SKILLS_PAGE_SIZE);

  return (
    <section className="skill-workbench" aria-label="Agentic skills">
      <div className="skill-header">
        <div>
          <span className="section-kicker">{t.requiredSkills}</span>
          <strong>{t.requiredSummary(selectedSkillIds.length)}</strong>
        </div>
        <button type="button" className="new-skill-button" onClick={onNewSkill}>
          <Plus size={14} aria-hidden="true" />
          {t.newSkill}
        </button>
        <button type="button" className="skill-drawer-close" onClick={onClose} aria-label={t.close}>
          <X size={16} />
        </button>
      </div>

      {error ? <p className="skill-error">{error}</p> : null}

      <div className="skill-list">
        {visibleSkills.map((skill) => {
          const selected = selectedSkillIds.includes(skill.id);
          const disabled = !selected && selectedSkillIds.length >= MAX_SELECTED_SKILLS;
          return (
            <article className={`skill-row ${selected ? "selected" : ""}`} key={skill.id}>
              <label>
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={disabled}
                  onChange={() => onToggleSkill(skill.id)}
                />
                <span>
                  <strong>{skill.name}</strong>
                  <small>{skill.description}</small>
                </span>
              </label>
              <div className="skill-actions">
                <button type="button" onClick={() => onEditSkill(skill)} aria-label={`${t.edit}: ${skill.name}`}>
                  <Pencil size={14} />
                </button>
                <button type="button" onClick={() => onDeleteSkill(skill.id)} aria-label={`${t.delete}: ${skill.name}`}>
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="skill-pagination" aria-label="Skill pagination">
        <button type="button" onClick={() => onPageChange(Math.max(0, safePage - 1))} disabled={safePage === 0}>
          {t.prev}
        </button>
        <span>
          {t.page(safePage + 1, pageCount)}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(pageCount - 1, safePage + 1))}
          disabled={safePage >= pageCount - 1}
        >
          {t.next}
        </button>
      </div>
    </section>
  );
}

function SkillEditorModal({
  skillDraft,
  editingSkillId,
  isDrafting,
  onDraftSkill,
  onCancelEdit,
  onDraftChange,
  onSaveSkill,
  t,
}: {
  skillDraft: SkillDraft;
  editingSkillId: string | null;
  isDrafting: boolean;
  onDraftSkill: () => void;
  onCancelEdit: () => void;
  onDraftChange: (draft: SkillDraft) => void;
  onSaveSkill: () => void;
  t: typeof TRANSLATIONS.en;
}) {
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onCancelEdit();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancelEdit]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancelEdit}>
      <section
        className="skill-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="skill-modal-header">
          <div>
            <span className="section-kicker">{t.requiredSkills}</span>
            <h2 id="skill-modal-title">{editingSkillId ? t.skillModalTitleEdit : t.skillModalTitleNew}</h2>
          </div>
          <button type="button" className="modal-close-button" onClick={onCancelEdit} aria-label={t.close}>
            <X size={18} />
          </button>
        </div>

        <div className="skill-editor">
          <input
            value={skillDraft.name}
            onChange={(event) => onDraftChange({ ...skillDraft, name: event.target.value })}
            placeholder={t.skillName}
            autoFocus
          />
          <input
            value={skillDraft.description}
            onChange={(event) => onDraftChange({ ...skillDraft, description: event.target.value })}
            placeholder={t.skillDescription}
          />
          <textarea
            value={skillDraft.instructions}
            onChange={(event) => onDraftChange({ ...skillDraft, instructions: event.target.value })}
            placeholder={t.skillInstructions}
            rows={8}
          />
          <p className="skill-draft-help">{t.skillDraftHelp}</p>
          <div className="skill-editor-actions">
            <button type="button" onClick={onCancelEdit}>
              {t.cancel}
            </button>
            <button type="button" onClick={onDraftSkill} disabled={isDrafting}>
              {isDrafting ? <Loader2 className="spin" size={14} /> : <WandSparkles size={14} />}
              {t.generateDraft}
            </button>
            <button type="button" onClick={onSaveSkill}>
              {editingSkillId ? t.saveChanges : t.createSkill}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function TutorialPanel({
  step,
  steps,
  onBack,
  onNext,
  onDone,
  t,
}: {
  step: number;
  steps: TutorialStep[];
  onBack: () => void;
  onNext: () => void;
  onDone: () => void;
  t: typeof TRANSLATIONS.en;
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
          {t.back}
        </button>
        {isLast ? (
          <button type="button" onClick={onDone}>
            {t.done}
          </button>
        ) : (
          <button type="button" onClick={onNext}>
            {t.next}
          </button>
        )}
      </div>
    </article>
  );
}

function PromptSuggestions({
  examples,
  activeExample,
  activeGuide,
  onStart,
  onContinue,
  onReset,
  t,
}: {
  examples: GuidedExample[];
  activeExample: GuidedExample | null | undefined;
  activeGuide: ActiveGuide | null;
  onStart: (example: GuidedExample) => void;
  onContinue: () => void;
  onReset: () => void;
  t: typeof TRANSLATIONS.en;
}) {
  if (activeExample && activeGuide?.status === "ready-next") {
    const nextPrompt = activeExample.prompts[activeGuide.stepIndex];
    return (
      <section className="starter-prompts" aria-label="Next guided question">
        <div className="starter-header">
          <span className="section-kicker">{t.nextSuggestedQuestion}</span>
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
            <span className="section-kicker">{t.exampleComplete}</span>
            <strong>{activeExample.title}</strong>
            <p>{t.exampleCompleteBody}</p>
          </div>
          <button type="button" onClick={onReset}>
            {t.moreExamples}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="starter-prompts" aria-label="Guided starter examples">
      <div className="starter-header">
        <span className="section-kicker">{t.examples}</span>
      </div>
      <div className="starter-grid">
        {examples.map((example) => (
          <button
            key={example.id}
            type="button"
            onClick={() => onStart(example)}
            title={`${example.summary}\n\n${example.prompts[0].prompt}`}
          >
            <span className="starter-card-top">
              <span>{example.prompts[0].category}</span>
              <CircleHelp size={13} aria-hidden="true" />
            </span>
            <strong>{example.title}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}

function EventIcon({ type }: { type: string }) {
  if (type.includes("tool")) {
    return <Wrench size={15} className="event-icon-tool" />;
  }
  if (type.includes("reasoning")) {
    return <Brain size={15} className="event-icon-reasoning" />;
  }
  if (type.includes("error")) {
    return <X size={15} className="event-icon-error" />;
  }
  if (type.includes("specialist") || type.includes("agent")) {
    return <Server size={15} className="event-icon-agent" />;
  }
  return <TerminalSquare size={15} className="event-icon-default" />;
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
  const [showRaw, setShowRaw] = useState(false);
  const typeClass = `event-type-${event.type.replace(/\s+/g, "_")}`;
  const summary = event.detail.length > 120 ? event.detail.slice(0, 120) + "..." : event.detail;
  const hasLongDetail = event.detail.length > 120;

  return (
    <>
      <article className={`event-card ${typeClass} ${prominent ? "prominent" : ""}`}>
        <EventIcon type={event.type} />
        <div className="event-card-body">
          <strong>{event.title}</strong>
          <span>{roundLabel ? `${roundLabel} · ${event.type}` : event.type}</span>
          {summary && <p className="event-card-summary">{summary}</p>}
          {hasLongDetail && (
            <button type="button" className="event-card-raw-button" onClick={() => setShowRaw(true)}>
              View raw
            </button>
          )}
        </div>
      </article>
      {showRaw && (
        <EventDetailModal event={event} onClose={() => setShowRaw(false)} />
      )}
    </>
  );
}

function EventDetailModal({ event, onClose }: { event: StreamEvent; onClose: () => void }) {
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="event-detail-modal"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="event-detail-header">
          <div>
            <EventIcon type={event.type} />
            <strong>{event.title}</strong>
            <span className="event-detail-type">{event.type}</span>
          </div>
          <button type="button" className="modal-close-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <pre className="event-detail-code">{event.detail}</pre>
      </section>
    </div>
  );
}

interface EventGroup {
  messageId: string;
  label: string;
  roundIndex: number;
  userQuestion?: string;
  events: StreamEvent[];
}

function RoundEventGroup({
  group,
  onDelete,
  currentEventId,
  t,
}: {
  group: EventGroup;
  onDelete: () => void;
  currentEventId?: string;
  t: typeof TRANSLATIONS.en;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasCurrentEvent = currentEventId ? group.events.some((event) => event.id === currentEventId) : false;
  const displayLabel = group.userQuestion ?? group.label;

  // Auto-expand when the current streaming event belongs to this round
  useEffect(() => {
    if (hasCurrentEvent) setIsExpanded(true);
  }, [hasCurrentEvent]);

  return (
    <article className={`round-log-row ${hasCurrentEvent ? "active" : ""} ${isExpanded ? "expanded" : ""}`}>
      <button
        className="round-log-button"
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        aria-expanded={isExpanded}
        aria-label={isExpanded ? t.collapse : t.expand}
      >
        <span className="round-log-title">
          <ChevronDown size={14} className={isExpanded ? "rotated" : ""} />
          <strong>{displayLabel}</strong>
          <em>{group.events.length}</em>
        </span>
        {!isExpanded && (
          <span className="round-log-preview">
            <small>{group.label}</small>
          </span>
        )}
      </button>
      <button type="button" className="delete-round-button" onClick={onDelete} aria-label={`${t.deleteRoundLogs}: ${group.label}`}>
        <Trash2 size={13} />
      </button>
      {isExpanded && (
        <div className="round-log-events">
          {group.events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              roundLabel={group.label}
              prominent={event.id === currentEventId}
            />
          ))}
        </div>
      )}
    </article>
  );
}

function RoundLogModal({
  group,
  currentEventId,
  onClose,
  t,
}: {
  group: EventGroup;
  currentEventId?: string;
  onClose: () => void;
  t: typeof TRANSLATIONS.en;
}) {
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="round-log-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="round-log-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="skill-modal-header">
          <div>
            <span className="section-kicker">{t.roundLogs}</span>
            <h2 id="round-log-title">{group.label}</h2>
          </div>
          <button type="button" className="modal-close-button" onClick={onClose} aria-label={t.close}>
            <X size={18} />
          </button>
        </div>
        <div className="round-log-summary">
          <span>{group.events.length}</span>
          <strong>{t.eventHistory}</strong>
        </div>
        <div className="round-log-list">
          {group.events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              roundLabel={group.label}
              prominent={event.id === currentEventId}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function ImageLightbox({
  image,
  gallery,
  zoomMode,
  onZoomModeChange,
  onSelect,
  onClose,
  t,
}: {
  image: GeneratedImage;
  gallery: GeneratedImage[];
  zoomMode: ImageZoomMode;
  onZoomModeChange: (mode: ImageZoomMode) => void;
  onSelect: (next: GeneratedImage) => void;
  onClose: () => void;
  t: typeof TRANSLATIONS.en;
}) {
  const navigableGallery = gallery.filter((item) => item.imageUrl);
  const currentIndex = navigableGallery.findIndex((item) => item.id === image.id);
  const hasMultiple = navigableGallery.length > 1;

  const goPrev = useCallback(() => {
    if (!hasMultiple || currentIndex < 0) return;
    const prevIndex = (currentIndex - 1 + navigableGallery.length) % navigableGallery.length;
    onSelect(navigableGallery[prevIndex]);
  }, [hasMultiple, currentIndex, navigableGallery, onSelect]);

  const goNext = useCallback(() => {
    if (!hasMultiple || currentIndex < 0) return;
    const nextIndex = (currentIndex + 1) % navigableGallery.length;
    onSelect(navigableGallery[nextIndex]);
  }, [hasMultiple, currentIndex, navigableGallery, onSelect]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") goPrev();
      if (event.key === "ArrowRight") goNext();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, goPrev, goNext]);

  if (!image.imageUrl) {
    return null;
  }

  return (
    <div className="modal-backdrop image-lightbox-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="image-lightbox"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-lightbox-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="image-lightbox-header">
          <div>
            <span className="section-kicker">{t.imageLightboxTitle}</span>
            <h2 id="image-lightbox-title">{image.title}</h2>
            <p>{image.agent || t.managerAgent}</p>
          </div>
          <div className="image-lightbox-actions">
            <button
              type="button"
              className={zoomMode === "fit" ? "active" : ""}
              onClick={() => onZoomModeChange("fit")}
            >
              {t.zoomFit}
            </button>
            <button
              type="button"
              className={zoomMode === "actual" ? "active" : ""}
              onClick={() => onZoomModeChange("actual")}
            >
              {t.zoomActual}
            </button>
            <a href={image.imageUrl} download={`${safeFileName(image.title)}.png`}>
              <Download size={14} />
              {t.downloadImage}
            </a>
            <button type="button" className="modal-close-button" onClick={onClose} aria-label={t.close}>
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="image-lightbox-canvas" data-zoom={zoomMode}>
          <img src={image.imageUrl} alt={image.title} />
          {hasMultiple && (
            <>
              <button
                type="button"
                className="image-lightbox-nav prev"
                onClick={goPrev}
                aria-label={t.prev}
              >
                <ChevronLeft size={22} />
              </button>
              <button
                type="button"
                className="image-lightbox-nav next"
                onClick={goNext}
                aria-label={t.next}
              >
                <ChevronRight size={22} />
              </button>
              <div className="image-lightbox-counter">
                {currentIndex + 1} / {navigableGallery.length}
              </div>
            </>
          )}
        </div>
        {image.description ? <p className="image-lightbox-description">{image.description}</p> : null}
      </section>
    </div>
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

function userQuestionForAssistant(messageId: string, messages: Message[]): string | undefined {
  const assistantIdx = messages.findIndex((m) => m.id === messageId && m.role === "assistant");
  if (assistantIdx <= 0) return undefined;
  // Walk backwards to find the most recent user message preceding this assistant reply.
  for (let i = assistantIdx - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && m.content.trim()) {
      return m.content.trim();
    }
  }
  return undefined;
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
        userQuestion: userQuestionForAssistant(event.messageId, messages),
        events: [event],
      });
    }
  }
  return groups.sort((left, right) => left.roundIndex - right.roundIndex);
}

function allEvents(currentEvent: StreamEvent | null, eventHistory: StreamEvent[]): StreamEvent[] {
  return currentEvent ? [...eventHistory, currentEvent] : eventHistory;
}

function sanitizeMessages(value: unknown, locale: Locale): Message[] {
  if (!Array.isArray(value) || value.length === 0) {
    return initialMessages(locale);
  }
  const messages = value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const candidate = item as Partial<Message>;
      const role = candidate.role === "user" || candidate.role === "assistant" ? candidate.role : null;
      if (!role) {
        return null;
      }
      const message: Message = {
        id: typeof candidate.id === "string" ? candidate.id : crypto.randomUUID(),
        role,
        content: typeof candidate.content === "string" ? candidate.content : "",
      };
      if (Array.isArray(candidate.images)) {
        message.images = candidate.images
          .filter((image) => Boolean(image && typeof image === "object"))
          .map((image) => ({
            id: typeof image.id === "string" ? image.id : crypto.randomUUID(),
            title: typeof image.title === "string" ? image.title : "Financial visual summary",
            description: typeof image.description === "string" ? image.description : "",
            imageUrl: typeof image.imageUrl === "string" ? image.imageUrl : undefined,
            previewUrl: typeof image.previewUrl === "string" ? image.previewUrl : undefined,
            agent: typeof image.agent === "string" ? image.agent : undefined,
            skillId: typeof image.skillId === "string" ? image.skillId : undefined,
            traceId: typeof image.traceId === "string" ? image.traceId : undefined,
            traceUrl: typeof image.traceUrl === "string" ? image.traceUrl : undefined,
            createdAt: typeof image.createdAt === "string" ? image.createdAt : undefined,
            status: image.status === "loading" ? "loading" : "ready",
          }));
      }
      if (Array.isArray(candidate.activities)) {
        message.activities = candidate.activities
          .filter((activity) => Boolean(activity && typeof activity === "object"))
          .map((activity) => ({
            id: typeof activity.id === "string" ? activity.id : crypto.randomUUID(),
            type: typeof activity.type === "string" ? activity.type : "event",
            label: typeof activity.label === "string" ? activity.label : "",
            createdAt: typeof activity.createdAt === "string" ? activity.createdAt : new Date().toISOString(),
          }))
          .filter((activity) => activity.label);
      }
      if (typeof candidate.activitiesComplete === "boolean") {
        message.activitiesComplete = candidate.activitiesComplete;
      }
      if (typeof candidate.sourcePrompt === "string") {
        message.sourcePrompt = candidate.sourcePrompt;
      }
      if (typeof candidate.stock === "string") {
        message.stock = candidate.stock;
      }
      if (Array.isArray(candidate.requiredSkillIds)) {
        message.requiredSkillIds = candidate.requiredSkillIds.filter((id): id is string => typeof id === "string");
      }
      if (Array.isArray(candidate.requiredSkillsSnapshot)) {
        message.requiredSkillsSnapshot = candidate.requiredSkillsSnapshot
          .filter((skill) => Boolean(skill && typeof skill === "object"))
          .map((skill) => ({
            id: typeof skill.id === "string" ? skill.id : "",
            name: typeof skill.name === "string" ? skill.name : "",
            description: typeof skill.description === "string" ? skill.description : "",
          }))
          .filter((skill) => skill.id && skill.name);
      }
      if (candidate.workflow === "chat" || candidate.workflow === "financial" || candidate.workflow === "agentic") {
        message.workflow = candidate.workflow;
      }
      if (candidate.visualStatus === "generating" || candidate.visualStatus === "complete" || candidate.visualStatus === "error") {
        message.visualStatus = candidate.visualStatus;
      }
      return message;
    })
    .filter((message): message is Message => Boolean(message));
  return messages.length > 0 ? messages : initialMessages(locale);
}

function sanitizeEvents(value: unknown): StreamEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const candidate = item as Partial<StreamEvent>;
      if (
        typeof candidate.messageId !== "string" ||
        typeof candidate.type !== "string" ||
        typeof candidate.title !== "string"
      ) {
        return null;
      }
      return {
        id: typeof candidate.id === "string" ? candidate.id : crypto.randomUUID(),
        messageId: candidate.messageId,
        type: candidate.type,
        title: candidate.title,
        detail: typeof candidate.detail === "string" ? candidate.detail : "",
        order: typeof candidate.order === "number" ? candidate.order : index,
      } satisfies StreamEvent;
    })
    .filter((event): event is StreamEvent => Boolean(event));
}

function nextEventOrder(events: StreamEvent[]): number {
  return events.reduce((max, event) => Math.max(max, event.order), -1) + 1;
}

function sessionTitle(messages: Message[], fallback: string): string {
  const firstUserMessage = messages.find((message) => message.role === "user" && message.content.trim());
  if (!firstUserMessage) {
    return fallback;
  }
  const compact = firstUserMessage.content.replace(/\s+/g, " ").trim();
  return compact.length > 72 ? `${compact.slice(0, 72)}...` : compact;
}

function roundIndex(messageId: string, messages: Message[]): number {
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  return assistantMessages.findIndex((message) => message.id === messageId);
}

function endpointForWorkflow(workflow: Workflow): string {
  if (workflow === "agentic") {
    return "/api/agentic-task/stream";
  }
  return workflow === "financial" ? "/api/financial-analysis/stream" : "/api/chat/stream";
}

function payloadForWorkflow(
  workflow: Workflow,
  prompt: string,
  messages: Message[],
  selectedSkillIds: string[],
  sessionId: string | null,
) {
  if (workflow === "agentic") {
    return {
      prompt,
      skill_ids: selectedSkillIds,
      required_skill_ids: selectedSkillIds,
      stock: extractStockInput(prompt, messages),
      context: financialContext(messages),
      session_id: sessionId,
    };
  }

  if (workflow === "financial") {
    return {
      stock: extractStockInput(prompt, messages),
      question: prompt,
      context: financialContext(messages),
    };
  }

  return {
    messages: messages
      .filter((message) => message.content.trim())
      .map(({ role, content }) => ({ role, content })),
  };
}

function inferWorkflow(prompt: string): Workflow {
  return /財務|合理價|本益比|估值|同業|現金流|分批|完整分析|圖表|視覺化|畫.*圖|生成.*圖|chart|visual|visualize|graph|plot|image/i.test(prompt) ? "financial" : "chat";
}

function extractStockInput(prompt: string, messages: Message[] = []): string {
  const directMatch = prompt.match(/\b\d{4,6}\b/);
  if (directMatch) {
    return directMatch[0];
  }

  for (const message of [...messages].reverse()) {
    const match = message.content.match(/\b\d{4,6}\b/);
    if (match) {
      return match[0];
    }
  }

  return prompt;
}

function financialContext(messages: Message[]): string {
  return messages
    .filter((message) => message.content.trim())
    .slice(-6)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");
}

function normalizeMarkdown(text: string): string {
  // Fix common streaming-markdown issues that break GFM rendering:
  // 1. Insert a blank line before a table row that immediately follows
  //    a non-blank, non-table line (tables need a preceding blank line).
  // 2. Insert a blank line after a heading that's immediately followed by content.
  const lines = text.split("\n");
  const out: string[] = [];
  const tableRowRe = /^\s*\|.*\|\s*$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : "";
    if (tableRowRe.test(line) && prev.trim() && !tableRowRe.test(prev)) {
      if (out[out.length - 1]?.trim() !== "") out.push("");
    }
    out.push(line);
    if (/^#{1,6}\s/.test(line) && i + 1 < lines.length && lines[i + 1].trim()) {
      out.push("");
    }
  }
  return out.join("\n");
}

function visibleMessageContent(message: Message, isStreaming: boolean): string {
  const content = message.content.trim();
  if (
    message.role === "assistant" &&
    message.images?.length &&
    content === "No specialist produced a usable result."
  ) {
    return "";
  }
  return message.content || (message.role === "assistant" && isStreaming ? "..." : "");
}

function activityLabel(type: string, payload: Record<string, unknown>, t: typeof TRANSLATIONS.en): string {
  const agent = String(payload.agent ?? "");
  if (type === "trace_started") {
    return t.activityTraceReady;
  }
  if (type === "manager_planning_started") {
    return t.activityPlanning;
  }
  if (type === "execution_plan_created") {
    return t.activityPlanReady;
  }
  if (type === "manager_started") {
    return t.activityManagerStarted;
  }
  if (type === "manager_completed") {
    return t.activitySynthesizing;
  }
  if (type === "no_relevant_skills") {
    return t.activityNoSkills;
  }
  if (type === "image_generation_started" || agent === "FinancialVisualizationAgent") {
    return t.activityGeneratingVisualization;
  }
  if (type === "skill_selected_by_manager") {
    return t.activitySelectedSkill(String(payload.skill_name ?? payload.skill_id ?? "skill"));
  }
  if (type === "specialist_started" || type === "agent_started") {
    return t.activityRunningAgent(agent || "agent");
  }
  if (type === "specialist_completed" || type === "agent_completed") {
    return t.activityFinishedAgent(agent || "agent");
  }
  return "";
}

function safeFileName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-").replace(/^-+|-+$/g, "") || "financial-visualization";
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

async function copyImageToClipboard(image: GeneratedImage) {
  if (!image.imageUrl || !navigator.clipboard) {
    return;
  }
  try {
    if ("ClipboardItem" in window) {
      const response = await fetch(image.imageUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
      return;
    }
  } catch {
    // Fall back to copying the image URL/data URL below.
  }
  await navigator.clipboard.writeText(image.imageUrl);
}

async function createImagePreview(imageUrl: string): Promise<string | undefined> {
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = imageUrl;
    await image.decode();

    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext("2d");
    if (!context) {
      return undefined;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const width = Math.round(image.naturalWidth * scale);
    const height = Math.round(image.naturalHeight * scale);
    const x = Math.round((canvas.width - width) / 2);
    const y = Math.round((canvas.height - height) / 2);
    context.drawImage(image, x, y, width, height);
    return canvas.toDataURL("image/png");
  } catch {
    return undefined;
  }
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
    // Try to pretty-print JSON strings so tool outputs are readable.
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        return value;
      }
    }
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function ToastContainer({ toasts }: { toasts: { id: string; message: string; type: "success" | "error" }[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.type}`}>
          {toast.type === "success" ? <CheckCircle2 size={14} /> : <X size={14} />}
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
