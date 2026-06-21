import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function snippetAfter(source, marker, length = 420) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing marker: ${marker}`);
  return source.slice(start, start + length);
}

function mediaBlock(source, mediaQuery) {
  const start = source.indexOf(`@media (${mediaQuery})`);
  assert.notEqual(start, -1, `missing media query: ${mediaQuery}`);
  const next = source.indexOf("\n@media", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

test("app shell navigation is icon-first with accessible labels", () => {
  assert.match(app, /className="nav-icon"/);
  assert.match(app, /className="nav-label"/);
  assert.match(app, /className="nav-tooltip"/);
  assert.match(app, /aria-label=\{t\.pages\.portfolio\}/);
  assert.match(app, /aria-label=\{t\.pages\.prompts\}/);
  assert.match(app, /aria-label=\{t\.pages\.research\}/);
  assert.doesNotMatch(app, /className="nav-tag"/);
  assert.match(styles, /\.nav-item\s*\{[\s\S]*grid-template-columns: var\(--icon-size\);[\s\S]*justify-content: center;/);
  assert.match(styles, /\.nav-tooltip/);
});

test("top shell controls are compact icon buttons", () => {
  assert.match(app, /className="shell-topbar"/);
  assert.match(app, /className="sidebar-top"/);
  assert.match(app, /className="shell-brand"/);
  assert.match(app, /className="icon-button sidebar-toggle"/);
  assert.match(app, /aria-label=\{sidebarCollapsed \? "Expand sidebar" : "Collapse sidebar"\}/);
  assert.match(app, /setSidebarCollapsed\(\(collapsed\) => !collapsed\)/);
  assert.match(app, /className="icon-button theme-toggle"/);
  assert.match(app, /className=\{priceMasked \? "icon-button privacy-toggle active" : "icon-button privacy-toggle"\}/);
  assert.match(app, /className="icon-button language-trigger"/);
  assert.doesNotMatch(app, /<span>\{appTheme === "dark" \? "深色" : "亮色"\}<\/span>/);
  assert.match(styles, /\.icon-button\s*\{[\s\S]*width: var\(--control-height\);/);
  assert.match(styles, /\.shell-topbar\s*\{[\s\S]*display: flex;/);
  assert.match(styles, /\.sidebar-top\s*\{[\s\S]*display: flex;/);
  assert.match(styles, /\.shell-brand h1\s*\{[\s\S]*font-size: 1\.7rem;/);
  assert.match(styles, /\.top-nav-actions\s*\{[\s\S]*width: auto;/);
  assert.doesNotMatch(snippetAfter(styles, ".top-nav-actions {", 220), /position: fixed;/);
  assert.match(styles, /\.shell:has\(\.sheet-backdrop\) \.top-nav-actions,\s*\n\.shell:has\(\.profile-dropdown-backdrop\) \.top-nav-actions,\s*\n\.shell:has\(\.research-help-backdrop\) \.top-nav-actions/);
  assert.match(styles, /\.shell:has\(\.sheet-backdrop\) \.mobile-shell-nav,\s*\n\.shell:has\(\.profile-dropdown-backdrop\) \.mobile-shell-nav,\s*\n\.shell:has\(\.research-help-backdrop\) \.mobile-shell-nav,\s*\n\.shell:has\(\.sheet-backdrop\) \.mobile-action-dock,\s*\n\.shell:has\(\.profile-dropdown-backdrop\) \.mobile-action-dock,\s*\n\.shell:has\(\.research-help-backdrop\) \.mobile-action-dock/);
  assert.match(styles, /@media \(max-width: 860px\)[\s\S]*\.top-nav-actions \.badge\s*\{[\s\S]*display: none;/);
});

test("desktop shell defaults to a collapsed icon rail with a tighter top band", () => {
  assert.match(styles, /\.shell\s*\{[\s\S]*--sidebar-width: 92px;[\s\S]*grid-template-columns: var\(--sidebar-width\) minmax\(0, 1fr\);/);
  assert.match(styles, /\.shell.sidebar-expanded\s*\{[\s\S]*--sidebar-width: 284px;/);
  assert.match(styles, /\.sidebar\s*\{[\s\S]*padding: 18px 10px 16px;/);
  assert.match(styles, /\.sidebar\s*\{[\s\S]*grid-template-rows: auto minmax\(0, 1fr\);/);
  assert.match(styles, /\.nav\s*\{[\s\S]*padding: 4px 0 0;/);
  assert.match(styles, /\.sidebar-brand\s*\{[\s\S]*display: grid;/);
  assert.match(styles, /\.shell.sidebar-collapsed \.sidebar-brand\s*\{[\s\S]*justify-items: center;/);
  assert.match(styles, /\.sidebar-copy\s*\{[\s\S]*display: none;/);
  assert.match(styles, /\.shell.sidebar-expanded \.sidebar-copy\s*\{[\s\S]*display: grid;/);
  assert.match(styles, /\.sidebar-toggle\s*\{[\s\S]*justify-self: end;/);
  assert.match(styles, /\.nav\s*\{[\s\S]*justify-items: center;/);
  assert.match(styles, /\.nav-item\s*\{[\s\S]*grid-template-columns: var\(--icon-size\);[\s\S]*justify-content: center;/);
  assert.match(styles, /\.shell.sidebar-expanded \.nav-item\s*\{[\s\S]*grid-template-columns: var\(--icon-size\) minmax\(0, 1fr\);/);
  assert.match(styles, /\.nav-label\s*\{[\s\S]*display: none;/);
  assert.match(styles, /\.shell\.sidebar-expanded \.nav-label\s*\{[\s\S]*display: inline;/);
  assert.match(styles, /\.shell-topbar\s*\{[\s\S]*margin-bottom: 18px;/);
  assert.match(styles, /\.main\s*\{[\s\S]*padding: 18px clamp\(18px, 2\.5vw, 28px\) 28px;/);
});

test("overlay entry points reset transient shell popovers", () => {
  assert.match(app, /const closeTransientShellUI = \(\) => \{[\s\S]*setLanguageMenuOpen\(false\);[\s\S]*setProfileDropdownOpen\(false\);[\s\S]*setPortfolioPendingDelete\(null\);[\s\S]*setCopilotInfoOpen\(false\);[\s\S]*\};/);
  assert.match(app, /useEffect\(\(\) => \{[\s\S]*closeTransientShellUI\(\);[\s\S]*if \(currentPage === "prompts"/);
  assert.match(app, /const openHoldingSheet = \(holding\?: HoldingPosition\) => \{[\s\S]*closeTransientShellUI\(\);/);
  assert.match(app, /className="research-help-trigger"[\s\S]*onClick=\{\(\) => \{[\s\S]*onOpenHelp\(\);[\s\S]*setIsHelpOpen\(true\);[\s\S]*\}\}/);
  assert.match(app, /onOpenHelp=\{closeTransientShellUI\}/);
  assert.match(app, /className="icon-button language-trigger"[\s\S]*setProfileDropdownOpen\(false\);[\s\S]*setPortfolioPendingDelete\(null\);[\s\S]*setCopilotInfoOpen\(false\);[\s\S]*setLanguageMenuOpen\(\(open\) => !open\);/);
});

test("narrow desktop shell compacts to an icon rail before the phone layout takes over", () => {
  assert.match(styles, /@media \(max-width: 860px\)[\s\S]*\.shell\s*\{[\s\S]*grid-template-columns: 92px minmax\(0, 1fr\);/);
  assert.match(styles, /@media \(max-width: 860px\)[\s\S]*\.nav-item\s*\{[\s\S]*width: var\(--icon-size\);[\s\S]*grid-template-columns: var\(--icon-size\);/);
  assert.match(styles, /@media \(max-width: 860px\)[\s\S]*\.nav-label\s*\{[\s\S]*display: none;/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.sidebar\s*\{[\s\S]*display: none;/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.shell-topbar\s*\{[\s\S]*margin-bottom: 14px;/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.top-nav-actions\s*\{[\s\S]*position: fixed;[\s\S]*top: 10px;[\s\S]*right: 12px;/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.mobile-shell-nav/);
});

test("light and dark mode have explicit active and control state tokens", () => {
  assert.match(styles, /--surface-selected:/);
  assert.match(styles, /--surface-selected-strong:/);
  assert.match(styles, /\.shell\.theme-light \.nav-item\.active/);
  assert.match(styles, /\.shell\.theme-dark \.nav-item\.active/);
  assert.match(styles, /\.shell\.theme-light \.icon-button\.active/);
  assert.match(styles, /\.shell\.theme-dark \.icon-button\.active/);
  assert.match(styles, /\.shell\.theme-light \.language-popover/);
  assert.match(styles, /\.shell\.theme-light \.language-popover button/);
  assert.match(styles, /\.shell\.theme-light \.copilot-info-popover/);
});

test("prompt management workspace is constrained and rows are accessible", () => {
  assert.match(styles, /\.prompt-management-page\s*\{[\s\S]*max-width: 1480px;/);
  assert.match(styles, /\.prompt-management-grid\s*\{[\s\S]*grid-template-columns: minmax\(390px, 0\.84fr\) minmax\(560px, 1\.16fr\);/);
  assert.match(styles, /@media \(max-width: 1340px\)[\s\S]*\.prompt-management-grid\s*\{[\s\S]*grid-template-columns: 1fr;/);
  assert.match(styles, /@media \(max-width: 980px\)[\s\S]*\.prompt-page-header\s*\{[\s\S]*flex-direction: column;/);
  assert.match(styles, /@media \(max-width: 980px\)[\s\S]*\.prompt-page-header\s*\{[\s\S]*justify-content: flex-start;/);
  assert.match(styles, /@media \(max-width: 980px\)[\s\S]*\.prompt-page-header > div\s*\{[\s\S]*flex: 0 0 auto;/);
  assert.match(styles, /@media \(max-width: 980px\)[\s\S]*\.prompt-create-button\s*\{[\s\S]*align-self: flex-start;/);
  assert.match(app, /aria-label=\{promptRowLabel\(prompt, labels\)\}/);
  assert.match(app, /function promptRowLabel/);
  assert.match(app, /className=\{prompt\.isBuiltin \? "prompt-type-chip builtin" : "prompt-type-chip"\}/);
  assert.match(styles, /\.prompt-type-chip/);
  assert.match(styles, /\.prompt-table\s*\{[\s\S]*max-height: min\(68vh, 760px\);[\s\S]*overflow: auto;/);
  assert.match(styles, /\.prompt-table-head\s*\{[\s\S]*position: sticky;[\s\S]*top: 0;/);
  assert.match(styles, /button\.prompt-table-row:focus-visible\s*\{/);
  assert.match(styles, /\.prompt-editor-form input:focus-visible,\s*\n\.prompt-editor-form textarea:focus-visible\s*\{/);
  assert.match(styles, /\.theme-light \.prompt-editor-form input:focus-visible,\s*\n\.theme-light \.prompt-editor-form textarea:focus-visible\s*\{/);
});

test("prompt primary create action is explicit while editor secondary actions stay compact", () => {
  assert.match(app, /className="action-button primary filled-action-button prompt-create-button"/);
  assert.match(app, /aria-label=\{labels\.create\}/);
  assert.match(app, /<span>\{labels\.create\}<\/span>/);
  assert.match(app, /className="icon-button prompt-editor-icon-action"/);
  assert.match(app, /aria-label=\{labels\.cancel\}/);
  assert.match(app, /className="icon-button prompt-editor-icon-action danger"/);
  assert.match(app, /aria-label=\{labels\.delete\}/);
  assert.match(app, /className="btn btn-primary" disabled=\{saving\}/);
  assert.match(styles, /\.prompt-editor-actions\s*\{[\s\S]*position: sticky;[\s\S]*bottom: 0;/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.prompt-editor-actions\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto auto;/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.prompt-editor-actions \.btn\s*\{[\s\S]*width: 100%;/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.prompt-editor-actions \.prompt-editor-icon-action\s*\{[\s\S]*width: 40px;/);
}
);

test("mobile shell keeps icon-first controls", () => {
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.mobile-shell-nav/);
  assert.match(app, /className="mobile-shell-nav"/);
  assert.match(app, /className=\{currentPage === "portfolio" \? "mobile-shell-tab active" : "mobile-shell-tab"\}/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.top-nav-actions \.icon-button\s*\{[\s\S]*width: 36px;/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.mobile-shell-nav\s*\{[\s\S]*position: fixed;[\s\S]*top: 10px;[\s\S]*left: 12px;/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.mobile-shell-tab\s*\{[\s\S]*width: 34px;[\s\S]*height: 34px;/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.main\s*\{[\s\S]*padding: 64px 14px 12px;/);
});

test("app page state stays synchronized with the URL hash and browser history", () => {
  assert.match(app, /function appPageFromHash\(hash: string\): AppPage/);
  assert.match(app, /function appPageHash\(page: AppPage\): string/);
  assert.match(app, /window\.history\.pushState\(\{ page: currentPage \}, "", `\$\{window\.location\.pathname\}\$\{window\.location\.search\}\$\{nextHash\}`\)/);
  assert.match(app, /window\.addEventListener\("hashchange", syncPageFromLocation\)/);
  assert.match(app, /window\.addEventListener\("popstate", syncPageFromLocation\)/);
  assert.match(app, /setCurrentPage\(\(current\) => \(current === nextPage \? current : nextPage\)\)/);
});

test("AI-assisted surfaces expose a subtle trust cue", () => {
  assert.match(app, /className="ai-trust-cue"/);
  assert.match(app, /aria-label=\{labels\.aiTrustCue\}/);
  assert.match(styles, /\.ai-trust-cue/);
});

test("portfolio workspace has light mode surfaces and narrower chat reading width", () => {
  assert.match(styles, /\.portfolio-command-rail\s*\{[\s\S]*border-radius: var\(--radius-shell\);/);
  assert.match(styles, /\.profile-selector-shell,\s*\n\.rail-chat-sessions\s*\{[\s\S]*border-radius: 18px;/);
  assert.match(styles, /\.profile-selector-trigger\s*\{[\s\S]*background: var\(--surface-control\);/);
  assert.match(styles, /\.rail-chat-session-list \.chat-session-row\.active/);
  assert.match(styles, /\.shell\.theme-light \.portfolio-command-rail/);
  assert.match(styles, /\.shell\.theme-light \.portfolio-chat-workspace/);
  assert.match(styles, /\.shell\.theme-light \.portfolio-context-canvas/);
  assert.match(styles, /\.shell\.theme-light \.chat-log/);
  assert.match(styles, /\.shell\.theme-light \.chat-message/);
  assert.match(styles, /\.shell\.theme-light \.approval-card/);
  assert.match(styles, /\.shell\.theme-light \.allocation-modal/);
  assert.match(styles, /\.shell\.theme-light \.allocation-modal-body \.holdings-chart-card/);
  assert.match(styles, /\.shell\.theme-light \.cash-level-chart-panel/);
  assert.match(styles, /\.shell\.theme-light \.profile-dropdown/);
  assert.match(styles, /\.shell\.theme-light \.profile-option-row/);
  assert.match(styles, /\.shell\.theme-light \.profile-create-option/);
  assert.match(styles, /\.shell\.theme-light \.context-card/);
  assert.match(styles, /\.shell\.theme-light \.profile-selector-trigger,\s*\n\.shell\.theme-light \.rail-chat-session-list \.chat-session-row,\s*\n\.shell\.theme-light \.pinned-profile-button\s*\{[\s\S]*box-shadow:/);
  assert.match(styles, /\.portfolio-app\.chat-first\s*\{[\s\S]*grid-template-columns: minmax\(208px, 240px\) minmax\(0, 1fr\);/);
  assert.match(styles, /\.portfolio-main\.chat-first-workspace\s*\{[\s\S]*grid-template-columns: minmax\(470px, 1\.12fr\) minmax\(300px, 0\.88fr\);/);
  assert.match(styles, /\.portfolio-chat-workspace,\s*\n\.portfolio-context-canvas\s*\{[\s\S]*rgba\(13, 21, 36, 0\.94\);/);
  assert.match(styles, /\.portfolio-app\.chat-first\s*\{[\s\S]*max-width: 1480px;/);
  assert.match(styles, /\.portfolio-chat-workspace \.chat-turn-content\s*\{[\s\S]*max-width: min\(74%, 640px\);/);
  assert.match(styles, /\.portfolio-chat-workspace \.chat-turn\.user \.chat-turn-content\s*\{[\s\S]*max-width: min\(74%, 640px\);/);
});

test("portfolio secondary controls stay readable on desktop and compact responsively", () => {
  assert.match(app, /className="portfolio-output-trust-cue"/);
  assert.match(styles, /\.portfolio-output-trust-cue/);
  assert.match(app, /className="context-visualization-button context-action-button"/);
  assert.match(app, /className="context-collapse-button context-action-button"/);
  assert.match(app, /className="context-visualization-button context-export-button context-action-button"/);
  assert.match(app, /title=\{labels\.assetComposition\}/);
  assert.match(app, /title=\{contextMetricsCollapsed \? labels\.viewAll : labels\.collapse\}/);
  assert.match(app, /title=\{labels\.performanceAttribution\}/);
  assert.match(app, /title=\{labels\.exportHoldings\}/);

  const assetAction = snippetAfter(app, 'className="context-visualization-button context-action-button"');
  const collapseAction = snippetAfter(app, 'className="context-collapse-button context-action-button"', 680);
  const exportAction = snippetAfter(app, 'className="context-visualization-button context-export-button context-action-button"');
  assert.doesNotMatch(assetAction, /<span>\{labels\.assetComposition\}<\/span>/);
  assert.doesNotMatch(collapseAction, /<span>\{contextMetricsCollapsed \? labels\.viewAll : labels\.collapse\}<\/span>/);
  assert.doesNotMatch(exportAction, /<span>\{labels\.exportHoldings\}<\/span>/);
  assert.match(styles, /\.context-action-button\s*\{[\s\S]*width: 34px;/);
  assert.match(styles, /@media \(max-width: 1180px\)[\s\S]*\.portfolio-chat-header\s*\{[\s\S]*flex-direction: column;/);
  assert.match(styles, /@media \(max-width: 1180px\)[\s\S]*\.portfolio-chat-header \.chat-runtime-controls\s*\{[\s\S]*width: 100%;/);
  assert.match(styles, /@media \(max-width: 1180px\)[\s\S]*\.copilot-title-row\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/);
});

test("portfolio medium-width layout stacks dense controls before phone breakpoints", () => {
  const desktop1120 = mediaBlock(styles, "max-width: 1120px");
  assert.match(desktop1120, /\.portfolio-chat-header,\s*\n\s*\.context-canvas-header\s*\{[\s\S]*padding: 14px 14px 12px;/);
  assert.match(desktop1120, /\.chat-runtime-controls\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(desktop1120, /\.reasoning-toggle\s*\{[\s\S]*justify-content: space-between;/);
  assert.match(desktop1120, /\.context-holdings-toolbar\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(desktop1120, /\.context-holdings-toolbar \.control-field\s*\{[\s\S]*grid-column: 1 \/ -1;/);
});

test("portfolio holdings sort direction uses an icon-only control with an accessible label", () => {
  assert.match(app, /className=\{contextHoldingSortDirection === "asc" \? "sort-direction-button ascending" : "sort-direction-button"\}/);
  assert.match(app, /title=\{contextHoldingSortDirection === "asc" \? labels\.sortAsc : labels\.sortDesc\}/);
  assert.match(app, /<ChevronDown size=\{16\} \/>/);
  assert.match(styles, /\.sort-direction-button\s*\{[\s\S]*display: inline-grid;[\s\S]*place-items: center;/);
  assert.match(styles, /\.sort-direction-button\.ascending svg\s*\{[\s\S]*transform: rotate\(180deg\);/);
});

test("portfolio chat and context stay side-by-side until the medium desktop breakpoint", () => {
  const desktop1280 = mediaBlock(styles, "max-width: 1280px");
  const desktop1180 = mediaBlock(styles, "max-width: 1180px");
  assert.match(desktop1280, /\.portfolio-app\.chat-first\s*\{[\s\S]*grid-template-columns: minmax\(210px, 240px\) minmax\(0, 1fr\);/);
  assert.doesNotMatch(desktop1280, /\.portfolio-main\.chat-first-workspace\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(desktop1180, /\.portfolio-main\.chat-first-workspace\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(desktop1180, /\.portfolio-context-canvas\s*\{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
});

test("deep research has theme-aware surfaces, legible hero text, and themed preview shell", () => {
  assert.match(app, /className="research-output-trust-cue"/);
  assert.match(styles, /\.deep-research-page\s*\{[\s\S]*max-width: 1480px;/);
  assert.match(styles, /@media \(max-width: 1520px\)[\s\S]*\.deep-research-layout\s*\{[\s\S]*grid-template-columns: minmax\(320px, 0\.92fr\) minmax\(0, 1\.08fr\);/);
  assert.match(styles, /@media \(max-width: 1520px\)[\s\S]*\.research-preview-panel\s*\{[\s\S]*grid-column: 1 \/ -1;/);
  assert.match(styles, /@media \(max-width: 1080px\)[\s\S]*\.deep-research-layout\s*\{[\s\S]*grid-template-columns: 1fr;/);
  assert.match(styles, /@media \(max-width: 1080px\)[\s\S]*\.deep-research-hero\s*\{[\s\S]*flex-direction: column;/);
  assert.match(styles, /@media \(max-width: 1080px\)[\s\S]*\.research-form-footer\s*\{[\s\S]*flex-direction: column;/);
  assert.match(styles, /@media \(max-width: 1080px\)[\s\S]*\.research-form-footer \.research-create-outline-button\s*\{[\s\S]*width: 100%;/);
  assert.match(styles, /@media \(max-width: 860px\)[\s\S]*\.deep-research-hero\s*\{[\s\S]*flex-direction: column;/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.research-detail-strip\s*\{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.research-run-toolbar,\s*\n\s*\.research-document-toolbar\s*\{[\s\S]*flex-direction: row;/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.research-preview-panel\s*\{[\s\S]*min-height: 420px;/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.research-preview-panel iframe\s*\{[\s\S]*min-height: 360px;/);
  assert.match(styles, /@media \(max-width: 860px\)[\s\S]*\.research-output-trust-cue > span:last-child\s*\{[\s\S]*white-space: normal;/);
  assert.match(styles, /\.shell\.theme-light \.deep-research-hero/);
  assert.match(styles, /\.shell\.theme-light \.research-help-trigger/);
  assert.match(styles, /\.shell\.theme-light \.research-model-chip/);
  assert.match(styles, /\.shell\.theme-light \.research-run-panel/);
  assert.match(styles, /\.shell\.theme-light \.research-document-panel/);
  assert.match(styles, /\.shell\.theme-light \.research-preview-panel/);
  assert.match(styles, /\.deep-research-hero h2\s*\{[\s\S]*color: var\(--text-primary\);/);
  assert.match(styles, /\.research-preview-frame/);
  assert.match(app, /className="research-preview-frame"/);
  assert.match(app, /className="research-preview-shell"/);
  assert.match(app, /className="research-preview-meta"/);
  assert.match(app, /className="research-preview-kind"/);
  assert.match(app, /className="research-preview-canvas"/);
  assert.match(styles, /\.research-preview-shell/);
  assert.match(styles, /\.research-preview-meta/);
  assert.match(styles, /\.research-preview-kind/);
  assert.match(styles, /\.research-preview-canvas/);
  assert.match(styles, /\.shell\.theme-light \.research-preview-shell/);
  assert.match(styles, /\.shell\.theme-light \.research-preview-canvas/);
  assert.match(app, /researchDocumentHtmlUrl\(selectedDocument\.id, \{ embedded: true \}\)/);
});

test("research secondary controls stay compact while outline and deep-run remain explicit", () => {
  assert.match(app, /className="action-button primary filled-action-button research-create-outline-button"/);
  assert.match(app, /aria-label=\{labels\.createOutline\}/);
  assert.match(app, /<span>\{labels\.createOutline\}<\/span>/);
  assert.match(app, /className="icon-button research-refresh-button"/);
  assert.match(app, /className="action-button primary filled-action-button research-run-deep-button"/);
  assert.match(app, /className="icon-button research-open-html-button"/);
  assert.doesNotMatch(app, /<span>\{labels\.refresh\}<\/span>/);
  assert.doesNotMatch(app, /<span>\{labels\.openHtml\}<\/span>/);
  assert.match(styles, /\.action-button\.primary\.filled-action-button/);
});
