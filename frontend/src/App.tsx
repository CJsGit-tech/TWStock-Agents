import { FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type SetStateAction } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Database,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileText,
  ImagePlus,
  Info,
  Languages,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Send,
  PieChart,
  Save,
  Settings,
  Sun,
  Trash2,
  Star,
  TrendingUp,
  X
} from "lucide-react";
import {
  createHolding,
  createChatSession,
  createPrompt,
  createPortfolio as createPortfolioRequest,
  deletePrompt,
  deleteHolding,
  deletePortfolio as deletePortfolioRequest,
  fetchChatSessionMessages,
  fetchChatSessions,
  fetchPortfolioBundle,
  fetchPortfolios,
  fetchPrompts,
  fetchResearchRun,
  fetchResearchRuns,
  applyPortfolioApproval,
  rejectPortfolioApproval,
  type ApprovalRequestedEvent,
  type ChatSession,
  type ChatImageAttachment,
  type HoldingPayload,
  type HoldingPosition,
  type Portfolio,
  type PortfolioStats,
  type PortfolioSummary,
  type PromptRecord,
  type ResearchDocumentRecord,
  type ResearchRunRecord,
  type StreamEvent,
  researchDocumentHtmlUrl,
  streamDeepResearchReply,
  streamPortfolioCopilotReply,
  streamResearchDeepRun,
  streamResearchOutlineRun,
  updateHolding,
  updateChatSession,
  updatePrompt,
  updatePortfolio as updatePortfolioRequest
} from "./portfolioApi";
import { applyTickerSelection } from "./holdingForm";
import { calculateProfitTakingPlan, getPortfolioDisplayMetrics, getPositionCostValue, getPositionGain } from "./portfolioMetrics";

type Locale = "en" | "zh-TW";
type AppTheme = "dark" | "light";
type AppPage = "portfolio" | "prompts" | "research";
type MobileFocus = "portfolio" | "ai" | "context";
type HoldingSortKey = "createdAt" | "ticker" | "quantity" | "averageCost" | "marketPrice" | "marketValue" | "value" | "gain";
type SortDirection = "asc" | "desc";
type AllocationTopLimit = 3 | 5 | 10;
const ALLOCATION_TOP_LIMITS: AllocationTopLimit[] = [3, 5, 10];
const PORTFOLIO_ORDER_STORAGE_KEY = "twstock.portfolioOrder.v1";
const THEME_STORAGE_KEY = "twstock.theme.v1";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: ChatAttachment[];
  researchDocuments?: ResearchDocumentRecord[];
};

type ChatAttachment = ChatImageAttachment & {
  name: string;
};

function isChatImageAttachment(attachment: string | ChatImageAttachment): attachment is ChatImageAttachment {
  return typeof attachment !== "string" && attachment.type === "image";
}

function loadStoredTheme(): AppTheme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" ? "light" : "dark";
}

function toDisplayChatAttachment(attachment: ChatImageAttachment, index: number): ChatAttachment {
  return {
    name: `Screenshot ${index + 1}`,
    type: "image",
    image_url: attachment.image_url,
    detail: attachment.detail ?? "high"
  };
}

type PendingApproval = ApprovalRequestedEvent & {
  status: "pending" | "applying" | "rejecting" | "applied" | "rejected";
  messageId: string;
};

type ApprovalDecision = "applied" | "rejected";

type HoldingForm = {
  id?: string;
  ticker: string;
  name: string;
  quantity: string;
  averageCost: string;
  totalCost: string;
  marketPrice: string;
  marketValue: string;
};

type PortfolioForm = {
  id?: string;
  name: string;
  strategy: string;
  cash: string;
  currency: Portfolio["currency"];
};

type PromptDraft = {
  id?: string;
  key: string;
  name: string;
  content: string;
  isActive: boolean;
  isBuiltin: boolean;
};

type FloatingPosition = {
  x: number;
  y: number;
};

type FloatingSize = {
  width: number;
  height: number;
};

type DragState = {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

type ResizeDirection = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

type ResizeState = {
  direction: ResizeDirection;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  originWidth: number;
  originHeight: number;
};

type DonutHoldingSlice = HoldingPosition & {
  chartPercent: number;
  startAngle: number;
  endAngle: number;
  color: string;
  isOther?: boolean;
};

type AssetCompositionSlice = {
  id: string;
  label: string;
  value: number;
  chartPercent: number;
  startAngle: number;
  endAngle: number;
  color: string;
  tone?: "good" | "bad";
};

type AllocationMetric = "value" | "quantity";

const COPILOT_FLOATING_WIDTH = 392;
const COPILOT_FLOATING_HEIGHT = 560;
const COPILOT_FLOATING_MIN_WIDTH = 340;
const COPILOT_FLOATING_MIN_HEIGHT = 420;
const COPILOT_FLOATING_MAX_WIDTH = 820;
const COPILOT_FLOATING_MAX_HEIGHT = 860;
const COPILOT_FLOATING_MARGIN = 18;

const COPILOT_RESIZE_HANDLES: ResizeDirection[] = ["n", "e", "s", "w", "ne", "nw", "se", "sw"];

function getDefaultCopilotPosition(): FloatingPosition {
  if (typeof window === "undefined") {
    return { x: 920, y: 112 };
  }

  return {
    x: Math.max(COPILOT_FLOATING_MARGIN, window.innerWidth - COPILOT_FLOATING_WIDTH - 28),
    y: Math.max(88, window.innerHeight - COPILOT_FLOATING_HEIGHT - 36)
  };
}

function clampCopilotSize(size: FloatingSize): FloatingSize {
  if (typeof window === "undefined") {
    return size;
  }

  const viewportMaxWidth = Math.max(COPILOT_FLOATING_MIN_WIDTH, window.innerWidth - COPILOT_FLOATING_MARGIN * 2);
  const viewportMaxHeight = Math.max(COPILOT_FLOATING_MIN_HEIGHT, window.innerHeight - COPILOT_FLOATING_MARGIN * 2);

  return {
    width: Math.min(Math.max(COPILOT_FLOATING_MIN_WIDTH, size.width), Math.min(COPILOT_FLOATING_MAX_WIDTH, viewportMaxWidth)),
    height: Math.min(Math.max(COPILOT_FLOATING_MIN_HEIGHT, size.height), Math.min(COPILOT_FLOATING_MAX_HEIGHT, viewportMaxHeight))
  };
}

function clampCopilotPosition(position: FloatingPosition, size: FloatingSize = { width: COPILOT_FLOATING_WIDTH, height: COPILOT_FLOATING_HEIGHT }): FloatingPosition {
  if (typeof window === "undefined") {
    return position;
  }

  const panelSize = clampCopilotSize(size);
  const panelWidth = Math.min(panelSize.width, window.innerWidth - COPILOT_FLOATING_MARGIN * 2);
  const panelHeight = Math.min(panelSize.height, window.innerHeight - COPILOT_FLOATING_MARGIN * 2);
  const maxX = Math.max(COPILOT_FLOATING_MARGIN, window.innerWidth - panelWidth - COPILOT_FLOATING_MARGIN);
  const maxY = Math.max(COPILOT_FLOATING_MARGIN, window.innerHeight - panelHeight - COPILOT_FLOATING_MARGIN);

  return {
    x: Math.min(Math.max(COPILOT_FLOATING_MARGIN, position.x), maxX),
    y: Math.min(Math.max(COPILOT_FLOATING_MARGIN, position.y), maxY)
  };
}

const copy = {
  en: {
    app: "Long-term Financial assistant",
    subtitle: "AI-assisted portfolio workbench",
    pages: {
      portfolio: "Stock Portfolio",
      prompts: "Prompt MGT",
      research: "Deep Research"
    },
    pageTag: {
      portfolio: "Portfolio",
      prompts: "Prompts",
      research: "Research"
    },
    badgeOrg: "Org: Formosa Capital",
    badgeMode: "Local Prototype",
    closeButton: "Close",
    languageLabel: "Change language",
    mobileDock: {
      label: "Phone quick actions",
      portfolio: "Portfolio",
      chat: "AI",
      context: "Context",
      addHolding: "Add"
    },
    portfolio: {
      portfoliosLabel: "Portfolios",
      portfolioActions: "Portfolio actions",
      profileSelector: "Portfolio profile",
      createNewPortfolio: "Create new portfolio",
      commandRail: "Workspace shortcuts",
      chatWorkspace: "AI workspace",
      contextCanvas: "Portfolio context",
      pinnedMetrics: "Pinned metrics",
      holdingsPreview: "Holdings preview",
      cashAllocation: "Cash",
      openAllocationVisualization: "Open allocation visualization",
      exportHoldings: "Export",
      allocationVisualizationTitle: "Portfolio allocation visualization",
      openAssetCompositionVisualization: "Open asset composition visualization",
      assetCompositionVisualizationTitle: "Asset composition visualization",
      assetComposition: "Asset composition",
      assetCompositionBasis: "Investment cost and unrealized P/L shown against the current portfolio value.",
      cashLevel: "Cash level",
      cashLevelBasis: "Enter current cash to compare cash, invested cost, and unrealized gain as separate portfolio parts.",
      assetCompositionApproxNote: "Values are estimates; settled records are the source of truth.",
      currentCashLevel: "Current cash",
      investedAssets: "Invested cost",
      cashInputPlaceholder: "Enter cash amount",
      updateCashSettings: "Update settings",
      saveCashLevel: "Save settings",
      saveCashSettings: "Save settings",
      saveCashSettingsShort: "Save",
      cashLevelSaved: "Cash settings saved.",
      profitTakingRecommendation: "Profit taking recommendation",
      currentCashRatio: "Current cash",
      targetCashRatio: "Target cash",
      targetCashRatioLabel: "Target cash ratio",
      recommendedProfitTaking: "Recommended profit taking",
      targetCashMet: "Target cash level reached.",
      targetCashCapped: "Unrealized gain is not enough to fully reach the target.",
      targetMarker: "Target",
      ruleTwoEight: "Rule 2:8",
      cashSettingCash: "Cash",
      cashSettingTarget: "Target",
      cashRatioGap: "Gap",
      profitTakingGoalCopy: "Reach the 2:8 target cash level.",
      cashLevelFooterNote: "Cash level = current cash ÷ total assets. Keep cash close to the target to balance risk and capital efficiency.",
      unrealizedGain: "Unrealized gain",
      unrealizedLoss: "Unrealized loss",
      assetCurrentValue: "Current value",
      allocationTopLabel: (count: number) => `Top ${count} holdings`,
      allocationOtherLabel: "Other",
      allocationValueBasis: "Based on current market value. Smaller holdings are grouped when more than 8 positions exist.",
      allocationQuantityBasis: "Based on share count. Use this to spot quantity-heavy positions that may not dominate value.",
      allocationComparisonPrefix: "Top holding",
      viewAll: "View all",
      collapse: "Collapse",
      searchPortfolios: "Search portfolios",
      noPortfolioResults: "No matching portfolios. Try a strategy or portfolio name.",
      selectedPortfolio: "Selected portfolio",
      updated: "Updated",
      pinnedProfiles: "Pinned",
      pinPortfolio: "Pin portfolio",
      unpinPortfolio: "Unpin portfolio",
      rename: "Edit",
      editPortfolio: "Edit portfolio",
      duplicate: "Duplicate",
      archive: "Archive",
      deletePortfolio: "Delete portfolio",
      deletePortfolioTitle: "Delete portfolio",
      deletePortfolioBody: (name: string) => `This will permanently delete "${name}" and its holdings. This action cannot be undone.`,
      cancelDeletePortfolio: "Cancel",
      confirmDeletePortfolio: "Permanently delete",
      stats: {
        totalValue: "Total value",
        unrealizedPL: "Unrealized P/L",
        cash: "Investment cost",
        topHolding: "Top holding",
        valueAllocation: "Value allocation",
        quantityAllocation: "Quantity allocation"
      },
      holdings: "Holdings",
      deskTitle: "Portfolio Desk",
      deskSubtitle: "Direct holdings editor",
      performanceAttribution: "Allocation",
      searchHoldings: "Search holdings",
      noHoldingResults: "No matching holdings. Try ticker or company name.",
      sortBy: "Sort",
      sortNewest: "Newest",
      sortValue: "Cost",
      sortTicker: "Ticker",
      sortGain: "Est. P/L Adj.",
      sortQuantity: "Qty",
      sortAverageCost: "Trade Px",
      sortMarketPrice: "Market Px",
      sortMarketValue: "Current Value",
      sortAsc: "Asc",
      sortDesc: "Desc",
      rowsPerPage: "Rows",
      pagination: "Holdings pagination",
      previousPage: "Prev",
      nextPage: "Next",
      pageStatus: "Page",
      of: "of",
      showing: "Showing",
      holdingsCount: "holdings",
      positions: "positions",
      addHolding: "Add holding",
      table: {
        stock: "Item",
        qty: "Qty",
        avg: "Trade Px",
        marketPrice: "Market Px",
        price: "Current Value",
        value: "Cost",
        pl: "Est. P/L Adj."
      },
      copilotLabel: "LLM CRUD",
      copilotTitle: "Portfolio copilot",
      copilotInfoLabel: "Copilot usage tips",
      copilotHint: "Ask the assistant to inspect or update portfolio holdings. Direct edits remain available in the holdings table.",
      chatSessions: "Chat sessions",
      newChat: "New chat",
      renameChat: "Rename chat",
      archiveChat: "Archive chat",
      noChatSessions: "No chat sessions yet.",
      untitledChat: "Untitled chat",
      chatPlaceholder: "Review this portfolio and suggest changes...",
      chatEmptyTitle: "Ready to analyze this portfolio",
      chatEmptyBody: "Ask for a holdings review, rebalancing idea, or a proposed portfolio edit.",
      chatPromptReview: "Review holdings",
      chatPromptRebalance: "Suggest rebalance",
      chatReady: "Ready",
      chatStreaming: "Streaming",
      deepResearchToggle: "Deep Research",
      deepResearchModel: "gpt-5-mini",
      deepResearchStatusPlanning: "Planning research",
      deepResearchStatusSpecialist: "Researching sources",
      deepResearchStatusReviewing: "Reviewing findings",
      deepResearchStatusSynthesizing: "Writing research summary",
      researchArtifacts: "Research HTML",
      openHtml: "Open HTML",
      modelLabel: "Model",
      reasoningLabel: "Reasoning",
      reasoningOn: "On",
      reasoningOff: "Off",
      userLabel: "You",
      approvalTitle: "Review proposed changes",
      approvalPending: "Pending approval",
      approvalApply: "Yes, apply",
      approvalReject: "No, cancel",
      approvalApplied: "Changes applied",
      approvalRejected: "Changes rejected",
      approvalToolAllowed: "Tool allowed",
      approvalToolDenied: "Tool denied",
      approvalYes: "Yes",
      approvalNo: "No",
      approvalActionUpdatePortfolio: "Update portfolio",
      approvalActionCreateHolding: "Create holding",
      approvalActionUpdateHolding: "Update holding",
      approvalActionDeleteHolding: "Delete holding",
      approvalFieldLabels: {
        ticker: "Ticker",
        name: "Name",
        quantity: "Quantity",
        average_cost: "Bought price",
        total_cost: "Total cost",
        market_price: "Market price",
        market_value: "Market value",
        cash: "Cash",
        currency: "Currency",
        strategy: "Strategy",
        archived: "Archived",
        portfolio_id: "Portfolio ID",
        holding_id: "Holding ID"
      },
      summary: "Summary",
      hideSummary: "Hide summary",
      hidePricing: "Hide pricing",
      showPricing: "Show pricing",
      maskedValue: "••••••",
      openCopilot: "Open portfolio copilot",
      closeCopilot: "Close copilot",
      newPortfolio: "New portfolio",
      portfolioName: "Portfolio name",
      portfolioNamePlaceholder: "Dividend Compounders",
      strategyNote: "Strategy note",
      strategyNotePlaceholder: "Income-focused Taiwan equity strategy",
      initialFunds: "Initial funds",
      cash: "Cash",
      currency: "Currency",
      createPortfolio: "Create portfolio",
      editHolding: "Edit holding",
      holdingSheetHint: "Add or update one stock position with the same fields used by AI portfolio actions.",
      holdingRequiredFieldsNote: "Ticker, quantity, total cost, bought price, market price, and market value are required. Name is optional.",
      holdingClarificationSuffix: "These fields match the required fields in the holding form; name is optional.",
      instrumentDetails: "Instrument",
      positionDetails: "Position",
      pricingDetails: "Pricing",
      ticker: "Ticker",
      name: "Name",
      quantity: "Quantity",
      averageCost: "Bought price",
      totalCost: "Total cost",
      currentPrice: "Market price",
      currentValue: "Market value",
      savePortfolio: "Save changes",
      holdingHelp: {
        ticker: "Stock ticker or exchange code. Example: 2330 for TSMC.",
        name: "Optional company or instrument display name. Example: TSMC.",
        quantity: "Number of shares or units currently held.",
        averageCost: "Purchase price per share used for cost calculations.",
        totalCost: "Total cost basis stored for this holding.",
        currentPrice: "Current market price per share.",
        currentValue: "Current market value stored for this holding."
      },
      saveHolding: "Save holding",
      send: "Send",
      none: "None"
    },
    prompts: {
      title: "Prompt Management",
      subtitle: "Edit the active chatbot prompts used by the backend.",
      listTitle: "Prompt records",
      editorTitle: "Prompt editor",
      key: "Key",
      name: "Name",
      status: "Status",
      type: "Type",
      updated: "Updated",
      content: "Prompt content",
      active: "Active",
      inactive: "Inactive",
      builtin: "Built-in",
      custom: "Custom",
      createdBy: "Created by",
      save: "Save prompt",
      create: "Create prompt",
      delete: "Delete",
      cancel: "Cancel",
      newPrompt: "New prompt",
      aiTrustCue: "AI-assisted prompts should be reviewed before use.",
      builtinDeleteNote: "Built-in prompts cannot be deleted.",
      unwiredNote: "Custom prompts are saved records and are not wired to chatbot workflows yet.",
      loading: "Loading prompts...",
      empty: "No prompts found.",
      error: "Prompt backend unavailable",
      saved: "Prompt saved.",
      createDefaults: {
        key: "user.custom-review",
        name: "Custom Review",
        content: "Review the portfolio with a conservative risk lens."
      }
    },
    research: {
      title: "Deep Research Application",
      subtitle: "Create DB-backed HTML research runs using the new skill-style APIs.",
      model: "gpt-5-mini",
      topic: "Research topic",
      topicPlaceholder: "Compare Taiwan AI server supply chain opportunities",
      language: "Language",
      timeRange: "Time range",
      timeRangePlaceholder: "Last 6 months, since 2025, or leave blank",
      portfolioLink: "Link current portfolio",
      createOutline: "Create outline",
      runDeep: "Run deep research",
      refresh: "Refresh",
      runHistory: "Research runs",
      documents: "HTML artifacts",
      preview: "HTML preview",
      status: "Status",
      items: "Items",
      completed: "Completed",
      failed: "Failed",
      loading: "Loading research runs...",
      emptyRuns: "No research runs yet.",
      emptyDocuments: "No HTML documents yet.",
      noPreview: "Select a generated HTML artifact to preview it here.",
      error: "Research API unavailable",
      runningOutline: "Creating outline and fields",
      runningDeep: "Running item-by-item deep research",
      ready: "Ready",
      openHtml: "Open HTML",
      kindOutline: "Outline",
      kindFields: "Fields",
      kindResult: "Result",
      helpButton: "How to use Deep Research",
      helpTitle: "How to get started",
      helpIntro: "Deep Research runs in two stages so the generated HTML stays durable and easy to inspect.",
      helpSteps: [
        {
          title: "1. Write a research topic",
          body: "Describe the question you want answered. Use the time range field when freshness matters, for example last 6 months or since 2025."
        },
        {
          title: "2. Create the outline",
          body: "Click Create outline. The backend stores outline and field-definition HTML in the database and shows them in HTML artifacts."
        },
        {
          title: "3. Review the generated HTML",
          body: "Select an artifact to preview it. The embedded JSON inside these HTML files is the source of truth for the next step."
        },
        {
          title: "4. Run deep research",
          body: "Click Run deep research after an outline exists. The app researches each outline item, stores result HTML, and updates progress counts."
        },
        {
          title: "5. Open or reuse results",
          body: "Preview results in this panel or open the HTML in a new tab. Runs remain available from Research runs after refresh."
        }
      ],
      helpNote: "Tip: when a current portfolio is selected, the run is linked to that portfolio for later review."
    }
  },
  "zh-TW": {
    app: "Long-term Financial assistant",
    subtitle: "AI 輔助投資組合工作台",
    pages: {
      portfolio: "股票投資組合",
      prompts: "提示詞管理",
      research: "深度研究"
    },
    pageTag: {
      portfolio: "投資組合",
      prompts: "Prompts",
      research: "Research"
    },
    badgeOrg: "組織：Formosa Capital",
    badgeMode: "本機原型",
    closeButton: "關閉",
    languageLabel: "切換語言",
    mobileDock: {
      label: "手機快捷操作",
      portfolio: "組合",
      chat: "AI",
      context: "脈絡",
      addHolding: "新增"
    },
    portfolio: {
      portfoliosLabel: "投資組合",
      portfolioActions: "投資組合操作",
      profileSelector: "投資組合設定檔",
      createNewPortfolio: "建立新投資組合",
      commandRail: "工作區捷徑",
      chatWorkspace: "AI 工作區",
      contextCanvas: "投資組合脈絡",
      pinnedMetrics: "鎖定指標",
      holdingsPreview: "持股預覽",
      cashAllocation: "現金",
      openAllocationVisualization: "開啟配置視覺化",
      exportHoldings: "匯出",
      allocationVisualizationTitle: "投資組合配置視覺化",
      openAssetCompositionVisualization: "開啟資產組成視覺化",
      assetCompositionVisualizationTitle: "資產組成視覺化",
      assetComposition: "資產組成",
      assetCompositionBasis: "以目前總資產呈現投資成本與未實現損益的組成。",
      cashLevel: "現金水位",
      cashLevelBasis: "輸入目前現金，查看現金水位、已投入成本、未實現獲利三個部位的比例。",
      assetCompositionApproxNote: "數值為約略值，實際以結算為準",
      currentCashLevel: "目前現金",
      investedAssets: "已投入成本",
      cashInputPlaceholder: "輸入現金金額",
      updateCashSettings: "更新設定",
      saveCashLevel: "儲存設定",
      saveCashSettings: "儲存設定",
      saveCashSettingsShort: "儲存",
      cashLevelSaved: "現金設定已儲存。",
      profitTakingRecommendation: "獲利了結建議",
      currentCashRatio: "目前現金",
      targetCashRatio: "目標現金",
      targetCashRatioLabel: "目標現金比例",
      recommendedProfitTaking: "建議獲利了結",
      targetCashMet: "已達目標現金水位",
      targetCashCapped: "未實現獲利不足以完全補足目標現金水位。",
      targetMarker: "目標",
      ruleTwoEight: "規則 2:8",
      cashSettingCash: "現金",
      cashSettingTarget: "目標",
      cashRatioGap: "差距",
      profitTakingGoalCopy: "達到 2:8 目標現金水位",
      cashLevelFooterNote: "現金水位 = 目前現金 ÷ 總資產。建議將現金比例維持在目標附近，以平衡風險與資金運用效率。",
      unrealizedGain: "未實現獲利",
      unrealizedLoss: "未實現虧損",
      assetCurrentValue: "目前市值",
      allocationTopLabel: (count: number) => `前 ${count} 大持股`,
      allocationOtherLabel: "其他",
      allocationValueBasis: "依目前市值計算。超過 8 檔時，其餘持股會合併顯示。",
      allocationQuantityBasis: "依股數占比計算，可用來辨識股數集中但市值不一定最高的部位。",
      allocationComparisonPrefix: "最大占比",
      viewAll: "查看全部",
      collapse: "收合",
      searchPortfolios: "搜尋投資組合",
      noPortfolioResults: "沒有符合的投資組合。可嘗試輸入策略或名稱。",
      selectedPortfolio: "目前投資組合",
      updated: "更新",
      pinnedProfiles: "置頂",
      pinPortfolio: "置頂投資組合",
      unpinPortfolio: "取消置頂",
      rename: "編輯",
      editPortfolio: "編輯投資組合",
      duplicate: "複製",
      archive: "封存",
      deletePortfolio: "刪除投資組合",
      deletePortfolioTitle: "刪除投資組合",
      deletePortfolioBody: (name: string) => `這會永久刪除「${name}」及其持股資料。此操作無法復原。`,
      cancelDeletePortfolio: "取消",
      confirmDeletePortfolio: "永久刪除",
      stats: {
        totalValue: "總資產",
        unrealizedPL: "未實現損益",
        cash: "投資成本",
        topHolding: "最大持股",
        valueAllocation: "市值配置",
        quantityAllocation: "股數配置"
      },
      holdings: "持股",
      deskTitle: "投資組合工作台",
      deskSubtitle: "直接持股編輯",
      performanceAttribution: "配置",
      searchHoldings: "搜尋持股",
      noHoldingResults: "沒有符合的持股。可嘗試股票代號或名稱。",
      sortBy: "排序",
      sortNewest: "最新",
      sortValue: "成本",
      sortTicker: "代號",
      sortGain: "預估損益調整",
      sortQuantity: "股數",
      sortAverageCost: "成交價",
      sortMarketPrice: "現值(股)",
      sortMarketValue: "現值",
      sortAsc: "升序",
      sortDesc: "降序",
      rowsPerPage: "每頁",
      pagination: "持股分頁",
      previousPage: "上一頁",
      nextPage: "下一頁",
      pageStatus: "第",
      of: "頁 / 共",
      showing: "顯示",
      holdingsCount: "檔持股",
      positions: "檔部位",
      addHolding: "新增持股",
      table: {
        stock: "標的",
        qty: "股數",
        avg: "成交價",
        marketPrice: "現值(股)",
        price: "現值",
        value: "成本",
        pl: "預估損益調整"
      },
      copilotLabel: "LLM 操作",
      copilotTitle: "投資組合助理",
      copilotInfoLabel: "助理使用提示",
      copilotHint: "可請助理檢視或更新投資組合持股；表格仍可直接手動編輯。",
      chatSessions: "對話記錄",
      newChat: "新增對話",
      renameChat: "重新命名對話",
      archiveChat: "封存對話",
      noChatSessions: "尚無對話記錄。",
      untitledChat: "未命名對話",
      chatPlaceholder: "檢視這個投資組合並建議調整...",
      chatEmptyTitle: "準備分析這個投資組合",
      chatEmptyBody: "可要求檢視持股、提出再平衡想法，或建立投資組合修改建議。",
      chatPromptReview: "檢視持股",
      chatPromptRebalance: "建議再平衡",
      chatReady: "待命",
      chatStreaming: "串流中",
      deepResearchToggle: "深度研究",
      deepResearchModel: "gpt-5-mini",
      deepResearchStatusPlanning: "規劃研究",
      deepResearchStatusSpecialist: "查找資料來源",
      deepResearchStatusReviewing: "檢查研究結果",
      deepResearchStatusSynthesizing: "撰寫研究摘要",
      researchArtifacts: "研究 HTML",
      openHtml: "開啟 HTML",
      modelLabel: "模型",
      reasoningLabel: "Reasoning",
      reasoningOn: "啟用",
      reasoningOff: "關閉",
      userLabel: "你",
      approvalTitle: "檢視建議變更",
      approvalPending: "等待確認",
      approvalApply: "是，套用",
      approvalReject: "否，取消",
      approvalApplied: "已套用變更",
      approvalRejected: "已拒絕變更",
      approvalToolAllowed: "已允許工具",
      approvalToolDenied: "已拒絕工具",
      approvalYes: "是",
      approvalNo: "否",
      approvalActionUpdatePortfolio: "更新投資組合",
      approvalActionCreateHolding: "新增持股",
      approvalActionUpdateHolding: "更新持股",
      approvalActionDeleteHolding: "刪除持股",
      approvalFieldLabels: {
        ticker: "代號",
        name: "名稱",
        quantity: "股數",
        average_cost: "買入價格",
        total_cost: "總成本",
        market_price: "市價",
        market_value: "市值",
        cash: "現金",
        currency: "幣別",
        strategy: "策略",
        archived: "封存",
        portfolio_id: "投資組合 ID",
        holding_id: "持股 ID"
      },
      summary: "摘要",
      hideSummary: "隱藏摘要",
      hidePricing: "隱藏價格",
      showPricing: "顯示價格",
      maskedValue: "••••••",
      openCopilot: "開啟投資組合助理",
      closeCopilot: "關閉助理",
      newPortfolio: "新增投資組合",
      portfolioName: "投資組合名稱",
      portfolioNamePlaceholder: "股息複利組合",
      strategyNote: "策略備註",
      strategyNotePlaceholder: "以收益為主的台股投資策略",
      initialFunds: "初始資金",
      cash: "現金",
      currency: "幣別",
      createPortfolio: "建立投資組合",
      editHolding: "編輯持股",
      holdingSheetHint: "新增或更新單一股票部位，欄位會與 AI 投資組合操作使用相同格式。",
      holdingRequiredFieldsNote: "代號、股數、總成本、買入價格、市價、現值為必填；名稱為選填。",
      holdingClarificationSuffix: "這些欄位與持股表單必填欄位一致；名稱為選填。",
      instrumentDetails: "標的資料",
      positionDetails: "部位設定",
      pricingDetails: "價格資料",
      ticker: "代號",
      name: "名稱",
      quantity: "股數",
      averageCost: "買入價格",
      totalCost: "總成本",
      currentPrice: "市值（單股）",
      currentValue: "現值",
      savePortfolio: "儲存變更",
      holdingHelp: {
        ticker: "股票代號或交易所代碼。例：2330 代表台積電。",
        name: "選填的公司或標的顯示名稱。例：TSMC。",
        quantity: "目前持有股數或單位數。",
        averageCost: "用於成本計算的每股買入價格。",
        totalCost: "此持股直接儲存的總成本。",
        currentPrice: "目前每股市值。",
        currentValue: "此持股直接儲存的現值。"
      },
      saveHolding: "儲存持股",
      send: "送出",
      none: "無"
    },
    prompts: {
      title: "提示詞管理",
      subtitle: "編輯後端目前使用的聊天助理提示詞。",
      listTitle: "提示詞紀錄",
      editorTitle: "提示詞編輯器",
      key: "Key",
      name: "名稱",
      status: "狀態",
      type: "類型",
      updated: "更新時間",
      content: "Prompt content",
      active: "啟用",
      inactive: "停用",
      builtin: "內建",
      custom: "自訂",
      createdBy: "建立者",
      save: "儲存提示詞",
      create: "新增提示詞",
      delete: "刪除",
      cancel: "取消",
      newPrompt: "新增提示詞",
      aiTrustCue: "AI 輔助提示詞使用前仍需人工確認。",
      builtinDeleteNote: "內建提示詞不可刪除。",
      unwiredNote: "自訂提示詞目前只會儲存為紀錄，尚未接到聊天工作流程。",
      loading: "正在載入提示詞...",
      empty: "尚無提示詞。",
      error: "提示詞後端無法連線",
      saved: "提示詞已儲存。",
      createDefaults: {
        key: "user.custom-review",
        name: "Custom Review",
        content: "以保守風險角度檢視投資組合。"
      }
    },
    research: {
      title: "深度研究應用",
      subtitle: "使用新的技能式 API 建立可儲存在資料庫的 HTML 研究成果。",
      model: "gpt-5-mini",
      topic: "研究主題",
      topicPlaceholder: "比較台灣 AI 伺服器供應鏈機會",
      language: "語言",
      timeRange: "時間範圍",
      timeRangePlaceholder: "近 6 個月、2025 以來，或留空",
      portfolioLink: "連結目前投資組合",
      createOutline: "建立大綱",
      runDeep: "執行深度研究",
      refresh: "重新整理",
      runHistory: "研究任務",
      documents: "HTML 成果",
      preview: "HTML 預覽",
      status: "狀態",
      items: "項目",
      completed: "完成",
      failed: "失敗",
      loading: "正在載入研究任務...",
      emptyRuns: "尚無研究任務。",
      emptyDocuments: "尚無 HTML 成果。",
      noPreview: "選擇已產生的 HTML 成果即可在此預覽。",
      error: "研究 API 無法連線",
      runningOutline: "正在建立大綱與欄位",
      runningDeep: "正在逐項執行深度研究",
      ready: "待命",
      openHtml: "開啟 HTML",
      kindOutline: "大綱",
      kindFields: "欄位",
      kindResult: "結果",
      helpButton: "如何使用深度研究",
      helpTitle: "如何開始使用",
      helpIntro: "深度研究分成兩個階段執行，讓產出的 HTML 可以持久保存，也方便檢查。",
      helpSteps: [
        {
          title: "1. 輸入研究主題",
          body: "描述你想回答的問題。若資料新鮮度很重要，可在時間範圍輸入例如近 6 個月或 2025 以來。"
        },
        {
          title: "2. 建立大綱",
          body: "點擊建立大綱。後端會把大綱與欄位定義 HTML 存入資料庫，並顯示在 HTML 成果中。"
        },
        {
          title: "3. 檢查產生的 HTML",
          body: "選擇任一成果即可預覽。這些 HTML 內嵌的 JSON 會作為下一步研究的資料來源。"
        },
        {
          title: "4. 執行深度研究",
          body: "有大綱後點擊執行深度研究。系統會逐項研究大綱項目、儲存結果 HTML，並更新進度。"
        },
        {
          title: "5. 開啟或重用結果",
          body: "可在此預覽結果，或開新分頁查看 HTML。重新整理後仍可從研究任務取回紀錄。"
        }
      ],
      helpNote: "提示：如果目前有選定投資組合，研究任務會連結到該投資組合，方便後續檢視。"
    }
  }
} as const;

type PortfolioLabels = (typeof copy)[Locale]["portfolio"];
type PromptLabels = (typeof copy)[Locale]["prompts"];
type ResearchLabels = (typeof copy)[Locale]["research"];

const STOCK_DIRECTORY: Record<string, { ticker: string; name: string; price: number }> = {
  "2330": { ticker: "2330", name: "TSMC", price: 676 },
  "2382": { ticker: "2382", name: "Quanta", price: 282 },
  "0050": { ticker: "0050", name: "Yuanta Taiwan 50", price: 188 },
  "2412": { ticker: "2412", name: "Chunghwa Telecom", price: 126.5 },
  "2882": { ticker: "2882", name: "Cathay Financial", price: 63 }
};

function currency(value: number, code = "TWD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
    maximumFractionDigits: 0
  }).format(value);
}

