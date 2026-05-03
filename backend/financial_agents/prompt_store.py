from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from string import Template
from typing import Any


PROMPT_DIR = Path(__file__).with_name("prompts")


@dataclass(frozen=True)
class PromptSpec:
    name: str
    filename: str
    version: str
    description: str


PROMPTS: dict[str, PromptSpec] = {
    "financial_analysis.instructions": PromptSpec(
        name="financial_analysis.instructions",
        filename="financial_analysis_instructions.md",
        version="2026-05-03",
        description="System instructions for the single financial analysis agent.",
    ),
    "financial_analysis.input": PromptSpec(
        name="financial_analysis.input",
        filename="financial_analysis_input.md",
        version="2026-05-03",
        description="User/input prompt assembled by the backend orchestrator.",
    ),
    "financial_visualization.instructions": PromptSpec(
        name="financial_visualization.instructions",
        filename="financial_visualization_instructions.md",
        version="2026-05-03",
        description="System instructions for chart image generation from financial data.",
    ),
    "financial_visualization.input": PromptSpec(
        name="financial_visualization.input",
        filename="financial_visualization_input.md",
        version="2026-05-03",
        description="Image-generation prompt assembled from stock data and user context.",
    ),
    "manager_dispatch.instructions": PromptSpec(
        name="manager_dispatch.instructions",
        filename="manager_dispatch_instructions.md",
        version="2026-05-03",
        description=(
            "Dispatch policy for request parsing. Current implementation uses "
            "code-owned rules; this prompt documents the policy for future LLM planning."
        ),
    ),
}


def list_prompts() -> list[PromptSpec]:
    return list(PROMPTS.values())


def render_prompt(name: str, **values: Any) -> str:
    text = load_prompt(name)
    return Template(text).safe_substitute({key: _stringify(value) for key, value in values.items()})


@lru_cache(maxsize=32)
def load_prompt(name: str) -> str:
    spec = PROMPTS[name]
    env_key = "FINANCIAL_PROMPT_" + name.upper().replace(".", "_")
    override_path = os.getenv(env_key)
    path = Path(override_path) if override_path else PROMPT_DIR / spec.filename
    return path.read_text(encoding="utf-8").strip()


def _stringify(value: Any) -> str:
    if isinstance(value, str):
        return value
    return str(value)