function percent(value: number) {
  return `${value.toFixed(1)}%`;
}

function holdingDisplayName(holding: Pick<HoldingPosition, "name" | "ticker">) {
  const name = holding.name.trim();
  return name ? `${name}(${holding.ticker})` : holding.ticker;
}

function stockPrice(value: number) {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4
  }).format(value);
}

function maskPricingValue(value: string, priceMasked: boolean, maskedValue: string) {
  return priceMasked ? maskedValue : value;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString();
}

function promptRowLabel(prompt: PromptRecord, labels: PromptLabels) {
  const status = prompt.isActive ? labels.active : labels.inactive;
  const type = prompt.isBuiltin ? labels.builtin : labels.custom;
  return `${prompt.key}: ${prompt.name}. ${labels.status}: ${status}. ${labels.type}: ${type}. ${labels.updated}: ${formatDate(prompt.updatedAt)}.`;
}

function polarToCartesian(center: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: center + radius * Math.cos(angleInRadians),
    y: center + radius * Math.sin(angleInRadians)
  };
}

function donutArcPath(center: number, radius: number, startAngle: number, endAngle: number) {
  const safeEndAngle = endAngle - 0.5;
  const start = polarToCartesian(center, radius, safeEndAngle);
  const end = polarToCartesian(center, radius, startAngle);
  const largeArcFlag = safeEndAngle - startAngle <= 180 ? "0" : "1";
  return ["M", start.x, start.y, "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y].join(" ");
}

function arcMidpointOffset(startAngle: number, endAngle: number, distance: number) {
  const midpoint = (((startAngle + endAngle) / 2 - 90) * Math.PI) / 180;
  return {
    x: Math.cos(midpoint) * distance,
    y: Math.sin(midpoint) * distance
  };
}

function chartTooltipPosition(startAngle: number, endAngle: number) {
  const midpoint = (startAngle + endAngle) / 2;
  const point = polarToCartesian(130, 112, midpoint);
  return {
    x: Math.min(220, Math.max(40, point.x)),
    y: Math.min(220, Math.max(36, point.y))
  };
}

function loadPortfolioOrder() {
  if (typeof window === "undefined") return [];
  try {
    const rawOrder = window.localStorage.getItem(PORTFOLIO_ORDER_STORAGE_KEY);
    const parsed = rawOrder ? JSON.parse(rawOrder) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function savePortfolioOrder(order: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PORTFOLIO_ORDER_STORAGE_KEY, JSON.stringify(order));
}

function scrollToMobileSection(selector: string) {
  if (typeof document === "undefined") return;
  document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function orderPortfolios(portfolios: PortfolioSummary[], savedOrder: string[]) {
  const orderIndex = new Map(savedOrder.map((id, index) => [id, index]));
  return [...portfolios].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const aIndex = orderIndex.get(a.id);
    const bIndex = orderIndex.get(b.id);
    if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
    if (aIndex !== undefined) return -1;
    if (bIndex !== undefined) return 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function safeFilePart(value: string) {
  return value.trim().replace(/[^a-z0-9\u4e00-\u9fff-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "portfolio";
}

function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function compareHoldings(a: HoldingPosition, b: HoldingPosition, key: HoldingSortKey, direction: SortDirection) {
  let comparison = 0;
  if (key === "createdAt") comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  if (key === "ticker") comparison = a.ticker.localeCompare(b.ticker);
  if (key === "quantity") comparison = a.quantity - b.quantity;
  if (key === "averageCost") comparison = a.averageCost - b.averageCost;
  if (key === "marketPrice") comparison = a.marketPrice - b.marketPrice;
  if (key === "marketValue") comparison = a.marketValue - b.marketValue;
  if (key === "value") comparison = getPositionCostValue(a) - getPositionCostValue(b);
  if (key === "gain") comparison = getPositionGain(a) - getPositionGain(b);
  if (comparison === 0) comparison = a.ticker.localeCompare(b.ticker);
  return direction === "asc" ? comparison : -comparison;
}

function emptyHoldingForm(): HoldingForm {
  return {
    ticker: "",
    name: "",
    quantity: "",
    averageCost: "",
    totalCost: "",
    marketPrice: "",
    marketValue: ""
  };
}

function formFromHolding(holding: HoldingPosition): HoldingForm {
  return {
    id: holding.id,
    ticker: holding.ticker,
    name: holding.name,
    quantity: String(holding.quantity),
    averageCost: String(holding.averageCost),
    totalCost: String(holding.totalCost),
    marketPrice: String(holding.marketPrice),
    marketValue: String(holding.marketValue)
  };
}

function draftFromPrompt(prompt: PromptRecord): PromptDraft {
  return {
    id: prompt.id,
    key: prompt.key,
    name: prompt.name,
    content: prompt.content,
    isActive: prompt.isActive,
    isBuiltin: prompt.isBuiltin
  };
}

function parseHoldingForm(form: HoldingForm): HoldingPayload {
  const quantity = Number(form.quantity) || 0;
  const averageCost = Number(form.averageCost) || 0;
  const marketPrice = Number(form.marketPrice) || 0;
  return {
    ticker: form.ticker.trim().toUpperCase(),
    name: form.name.trim(),
    quantity,
    average_cost: averageCost,
    total_cost: Number(form.totalCost),
    market_price: marketPrice,
    market_value: Number(form.marketValue)
  };
}

function appPageFromHash(hash: string): AppPage {
  const page = hash.replace("#", "");
  return page === "prompts" || page === "research" ? page : "portfolio";
}

function appPageHash(page: AppPage): string {
  return page === "portfolio" ? "" : `#${page}`;
}

function initialAppPage(): AppPage {
  if (typeof window === "undefined") return "portfolio";
  return appPageFromHash(window.location.hash);
}

export default function App() {
  const [locale, setLocale] = useState<Locale>("zh-TW");
  const [appTheme, setAppTheme] = useState<AppTheme>(() => loadStoredTheme());
  const [currentPage, setCurrentPage] = useState<AppPage>(() => initialAppPage());
  const [mobileFocus, setMobileFocus] = useState<MobileFocus>("portfolio");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [portfolios, setPortfolios] = useState<PortfolioSummary[]>([]);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null);
  const [selectedPortfolio, setSelectedPortfolio] = useState<Portfolio | null>(null);
  const [portfolioStats, setPortfolioStats] = useState<PortfolioStats | null>(null);
  const [holdings, setHoldings] = useState<HoldingPosition[]>([]);
  const [portfolioSheetOpen, setPortfolioSheetOpen] = useState(false);
  const [portfolioEditorOpen, setPortfolioEditorOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [portfolioPendingDelete, setPortfolioPendingDelete] = useState<PortfolioSummary | null>(null);
  const [holdingSheetOpen, setHoldingSheetOpen] = useState(false);
  const [priceMasked, setPriceMasked] = useState(true);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotInfoOpen, setCopilotInfoOpen] = useState(false);
  const [holdingForm, setHoldingForm] = useState<HoldingForm>(emptyHoldingForm());
  const [newPortfolio, setNewPortfolio] = useState<PortfolioForm>({ name: "", strategy: "", cash: "250000", currency: "TWD" });
  const [portfolioEditDraft, setPortfolioEditDraft] = useState<PortfolioForm>({ id: "", name: "", strategy: "", cash: "0", currency: "TWD" });
  const [portfolioQuery, setPortfolioQuery] = useState("");
  const [holdingQuery, setHoldingQuery] = useState("");
  const [portfolioOrder, setPortfolioOrder] = useState<string[]>(() => loadPortfolioOrder());
  const [draggingPortfolioId, setDraggingPortfolioId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [chatReasoningEnabled, setChatReasoningEnabled] = useState(true);
  const [deepResearchEnabled, setDeepResearchEnabled] = useState(false);
  const [deepResearchStatus, setDeepResearchStatus] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [approvalDecisionsByMessage, setApprovalDecisionsByMessage] = useState<Record<string, ApprovalDecision>>({});
  const [chatStreaming, setChatStreaming] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [holdingError, setHoldingError] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<PromptRecord[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState<PromptDraft | null>(null);
  const [promptsLoading, setPromptsLoading] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptNotice, setPromptNotice] = useState<string | null>(null);
  const [researchRuns, setResearchRuns] = useState<ResearchRunRecord[]>([]);
  const [selectedResearchRunId, setSelectedResearchRunId] = useState<string | null>(null);
  const [selectedResearchDetail, setSelectedResearchDetail] = useState<{ run: ResearchRunRecord; documents: ResearchDocumentRecord[] } | null>(null);
  const [researchTopic, setResearchTopic] = useState("");
  const [researchTimeRange, setResearchTimeRange] = useState("");
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchStreaming, setResearchStreaming] = useState(false);
  const [researchStatus, setResearchStatus] = useState<string | null>(null);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [selectedResearchDocumentId, setSelectedResearchDocumentId] = useState<string | null>(null);
  const [isSavingPortfolio, setIsSavingPortfolio] = useState(false);
  const [isSavingHolding, setIsSavingHolding] = useState(false);
  const deferredPortfolioQuery = useDeferredValue(portfolioQuery);
  const deferredHoldingQuery = useDeferredValue(holdingQuery);
  const profileDropdownRef = useRef<HTMLDivElement | null>(null);
  const t = useMemo(() => copy[locale], [locale]);

  const closeTransientShellUI = () => {
    setLanguageMenuOpen(false);
    setProfileDropdownOpen(false);
    setPortfolioPendingDelete(null);
    setCopilotInfoOpen(false);
  };

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, appTheme);
  }, [appTheme]);

  const filteredPortfolios = useMemo(() => {
    const query = deferredPortfolioQuery.trim().toLowerCase();
    const visiblePortfolios = !query ? portfolios.filter((item) => !item.archived) : portfolios.filter((portfolio) => {
      const haystack = [portfolio.name, portfolio.strategy, portfolio.currency].join(" ").toLowerCase();
      return !portfolio.archived && haystack.includes(query);
    });
    return orderPortfolios(visiblePortfolios, portfolioOrder);
  }, [deferredPortfolioQuery, portfolioOrder, portfolios]);

  const pinnedPortfolios = useMemo(
    () => orderPortfolios(portfolios.filter((portfolio) => portfolio.pinned && !portfolio.archived), portfolioOrder),
    [portfolioOrder, portfolios]
  );

  const filteredHoldings = useMemo(() => {
    const query = deferredHoldingQuery.trim().toLowerCase();
    const base = query
      ? holdings.filter((holding) => [holding.ticker, holding.name].join(" ").toLowerCase().includes(query))
      : holdings;

    return [...base].sort((a, b) => compareHoldings(a, b, "marketValue", "desc"));
  }, [deferredHoldingQuery, holdings]);

  const holdingOptions = useMemo(() => [...holdings].sort((a, b) => a.ticker.localeCompare(b.ticker)), [holdings]);

  const loadPortfolioIndex = async (nextSelectedId?: string | null) => {
    const items = await fetchPortfolios();
    const orderedItems = orderPortfolios(items.filter((item) => !item.archived), portfolioOrder);
    setPortfolios(items);
    setSelectedPortfolioId(nextSelectedId ?? orderedItems[0]?.id ?? null);
  };

  const loadPromptIndex = async (nextSelectedId?: string | null) => {
    setPromptsLoading(true);
    setPromptError(null);
    try {
      const items = await fetchPrompts();
      setPrompts(items);
      const nextPrompt = items.find((item) => item.id === nextSelectedId) ?? items.find((item) => item.id === selectedPromptId) ?? items[0] ?? null;
      setSelectedPromptId(nextPrompt?.id ?? null);
      setPromptDraft(nextPrompt ? draftFromPrompt(nextPrompt) : null);
    } catch (error) {
      setPromptError(error instanceof Error ? error.message : t.prompts.error);
    } finally {
      setPromptsLoading(false);
    }
  };

  const selectPrompt = (prompt: PromptRecord) => {
    setSelectedPromptId(prompt.id);
    setPromptDraft(draftFromPrompt(prompt));
    setPromptNotice(null);
    setPromptError(null);
  };

  const createPromptDraft = () => {
    setSelectedPromptId(null);
    setPromptDraft({
      key: t.prompts.createDefaults.key,
      name: t.prompts.createDefaults.name,
      content: t.prompts.createDefaults.content,
      isActive: true,
      isBuiltin: false
    });
    setPromptNotice(null);
    setPromptError(null);
  };

  const savePromptDraft = async (event: FormEvent) => {
    event.preventDefault();
    if (!promptDraft || promptSaving) return;
    setPromptSaving(true);
    setPromptError(null);
    setPromptNotice(null);
    try {
      const saved = promptDraft.id
        ? await updatePrompt(promptDraft.id, {
            name: promptDraft.name.trim(),
            content: promptDraft.content.trim(),
            is_active: promptDraft.isActive
          })
        : await createPrompt({
            key: promptDraft.key.trim(),
            name: promptDraft.name.trim(),
            content: promptDraft.content.trim(),
            is_active: promptDraft.isActive,
            created_by: "user"
          });
      setPromptNotice(t.prompts.saved);
      await loadPromptIndex(saved.id);
    } catch (error) {
      setPromptError(error instanceof Error ? error.message : t.prompts.error);
    } finally {
      setPromptSaving(false);
    }
  };

  const removePromptDraft = async () => {
    if (!promptDraft?.id || promptDraft.isBuiltin || promptSaving) return;
    setPromptSaving(true);
    setPromptError(null);
    try {
      await deletePrompt(promptDraft.id);
      await loadPromptIndex(null);
    } catch (error) {
      setPromptError(error instanceof Error ? error.message : t.prompts.error);
    } finally {
      setPromptSaving(false);
    }
  };

  const loadResearchIndex = async (nextSelectedId?: string | null) => {
    setResearchLoading(true);
    setResearchError(null);
    try {
      const runs = await fetchResearchRuns();
      setResearchRuns(runs);
      const nextRunId = nextSelectedId ?? selectedResearchRunId ?? runs[0]?.id ?? null;
      setSelectedResearchRunId(nextRunId);
      if (nextRunId) {
        const detail = await fetchResearchRun(nextRunId);
        setSelectedResearchDetail(detail);
        setResearchTopic(detail.run.topic);
        setResearchTimeRange(detail.run.time_range ?? "");
        setSelectedResearchDocumentId((current) => {
          if (current && detail.documents.some((document) => document.id === current)) return current;
          return detail.documents[detail.documents.length - 1]?.id ?? null;
        });
      } else {
        setSelectedResearchDetail(null);
        setSelectedResearchDocumentId(null);
        setResearchTopic("");
        setResearchTimeRange("");
      }
    } catch (error) {
      setResearchError(error instanceof Error ? error.message : t.research.error);
    } finally {
      setResearchLoading(false);
    }
  };

  const selectResearchRun = async (runId: string) => {
    setSelectedResearchRunId(runId);
    setResearchError(null);
    try {
      const detail = await fetchResearchRun(runId);
      setSelectedResearchDetail(detail);
      setResearchTopic(detail.run.topic);
      setResearchTimeRange(detail.run.time_range ?? "");
      setSelectedResearchDocumentId(detail.documents[detail.documents.length - 1]?.id ?? null);
    } catch (error) {
      setResearchError(error instanceof Error ? error.message : t.research.error);
    }
  };

  const createResearchOutline = async (event: FormEvent) => {
    event.preventDefault();
    if (!researchTopic.trim() || researchStreaming) return;
    let runId: string | null = null;
    setResearchStreaming(true);
    setResearchStatus(t.research.runningOutline);
    setResearchError(null);
    setSelectedResearchDetail(null);
    setSelectedResearchDocumentId(null);
    try {
      await streamResearchOutlineRun(
        {
          topic: researchTopic.trim(),
          language: locale === "zh-TW" ? "zh-Hant" : "en",
          depth: "standard",
          time_range: researchTimeRange.trim() || undefined,
          portfolio_id: selectedPortfolio?.id ?? null
        },
        (event) => {
          if (event.type === "run_created") {
            runId = event.run.id;
            setSelectedResearchRunId(event.run.id);
            setResearchRuns((runs) => [event.run, ...runs.filter((run) => run.id !== event.run.id)]);
          }
          if (event.type === "document_completed") {
            setSelectedResearchDocumentId(event.document.id);
          }
          if (event.type === "done" && event.run) {
            const completedRun = event.run;
            setResearchRuns((runs) => [completedRun, ...runs.filter((run) => run.id !== completedRun.id)]);
          }
        }
      );
      if (runId) await loadResearchIndex(runId);
      setResearchStatus(t.research.ready);
    } catch (error) {
      setResearchError(error instanceof Error ? error.message : t.research.error);
      setResearchStatus(null);
    } finally {
      setResearchStreaming(false);
    }
  };

  const runSelectedDeepResearch = async () => {
    if (!selectedResearchRunId || researchStreaming) return;
    setResearchStreaming(true);
    setResearchStatus(t.research.runningDeep);
    setResearchError(null);
    try {
      await streamResearchDeepRun(
        selectedResearchRunId,
        { language: locale === "zh-TW" ? "zh-Hant" : "en" },
        (event) => {
          if (event.type === "document_completed") {
            setSelectedResearchDocumentId(event.document.id);
          }
          if (event.type === "done" && event.run) {
            const completedRun = event.run;
            setResearchRuns((runs) => [completedRun, ...runs.filter((run) => run.id !== completedRun.id)]);
          }
        }
      );
      await loadResearchIndex(selectedResearchRunId);
      setResearchStatus(t.research.ready);
    } catch (error) {
      setResearchError(error instanceof Error ? error.message : t.research.error);
      setResearchStatus(null);
    } finally {
      setResearchStreaming(false);
    }
  };

  const persistPortfolioOrder = (nextOrder: string[]) => {
    setPortfolioOrder(nextOrder);
    savePortfolioOrder(nextOrder);
  };

  const movePortfolioBefore = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const orderedIds = orderPortfolios(portfolios.filter((portfolio) => !portfolio.archived), portfolioOrder).map((portfolio) => portfolio.id);
    const withoutSource = orderedIds.filter((id) => id !== sourceId);
    const targetIndex = withoutSource.indexOf(targetId);
    if (targetIndex < 0) return;
    const nextOrder = [
      ...withoutSource.slice(0, targetIndex),
      sourceId,
      ...withoutSource.slice(targetIndex)
    ];
    persistPortfolioOrder(nextOrder);
  };

  const startPortfolioDrag = (portfolioId: string) => (event: ReactDragEvent<HTMLDivElement>) => {
    setDraggingPortfolioId(portfolioId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", portfolioId);
  };

  const dropPortfolio = (targetPortfolioId: string) => (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const sourceId = draggingPortfolioId ?? event.dataTransfer.getData("text/plain");
    if (sourceId) movePortfolioBefore(sourceId, targetPortfolioId);
    setDraggingPortfolioId(null);
  };

  const loadChatSessions = async (portfolioId: string, nextSelectedSessionId?: string | null) => {
    const sessions = (await fetchChatSessions()).filter(
      (session) => session.status !== "archived" && session.portfolioId === portfolioId
    );
    setChatSessions(sessions);
    const nextSessionId: string | null = sessions.some((session) => session.id === nextSelectedSessionId)
      ? nextSelectedSessionId ?? null
      : sessions[0]?.id ?? null;
    setActiveChatSessionId(nextSessionId);
  };

  const loadChatMessages = async (sessionId: string | null) => {
    if (!sessionId) {
      setChatMessages([]);
      setPendingApprovals([]);
      setApprovalDecisionsByMessage({});
      return;
    }

    const messages = await fetchChatSessionMessages(sessionId);
    setChatMessages(
      messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({
          id: message.id,
          role: message.role as "user" | "assistant",
          text: message.content,
          attachments: message.attachments
            .filter(isChatImageAttachment)
            .map(toDisplayChatAttachment)
        }))
    );
    setPendingApprovals([]);
    setApprovalDecisionsByMessage({});
  };

  const loadSelectedPortfolioBundle = async (portfolioId: string) => {
    setPortfolioLoading(true);
    setMutationError(null);
    try {
      const bundle = await fetchPortfolioBundle(portfolioId);
      setSelectedPortfolio(bundle.portfolio);
      setPortfolioStats(bundle.stats);
      setHoldings(bundle.holdings);
      setPageError(null);
      await loadChatSessions(portfolioId, activeChatSessionId);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to load portfolio data.");
      setSelectedPortfolio(null);
      setPortfolioStats(null);
      setHoldings([]);
    } finally {
      setPortfolioLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      setBootstrapping(true);
      setPageError(null);
      try {
        const items = await fetchPortfolios();
        if (cancelled) return;
        const orderedItems = orderPortfolios(items.filter((item) => !item.archived), portfolioOrder);
        setPortfolios(items);
        setSelectedPortfolioId(orderedItems[0]?.id ?? null);
      } catch (error) {
        if (!cancelled) setPageError(error instanceof Error ? error.message : "Failed to load portfolios.");
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedPortfolioId) {
      setSelectedPortfolio(null);
      setPortfolioStats(null);
      setHoldings([]);
      setChatSessions([]);
      setActiveChatSessionId(null);
      return;
    }
    void loadSelectedPortfolioBundle(selectedPortfolioId);
  }, [selectedPortfolioId]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const nextHash = appPageHash(currentPage);
      if (window.location.hash !== nextHash) {
        window.history.pushState({ page: currentPage }, "", `${window.location.pathname}${window.location.search}${nextHash}`);
      }
    }
    closeTransientShellUI();
    if (currentPage === "prompts" && prompts.length === 0 && !promptsLoading) {
      void loadPromptIndex(null);
    }
    if (currentPage === "research" && researchRuns.length === 0 && !researchLoading) {
      void loadResearchIndex(null);
    }
  }, [currentPage, prompts.length, promptsLoading, researchLoading, researchRuns.length]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const syncPageFromLocation = () => {
      const nextPage = appPageFromHash(window.location.hash);
      setCurrentPage((current) => (current === nextPage ? current : nextPage));
    };
    window.addEventListener("hashchange", syncPageFromLocation);
    window.addEventListener("popstate", syncPageFromLocation);
    return () => {
      window.removeEventListener("hashchange", syncPageFromLocation);
      window.removeEventListener("popstate", syncPageFromLocation);
    };
  }, []);

  useEffect(() => {
    void loadChatMessages(activeChatSessionId);
  }, [activeChatSessionId]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(event.target as Node)) {
        setProfileDropdownOpen(false);
        setPortfolioPendingDelete(null);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (portfolioPendingDelete) {
        setPortfolioPendingDelete(null);
        return;
      }
      setProfileDropdownOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [portfolioPendingDelete]);

  const refreshSelectedPortfolio = async () => {
    if (!selectedPortfolioId) return;
    await loadSelectedPortfolioBundle(selectedPortfolioId);
  };

  const createPortfolio = async (event: FormEvent) => {
    event.preventDefault();
    setIsSavingPortfolio(true);
    setMutationError(null);
    try {
      const created = await createPortfolioRequest({
        name: newPortfolio.name.trim() || "Untitled Portfolio",
        strategy: newPortfolio.strategy.trim() || "Long-term discretionary strategy.",
        cash: Number(newPortfolio.cash) || 0,
        currency: newPortfolio.currency
      });
      persistPortfolioOrder([created.id, ...portfolioOrder.filter((id) => id !== created.id)]);
      await loadPortfolioIndex(created.id);
      setPortfolioSheetOpen(false);
      setNewPortfolio({ name: "", strategy: "", cash: "250000", currency: "TWD" });
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Failed to create portfolio.");
    } finally {
      setIsSavingPortfolio(false);
    }
  };

  const openPortfolioEditor = async (portfolioId: string) => {
    try {
      setMutationError(null);
      const portfolio =
        selectedPortfolio?.id === portfolioId
          ? selectedPortfolio
          : (await fetchPortfolioBundle(portfolioId)).portfolio;
      setSelectedPortfolioId(portfolioId);
      setPortfolioEditDraft({
        id: portfolio.id,
        name: portfolio.name,
        strategy: portfolio.strategy,
        cash: String(portfolio.cash),
        currency: portfolio.currency
      });
      setPortfolioEditorOpen(true);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Failed to load portfolio for editing.");
    }
  };

  const savePortfolioEdits = async (event: FormEvent) => {
    event.preventDefault();
    if (!portfolioEditDraft.id) return;
    setIsSavingPortfolio(true);
    setMutationError(null);
    try {
      await updatePortfolioRequest(portfolioEditDraft.id, {
        name: portfolioEditDraft.name.trim() || "Untitled Portfolio",
        strategy: portfolioEditDraft.strategy.trim(),
        cash: Number(portfolioEditDraft.cash) || 0,
        currency: portfolioEditDraft.currency
      });
      await loadPortfolioIndex(portfolioEditDraft.id);
      await loadSelectedPortfolioBundle(portfolioEditDraft.id);
      setPortfolioEditorOpen(false);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Failed to save portfolio changes.");
    } finally {
      setIsSavingPortfolio(false);
    }
  };

  const saveCashSettings = async (cashLevel: number, targetCashRatio: number) => {
    if (!selectedPortfolioId) return;
    const updated = await updatePortfolioRequest(selectedPortfolioId, { cashLevel, targetCashRatio });
    setSelectedPortfolio(updated);
    await loadPortfolioIndex(updated.id);
  };

  const togglePortfolioPinned = async (portfolio: PortfolioSummary) => {
    const updated = await updatePortfolioRequest(portfolio.id, { pinned: !portfolio.pinned });
    setPortfolios((current) => current.map((item) => (item.id === updated.id ? { ...item, pinned: updated.pinned } : item)));
    if (selectedPortfolio?.id === updated.id) setSelectedPortfolio(updated);
    await loadPortfolioIndex(selectedPortfolioId ?? updated.id);
  };

  const deletePortfolio = async (portfolio: PortfolioSummary) => {
    try {
      setMutationError(null);
      await deletePortfolioRequest(portfolio.id);
      const items = await fetchPortfolios();
      const orderedItems = orderPortfolios(items.filter((item) => !item.archived), portfolioOrder);
      const nextSelectedId = portfolio.id === selectedPortfolioId ? (orderedItems[0]?.id ?? null) : selectedPortfolioId;
      setPortfolios(items);
      setPortfolioPendingDelete(null);
      setProfileDropdownOpen(false);
      setSelectedPortfolioId(nextSelectedId);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Failed to delete portfolio.");
    }
  };

  const saveHolding = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedPortfolio) return;
    setIsSavingHolding(true);
    setHoldingError(null);
    try {
      const parsed = parseHoldingForm(holdingForm);
      if (holdingForm.id) {
        await updateHolding(selectedPortfolio.id, holdingForm.id, parsed);
      } else {
        await createHolding(selectedPortfolio.id, parsed);
      }
      setHoldingSheetOpen(false);
      setHoldingForm(emptyHoldingForm());
      await refreshSelectedPortfolio();
      await loadPortfolioIndex(selectedPortfolio.id);
    } catch (error) {
      setHoldingError(error instanceof Error ? error.message : "Failed to save holding.");
    } finally {
      setIsSavingHolding(false);
    }
  };

  const removeHolding = async (holding: HoldingPosition) => {
    if (!selectedPortfolio || !confirm(`Remove ${holding.ticker}?`)) return;
    try {
      setMutationError(null);
      await deleteHolding(selectedPortfolio.id, holding.id);
      await refreshSelectedPortfolio();
      await loadPortfolioIndex(selectedPortfolio.id);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Failed to remove holding.");
    }
  };

  const createCopilotSession = async () => {
    if (!selectedPortfolio) return null;
    const session = await createChatSession({
      title: `${selectedPortfolio.name} ${new Date().toLocaleDateString()}`,
      portfolio_id: selectedPortfolio.id
    });
    await loadChatSessions(selectedPortfolio.id, session.id);
    setChatMessages([]);
    setPendingApprovals([]);
    setApprovalDecisionsByMessage({});
    return session;
  };

  const renameCopilotSession = async (sessionId: string) => {
    const source = chatSessions.find((session) => session.id === sessionId);
    if (!source || !selectedPortfolio) return;
    const title = prompt(t.portfolio.renameChat, source.title)?.trim();
    if (!title) return;
    await updateChatSession(sessionId, { title });
    await loadChatSessions(selectedPortfolio.id, sessionId);
  };

  const archiveCopilotSession = async (sessionId: string) => {
    const source = chatSessions.find((session) => session.id === sessionId);
    if (!source || !selectedPortfolio || !confirm(`${t.portfolio.archiveChat}: ${source.title}?`)) return;
    await updateChatSession(sessionId, { status: "archived" });
    await loadChatSessions(selectedPortfolio.id, activeChatSessionId === sessionId ? null : activeChatSessionId);
  };

  const submitChat = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedPortfolio || !chatInput.trim() || chatStreaming) return;
    let sessionId = activeChatSessionId;
    if (!deepResearchEnabled && !sessionId) {
      const created = await createChatSession({
        title: `${selectedPortfolio.name} ${new Date().toLocaleDateString()}`,
        portfolio_id: selectedPortfolio.id
      });
      sessionId = created.id;
      setChatSessions((sessions) => [created, ...sessions]);
    }
    const userAttachments = deepResearchEnabled ? [] : chatAttachments;
    const userMessage = {
      id: crypto.randomUUID(),
      role: "user" as const,
      text: chatInput.trim(),
      attachments: userAttachments
    };
    const streamingMessageId = crypto.randomUUID();

    setChatStreaming(true);
    setDeepResearchStatus(deepResearchEnabled ? t.portfolio.deepResearchStatusPlanning : null);
    setChatMessages((messages) => [...messages, userMessage, { id: streamingMessageId, role: "assistant", text: "" }]);
    setChatInput("");
    setChatAttachments([]);

    try {
      const handleStreamEvent = (event: StreamEvent) => {
          if (event.type === "text_delta") {
            setDeepResearchStatus(null);
            setChatMessages((messages) =>
              messages.map((message) =>
                message.id === streamingMessageId ? { ...message, text: message.text + event.delta } : message
              )
            );
          }
          if (event.type === "approval_requested") {
            setPendingApprovals((approvals) => [...approvals, { ...event, status: "pending", messageId: streamingMessageId }]);
          }
          if (event.type === "approval_clarification_required") {
            const clarification = approvalClarificationText(event.missing, t.portfolio);
            setChatMessages((messages) =>
              messages.map((message) => (message.id === streamingMessageId ? { ...message, text: clarification } : message))
            );
          }
          if (event.type === "planning_started" || event.type === "planning_completed") {
            setDeepResearchStatus(t.portfolio.deepResearchStatusPlanning);
          }
          if (event.type === "specialist_started" || event.type === "specialist_completed") {
            setDeepResearchStatus(t.portfolio.deepResearchStatusSpecialist);
          }
          if (event.type === "review_started" || event.type === "review_completed") {
            setDeepResearchStatus(t.portfolio.deepResearchStatusReviewing);
          }
          if (event.type === "message_started") {
            setDeepResearchStatus(t.portfolio.deepResearchStatusSynthesizing);
          }
          if (event.type === "document_completed") {
            setChatMessages((messages) =>
              messages.map((message) => {
                if (message.id !== streamingMessageId) return message;
                const current = message.researchDocuments ?? [];
                if (current.some((document) => document.id === event.document.id)) return message;
                return { ...message, researchDocuments: [...current, event.document] };
              })
            );
          }
          if (event.type === "run_created" || event.type === "deep_started") {
            setDeepResearchStatus(t.portfolio.deepResearchStatusPlanning);
          }
          if (event.type === "item_started" || event.type === "item_completed" || event.type === "item_skipped") {
            setDeepResearchStatus(t.portfolio.deepResearchStatusSpecialist);
          }
        };

      if (deepResearchEnabled) {
        await streamDeepResearchReply(userMessage.text, handleStreamEvent, {
          research_depth: "standard",
          max_agents: 4,
          portfolio_id: selectedPortfolio.id,
          language: locale === "zh-TW" ? "zh-Hant" : "en"
        });
      } else {
        await streamPortfolioCopilotReply(
          selectedPortfolio.id,
          sessionId,
          [
            {
              role: userMessage.role,
              content: userMessage.text,
              attachments: userAttachments.map(({ type, image_url, detail }) => ({ type, image_url, detail }))
            }
          ],
          handleStreamEvent,
          {
            reasoning_enabled: chatReasoningEnabled
          }
        );
      }
      if (!deepResearchEnabled && sessionId) await loadChatSessions(selectedPortfolio.id, sessionId);
    } catch (error) {
      const fallbackText =
        locale === "zh-TW"
          ? `連線聊天後端失敗：${error instanceof Error ? error.message : "未知錯誤"}`
          : `Chat backend request failed: ${error instanceof Error ? error.message : "Unknown error"}`;
      setChatMessages((messages) =>
        messages.map((message) => (message.id === streamingMessageId ? { ...message, text: fallbackText } : message))
      );
    } finally {
      setDeepResearchStatus(null);
      setChatStreaming(false);
    }
  };

  const applyApproval = async (approvalId: string) => {
    const approvalMessageId = pendingApprovals.find((approval) => approval.approval_id === approvalId)?.messageId;
    setPendingApprovals((approvals) =>
      approvals.map((approval) => (approval.approval_id === approvalId ? { ...approval, status: "applying" } : approval))
    );
    try {
      await applyPortfolioApproval(approvalId);
      if (approvalMessageId) {
        setApprovalDecisionsByMessage((decisions) => ({ ...decisions, [approvalMessageId]: "applied" }));
      }
      setPendingApprovals((approvals) => approvals.filter((approval) => approval.approval_id !== approvalId));
      await refreshSelectedPortfolio();
      if (selectedPortfolioId) await loadPortfolioIndex(selectedPortfolioId);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Failed to apply proposed changes.");
      setPendingApprovals((approvals) =>
        approvals.map((approval) => (approval.approval_id === approvalId ? { ...approval, status: "pending" } : approval))
      );
    }
  };

  const rejectApproval = async (approvalId: string) => {
    const approvalMessageId = pendingApprovals.find((approval) => approval.approval_id === approvalId)?.messageId;
    setPendingApprovals((approvals) =>
      approvals.map((approval) => (approval.approval_id === approvalId ? { ...approval, status: "rejecting" } : approval))
    );
    try {
      await rejectPortfolioApproval(approvalId);
      if (approvalMessageId) {
        setApprovalDecisionsByMessage((decisions) => ({ ...decisions, [approvalMessageId]: "rejected" }));
      }
      setPendingApprovals((approvals) => approvals.filter((approval) => approval.approval_id !== approvalId));
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Failed to reject proposed changes.");
      setPendingApprovals((approvals) =>
        approvals.map((approval) => (approval.approval_id === approvalId ? { ...approval, status: "pending" } : approval))
      );
    }
  };

  const openHoldingSheet = (holding?: HoldingPosition) => {
    closeTransientShellUI();
    setHoldingError(null);
    setHoldingForm(holding ? formFromHolding(holding) : emptyHoldingForm());
    setHoldingSheetOpen(true);
  };

  const profileDropdownDialog = profileDropdownOpen ? (
    <div
      className="profile-dropdown-backdrop"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        setPortfolioPendingDelete(null);
        setProfileDropdownOpen(false);
      }}
    >
      <div className="profile-dropdown" role="dialog" aria-modal="true" aria-label={t.portfolio.portfoliosLabel}>
        <header className="profile-dropdown-header">
          <h2>{t.portfolio.portfoliosLabel}</h2>
          <button
            type="button"
            className="profile-modal-close"
            aria-label={t.closeButton}
            onClick={() => {
              setPortfolioPendingDelete(null);
              setProfileDropdownOpen(false);
            }}
          >
            <X size={24} />
          </button>
        </header>
        <label className="control-field profile-search">
          <Search size={24} />
          <input value={portfolioQuery} onChange={(event) => setPortfolioQuery(event.target.value)} placeholder={t.portfolio.searchPortfolios} />
        </label>
        <div className="profile-option-list">
          {filteredPortfolios.length ? filteredPortfolios.map((portfolio) => {
            const portfolioDisplayMetrics = getPortfolioDisplayMetrics({
              cashLevel: portfolio.cashLevel,
              holdingsValue: portfolio.summary.totalValue,
              holdingsCount: portfolio.summary.holdingsCount
            });

            return (
              <div
                key={portfolio.id}
                className={[
                  "profile-option-row",
                  portfolio.id === selectedPortfolioId ? "active" : "",
                  draggingPortfolioId === portfolio.id ? "dragging" : ""
                ].filter(Boolean).join(" ")}
                draggable
                onDragStart={startPortfolioDrag(portfolio.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={dropPortfolio(portfolio.id)}
                onDragEnd={() => setDraggingPortfolioId(null)}
              >
                <button
                  type="button"
                  className="profile-option"
                  onClick={() => {
                    setSelectedPortfolioId(portfolio.id);
                    setProfileDropdownOpen(false);
                  }}
                >
                  <span className="portfolio-avatar" aria-hidden="true">{portfolio.name.slice(0, 2).toUpperCase()}</span>
                  <span className="profile-option-copy">
                    <strong>{portfolio.name}</strong>
                    <small>{maskPricingValue(currency(portfolioDisplayMetrics.totalAssets, portfolio.currency), priceMasked, t.portfolio.maskedValue)}</small>
                  </span>
                  {portfolio.id === selectedPortfolioId ? <Check size={15} /> : null}
                </button>
                <button
                  type="button"
                  className={portfolio.pinned ? "profile-pin-button pinned" : "profile-pin-button"}
                  aria-label={portfolio.pinned ? t.portfolio.unpinPortfolio : t.portfolio.pinPortfolio}
                  aria-pressed={portfolio.pinned}
                  onClick={() => void togglePortfolioPinned(portfolio)}
                >
                  <Star size={14} />
                </button>
                <button
                  type="button"
                  className="profile-row-action"
                  aria-label={t.portfolio.editPortfolio}
                  onClick={() => {
                    setProfileDropdownOpen(false);
                    void openPortfolioEditor(portfolio.id);
                  }}
                >
                  <Edit3 size={18} />
                </button>
                <button
                  type="button"
                  className="profile-row-action danger"
                  aria-label={t.portfolio.deletePortfolio}
                  onClick={() => setPortfolioPendingDelete(portfolio)}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            );
          }) : (
            <div className="portfolio-empty-state">{t.portfolio.noPortfolioResults}</div>
          )}
        </div>
        <button
          type="button"
          className="profile-create-option"
          onClick={() => {
            setProfileDropdownOpen(false);
            setPortfolioSheetOpen(true);
          }}
        >
          <Plus size={26} />
          <span>{t.portfolio.createNewPortfolio}</span>
        </button>
        {portfolioPendingDelete ? (
          <div className="portfolio-delete-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="portfolio-delete-title">
            <div className="portfolio-delete-card">
              <h3 id="portfolio-delete-title">{t.portfolio.deletePortfolioTitle}</h3>
              <p>{t.portfolio.deletePortfolioBody(portfolioPendingDelete.name)}</p>
              <div className="portfolio-delete-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setPortfolioPendingDelete(null)}>{t.portfolio.cancelDeletePortfolio}</button>
                <button type="button" className="btn btn-danger" onClick={() => void deletePortfolio(portfolioPendingDelete)}>{t.portfolio.confirmDeletePortfolio}</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <div className={`shell theme-${appTheme} ${sidebarCollapsed ? "sidebar-collapsed" : "sidebar-expanded"}`}>
      <header className="sidebar">
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <p className="eyebrow">TWStock Agents</p>
            <div className="sidebar-copy" aria-hidden={sidebarCollapsed}>
              <strong>{t.subtitle}</strong>
              <span>{t.pages[currentPage]}</span>
            </div>
          </div>
          <button
            type="button"
            className="icon-button sidebar-toggle"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            {sidebarCollapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
          </button>
        </div>
        <nav className="nav">
          <button
            type="button"
            className={currentPage === "portfolio" ? "nav-item active" : "nav-item"}
            aria-label={t.pages.portfolio}
            onClick={() => {
              setCurrentPage("portfolio");
              setMobileFocus("portfolio");
            }}
          >
            <span className="nav-icon" aria-hidden="true"><PieChart size={18} /></span>
            <span className="nav-label">{t.pages.portfolio}</span>
            <span className="nav-tooltip" role="tooltip">{t.pages.portfolio}</span>
          </button>
          <button
            type="button"
            className={currentPage === "prompts" ? "nav-item active" : "nav-item"}
            aria-label={t.pages.prompts}
            onClick={() => {
              setCurrentPage("prompts");
              void loadPromptIndex(null);
            }}
          >
            <span className="nav-icon" aria-hidden="true"><FileText size={18} /></span>
            <span className="nav-label">{t.pages.prompts}</span>
            <span className="nav-tooltip" role="tooltip">{t.pages.prompts}</span>
          </button>
          <button
            type="button"
            className={currentPage === "research" ? "nav-item active" : "nav-item"}
            aria-label={t.pages.research}
            onClick={() => {
              setCurrentPage("research");
              void loadResearchIndex(null);
            }}
          >
            <span className="nav-icon" aria-hidden="true"><Search size={18} /></span>
            <span className="nav-label">{t.pages.research}</span>
            <span className="nav-tooltip" role="tooltip">{t.pages.research}</span>
          </button>
        </nav>
      </header>

      <main className="main">
        <div className="shell-topbar">
          <div className="shell-brand">
            <p className="eyebrow">TWStock Agents</p>
            <h1>{t.app}</h1>
          </div>
          <div className="top-nav-actions">
            <span className="badge badge-teal">{t.badgeOrg}</span>
            <span className="badge">{t.badgeMode}</span>
            <button
              type="button"
              className="icon-button theme-toggle"
              aria-label={appTheme === "dark" ? "Switch to bright mode" : "Switch to dark mode"}
              aria-pressed={appTheme === "dark"}
              onClick={() => setAppTheme((theme) => (theme === "dark" ? "light" : "dark"))}
            >
              {appTheme === "dark" ? <Moon size={17} /> : <Sun size={17} />}
            </button>
            <button
              type="button"
              className={priceMasked ? "icon-button privacy-toggle active" : "icon-button privacy-toggle"}
              aria-label={priceMasked ? t.portfolio.showPricing : t.portfolio.hidePricing}
              aria-pressed={priceMasked}
              onClick={() => setPriceMasked((masked) => !masked)}
            >
              {priceMasked ? <Eye size={17} /> : <EyeOff size={17} />}
            </button>
            <div className="language-menu">
              <button
                className="icon-button language-trigger"
                onClick={() => {
                  setProfileDropdownOpen(false);
                  setPortfolioPendingDelete(null);
                  setCopilotInfoOpen(false);
                  setLanguageMenuOpen((open) => !open);
                }}
                aria-haspopup="menu"
                aria-expanded={languageMenuOpen}
                aria-label={t.languageLabel}
              >
                <Languages size={17} />
                <ChevronDown size={14} />
              </button>
              {languageMenuOpen ? (
                <div className="language-popover" role="menu">
                  <button className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")} role="menuitem">
                    <span>English</span>
                    {locale === "en" ? <Check size={15} /> : null}
                  </button>
                  <button className={locale === "zh-TW" ? "active" : ""} onClick={() => setLocale("zh-TW")} role="menuitem">
                    <span>繁體中文</span>
                    {locale === "zh-TW" ? <Check size={15} /> : null}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <nav className="mobile-shell-nav" aria-label={t.mobileDock.label}>
          <button
            type="button"
            className={currentPage === "portfolio" ? "mobile-shell-tab active" : "mobile-shell-tab"}
            aria-label={t.pages.portfolio}
            aria-current={currentPage === "portfolio" ? "page" : undefined}
            onClick={() => {
              setCurrentPage("portfolio");
              setMobileFocus("portfolio");
            }}
          >
            <PieChart size={18} />
          </button>
          <button
            type="button"
            className={currentPage === "prompts" ? "mobile-shell-tab active" : "mobile-shell-tab"}
            aria-label={t.pages.prompts}
            aria-current={currentPage === "prompts" ? "page" : undefined}
            onClick={() => {
              setCurrentPage("prompts");
              void loadPromptIndex(null);
            }}
          >
            <FileText size={18} />
          </button>
          <button
            type="button"
            className={currentPage === "research" ? "mobile-shell-tab active" : "mobile-shell-tab"}
            aria-label={t.pages.research}
            aria-current={currentPage === "research" ? "page" : undefined}
            onClick={() => {
              setCurrentPage("research");
              void loadResearchIndex(null);
            }}
          >
            <Search size={18} />
          </button>
        </nav>
        {currentPage === "prompts" ? (
          <PromptManagementPage
            labels={t.prompts}
            prompts={prompts}
            selectedPromptId={selectedPromptId}
            draft={promptDraft}
            setDraft={setPromptDraft}
            loading={promptsLoading}
            saving={promptSaving}
            error={promptError}
            notice={promptNotice}
            onSelect={selectPrompt}
            onCreate={createPromptDraft}
            onSubmit={savePromptDraft}
            onDelete={removePromptDraft}
          />
        ) : currentPage === "research" ? (
          <DeepResearchPage
            labels={t.research}
            locale={locale}
            selectedPortfolio={selectedPortfolio}
            topic={researchTopic}
            setTopic={setResearchTopic}
            timeRange={researchTimeRange}
            setTimeRange={setResearchTimeRange}
            runs={researchRuns}
            selectedRunId={selectedResearchRunId}
            detail={selectedResearchDetail}
            selectedDocumentId={selectedResearchDocumentId}
            setSelectedDocumentId={setSelectedResearchDocumentId}
            loading={researchLoading}
            streaming={researchStreaming}
            status={researchStatus}
            error={researchError}
            onCreateOutline={createResearchOutline}
            onRunDeep={() => void runSelectedDeepResearch()}
            onRefresh={() => void loadResearchIndex(selectedResearchRunId)}
            onSelectRun={(runId) => void selectResearchRun(runId)}
            onOpenHelp={closeTransientShellUI}
          />
        ) : bootstrapping ? (
          <section className="portfolio-placeholder">
            <p className="hero-tag">{t.pageTag.portfolio}</p>
            <h2>Loading portfolios...</h2>
            <p>Connecting the workbench to the backend service.</p>
          </section>
        ) : pageError && portfolios.length === 0 ? (
          <section className="portfolio-placeholder">
            <p className="hero-tag">{t.pageTag.portfolio}</p>
            <h2>Portfolio backend unavailable</h2>
            <p>{pageError}</p>
          </section>
        ) : (
          <div className="portfolio-app chat-first">
            <section className="portfolio-command-rail" aria-label={t.portfolio.commandRail}>
              <div className="profile-selector-shell" ref={profileDropdownRef}>
                <button
                  type="button"
                  className="profile-selector-trigger"
                  aria-label={t.portfolio.profileSelector}
                  aria-haspopup="dialog"
                  aria-expanded={profileDropdownOpen}
                  onClick={() => {
                    setLanguageMenuOpen(false);
                    setCopilotInfoOpen(false);
                    setProfileDropdownOpen((open) => !open);
                    setPortfolioPendingDelete(null);
                  }}
                >
                  <span className="portfolio-avatar" aria-hidden="true">{selectedPortfolio?.name.slice(0, 2).toUpperCase() ?? "PF"}</span>
                  <span>{selectedPortfolio?.name ?? t.portfolio.selectedPortfolio}</span>
                  <ChevronDown size={15} />
                </button>
                {pinnedPortfolios.length ? (
                  <section className="rail-pinned-profiles" aria-label={t.portfolio.pinnedProfiles}>
                    <div className="rail-section-heading pinned-heading">
                      <span>{t.portfolio.pinnedProfiles}</span>
                    </div>
                    <div className="pinned-profile-list">
                      {pinnedPortfolios.map((portfolio) => {
                        const portfolioDisplayMetrics = getPortfolioDisplayMetrics({
                          cashLevel: portfolio.cashLevel,
                          holdingsValue: portfolio.summary.totalValue,
                          holdingsCount: portfolio.summary.holdingsCount
                        });

                        return (
                          <button
                            type="button"
                            key={portfolio.id}
                            className={portfolio.id === selectedPortfolioId ? "pinned-profile-button active" : "pinned-profile-button"}
                            onClick={() => {
                              setSelectedPortfolioId(portfolio.id);
                              setProfileDropdownOpen(false);
                            }}
                          >
                            <span className="pinned-profile-star" aria-hidden="true"><Star size={12} /></span>
                            <span className="pinned-profile-copy">
                              <strong>{portfolio.name}</strong>
                              <small>{maskPricingValue(currency(portfolioDisplayMetrics.totalAssets, portfolio.currency), priceMasked, t.portfolio.maskedValue)}</small>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
              </div>
              <div className="rail-chat-sessions" aria-label={t.portfolio.chatSessions}>
                <div className="rail-section-heading">
                  <span>{t.portfolio.chatSessions}</span>
                  <button type="button" className="action-button primary" onClick={() => void createCopilotSession()} aria-label={t.portfolio.newChat} disabled={!selectedPortfolio}>
                    <Plus size={14} />
                  </button>
                </div>
                <div className="chat-session-list rail-chat-session-list">
                  {chatSessions.length ? chatSessions.map((session) => (
                    <div className={session.id === activeChatSessionId ? "chat-session-row active" : "chat-session-row"} key={session.id}>
                      <button type="button" className="chat-session-main" onClick={() => setActiveChatSessionId(session.id)}>
                        <strong>{session.title || t.portfolio.untitledChat}</strong>
                        <small>{session.lastMessageAt ? new Date(session.lastMessageAt).toLocaleString() : new Date(session.updatedAt).toLocaleString()}</small>
                      </button>
                      <span className="chat-session-actions">
                        <button type="button" className="action-button ghost" onClick={() => void renameCopilotSession(session.id)} aria-label={t.portfolio.renameChat}><Edit3 size={13} /></button>
                        <button type="button" className="action-button danger" onClick={() => void archiveCopilotSession(session.id)} aria-label={t.portfolio.archiveChat}><Trash2 size={13} /></button>
                      </span>
                    </div>
                  )) : (
                    <div className="chat-session-empty">{t.portfolio.noChatSessions}</div>
                  )}
                </div>
              </div>
            </section>

            <PortfolioWorkspace
              labels={t.portfolio}
              selectedPortfolio={selectedPortfolio}
              stats={portfolioStats}
              holdings={filteredHoldings}
              holdingQuery={holdingQuery}
              setHoldingQuery={setHoldingQuery}
              openHoldingSheet={openHoldingSheet}
              removeHolding={removeHolding}
              chatMessages={chatMessages}
              chatInput={chatInput}
              setChatInput={setChatInput}
              chatAttachments={chatAttachments}
              setChatAttachments={setChatAttachments}
              chatReasoningEnabled={chatReasoningEnabled}
              setChatReasoningEnabled={setChatReasoningEnabled}
              deepResearchEnabled={deepResearchEnabled}
              setDeepResearchEnabled={setDeepResearchEnabled}
              deepResearchStatus={deepResearchStatus}
              submitChat={submitChat}
              pendingApprovals={pendingApprovals}
              approvalDecisionsByMessage={approvalDecisionsByMessage}
              applyApproval={applyApproval}
              rejectApproval={rejectApproval}
              copilotOpen={copilotOpen}
              setCopilotOpen={setCopilotOpen}
              copilotInfoOpen={copilotInfoOpen}
              setCopilotInfoOpen={setCopilotInfoOpen}
              chatStreaming={chatStreaming}
              portfolioLoading={portfolioLoading}
              pageError={pageError}
              mutationError={mutationError}
              isSavingPortfolio={isSavingPortfolio}
              priceMasked={priceMasked}
              mobileFocus={mobileFocus}
              onOpenProfilePicker={() => {
                setLanguageMenuOpen(false);
                setCopilotInfoOpen(false);
                setPortfolioPendingDelete(null);
                setProfileDropdownOpen(true);
              }}
              onSaveCashSettings={saveCashSettings}
            />
          </div>
        )}
      </main>

      {currentPage === "portfolio" ? <nav className="mobile-action-dock" aria-label={t.mobileDock.label}>
        <button
          type="button"
          className={mobileFocus === "portfolio" ? "active" : ""}
          onClick={() => {
            setMobileFocus("portfolio");
            scrollToMobileSection(".main");
          }}
        >
          <PieChart size={18} />
          <span>{t.mobileDock.portfolio}</span>
        </button>
        <button
          type="button"
          className={mobileFocus === "ai" ? "active" : ""}
          onClick={() => {
            setMobileFocus("ai");
            scrollToMobileSection(".main");
          }}
        >
          <Bot size={18} />
          <span>{t.mobileDock.chat}</span>
        </button>
        <button
          type="button"
          className={mobileFocus === "context" ? "active" : ""}
          onClick={() => {
            setMobileFocus("context");
            scrollToMobileSection(".main");
          }}
        >
          <Database size={18} />
          <span>{t.mobileDock.context}</span>
        </button>
        <button type="button" className="primary" onClick={() => openHoldingSheet()} disabled={!selectedPortfolio}>
          <Plus size={19} />
          <span>{t.mobileDock.addHolding}</span>
        </button>
      </nav> : null}

      {portfolioSheetOpen ? (
        <PortfolioSheet
          labels={t.portfolio}
          closeLabel={t.closeButton}
          value={newPortfolio}
          setValue={setNewPortfolio}
          onSubmit={createPortfolio}
          onClose={() => setPortfolioSheetOpen(false)}
          mutationError={mutationError}
          saving={isSavingPortfolio}
        />
      ) : null}

      {portfolioEditorOpen ? (
        <PortfolioSheet
          labels={t.portfolio}
          closeLabel={t.closeButton}
          value={portfolioEditDraft}
          setValue={setPortfolioEditDraft}
          onSubmit={savePortfolioEdits}
          onClose={() => setPortfolioEditorOpen(false)}
          mutationError={mutationError}
          saving={isSavingPortfolio}
          editing
        />
      ) : null}

      {holdingSheetOpen ? (
        <HoldingSheet
          labels={t.portfolio}
          closeLabel={t.closeButton}
          form={holdingForm}
          setForm={setHoldingForm}
          holdingOptions={holdingOptions}
          onSubmit={saveHolding}
          onClose={() => setHoldingSheetOpen(false)}
          holdingError={holdingError}
          saving={isSavingHolding}
        />
      ) : null}

      {profileDropdownDialog}
    </div>
  );
}

function MobilePortfolioHome(props: {
  labels: PortfolioLabels;
  selectedPortfolio: Portfolio;
  stats: PortfolioStats;
  holdings: HoldingPosition[];
  openHoldingSheet: (holding?: HoldingPosition) => void;
  priceMasked: boolean;
  onOpenProfilePicker: () => void;
}) {
  const { labels, selectedPortfolio, stats, holdings, openHoldingSheet, priceMasked, onOpenProfilePicker } = props;
  const previewHoldings = holdings.slice(0, 5);
  const topHolding = holdings.find((holding) => holding.ticker === stats.topHolding?.ticker) ?? holdings[0] ?? null;
  const displayMetrics = getPortfolioDisplayMetrics({
    cashLevel: selectedPortfolio.cashLevel,
    holdingsValue: stats.holdingsValue,
    holdingsCount: stats.holdingsCount
  });
  const stockPercent = Math.max(0, Math.min(100, displayMetrics.holdingsPercent));
  const cashPercent = Math.max(0, Math.min(100, displayMetrics.cashPercent));
  const topHoldingPercent = stats.topHolding?.allocationPercent ?? topHolding?.allocation ?? 0;

  return (
    <section className="mobile-portfolio-home" aria-label={labels.selectedPortfolio}>
      <header className="mobile-screen-header">
        <div>
          <p className="hero-tag">{labels.selectedPortfolio}</p>
          <h2>{labels.portfoliosLabel}</h2>
        </div>
        <button type="button" className="mobile-profile-chip" aria-label={labels.profileSelector} onClick={onOpenProfilePicker}>
          <span>{selectedPortfolio.name}</span>
          <ChevronDown size={14} />
        </button>
      </header>

      <article className="mobile-portfolio-hero-card">
        <div>
          <span>{labels.stats.totalValue}</span>
          <strong>{maskPricingValue(currency(displayMetrics.totalAssets, selectedPortfolio.currency), priceMasked, labels.maskedValue)}</strong>
          <em className={priceMasked ? "masked-price" : stats.unrealizedPL >= 0 ? "good" : "bad"}>
            {maskPricingValue(currency(stats.unrealizedPL, selectedPortfolio.currency), priceMasked, labels.maskedValue)}
          </em>
        </div>
        <svg className="mobile-portfolio-sparkline" viewBox="0 0 120 64" aria-hidden="true">
          <path d="M4 50 C18 42 25 48 36 34 S58 36 66 25 S82 22 92 14 S104 18 116 6" />
          <path d="M4 62 L4 50 C18 42 25 48 36 34 S58 36 66 25 S82 22 92 14 S104 18 116 6 L116 62 Z" />
        </svg>
      </article>

      <div className="mobile-portfolio-insight-grid">
        <article className="mobile-insight-card">
          <h3>{labels.performanceAttribution}</h3>
          <div
            className="mobile-donut"
            style={{ "--stock-fill": `${stockPercent}%`, "--cash-fill": `${cashPercent}%` } as CSSProperties}
            aria-label={`${labels.stats.valueAllocation} ${percent(stockPercent)}`}
          />
          <dl className="mobile-allocation-list">
            <div><dt>{labels.holdings}</dt><dd>{percent(stockPercent)}</dd></div>
            <div><dt>{labels.cashAllocation}</dt><dd>{percent(cashPercent)}</dd></div>
          </dl>
        </article>
        <article className="mobile-insight-card">
          <h3>{labels.stats.topHolding}</h3>
          <strong>{stats.topHolding?.ticker ?? labels.none}</strong>
          <span>{topHolding ? topHolding.name : labels.none}</span>
          <em>{percent(topHoldingPercent)}</em>
        </article>
      </div>

      <section className="mobile-holdings-panel">
        <div className="mobile-section-heading">
          <div>
            <h3>{labels.holdings}</h3>
            <span>{stats.holdingsCount} {labels.positions}</span>
          </div>
          <button type="button" onClick={() => openHoldingSheet()} aria-label={labels.addHolding}>
            <Plus size={18} />
          </button>
        </div>
        <div className="mobile-holding-list">
          {previewHoldings.length ? previewHoldings.map((holding) => {
            const gain = getPositionGain(holding);
            return (
              <button type="button" className="mobile-holding-row" key={holding.id} onClick={() => openHoldingSheet(holding)}>
                <span className="mobile-holding-avatar">{holding.ticker.slice(0, 2)}</span>
                <span className="mobile-holding-copy">
                  <strong>{holding.ticker}</strong>
                  <small>{holding.name || labels.none}</small>
                </span>
                <span className="mobile-holding-values">
                  <strong>{percent(holding.allocation)}</strong>
                  <small className={priceMasked ? "masked-price" : gain >= 0 ? "good" : "bad"}>
                    {maskPricingValue(currency(gain, selectedPortfolio.currency), priceMasked, labels.maskedValue)}
                  </small>
                </span>
              </button>
            );
          }) : (
            <div className="holding-empty-state">{labels.noHoldingResults}</div>
          )}
        </div>
      </section>
    </section>
  );
}

function DeepResearchPage(props: {
  labels: ResearchLabels;
  locale: Locale;
  selectedPortfolio: Portfolio | null;
  topic: string;
  setTopic: (value: string) => void;
  timeRange: string;
  setTimeRange: (value: string) => void;
  runs: ResearchRunRecord[];
  selectedRunId: string | null;
  detail: { run: ResearchRunRecord; documents: ResearchDocumentRecord[] } | null;
  selectedDocumentId: string | null;
  setSelectedDocumentId: (value: string | null) => void;
  loading: boolean;
  streaming: boolean;
  status: string | null;
  error: string | null;
  onCreateOutline: (event: FormEvent) => Promise<void>;
  onRunDeep: () => void;
  onRefresh: () => void;
  onSelectRun: (runId: string) => void;
  onOpenHelp: () => void;
}) {
  const {
    labels,
    locale,
    selectedPortfolio,
    topic,
    setTopic,
    timeRange,
    setTimeRange,
    runs,
    selectedRunId,
    detail,
    selectedDocumentId,
    setSelectedDocumentId,
    loading,
    streaming,
    status,
    error,
    onCreateOutline,
    onRunDeep,
    onRefresh,
    onSelectRun,
    onOpenHelp
  } = props;
  const documents = detail?.documents ?? [];
  const selectedDocument = documents.find((document) => document.id === selectedDocumentId) ?? documents[documents.length - 1] ?? null;
  const resultCount = documents.filter((document) => document.kind === "result").length;
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  return (
    <section className="deep-research-page" aria-label={labels.title}>
      <header className="deep-research-hero">
        <div>
          <h2>{labels.title}</h2>
          <p>{labels.subtitle}</p>
          <span className="research-output-trust-cue">
            <Info size={13} aria-hidden="true" />
            <span>{labels.helpNote}</span>
          </span>
        </div>
        <div className="research-hero-actions">
          <button
            type="button"
            className="research-help-trigger"
            onClick={() => {
              onOpenHelp();
              setIsHelpOpen(true);
            }}
            aria-label={labels.helpButton}
          >
            <Info size={18} />
          </button>
          <div className="research-model-chip">
            <span>{labels.model}</span>
            <strong>{status ?? labels.ready}</strong>
          </div>
        </div>
      </header>

      {isHelpOpen ? (
        <div className="research-help-backdrop" role="presentation" onMouseDown={() => setIsHelpOpen(false)}>
          <aside
            className="research-help-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="research-help-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="research-help-header">
              <div>
                <h3 id="research-help-title">{labels.helpTitle}</h3>
                <p>{labels.helpIntro}</p>
              </div>
              <button type="button" className="icon-button ghost" onClick={() => setIsHelpOpen(false)} aria-label={labels.helpButton}>
                <X size={18} />
              </button>
            </div>
            <ol className="research-help-steps">
              {labels.helpSteps.map((step) => (
                <li key={step.title}>
                  <strong>{step.title}</strong>
                  <span>{step.body}</span>
                </li>
              ))}
            </ol>
            <p className="research-help-note">{labels.helpNote}</p>
          </aside>
        </div>
      ) : null}

      <div className="deep-research-layout">
        <section className="research-run-panel">
          <form className="research-run-form" onSubmit={onCreateOutline}>
            <label>
              <span>{labels.topic}</span>
              <textarea value={topic} onChange={(event) => setTopic(event.target.value)} placeholder={labels.topicPlaceholder} disabled={streaming} />
            </label>
            <div className="research-form-row">
              <label>
                <span>{labels.language}</span>
                <input value={locale === "zh-TW" ? "zh-Hant" : "en"} disabled />
              </label>
              <label>
                <span>{labels.timeRange}</span>
                <input value={timeRange} onChange={(event) => setTimeRange(event.target.value)} placeholder={labels.timeRangePlaceholder} disabled={streaming} />
              </label>
            </div>
            <div className="research-form-footer">
              <span>{labels.portfolioLink}: {selectedPortfolio?.name ?? "-"}</span>
              <button type="submit" className="action-button primary filled-action-button research-create-outline-button" disabled={streaming || !topic.trim()} aria-label={labels.createOutline}>
                <FileText size={15} />
                <span>{labels.createOutline}</span>
              </button>
            </div>
          </form>

          <div className="research-run-toolbar">
            <h3>{labels.runHistory}</h3>
            <button type="button" className="icon-button research-refresh-button" onClick={onRefresh} disabled={loading || streaming} aria-label={labels.refresh}>
              <RefreshCw size={15} />
            </button>
          </div>
          {error ? <div className="research-error">{error}</div> : null}
          {loading ? <div className="research-empty-state">{labels.loading}</div> : null}
          <div className="research-run-list">
            {runs.length ? runs.map((run) => (
              <button
                type="button"
                key={run.id}
                className={run.id === selectedRunId ? "research-run-row active" : "research-run-row"}
                onClick={() => onSelectRun(run.id)}
              >
                <span>
                  <strong>{run.topic}</strong>
                  <small>{new Date(run.updated_at).toLocaleString()}</small>
                </span>
                <em>{run.status}</em>
              </button>
            )) : !loading ? (
              <div className="research-empty-state">{labels.emptyRuns}</div>
            ) : null}
          </div>
        </section>

        <section className="research-document-panel">
          <div className="research-detail-strip">
            <div>
              <span>{labels.status}</span>
              <strong>{detail?.run.status ?? "-"}</strong>
            </div>
            <div>
              <span>{labels.items}</span>
              <strong>{detail?.run.total_items ?? 0}</strong>
            </div>
            <div>
              <span>{labels.completed}</span>
              <strong>{detail?.run.completed_items ?? resultCount}</strong>
            </div>
            <div>
              <span>{labels.failed}</span>
              <strong>{detail?.run.failed_items ?? 0}</strong>
            </div>
          </div>

          <div className="research-document-toolbar">
            <h3>{labels.documents}</h3>
            <button type="button" className="action-button primary filled-action-button research-run-deep-button" onClick={onRunDeep} disabled={!selectedRunId || streaming || !documents.some((document) => document.kind === "outline")}>
              <Search size={15} />
              <span>{labels.runDeep}</span>
            </button>
          </div>

          <div className="research-document-list">
            {documents.length ? documents.map((document) => (
              <button
                type="button"
                key={document.id}
                className={document.id === selectedDocument?.id ? "research-document-row active" : "research-document-row"}
                onClick={() => setSelectedDocumentId(document.id)}
              >
                <span>
                  <strong>{document.title}</strong>
                  <small>{document.item_name ?? document.slug}</small>
                </span>
                <em>{researchKindLabel(labels, document.kind)}</em>
              </button>
            )) : (
              <div className="research-empty-state">{labels.emptyDocuments}</div>
            )}
          </div>
        </section>

        <section className="research-preview-panel">
          <div className="research-document-toolbar">
            <h3>{labels.preview}</h3>
            {selectedDocument ? (
              <a className="icon-button research-open-html-button" href={researchDocumentHtmlUrl(selectedDocument.id)} target="_blank" rel="noreferrer" aria-label={labels.openHtml}>
                <Eye size={15} />
              </a>
            ) : null}
          </div>
          {selectedDocument ? (
            <div className="research-preview-frame">
              <div className="research-preview-shell">
                <div className="research-preview-meta">
                  <span className="research-preview-kind">{researchKindLabel(labels, selectedDocument.kind)}</span>
                  <strong>{selectedDocument.title}</strong>
                  <small>{selectedDocument.item_name ?? selectedDocument.slug}</small>
                </div>
                <div className="research-preview-canvas">
                  <iframe title={selectedDocument.title} src={researchDocumentHtmlUrl(selectedDocument.id, { embedded: true })} sandbox="allow-same-origin allow-popups" />
                </div>
              </div>
            </div>
          ) : (
            <div className="research-preview-empty">{labels.noPreview}</div>
          )}
        </section>
      </div>
    </section>
  );
}

function researchKindLabel(labels: ResearchLabels, kind: string): string {
  if (kind === "outline") return labels.kindOutline;
  if (kind === "fields") return labels.kindFields;
  if (kind === "result") return labels.kindResult;
  return kind;
}

function PromptManagementPage(props: {
  labels: PromptLabels;
  prompts: PromptRecord[];
  selectedPromptId: string | null;
  draft: PromptDraft | null;
  setDraft: Dispatch<SetStateAction<PromptDraft | null>>;
  loading: boolean;
  saving: boolean;
  error: string | null;
  notice: string | null;
  onSelect: (prompt: PromptRecord) => void;
  onCreate: () => void;
  onSubmit: (event: FormEvent) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { labels, prompts, selectedPromptId, draft, setDraft, loading, saving, error, notice, onSelect, onCreate, onSubmit, onDelete } = props;

  return (
    <section className="prompt-management-page" aria-label={labels.title}>
      <header className="prompt-page-header">
        <div>
          <p className="hero-tag">{labels.title}</p>
          <h2>{labels.title}</h2>
          <p>{labels.subtitle}</p>
          <span className="ai-trust-cue" aria-label={labels.aiTrustCue}>
            <Info size={13} aria-hidden="true" />
            <span>{labels.aiTrustCue}</span>
          </span>
        </div>
        <button type="button" className="action-button primary filled-action-button prompt-create-button" onClick={onCreate} aria-label={labels.create}>
          <Plus size={15} />
          <span>{labels.create}</span>
        </button>
      </header>

      <div className="prompt-management-grid">
        <section className="prompt-list-panel">
          <div className="prompt-panel-heading">
            <h3>{labels.listTitle}</h3>
            {loading ? <span className="prompt-muted">{labels.loading}</span> : null}
          </div>
          <div className="prompt-table" role="table" aria-label={labels.listTitle}>
            <div className="prompt-table-row prompt-table-head" role="row">
              <span>{labels.key}</span>
              <span>{labels.status}</span>
              <span>{labels.type}</span>
              <span>{labels.updated}</span>
            </div>
            {prompts.length ? prompts.map((prompt) => (
              <button
                type="button"
                key={prompt.id}
                className={prompt.id === selectedPromptId ? "prompt-table-row active" : "prompt-table-row"}
                role="row"
                aria-label={promptRowLabel(prompt, labels)}
                onClick={() => onSelect(prompt)}
              >
                <span>
                  <strong>{prompt.key}</strong>
                  <small>{prompt.name}</small>
                </span>
                <span className={prompt.isActive ? "prompt-status active" : "prompt-status"}>{prompt.isActive ? labels.active : labels.inactive}</span>
                <span className={prompt.isBuiltin ? "prompt-type-chip builtin" : "prompt-type-chip"}>{prompt.isBuiltin ? labels.builtin : labels.custom}</span>
                <span>{formatDate(prompt.updatedAt)}</span>
              </button>
            )) : (
              <div className="prompt-empty-state">{loading ? labels.loading : labels.empty}</div>
            )}
          </div>
        </section>

        <section className="prompt-editor-panel">
          <div className="prompt-panel-heading">
            <h3>{draft?.id ? labels.editorTitle : labels.newPrompt}</h3>
            {draft?.isBuiltin ? <span className="prompt-note-chip">{labels.builtin}</span> : null}
          </div>

          {draft ? (
            <form className="prompt-editor-form" onSubmit={onSubmit}>
              <label>
                <span>{labels.key}</span>
                <input
                  value={draft.key}
                  disabled={Boolean(draft.id)}
                  onChange={(event) => setDraft((current) => current ? { ...current, key: event.target.value } : current)}
                />
              </label>
              <label>
                <span>{labels.name}</span>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)}
                />
              </label>
              <label className="prompt-editor-content">
                <span>{labels.content}</span>
                <textarea
                  value={draft.content}
                  onChange={(event) => setDraft((current) => current ? { ...current, content: event.target.value } : current)}
                />
              </label>
              <div className="prompt-editor-meta">
                <button
                  type="button"
                  className={draft.isActive ? "reasoning-toggle active" : "reasoning-toggle"}
                  aria-pressed={draft.isActive}
                  onClick={() => setDraft((current) => current ? { ...current, isActive: !current.isActive } : current)}
                >
                  <span>{labels.status}</span>
                  <strong>{draft.isActive ? labels.active : labels.inactive}</strong>
                </button>
                <p>{draft.isBuiltin ? labels.builtinDeleteNote : labels.unwiredNote}</p>
              </div>
              {error ? <div className="prompt-message error">{error}</div> : null}
              {notice ? <div className="prompt-message success">{notice}</div> : null}
              <div className="prompt-editor-actions">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  <Check size={15} />
                  {labels.save}
                </button>
                <button type="button" className="icon-button prompt-editor-icon-action" onClick={onCreate} disabled={saving} aria-label={labels.cancel}>
                  <X size={15} />
                </button>
                <button type="button" className="icon-button prompt-editor-icon-action danger" onClick={() => void onDelete()} disabled={saving || draft.isBuiltin || !draft.id} aria-label={labels.delete}>
                  <Trash2 size={15} />
                </button>
              </div>
            </form>
          ) : (
            <div className="prompt-empty-state">{loading ? labels.loading : labels.empty}</div>
          )}
        </section>
      </div>
    </section>
  );
}

function PortfolioWorkspace(props: {
  labels: PortfolioLabels;
  selectedPortfolio: Portfolio | null;
  stats: PortfolioStats | null;
  holdings: HoldingPosition[];
  holdingQuery: string;
  setHoldingQuery: (value: string) => void;
  openHoldingSheet: (holding?: HoldingPosition) => void;
  removeHolding: (holding: HoldingPosition) => Promise<void>;
  chatMessages: ChatMessage[];
  chatInput: string;
  setChatInput: (value: string) => void;
  chatAttachments: ChatAttachment[];
  setChatAttachments: Dispatch<SetStateAction<ChatAttachment[]>>;
  chatReasoningEnabled: boolean;
  setChatReasoningEnabled: (value: boolean) => void;
  deepResearchEnabled: boolean;
  setDeepResearchEnabled: (value: boolean) => void;
  deepResearchStatus: string | null;
  submitChat: (event: FormEvent) => Promise<void>;
  pendingApprovals: PendingApproval[];
  approvalDecisionsByMessage: Record<string, ApprovalDecision>;
  applyApproval: (approvalId: string) => Promise<void>;
  rejectApproval: (approvalId: string) => Promise<void>;
  copilotOpen: boolean;
  setCopilotOpen: (open: boolean) => void;
  copilotInfoOpen: boolean;
  setCopilotInfoOpen: (open: boolean) => void;
  chatStreaming: boolean;
  portfolioLoading: boolean;
  pageError: string | null;
  mutationError: string | null;
  isSavingPortfolio: boolean;
  priceMasked: boolean;
  mobileFocus: MobileFocus;
  onOpenProfilePicker: () => void;
  onSaveCashSettings: (cashLevel: number, targetCashRatio: number) => Promise<void>;
}) {
  const {
    labels,
    selectedPortfolio,
    stats,
    holdings,
    holdingQuery,
    setHoldingQuery,
    openHoldingSheet,
    removeHolding,
    chatMessages,
    chatInput,
    setChatInput,
    chatAttachments,
    setChatAttachments,
    chatReasoningEnabled,
    setChatReasoningEnabled,
    deepResearchEnabled,
    setDeepResearchEnabled,
    deepResearchStatus,
    submitChat,
    pendingApprovals,
    approvalDecisionsByMessage,
    applyApproval,
    rejectApproval,
    copilotOpen,
    setCopilotOpen,
    copilotInfoOpen,
    setCopilotInfoOpen,
    chatStreaming,
    portfolioLoading,
    pageError,
    mutationError,
    isSavingPortfolio,
    priceMasked,
    mobileFocus,
    onOpenProfilePicker,
    onSaveCashSettings
  } = props;
  const [contextMetricsCollapsed, setContextMetricsCollapsed] = useState(true);
  const [allocationModalOpen, setAllocationModalOpen] = useState(false);
  const [assetCompositionModalOpen, setAssetCompositionModalOpen] = useState(false);
  const [holdingsPage, setHoldingsPage] = useState(1);
  const [contextHoldingSort, setContextHoldingSort] = useState<HoldingSortKey>("marketValue");
  const [contextHoldingSortDirection, setContextHoldingSortDirection] = useState<SortDirection>("desc");
  const holdingsPageSize = 5;
  const [copilotPosition, setCopilotPosition] = useState<FloatingPosition>(() => getDefaultCopilotPosition());
  const [copilotSize, setCopilotSize] = useState<FloatingSize>(() => ({ width: COPILOT_FLOATING_WIDTH, height: COPILOT_FLOATING_HEIGHT }));
  const [copilotDragging, setCopilotDragging] = useState(false);
  const [copilotResizing, setCopilotResizing] = useState(false);
  const copilotDragRef = useRef<DragState | null>(null);
  const copilotResizeRef = useRef<ResizeState | null>(null);
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const contextSortedHoldings = useMemo(
    () => [...holdings].sort((a, b) => compareHoldings(a, b, contextHoldingSort, contextHoldingSortDirection)),
    [contextHoldingSort, contextHoldingSortDirection, holdings]
  );
  const holdingsPageCount = Math.max(1, Math.ceil(contextSortedHoldings.length / holdingsPageSize));
  const visibleHoldingsStart = contextSortedHoldings.length ? (holdingsPage - 1) * holdingsPageSize : 0;
  const visibleHoldingsEnd = Math.min(visibleHoldingsStart + holdingsPageSize, contextSortedHoldings.length);
  const pagedHoldings = contextSortedHoldings.slice(visibleHoldingsStart, visibleHoldingsEnd);
  useEffect(() => {
    setHoldingsPage(1);
  }, [contextHoldingSort, contextHoldingSortDirection, holdingQuery]);

  useEffect(() => {
    setHoldingsPage((page) => Math.min(page, holdingsPageCount));
  }, [holdingsPageCount]);

  const scrollChatToBottom = (behavior: ScrollBehavior = "smooth") => {
    requestAnimationFrame(() => {
      const chatLog = chatLogRef.current;
      if (!chatLog) return;
      chatLog.scrollTo({ top: chatLog.scrollHeight, behavior });
    });
  };

  useEffect(() => {
    if (!copilotOpen) {
      setCopilotInfoOpen(false);
      return;
    }

    setCopilotSize((size) => {
      const nextSize = clampCopilotSize(size);
      setCopilotPosition((position) => clampCopilotPosition(position, nextSize));
      return nextSize;
    });
  }, [copilotOpen, setCopilotInfoOpen]);

  useEffect(() => {
    const handleResize = () => {
      setCopilotSize((size) => {
        const nextSize = clampCopilotSize(size);
        setCopilotPosition((position) => clampCopilotPosition(position, nextSize));
        return nextSize;
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    scrollChatToBottom(chatStreaming ? "auto" : "smooth");
  }, [chatMessages, pendingApprovals, chatStreaming]);

  const startCopilotDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (copilotResizeRef.current) return;

    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, [role='button']")) {
      return;
    }

    copilotDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: copilotPosition.x,
      originY: copilotPosition.y
    };
    setCopilotDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveCopilot = (event: ReactPointerEvent<HTMLElement>) => {
    if (!copilotDragRef.current) return;

    const drag = copilotDragRef.current;
    setCopilotPosition(
      clampCopilotPosition({
        x: drag.originX + event.clientX - drag.startX,
        y: drag.originY + event.clientY - drag.startY
      })
    );
  };

  const stopCopilotDrag = (event: ReactPointerEvent<HTMLElement>) => {
    copilotDragRef.current = null;
    setCopilotDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const startCopilotResize = (direction: ResizeDirection) => (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();

    copilotResizeRef.current = {
      direction,
      startX: event.clientX,
      startY: event.clientY,
      originX: copilotPosition.x,
      originY: copilotPosition.y,
      originWidth: copilotSize.width,
      originHeight: copilotSize.height
    };
    setCopilotResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const resizeCopilot = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!copilotResizeRef.current) return;

    const resize = copilotResizeRef.current;
    const deltaX = event.clientX - resize.startX;
    const deltaY = event.clientY - resize.startY;
    const growsEast = resize.direction.includes("e");
    const growsSouth = resize.direction.includes("s");
    const growsWest = resize.direction.includes("w");
    const growsNorth = resize.direction.includes("n");
    const requestedSize = {
      width: resize.originWidth + (growsEast ? deltaX : growsWest ? -deltaX : 0),
      height: resize.originHeight + (growsSouth ? deltaY : growsNorth ? -deltaY : 0)
    };
    const nextSize = clampCopilotSize(requestedSize);
    const nextPosition = clampCopilotPosition({
      x: growsWest ? resize.originX + (resize.originWidth - nextSize.width) : resize.originX,
      y: growsNorth ? resize.originY + (resize.originHeight - nextSize.height) : resize.originY
    }, nextSize);

    setCopilotSize(nextSize);
    setCopilotPosition(nextPosition);
  };

  const stopCopilotResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    copilotResizeRef.current = null;
    setCopilotResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  if (!selectedPortfolio || !stats) {
    return (
      <section className="portfolio-main">
        <div className="portfolio-placeholder">
          <p className="hero-tag">{labels.selectedPortfolio}</p>
          <h2>{portfolioLoading ? "Loading portfolio..." : "No portfolio selected"}</h2>
          <p>{pageError ?? "Create or select a portfolio to view holdings."}</p>
        </div>
      </section>
    );
  }

  const previewHoldings = pagedHoldings;
  const holdingSortOptions: Array<{ key: HoldingSortKey; label: string }> = [
    { key: "marketValue", label: labels.sortMarketValue },
    { key: "gain", label: labels.sortGain },
    { key: "ticker", label: labels.sortTicker },
    { key: "quantity", label: labels.sortQuantity },
    { key: "averageCost", label: labels.sortAverageCost },
    { key: "marketPrice", label: labels.sortMarketPrice },
    { key: "value", label: labels.sortValue },
    { key: "createdAt", label: labels.sortNewest }
  ];
  const exportHoldings = () => {
    const rows: Array<Array<string | number | null | undefined>> = [
      [
        labels.ticker,
        labels.name,
        labels.quantity,
        labels.averageCost,
        labels.currentPrice,
        labels.currentValue,
        labels.totalCost,
        labels.sortGain,
        labels.performanceAttribution,
        labels.updated
      ],
      ...contextSortedHoldings.map((holding) => [
        holding.ticker,
        holding.name,
        holding.quantity,
        holding.averageCost,
        holding.marketPrice,
        holding.marketValue,
        getPositionCostValue(holding),
        getPositionGain(holding),
        percent(holding.allocation),
        new Date(holding.updatedAt).toLocaleDateString()
      ])
    ];
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(`${safeFilePart(selectedPortfolio.name)}-holdings-${today}.csv`, rows);
  };
  const portfolioDisplayMetrics = getPortfolioDisplayMetrics({
    cashLevel: selectedPortfolio.cashLevel,
    holdingsValue: stats.holdingsValue,
    holdingsCount: stats.holdingsCount
  });

  return (
    <section className={`portfolio-main chat-first-workspace mobile-focus-${mobileFocus}`}>
      <MobilePortfolioHome
        labels={labels}
        selectedPortfolio={selectedPortfolio}
        stats={stats}
        holdings={holdings}
        openHoldingSheet={openHoldingSheet}
        priceMasked={priceMasked}
        onOpenProfilePicker={onOpenProfilePicker}
      />
      <section className="portfolio-chat-workspace" id="portfolio-chat-section" aria-label={labels.chatWorkspace}>
        <header className="portfolio-chat-header">
          <div className="copilot-header-main">
            <span className="copilot-avatar" aria-hidden="true"><Bot size={17} /></span>
            <div className="copilot-title-row">
              <div>
                <p className="hero-tag">{labels.copilotLabel}</p>
                <h3>{labels.copilotTitle}</h3>
              </div>
              <span className="copilot-live-dot">{chatStreaming ? labels.chatStreaming : labels.chatReady}</span>
            </div>
            <div className="copilot-info-wrap">
              <button className="action-button ghost" type="button" aria-label={labels.copilotInfoLabel} aria-haspopup="dialog" aria-expanded={copilotInfoOpen} onClick={() => setCopilotInfoOpen(!copilotInfoOpen)}>
                <CircleHelp size={15} />
              </button>
              {copilotInfoOpen ? <div className="copilot-info-popover">{labels.copilotHint}</div> : null}
            </div>
          </div>
          <div className="chat-runtime-controls" aria-label={`${labels.modelLabel} ${labels.reasoningLabel}`}>
            <div className="chat-model-select readonly" aria-label={labels.modelLabel}>
              <span>{labels.modelLabel}</span>
              <strong>Auto</strong>
              {deepResearchEnabled ? <small>{labels.deepResearchModel}</small> : null}
            </div>
            <button type="button" className={chatReasoningEnabled ? "reasoning-toggle active" : "reasoning-toggle"} aria-pressed={chatReasoningEnabled} disabled={chatStreaming} onClick={() => setChatReasoningEnabled(!chatReasoningEnabled)}>
              <span>{labels.reasoningLabel}</span>
              <strong>{chatReasoningEnabled ? labels.reasoningOn : labels.reasoningOff}</strong>
            </button>
          </div>
        </header>
        <span className="portfolio-output-trust-cue">
          <Info size={13} aria-hidden="true" />
          <span>{labels.copilotHint}</span>
        </span>
        <section className="copilot-chat-main">
          <div className="chat-log" ref={chatLogRef}>
            {!chatMessages.length && !pendingApprovals.length ? (
              <div className="chat-empty-card">
                <span className="copilot-avatar large" aria-hidden="true"><Bot size={22} /></span>
                <strong>{labels.chatEmptyTitle}</strong>
                <p>{labels.chatEmptyBody}</p>
                <div className="chat-starter-row">
                  <button type="button" onClick={() => setChatInput(labels.chatPromptReview)}>{labels.chatPromptReview}</button>
                  <button type="button" onClick={() => setChatInput(labels.chatPromptRebalance)}>{labels.chatPromptRebalance}</button>
                </div>
              </div>
            ) : null}
            {chatMessages.map((message) => (
              <div key={message.id} className={`chat-turn ${message.role}`}>
                <div className="chat-turn-content">
                  <span className="chat-role-line">
                    <span className="chat-role-label">{message.role === "assistant" ? labels.copilotTitle : labels.userLabel}</span>
                    {message.role === "assistant" && approvalDecisionsByMessage[message.id] ? (
                      <span className={`approval-decision-pill ${approvalDecisionsByMessage[message.id]}`} aria-label={approvalDecisionsByMessage[message.id] === "applied" ? labels.approvalToolAllowed : labels.approvalToolDenied}>
                        {approvalDecisionsByMessage[message.id] === "applied" ? <Check size={12} /> : <X size={12} />}
                        <span>{approvalDecisionsByMessage[message.id] === "applied" ? labels.approvalToolAllowed : labels.approvalToolDenied}</span>
                      </span>
                    ) : null}
                  </span>
                  <div className={`chat-message ${message.role}`}>
                    {message.attachments?.length ? (
                      <div className="chat-message-attachments" aria-label="Attached images">
                        {message.attachments.map((attachment, index) => (
                          <span className="chat-image-attachment" key={`${message.id}-${index}`}>
                            <img src={attachment.image_url} alt={attachment.name} />
                            <span><ImagePlus size={13} aria-hidden="true" />{attachment.name}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {message.text ? message.text : <span className="typing-indicator" aria-label="Assistant is thinking"><i /><i /><i /></span>}
                    {message.researchDocuments?.length ? (
                      <div className="research-artifact-panel">
                        <div className="research-artifact-header">
                          <strong>{labels.researchArtifacts}</strong>
                          <span>{labels.deepResearchModel}</span>
                        </div>
                        <div className="research-artifact-list">
                          {message.researchDocuments.map((document) => (
                            <a
                              href={researchDocumentHtmlUrl(document.id)}
                              target="_blank"
                              rel="noreferrer"
                              className="research-artifact-link"
                              key={document.id}
                            >
                              <span>{document.title}</span>
                              <small>{document.kind}</small>
                              <Eye size={13} aria-label={labels.openHtml} />
                            </a>
                          ))}
                        </div>
                        <iframe
                          title={message.researchDocuments[message.researchDocuments.length - 1].title}
                          src={researchDocumentHtmlUrl(message.researchDocuments[message.researchDocuments.length - 1].id, { embedded: true })}
                          sandbox="allow-same-origin allow-popups"
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
            {pendingApprovals.map((approval) => (
              <div className={`approval-card ${approval.status}`} key={approval.approval_id}>
                <div className="approval-card-header">
                  <div>
                    <span className="chat-role-label">{labels.approvalPending}</span>
                    <h4>{labels.approvalTitle}</h4>
                    <p>{approval.summary}</p>
                  </div>
                  <span className="approval-status">
                    {approval.status === "applied" ? labels.approvalApplied : approval.status === "rejected" ? labels.approvalRejected : labels.approvalPending}
                  </span>
                </div>
                <div className="approval-action-list">
                  {approval.actions.map((action, index) => (
                    <div className="approval-action-row" key={`${approval.approval_id}-${index}`}>
                      <span className="approval-action-index">{index + 1}</span>
                      <span className="approval-action-copy">
                        <strong>{approvalActionTitle(action.type, labels)}</strong>
                        <dl className="approval-kv-list">
                          {approvalActionFields(action, labels).map((field) => (
                            <div key={field.label}>
                              <dt>{field.label}</dt>
                              <dd>{field.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="approval-actions">
                  <button type="button" className="action-button primary filled-action-button" aria-label={labels.approvalApply} disabled={approval.status !== "pending"} onClick={() => void applyApproval(approval.approval_id)}>
                    <Check size={15} />
                    <span>{labels.approvalApply}</span>
                  </button>
                  <button type="button" className="action-button ghost approval-cancel-button" aria-label={labels.approvalReject} disabled={approval.status !== "pending"} onClick={() => void rejectApproval(approval.approval_id)}>
                    <X size={15} />
                    <span>{labels.approvalReject}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
          <form className="chat-form" onSubmit={submitChat}>
            {chatAttachments.length ? (
              <div className="attachment-strip">
                {chatAttachments.map((attachment, index) => (
                  <span className="attachment-chip" key={`${attachment.name}-${index}`}>
                    {attachment.name}
                    <button type="button" onClick={() => setChatAttachments(chatAttachments.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${attachment.name}`}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="composer-options">
              <label className="deep-research-toggle">
                <input
                  type="checkbox"
                  checked={deepResearchEnabled}
                  disabled={chatStreaming}
                  onChange={(event) => setDeepResearchEnabled(event.target.checked)}
                />
                <span>{labels.deepResearchToggle}</span>
              </label>
              {deepResearchStatus ? <span className="deep-research-status">{deepResearchStatus}</span> : null}
            </div>
            <div className="composer-row">
              <label className="action-button ghost attachment-btn" aria-label="Attach image">
                <ImagePlus size={16} />
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={deepResearchEnabled}
                  onChange={async (event) => {
                    const files = Array.from(event.target.files ?? []);
                    const attachments = await Promise.all(files.map((file) => new Promise<ChatAttachment>((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = () => resolve({ name: file.name, type: "image", image_url: String(reader.result), detail: "high" });
                      reader.onerror = () => reject(reader.error ?? new Error(`Unable to read ${file.name}`));
                      reader.readAsDataURL(file);
                    })));
                    setChatAttachments((current) => [...current, ...attachments]);
                    event.target.value = "";
                  }}
                />
              </label>
              <input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder={labels.chatPlaceholder} aria-label={labels.chatPlaceholder} disabled={chatStreaming} />
              <button className="action-button primary" type="submit" aria-label={labels.send} disabled={chatStreaming || !chatInput.trim()}><Send size={16} /></button>
            </div>
          </form>
        </section>
      </section>

      <aside className="portfolio-context-canvas" id="portfolio-context-section" aria-label={labels.contextCanvas}>
        <header className="context-canvas-header">
          <div>
            <p className="hero-tag">{labels.contextCanvas}</p>
            <h3>{selectedPortfolio.name}</h3>
          </div>
          <button type="button" className="action-button primary" onClick={() => openHoldingSheet()} aria-label={labels.addHolding}><Plus size={17} /></button>
        </header>
        {isSavingPortfolio ? <span className="muted">Saving...</span> : null}
        {mutationError ? <span className="muted">{mutationError}</span> : null}

        <section className={contextMetricsCollapsed ? "context-card pinned-metrics-card collapsed" : "context-card pinned-metrics-card"}>
          <div className="context-card-header">
            <div className="context-card-title-block">
              <h4>{labels.pinnedMetrics}</h4>
              {contextMetricsCollapsed ? (
                <p className="context-collapsed-summary">
                  {labels.stats.totalValue}: {maskPricingValue(currency(portfolioDisplayMetrics.totalAssets, selectedPortfolio.currency), priceMasked, labels.maskedValue)}
                </p>
              ) : null}
            </div>
            <div className="context-card-actions">
              <button
                type="button"
                className="context-visualization-button context-action-button"
                onClick={() => setAssetCompositionModalOpen(true)}
                aria-label={labels.openAssetCompositionVisualization}
                title={labels.assetComposition}
              >
                <PieChart size={16} />
              </button>
              <button
                type="button"
                className="context-collapse-button context-action-button"
                onClick={() => setContextMetricsCollapsed((collapsed) => !collapsed)}
                aria-expanded={!contextMetricsCollapsed}
                aria-label={contextMetricsCollapsed ? labels.viewAll : labels.collapse}
                title={contextMetricsCollapsed ? labels.viewAll : labels.collapse}
              >
                <ChevronDown size={16} className={contextMetricsCollapsed ? "" : "expanded"} />
              </button>
            </div>
          </div>
          {!contextMetricsCollapsed ? (
            <AssetCompositionChart
              labels={labels}
              stats={stats}
              currencyCode={selectedPortfolio.currency}
              priceMasked={priceMasked}
              compact
            />
          ) : null}
        </section>

        <section className="context-card holdings-preview-card">
          <div className="context-card-header">
            <div>
              <h4>{labels.holdingsPreview}</h4>
              <p>{stats.holdingsCount} {labels.positions} · {labels.stats.topHolding}: {stats.topHolding?.ticker ?? labels.none}</p>
            </div>
            <div className="context-card-actions">
              <button
                type="button"
                className="context-visualization-button context-action-button"
                onClick={() => setAllocationModalOpen(true)}
                aria-label={labels.openAllocationVisualization}
                title={labels.performanceAttribution}
                disabled={!holdings.length}
              >
                <PieChart size={16} />
              </button>
              <button
                type="button"
                className="context-visualization-button context-export-button context-action-button"
                onClick={exportHoldings}
                aria-label={labels.exportHoldings}
                title={labels.exportHoldings}
                disabled={!contextSortedHoldings.length}
              >
                <Download size={16} />
              </button>
            </div>
          </div>
          <div className="context-holdings-toolbar">
            <label className="control-field compact-field">
              <Search size={15} />
              <input value={holdingQuery} onChange={(event) => setHoldingQuery(event.target.value)} placeholder={labels.searchHoldings} />
            </label>
            <label className="holding-sort-select">
              <span>{labels.sortBy}</span>
              <select
                value={contextHoldingSort}
                onChange={(event) => setContextHoldingSort(event.target.value as HoldingSortKey)}
                aria-label={labels.sortBy}
              >
                {holdingSortOptions.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={contextHoldingSortDirection === "asc" ? "sort-direction-button ascending" : "sort-direction-button"}
              aria-label={contextHoldingSortDirection === "asc" ? labels.sortAsc : labels.sortDesc}
              title={contextHoldingSortDirection === "asc" ? labels.sortAsc : labels.sortDesc}
              onClick={() => setContextHoldingSortDirection((direction) => direction === "asc" ? "desc" : "asc")}
            >
              <ChevronDown size={16} />
            </button>
          </div>
          <div className="context-holdings-list">
            {holdings.length ? previewHoldings.map((holding) => {
              const gain = getPositionGain(holding);
              return (
                <div className="context-holding-row" key={holding.id}>
                  <button type="button" className="context-holding-main" onClick={() => openHoldingSheet(holding)}>
                    <strong>{holding.ticker} <em>{holding.name}</em></strong>
                    <small>{percent(holding.allocation)} · {labels.updated} {new Date(holding.updatedAt).toLocaleDateString()}</small>
                  </button>
                  <div className="context-holding-values">
                    <span className={priceMasked ? "masked-price" : ""}>{maskPricingValue(currency(holding.marketValue, selectedPortfolio.currency), priceMasked, labels.maskedValue)}</span>
                    <strong className={priceMasked ? "masked-price" : gain >= 0 ? "good" : "bad"}>{maskPricingValue(currency(gain, selectedPortfolio.currency), priceMasked, labels.maskedValue)}</strong>
                  </div>
                  <span className="row-actions">
                    <button type="button" className="action-button ghost" onClick={() => openHoldingSheet(holding)} aria-label={labels.editHolding}><Edit3 size={15} /></button>
                    <button type="button" className="action-button danger" onClick={() => void removeHolding(holding)} aria-label={labels.archive}><Trash2 size={15} /></button>
                  </span>
                </div>
              );
            }) : (
              <div className="holding-empty-state">{labels.noHoldingResults}</div>
            )}
          </div>
          {holdings.length ? (
            <nav className="holdings-pagination" aria-label={labels.pagination}>
              <span className="pagination-summary">{labels.showing} {visibleHoldingsStart + 1}-{visibleHoldingsEnd} / {holdings.length}</span>
              <div className="pagination-controls">
                <button type="button" onClick={() => setHoldingsPage((page) => Math.max(1, page - 1))} disabled={holdingsPage <= 1}>{labels.previousPage}</button>
                <span>{labels.pageStatus} {holdingsPage} {labels.of} {holdingsPageCount}</span>
                <button type="button" onClick={() => setHoldingsPage((page) => Math.min(holdingsPageCount, page + 1))} disabled={holdingsPage >= holdingsPageCount}>{labels.nextPage}</button>
              </div>
            </nav>
          ) : null}
        </section>

        {allocationModalOpen ? (
          <AllocationVisualizationModal
            labels={labels}
            holdings={holdings}
            onClose={() => setAllocationModalOpen(false)}
          />
        ) : null}
        {assetCompositionModalOpen ? (
          <AssetCompositionModal
            labels={labels}
            stats={stats}
            currencyCode={selectedPortfolio.currency}
            initialCash={selectedPortfolio.cashLevel}
            initialTargetCashRatio={selectedPortfolio.targetCashRatio}
            priceMasked={priceMasked}
            onSaveCashSettings={onSaveCashSettings}
            onClose={() => setAssetCompositionModalOpen(false)}
          />
        ) : null}
      </aside>
    </section>
  );
}

function approvalActionTitle(actionType: PendingApproval["actions"][number]["type"], labels: PortfolioLabels) {
  switch (actionType) {
    case "update_portfolio":
      return labels.approvalActionUpdatePortfolio;
    case "create_holding":
      return labels.approvalActionCreateHolding;
    case "update_holding":
      return labels.approvalActionUpdateHolding;
    case "delete_holding":
      return labels.approvalActionDeleteHolding;
  }
}

function approvalActionFields(action: PendingApproval["actions"][number], labels: PortfolioLabels) {
  const payload = isRecord(action.payload) ? action.payload : {};
  const fields = isRecord(payload.fields) ? payload.fields : payload;
  const entries = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .slice(0, 8);

  if (!entries.length) {
    return [
      {
        label: action.holding_id ? labels.approvalFieldLabels.holding_id : labels.approvalFieldLabels.portfolio_id,
        value: action.holding_id ?? action.portfolio_id
      }
    ];
  }

  return entries.map(([key, value]) => ({
    label: approvalFieldLabel(key, labels),
    value: formatApprovalValue(value, labels)
  }));
}

function approvalClarificationText(
  missing: Array<{ action_index: number | null; field: string; reason: string }>,
  labels: PortfolioLabels
) {
  const fields = [...new Set(missing.map((item) => approvalFieldLabel(item.field, labels)))];
  const fieldList = fields.join("、");
  return labels.userLabel === "你"
    ? `我還需要你補充 ${fieldList}，才能建立待確認的投資組合變更。${labels.holdingClarificationSuffix}`
    : `I still need ${fieldList} before I can create a portfolio change for approval. ${labels.holdingClarificationSuffix}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function approvalFieldLabel(key: string, labels: PortfolioLabels) {
  const fieldLabels = labels.approvalFieldLabels as Record<string, string>;
  return fieldLabels[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatApprovalValue(value: unknown, labels: PortfolioLabels) {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? labels.approvalYes : labels.approvalNo;
  }
  return JSON.stringify(value);
}

function PortfolioSheet(props: {
  labels: PortfolioLabels;
  closeLabel: string;
  value: PortfolioForm;
  setValue: (value: PortfolioForm) => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
  mutationError: string | null;
  saving: boolean;
  editing?: boolean;
}) {
  const { labels, closeLabel, value, setValue, onSubmit, onClose, mutationError, saving, editing } = props;
  return (
    <div className="sheet-backdrop">
      <form className="sheet" onSubmit={onSubmit}>
        <div className="section-title-row">
          <h3>{editing ? labels.rename : labels.newPortfolio}</h3>
          <button type="button" className="action-button ghost" onClick={onClose} aria-label={closeLabel} disabled={saving}><X size={16} /></button>
        </div>
        <label>{labels.portfolioName}<input value={value.name} onChange={(event) => setValue({ ...value, name: event.target.value })} placeholder={labels.portfolioNamePlaceholder} /></label>
        <div className="form-grid">
          <label>{labels.currency}<select value={value.currency} onChange={(event) => setValue({ ...value, currency: event.target.value as Portfolio["currency"] })}><option>TWD</option><option>USD</option></select></label>
          <label>{labels.initialFunds}<input value={value.cash} onChange={(event) => setValue({ ...value, cash: event.target.value })} /></label>
        </div>
        <label>{labels.strategyNote}<textarea value={value.strategy} onChange={(event) => setValue({ ...value, strategy: event.target.value })} placeholder={labels.strategyNotePlaceholder} /></label>
        {mutationError ? <p className="muted">{mutationError}</p> : null}
        <button className="btn btn-primary" type="submit" disabled={saving}><Plus size={16} />{editing ? labels.savePortfolio : labels.createPortfolio}</button>
      </form>
    </div>
  );
}

function HoldingSheet(props: {
  labels: PortfolioLabels;
  closeLabel: string;
  form: HoldingForm;
  setForm: (value: HoldingForm | ((current: HoldingForm) => HoldingForm)) => void;
  holdingOptions: HoldingPosition[];
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
  holdingError: string | null;
  saving: boolean;
}) {
  const { labels, closeLabel, form, setForm, holdingOptions, onSubmit, onClose, holdingError, saving } = props;
  return (
    <div className="sheet-backdrop">
      <form className="sheet wide-sheet holding-sheet" onSubmit={onSubmit}>
        <header className="holding-sheet-header">
          <div>
            <p className="hero-tag">{labels.instrumentDetails}</p>
            <h3>{form.id ? labels.editHolding : labels.addHolding}</h3>
            <p>{labels.holdingSheetHint}</p>
            <p className="holding-required-note">{labels.holdingRequiredFieldsNote}</p>
          </div>
          <div className="sheet-header-actions">
            {form.ticker ? <span className="holding-sheet-symbol">{form.ticker}</span> : null}
            <button type="button" className="action-button ghost" onClick={onClose} aria-label={closeLabel} disabled={saving}><X size={16} /></button>
          </div>
        </header>
        <div className="sheet-form-stack holding-form-body">
          <section className="form-group">
            <p className="form-group-title"><span>01</span>{labels.instrumentDetails}</p>
            <div className="form-grid">
              <TickerCombobox
                label={labels.ticker}
                help={labels.holdingHelp.ticker}
                value={form.ticker}
                options={holdingOptions}
                  onChange={(ticker, option) => setForm((current) => applyTickerSelection(current, ticker, option, STOCK_DIRECTORY))}
                  required
                />
              <label><FieldHelp label={labels.name} help={labels.holdingHelp.name} /><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            </div>
          </section>

          <section className="form-group">
            <p className="form-group-title"><span>02</span>{labels.positionDetails}</p>
            <div className="form-grid">
              <label><FieldHelp label={labels.quantity} help={labels.holdingHelp.quantity} /><input value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} required /></label>
              <label><FieldHelp label={labels.totalCost} help={labels.holdingHelp.totalCost} /><input value={form.totalCost} onChange={(event) => setForm({ ...form, totalCost: event.target.value })} required /></label>
            </div>
          </section>

          <section className="form-group">
            <p className="form-group-title"><span>03</span>{labels.pricingDetails}</p>
            <div className="form-grid">
              <label><FieldHelp label={labels.averageCost} help={labels.holdingHelp.averageCost} /><input value={form.averageCost} onChange={(event) => setForm({ ...form, averageCost: event.target.value })} required /></label>
              <label><FieldHelp label={labels.currentPrice} help={labels.holdingHelp.currentPrice} /><input value={form.marketPrice} onChange={(event) => setForm({ ...form, marketPrice: event.target.value })} required /></label>
              <label><FieldHelp label={labels.currentValue} help={labels.holdingHelp.currentValue} /><input value={form.marketValue} onChange={(event) => setForm({ ...form, marketValue: event.target.value })} required /></label>
            </div>
          </section>
        </div>
        <footer className="holding-sheet-footer">
          {holdingError ? <p className="form-error" role="alert">{holdingError}</p> : null}
          <button className="btn btn-primary" type="submit" disabled={saving}><Check size={16} />{labels.saveHolding}</button>
        </footer>
      </form>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <article className="stat-card">
      <p className="stat-label">{label}</p>
      <p className={`stat-value ${tone ?? ""}`}>{value}</p>
    </article>
  );
}

function DashboardMetricCard({
  label,
  value,
  subvalue,
  badge,
  tone,
  masked = false
}: {
  label: string;
  value: string;
  subvalue?: string;
  badge?: string;
  tone?: "good" | "bad";
  masked?: boolean;
}) {
  return (
    <article className="dashboard-metric-card">
      <div className="dashboard-metric-topline">
        <p className="dashboard-metric-label">{label}</p>
        {badge ? <span className={`metric-badge ${tone ?? ""}`}>{badge}</span> : null}
      </div>
      <div className="dashboard-metric-value-row">
        <p className={`dashboard-metric-value ${tone ?? ""} ${masked ? "masked-price" : ""}`}>{value}</p>
        {subvalue ? <span className="dashboard-metric-subvalue">{subvalue}</span> : null}
      </div>
    </article>
  );
}

function AssetCompositionChart({
  labels,
  stats,
  currencyCode,
  priceMasked,
  compact = false
}: {
  labels: PortfolioLabels;
  stats: PortfolioStats;
  currencyCode: Portfolio["currency"];
  priceMasked: boolean;
  compact?: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [tooltipIndex, setTooltipIndex] = useState<number | null>(null);
  const gainOrLoss = stats.unrealizedPL;
  const positiveGain = Math.max(gainOrLoss, 0);
  const loss = Math.max(Math.abs(Math.min(gainOrLoss, 0)), 0);
  const rawSlices = gainOrLoss >= 0
    ? [
        { id: "invested-cost", label: labels.stats.cash, value: Math.max(stats.investedCost, 0), color: "#6ea2ff" },
        { id: "unrealized-gain", label: labels.unrealizedGain, value: positiveGain, color: "#48dfaa", tone: "good" as const }
      ]
    : [
        { id: "current-value", label: labels.assetCurrentValue, value: Math.max(stats.totalValue, 0), color: "#6ea2ff" },
        { id: "unrealized-loss", label: labels.unrealizedLoss, value: loss, color: "#ff6b8a", tone: "bad" as const }
      ];
  const sliceTotal = rawSlices.reduce((sum, slice) => sum + slice.value, 0);
  let cursor = 0;
  const slices: AssetCompositionSlice[] = rawSlices
    .filter((slice) => slice.value > 0 && sliceTotal > 0)
    .map((slice) => {
      const chartPercent = (slice.value / sliceTotal) * 100;
      const startAngle = (cursor / 100) * 360;
      cursor += chartPercent;
      const endAngle = (cursor / 100) * 360;
      return { ...slice, chartPercent, startAngle, endAngle };
    });
  const activeSlice = slices[activeIndex] ?? slices[0];
  const tooltipSlice = tooltipIndex === null ? null : slices[tooltipIndex];
  const activeTooltipPosition = tooltipSlice ? chartTooltipPosition(tooltipSlice.startAngle, tooltipSlice.endAngle) : null;

  useEffect(() => {
    setActiveIndex(0);
  }, [stats.totalValue, stats.investedCost, stats.unrealizedPL]);

  function moveActiveSlice(direction: 1 | -1) {
    if (!slices.length) return;
    setActiveIndex((index) => {
      const nextIndex = (index + direction + slices.length) % slices.length;
      setTooltipIndex(nextIndex);
      return nextIndex;
    });
  }

  function handleSliceKeyDown(event: ReactKeyboardEvent<SVGPathElement>, index: number) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      moveActiveSlice(1);
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveSlice(-1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setActiveIndex(index);
      setTooltipIndex(index);
    }
  }

  return (
    <article className={compact ? "stat-card holdings-chart-card asset-composition-card compact" : "stat-card holdings-chart-card asset-composition-card"}>
      <div className="holdings-chart-visual">
        <svg className="holdings-chart-svg" viewBox="0 0 260 260" role="img" aria-label={`${labels.assetComposition} chart`} onMouseLeave={() => setTooltipIndex(null)}>
          <circle className="holdings-chart-track" cx="130" cy="130" r="84" />
          {slices.map((slice, index) => {
            const isActive = index === activeIndex;
            const offset = arcMidpointOffset(slice.startAngle, slice.endAngle, isActive ? 8 : 0);
            return (
              <path
                key={slice.id}
                className={isActive ? "holdings-chart-segment active" : "holdings-chart-segment"}
                d={donutArcPath(130, 84, slice.startAngle, slice.endAngle)}
                stroke={slice.color}
                transform={`translate(${offset.x} ${offset.y})`}
                onMouseEnter={() => {
                  setActiveIndex(index);
                  setTooltipIndex(index);
                }}
                onFocus={() => {
                  setActiveIndex(index);
                  setTooltipIndex(index);
                }}
                onBlur={() => setTooltipIndex(null)}
                onKeyDown={(event) => handleSliceKeyDown(event, index)}
                aria-label={`${slice.label} ${percent(slice.chartPercent)}`}
                tabIndex={0}
              />
            );
          })}
          {tooltipSlice && activeTooltipPosition ? (
            <g
              className="holdings-chart-tooltip"
              transform={`translate(${activeTooltipPosition.x} ${activeTooltipPosition.y})`}
              pointerEvents="none"
            >
              <rect x="-28" y="-16" width="56" height="32" rx="11" />
              <text x="0" y="5" textAnchor="middle">{percent(tooltipSlice.chartPercent)}</text>
            </g>
          ) : null}
          <circle className="holdings-chart-hole" cx="130" cy="130" r="50" />
          <text className="holdings-chart-center-label" x="130" y="118" textAnchor="middle">
            {labels.stats.totalValue}
          </text>
          <text className="holdings-chart-center-value" x="130" y="144" textAnchor="middle">
            {maskPricingValue(currency(stats.totalValue, currencyCode), priceMasked, labels.maskedValue)}
          </text>
        </svg>
      </div>
      <div className="holdings-chart-detail">
        <div className="holdings-chart-kicker">
          <span>{labels.assetComposition}</span>
          <em>{activeSlice ? activeSlice.label : labels.none}</em>
        </div>
        <p className={activeSlice?.tone ? `stat-value ${activeSlice.tone}` : "stat-value"}>
          {activeSlice
            ? `${activeSlice.label} · ${maskPricingValue(currency(activeSlice.value, currencyCode), priceMasked, labels.maskedValue)}`
            : labels.none}
        </p>
        <p className="holdings-chart-basis">{labels.assetCompositionBasis}</p>
        <div className="holdings-chart-legend" aria-label={`${labels.assetComposition} legend`}>
          {slices.map((slice, index) => (
            <button
              type="button"
              className={index === activeIndex ? "active" : ""}
              key={slice.id}
              aria-pressed={index === activeIndex}
              style={{
                "--legend-color": slice.color,
                "--legend-fill": `${Math.min(100, Math.max(0, slice.chartPercent))}%`
              } as CSSProperties}
              onMouseEnter={() => {
                setActiveIndex(index);
                setTooltipIndex(index);
              }}
              onMouseLeave={() => setTooltipIndex(null)}
              onFocus={() => {
                setActiveIndex(index);
                setTooltipIndex(index);
              }}
              onBlur={() => setTooltipIndex(null)}
            >
              <i style={{ background: slice.color }} />
              <b>{slice.label}</b>
              <em>{percent(slice.chartPercent)}</em>
            </button>
          ))}
        </div>
        <p className="cash-level-chart-note">{labels.assetCompositionApproxNote}</p>
      </div>
    </article>
  );
}

function CashLevelChart({
  labels,
  stats,
  currencyCode,
  priceMasked,
  cashValue,
  cashDraft,
  targetCashRatio,
  targetCashRatioDraft,
  cashSaving,
  cashNotice,
  cashError,
  onCashDraftChange,
  onTargetCashRatioDraftChange,
  onSaveCashSettings
}: {
  labels: PortfolioLabels;
  stats: PortfolioStats;
  currencyCode: Portfolio["currency"];
  priceMasked: boolean;
  cashValue: number;
  cashDraft: string;
  targetCashRatio: number;
  targetCashRatioDraft: string;
  cashSaving: boolean;
  cashNotice: string;
  cashError: string;
  onCashDraftChange: (value: string) => void;
  onTargetCashRatioDraftChange: (value: string) => void;
  onSaveCashSettings: () => Promise<void>;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [tooltipIndex, setTooltipIndex] = useState<number | null>(null);
  const [cashSettingsEditing, setCashSettingsEditing] = useState(false);
  const safeCash = Math.max(0, Number.isFinite(cashValue) ? cashValue : 0);
  const investedCost = Math.max(stats.investedCost, 0);
  const unrealizedGain = Math.max(stats.unrealizedPL, 0);
  const profitTakingRecommendation = calculateProfitTakingPlan({
    cashLevel: safeCash,
    investedCost,
    unrealizedGain,
    targetCashRatio
  });
  const totalAssets = profitTakingRecommendation.totalAssets;
  const targetMarkerAngle = profitTakingRecommendation.targetCashRatio * 360;
  const targetMarkerStart = polarToCartesian(130, 69, targetMarkerAngle);
  const targetMarkerEnd = polarToCartesian(130, 104, targetMarkerAngle);
  const targetMarkerLabel = polarToCartesian(130, 118, targetMarkerAngle);
  const cashRatioGap = Math.max(0, profitTakingRecommendation.targetCashRatio - profitTakingRecommendation.currentCashRatio);
  const rawSlices = [
    { id: "cash-level", label: labels.currentCashLevel, value: safeCash, color: "#48dfaa" },
    { id: "invested-cost", label: labels.investedAssets, value: investedCost, color: "#6ea2ff" },
    { id: "unrealized-gain", label: labels.unrealizedGain, value: unrealizedGain, color: "#f4b866", tone: "good" as const }
  ];
  let cursor = 0;
  const slices: AssetCompositionSlice[] = rawSlices
    .filter((slice) => totalAssets > 0 && slice.value > 0)
    .map((slice) => {
      const chartPercent = (slice.value / totalAssets) * 100;
      const startAngle = (cursor / 100) * 360;
      cursor += chartPercent;
      const endAngle = (cursor / 100) * 360;
      return { ...slice, chartPercent, startAngle, endAngle };
    });
  const activeSlice = slices[activeIndex] ?? slices[0];
  const tooltipSlice = tooltipIndex === null ? null : slices[tooltipIndex];
  const activeTooltipPosition = tooltipSlice ? chartTooltipPosition(tooltipSlice.startAngle, tooltipSlice.endAngle) : null;
  const allocationRows = rawSlices.map((slice) => ({
    ...slice,
    chartPercent: totalAssets > 0 ? (slice.value / totalAssets) * 100 : 0
  }));
  const metricCards = [
    { label: labels.targetCashRatio, value: percent(profitTakingRecommendation.targetCashRatio * 100), color: "#6ea2ff" },
    { label: labels.currentCashRatio, value: percent(profitTakingRecommendation.currentCashRatio * 100), color: "#48dfaa" },
    { label: labels.cashRatioGap, value: percent(cashRatioGap * 100), color: "#f4b866" }
  ];

  useEffect(() => {
    setActiveIndex(0);
  }, [cashValue, stats.investedCost, stats.unrealizedPL]);

  function moveActiveSlice(direction: 1 | -1) {
    if (!slices.length) return;
    setActiveIndex((index) => {
      const nextIndex = (index + direction + slices.length) % slices.length;
      setTooltipIndex(nextIndex);
      return nextIndex;
    });
  }

  function handleSliceKeyDown(event: ReactKeyboardEvent<SVGPathElement>, index: number) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      moveActiveSlice(1);
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveSlice(-1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setActiveIndex(index);
      setTooltipIndex(index);
    }
  }

  async function handleSaveCashSettings() {
    try {
      await onSaveCashSettings();
      setCashSettingsEditing(false);
    } catch {
      // Keep the panel open so the inline error remains actionable.
    }
  }

  useEffect(() => {
    if (!cashSettingsEditing) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setCashSettingsEditing(false);
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [cashSettingsEditing]);

  return (
    <article className="stat-card holdings-chart-card asset-composition-card cash-level-card">
      <div className="holdings-chart-visual cash-level-chart-panel">
        <svg className="holdings-chart-svg" viewBox="0 0 260 260" role="img" aria-label={`${labels.cashLevel} chart`} onMouseLeave={() => setTooltipIndex(null)}>
          <circle className="holdings-chart-track" cx="130" cy="130" r="84" />
          {slices.map((slice, index) => {
            const isActive = index === activeIndex;
            const offset = arcMidpointOffset(slice.startAngle, slice.endAngle, isActive ? 8 : 0);
            return (
              <path
                key={slice.id}
                className={isActive ? "holdings-chart-segment active" : "holdings-chart-segment"}
                d={donutArcPath(130, 84, slice.startAngle, slice.endAngle)}
                stroke={slice.color}
                transform={`translate(${offset.x} ${offset.y})`}
                onMouseEnter={() => {
                  setActiveIndex(index);
                  setTooltipIndex(index);
                }}
                onFocus={() => {
                  setActiveIndex(index);
                  setTooltipIndex(index);
                }}
                onBlur={() => setTooltipIndex(null)}
                onKeyDown={(event) => handleSliceKeyDown(event, index)}
                aria-label={`${slice.label} ${percent(slice.chartPercent)}`}
                tabIndex={0}
              />
            );
          })}
          {tooltipSlice && activeTooltipPosition ? (
            <g
              className="holdings-chart-tooltip"
              transform={`translate(${activeTooltipPosition.x} ${activeTooltipPosition.y})`}
              pointerEvents="none"
            >
              <rect x="-28" y="-16" width="56" height="32" rx="11" />
              <text x="0" y="5" textAnchor="middle">{percent(tooltipSlice.chartPercent)}</text>
            </g>
          ) : null}
          {totalAssets > 0 ? (
            <g className="holdings-chart-target-marker" pointerEvents="none">
              <line x1={targetMarkerStart.x} y1={targetMarkerStart.y} x2={targetMarkerEnd.x} y2={targetMarkerEnd.y} />
              <text x={targetMarkerLabel.x} y={targetMarkerLabel.y} textAnchor="middle">
                {labels.targetMarker} {percent(profitTakingRecommendation.targetCashRatio * 100)}
              </text>
            </g>
          ) : null}
          <circle className="holdings-chart-hole" cx="130" cy="130" r="50" />
          <text className="holdings-chart-center-label" x="130" y="118" textAnchor="middle">
            {labels.stats.totalValue}
          </text>
          <text className="holdings-chart-center-value" x="130" y="144" textAnchor="middle">
            {maskPricingValue(currency(totalAssets, currencyCode), priceMasked, labels.maskedValue)}
          </text>
        </svg>
        <div className="cash-level-chart-legend-strip" aria-label={`${labels.cashLevel} legend`}>
          {allocationRows.map((slice) => (
            <span key={slice.id} style={{ "--legend-color": slice.color } as CSSProperties}>
              <i />
              <b>{slice.label}</b>
              <em>{percent(slice.chartPercent)}</em>
              <strong>{maskPricingValue(currency(slice.value, currencyCode), priceMasked, labels.maskedValue)}</strong>
            </span>
          ))}
        </div>
      </div>
      <div className="holdings-chart-detail cash-level-insight-panel">
        <div className="cash-level-header">
          <div className="cash-level-title-block">
            <span>{labels.cashLevel}</span>
            <h4>{labels.currentCashLevel}</h4>
            <strong>{maskPricingValue(currency(safeCash, currencyCode), priceMasked, labels.maskedValue)}</strong>
          </div>
          <button
            type="button"
            className="cash-settings-toggle"
            aria-expanded={cashSettingsEditing}
            aria-controls="cash-settings-panel"
            disabled={cashSaving}
            onClick={() => {
              if (cashSettingsEditing) {
                void handleSaveCashSettings();
                return;
              }
              setCashSettingsEditing(true);
            }}
          >
            {cashSettingsEditing ? <Save size={16} /> : <Settings size={16} />}
            {cashSettingsEditing ? labels.saveCashSettingsShort : labels.updateCashSettings}
          </button>
        </div>
        {cashSettingsEditing ? (
          <form
            id="cash-settings-panel"
            className="cash-settings-record-card"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSaveCashSettings();
            }}
          >
            <div className="cash-settings-fields">
              <label className="cash-setting-field">
                <i aria-hidden="true" className="cash-setting-icon cash">$</i>
                <span className="cash-setting-meta">
                  <span className="cash-setting-caption">{labels.cashSettingCash}</span>
                  <input
                    aria-label={labels.currentCashLevel}
                    inputMode="decimal"
                    value={cashDraft}
                    onChange={(event) => onCashDraftChange(event.target.value)}
                    placeholder={labels.cashInputPlaceholder}
                  />
                </span>
              </label>
              <label className="target-cash-ratio-input">
                <i aria-hidden="true" className="cash-setting-icon target">◎</i>
                <span className="cash-setting-meta">
                  <span className="cash-setting-caption">{labels.cashSettingTarget}</span>
                  <input
                    aria-label={labels.targetCashRatioLabel}
                    inputMode="decimal"
                    value={targetCashRatioDraft}
                    onChange={(event) => onTargetCashRatioDraftChange(event.target.value)}
                  />
                </span>
                <b>%</b>
              </label>
            </div>
          </form>
        ) : (
          <section
            id="cash-settings-panel"
            className="cash-target-progress-card"
            style={{
              "--cash-progress": `${Math.min(100, Math.max(0, profitTakingRecommendation.currentCashRatio * 100))}%`,
              "--cash-target": `${Math.min(100, Math.max(0, profitTakingRecommendation.targetCashRatio * 100))}%`
            } as CSSProperties}
            aria-label={labels.targetCashRatio}
          >
            <div>
              <span>{labels.targetMarker} {percent(profitTakingRecommendation.targetCashRatio * 100)}</span>
              <strong>{labels.currentCashRatio} {percent(profitTakingRecommendation.currentCashRatio * 100)}</strong>
            </div>
            <i aria-hidden="true"><b /></i>
          </section>
        )}
        <div className="cash-level-inline-status">
          {cashNotice ? <span className="cash-level-save-status">{cashNotice}</span> : null}
          {cashError ? <span className="cash-level-save-status error">{cashError}</span> : null}
        </div>
        <div className="profit-taking-metric-grid profit-taking-chip-row">
          {metricCards.map((metric) => (
            <span key={metric.label} style={{ "--metric-color": metric.color } as CSSProperties}>
              <i />
              <b>{metric.label}</b>
              <strong>{metric.value}</strong>
            </span>
          ))}
        </div>
        <section className="profit-taking-card profit-taking-action-card" aria-label={labels.profitTakingRecommendation}>
          <p className="profit-taking-hero">
            <span className="profit-taking-icon"><TrendingUp size={26} /></span>
            <span className="profit-taking-copy">
              <b>{labels.recommendedProfitTaking}</b>
              <small>
                {profitTakingRecommendation.targetMet
                  ? labels.targetCashMet
                  : profitTakingRecommendation.cappedByUnrealizedGain
                    ? labels.targetCashCapped
                    : labels.profitTakingGoalCopy}
              </small>
            </span>
            <strong>{maskPricingValue(currency(profitTakingRecommendation.profitTakingAmount, currencyCode), priceMasked, labels.maskedValue)}</strong>
            <ChevronRight size={20} />
          </p>
        </section>
        <p className="cash-level-footer-note">
          <Info size={15} />
          <span>{labels.cashLevelFooterNote}</span>
        </p>
      </div>
    </article>
  );
}

function TopHoldingsChart({
  label,
  holdings,
  metric,
  topLimit,
  emptyLabel,
  otherLabel,
  topLabel,
  basisLabel
}: {
  label: string;
  holdings: HoldingPosition[];
  metric: AllocationMetric;
  topLimit: AllocationTopLimit;
  emptyLabel: string;
  otherLabel: string;
  topLabel: string;
  basisLabel: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const totalQuantity = holdings.reduce((sum, holding) => sum + holding.quantity, 0);
  const colors = ["#6ea2ff", "#3d67b8", "#4977af", "#5b84ad", "#7192ad", "#8795a3", "#9aa3b0", "#304f9a", "#5d697b"];
  const sortedHoldings = [...holdings].sort((a, b) => (metric === "value" ? b.marketValue - a.marketValue : b.quantity - a.quantity));
  const visibleHoldings = sortedHoldings.slice(0, topLimit);
  const hiddenHoldings = sortedHoldings.slice(topLimit);
  const rawSlices = visibleHoldings.map((holding) => ({
    ...holding,
    chartPercent: metric === "value" ? holding.allocation : totalQuantity ? (holding.quantity * 100) / totalQuantity : 0
  }));
  const hiddenPercent = hiddenHoldings.reduce(
    (sum, holding) => sum + (metric === "value" ? holding.allocation : totalQuantity ? (holding.quantity * 100) / totalQuantity : 0),
    0
  );
  const chartSeed =
    hiddenPercent > 0.05
      ? [
          ...rawSlices,
          {
            id: "other-allocation-slice",
            portfolioId: "",
            ticker: "",
            name: otherLabel,
            quantity: hiddenHoldings.reduce((sum, holding) => sum + holding.quantity, 0),
            averageCost: 0,
            totalCost: hiddenHoldings.reduce((sum, holding) => sum + holding.totalCost, 0),
            marketPrice: 0,
            marketValue: hiddenHoldings.reduce((sum, holding) => sum + holding.marketValue, 0),
            allocation: hiddenPercent,
            createdAt: "",
            updatedAt: "",
            chartPercent: hiddenPercent,
            isOther: true
          }
        ]
      : rawSlices;
  let cursor = 0;
  const topHoldings: DonutHoldingSlice[] = chartSeed
    .filter((holding) => holding.chartPercent > 0)
    .map((holding, index) => {
      const startAngle = (cursor / 100) * 360;
      cursor += holding.chartPercent;
      const endAngle = (cursor / 100) * 360;
      return {
        ...holding,
        chartPercent: holding.chartPercent,
        startAngle,
        endAngle,
        color: colors[index % colors.length]
      };
    });
  const activeSlice = topHoldings[activeIndex] ?? topHoldings[0];
  const activeName = activeSlice ? (activeSlice.isOther ? activeSlice.name : holdingDisplayName(activeSlice)) : emptyLabel;

  useEffect(() => {
    setActiveIndex(0);
  }, [metric, holdings, topLimit]);

  function moveActiveSlice(direction: 1 | -1) {
    if (!topHoldings.length) return;
    setActiveIndex((index) => (index + direction + topHoldings.length) % topHoldings.length);
  }

  function handleSliceKeyDown(event: ReactKeyboardEvent<SVGPathElement>, index: number) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      moveActiveSlice(1);
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveSlice(-1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setActiveIndex(index);
    }
  }

  return (
    <article className="stat-card holdings-chart-card">
      <div className="holdings-chart-visual">
        <svg className="holdings-chart-svg" viewBox="0 0 260 260" role="img" aria-label={`${label} chart`}>
          <circle className="holdings-chart-track" cx="130" cy="130" r="84" />
          {topHoldings.map((holding, index) => {
            const isActive = index === activeIndex;
            const offset = arcMidpointOffset(holding.startAngle, holding.endAngle, isActive ? 8 : 0);
            return (
              <path
                key={holding.id}
                className={isActive ? "holdings-chart-segment active" : "holdings-chart-segment"}
                d={donutArcPath(130, 84, holding.startAngle, holding.endAngle)}
                stroke={holding.color}
                transform={`translate(${offset.x} ${offset.y})`}
                onMouseEnter={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                onKeyDown={(event) => handleSliceKeyDown(event, index)}
                aria-label={`${holding.isOther ? holding.name : holdingDisplayName(holding)} ${percent(holding.chartPercent)}`}
                tabIndex={0}
              />
            );
          })}
          <circle className="holdings-chart-hole" cx="130" cy="130" r="50" />
          <text className="holdings-chart-center-label" x="130" y="118" textAnchor="middle">
            {activeSlice ? (activeSlice.isOther ? activeSlice.name : activeSlice.name || activeSlice.ticker) : label}
          </text>
          <text className="holdings-chart-center-value" x="130" y="144" textAnchor="middle">
            {activeSlice ? percent(activeSlice.chartPercent) : emptyLabel}
          </text>
        </svg>
      </div>
      <div className="holdings-chart-detail">
        <div className="holdings-chart-kicker">
          <span>{label}</span>
          <em>{topLabel}</em>
        </div>
        <p className="stat-value">
          {activeSlice ? `${activeName} · ${percent(activeSlice.chartPercent)}` : emptyLabel}
        </p>
        <p className="holdings-chart-basis">{basisLabel}</p>
        <div className="holdings-chart-legend" aria-label={`${label} legend`}>
          {topHoldings.map((holding, index) => (
            <button
              type="button"
              className={index === activeIndex ? "active" : ""}
              key={holding.id}
              title={holding.isOther ? holding.name : holdingDisplayName(holding)}
              aria-pressed={index === activeIndex}
              style={{ "--legend-fill": `${Math.min(100, Math.max(0, holding.chartPercent))}%` } as CSSProperties}
              onMouseEnter={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
            >
              <i style={{ background: holding.color }} />
              <b>{holding.isOther ? holding.name : holdingDisplayName(holding)}</b>
              <em>{percent(holding.chartPercent)}</em>
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

function AllocationVisualizationModal({
  labels,
  holdings,
  onClose
}: {
  labels: PortfolioLabels;
  holdings: HoldingPosition[];
  onClose: () => void;
}) {
  const [metric, setMetric] = useState<AllocationMetric>("value");
  const [topLimit, setTopLimit] = useState<AllocationTopLimit>(5);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const metricLabel = metric === "value" ? labels.stats.valueAllocation : labels.stats.quantityAllocation;
  const metricBasis = metric === "value" ? labels.allocationValueBasis : labels.allocationQuantityBasis;
  const topLabel = labels.allocationTopLabel(topLimit);
  const sortedByValue = [...holdings].sort((a, b) => b.marketValue - a.marketValue);
  const totalQuantity = holdings.reduce((sum, holding) => sum + holding.quantity, 0);
  const sortedByQuantity = [...holdings].sort((a, b) => b.quantity - a.quantity);
  const topValue = sortedByValue[0];
  const topQuantity = sortedByQuantity[0];
  const comparisonText = topValue && topQuantity
    ? `${labels.allocationComparisonPrefix}: ${labels.stats.valueAllocation} ${holdingDisplayName(topValue)} ${percent(topValue.allocation)} · ${labels.stats.quantityAllocation} ${holdingDisplayName(topQuantity)} ${percent(totalQuantity ? (topQuantity.quantity * 100) / totalQuantity : 0)}`
    : labels.none;

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const { body, documentElement } = document;
    const previousBodyOverflow = body.style.overflow;
    const previousDocumentOverflow = documentElement.style.overflow;

    body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";

    return () => {
      body.style.overflow = previousBodyOverflow;
      documentElement.style.overflow = previousDocumentOverflow;
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="sheet-backdrop allocation-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="allocation-modal"
        role="dialog"
        aria-modal="true"
        aria-label={labels.allocationVisualizationTitle}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="allocation-modal-header">
          <div>
            <p className="hero-tag">{labels.performanceAttribution}</p>
            <h3>{labels.allocationVisualizationTitle}</h3>
          </div>
          <button ref={closeButtonRef} type="button" className="action-button ghost" onClick={onClose} aria-label={labels.collapse}>
            <X size={16} />
          </button>
        </header>
        <div className="allocation-modal-controls">
          <div className="allocation-modal-switch" role="tablist" aria-label={labels.allocationVisualizationTitle}>
            <button
              type="button"
              role="tab"
              aria-selected={metric === "value"}
              className={metric === "value" ? "active" : ""}
              onClick={() => setMetric("value")}
            >
              {labels.stats.valueAllocation}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={metric === "quantity"}
              className={metric === "quantity" ? "active" : ""}
              onClick={() => setMetric("quantity")}
            >
              {labels.stats.quantityAllocation}
            </button>
          </div>
          <div className="allocation-top-limit-control" aria-label={topLabel}>
            {ALLOCATION_TOP_LIMITS.map((limit) => (
              <button
                type="button"
                key={limit}
                className={topLimit === limit ? "active" : ""}
                aria-pressed={topLimit === limit}
                onClick={() => setTopLimit(limit)}
              >
                {limit}
              </button>
            ))}
          </div>
        </div>
        <div className="allocation-modal-body">
          <TopHoldingsChart
            label={metricLabel}
            holdings={holdings}
            metric={metric}
            topLimit={topLimit}
            emptyLabel={labels.none}
            otherLabel={labels.allocationOtherLabel}
            topLabel={topLabel}
            basisLabel={metricBasis}
          />
          <p className="allocation-modal-note">{comparisonText}</p>
        </div>
      </section>
    </div>
  );
}

function AssetCompositionModal({
  labels,
  stats,
  currencyCode,
  initialCash,
  initialTargetCashRatio,
  priceMasked,
  onSaveCashSettings,
  onClose
}: {
  labels: PortfolioLabels;
  stats: PortfolioStats;
  currencyCode: Portfolio["currency"];
  initialCash: number;
  initialTargetCashRatio: number;
  priceMasked: boolean;
  onSaveCashSettings: (cashLevel: number, targetCashRatio: number) => Promise<void>;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [activeAssetTab, setActiveAssetTab] = useState<"cash" | "composition">("cash");
  const [cashDraft, setCashDraft] = useState(String(Math.max(0, initialCash)));
  const [targetCashRatioDraft, setTargetCashRatioDraft] = useState(String(Math.round(Math.max(0, initialTargetCashRatio) * 100)));
  const [cashSaving, setCashSaving] = useState(false);
  const [cashNotice, setCashNotice] = useState("");
  const [cashError, setCashError] = useState("");
  const cashValue = Number(cashDraft.replace(/,/g, ""));
  const normalizedCashValue = Number.isFinite(cashValue) ? cashValue : 0;
  const targetCashRatioValue = Number(targetCashRatioDraft.replace(/%/g, ""));
  const normalizedTargetCashRatio = Math.min(1, Math.max(0, Number.isFinite(targetCashRatioValue) ? targetCashRatioValue / 100 : initialTargetCashRatio));

  async function saveCashSettings() {
    setCashSaving(true);
    setCashNotice("");
    setCashError("");
    try {
      await onSaveCashSettings(Math.max(0, normalizedCashValue), normalizedTargetCashRatio);
      setCashNotice(labels.cashLevelSaved);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save cash settings.";
      setCashError(message);
      throw new Error(message);
    } finally {
      setCashSaving(false);
    }
  }

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const { body, documentElement } = document;
    const previousBodyOverflow = body.style.overflow;
    const previousDocumentOverflow = documentElement.style.overflow;

    body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";

    return () => {
      body.style.overflow = previousBodyOverflow;
      documentElement.style.overflow = previousDocumentOverflow;
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="sheet-backdrop allocation-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="allocation-modal asset-composition-modal"
        role="dialog"
        aria-modal="true"
        aria-label={labels.assetCompositionVisualizationTitle}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="allocation-modal-header">
          <div>
            <p className="hero-tag">{labels.assetComposition}</p>
            <h3>{labels.assetCompositionVisualizationTitle}</h3>
          </div>
          <button ref={closeButtonRef} type="button" className="action-button ghost" onClick={onClose} aria-label={labels.collapse}>
            <X size={16} />
          </button>
        </header>
        <div className="allocation-modal-controls asset-composition-tabs">
          <div className="allocation-modal-switch" role="tablist" aria-label={labels.assetCompositionVisualizationTitle}>
            <button
              type="button"
              role="tab"
              aria-selected={activeAssetTab === "cash"}
              className={activeAssetTab === "cash" ? "active" : ""}
              onClick={() => setActiveAssetTab("cash")}
            >
              {labels.cashLevel}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeAssetTab === "composition"}
              className={activeAssetTab === "composition" ? "active" : ""}
              onClick={() => setActiveAssetTab("composition")}
            >
              {labels.assetComposition}
            </button>
          </div>
        </div>
        <div className="allocation-modal-body">
          {activeAssetTab === "cash" ? (
            <>
              <CashLevelChart
                labels={labels}
                stats={stats}
                currencyCode={currencyCode}
                priceMasked={priceMasked}
                cashValue={normalizedCashValue}
                cashDraft={cashDraft}
                targetCashRatio={normalizedTargetCashRatio}
                targetCashRatioDraft={targetCashRatioDraft}
                cashSaving={cashSaving}
                cashNotice={cashNotice}
                cashError={cashError}
                onCashDraftChange={(value) => {
                  setCashDraft(value);
                  setCashNotice("");
                  setCashError("");
                }}
                onTargetCashRatioDraftChange={(value) => {
                  setTargetCashRatioDraft(value);
                  setCashNotice("");
                  setCashError("");
                }}
                    onSaveCashSettings={saveCashSettings}
              />
            </>
          ) : (
            <AssetCompositionChart
              labels={labels}
              stats={stats}
              currencyCode={currencyCode}
              priceMasked={priceMasked}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function AllocationAnalysisCard({
  title,
  footer,
  children
}: {
  title: string;
  footer?: string;
  children: ReactNode;
}) {
  return (
    <article className="analysis-card attribution-card">
      <div className="analysis-card-header">
        <h3>{title}</h3>
      </div>
      {children}
      {footer ? <p className="muted">{footer}</p> : null}
    </article>
  );
}

function TickerCombobox({
  label,
  help,
  value,
  options,
  onChange,
  required = false
}: {
  label: string;
  help: string;
  value: string;
  options: HoldingPosition[];
  onChange: (value: string, option?: HoldingPosition) => void;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const filteredOptions = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) => [option.ticker, option.name].join(" ").toLowerCase().includes(query));
  }, [options, value]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  return (
    <div className="ticker-combobox-field" ref={wrapperRef}>
      <FieldHelp label={label} help={help} />
      <div className="sector-combobox">
        <input
          value={value}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          required={required}
        />
        <button type="button" className="sector-combobox-trigger" onClick={() => setOpen((current) => !current)} aria-label={label}><ChevronDown size={14} /></button>
        {open ? (
          <div className="sector-combobox-menu" role="listbox">
            {filteredOptions.length ? filteredOptions.map((option) => (
              <button
                type="button"
                key={option.ticker}
                className={option.ticker === value ? "active" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option.ticker, option);
                  setOpen(false);
                }}
              >
                <strong>{option.ticker}</strong>
                <span>{option.name}</span>
              </button>
            )) : (
              <span className="combobox-empty">No existing ticker</span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FieldHelp({ label, help }: { label: string; help: string }) {
  return (
    <span className="field-label-row">
      <span>{label}</span>
      <span className="field-help" tabIndex={0} aria-label={help}>
        <CircleHelp size={13} aria-hidden="true" />
        <span className="field-help-tooltip" role="tooltip">{help}</span>
      </span>
    </span>
  );
}
