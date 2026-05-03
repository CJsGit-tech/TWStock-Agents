import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from financial_agents.orchestrator import (
    build_analysis_plan,
    coerce_specialist_result,
    extract_image_payload,
    infer_sections,
    serialize_results,
)
from financial_agents.prompt_store import list_prompts, render_prompt
from financial_agents.schemas import DISCLAIMER, FinalReport, SpecialistResult, normalize_stock_input


class FinancialAgentSchemaTests(unittest.TestCase):
    def test_normalize_stock_input_prefers_stock_code(self):
        self.assertEqual(normalize_stock_input("完整分析 2330 台積電"), "2330")
        self.assertEqual(normalize_stock_input("台積電"), "台積電")

    def test_specialist_result_coercion_from_text(self):
        result = coerce_specialist_result("資料不足，需補充來源。")
        self.assertEqual(result.summary, "資料不足，需補充來源。")
        self.assertEqual(result.confidence, "medium")

    def test_final_report_defaults_disclaimer(self):
        report = FinalReport(stock="2330")
        self.assertEqual(report.disclaimer, DISCLAIMER)
        self.assertEqual(report.sections, {})

    def test_serialize_results_uses_jsonable_models(self):
        result = SpecialistResult(summary="完成", table_rows=[{"指標": "EPS", "數據": "10"}])
        serialized = serialize_results({"financial_health": result})
        self.assertEqual(serialized["financial_health"]["summary"], "完成")
        self.assertEqual(serialized["financial_health"]["table_rows"][0]["指標"], "EPS")

    def test_infer_sections_uses_focused_question(self):
        self.assertEqual(infer_sections("只分析 2454 的估值和同業比較"), ["valuation", "peers"])

    def test_infer_sections_detects_visualization_request(self):
        self.assertEqual(infer_sections("用這個資訊生成一張圖"), ["visualization"])

    def test_build_analysis_plan_preserves_question(self):
        plan = build_analysis_plan("完整分析 2330 台積電", "只看 2330 的現金流")
        self.assertEqual(plan.stock, "2330")
        self.assertEqual(plan.question, "只看 2330 的現金流")
        self.assertEqual(plan.sections, ["cashflow"])

    def test_build_analysis_plan_can_use_context_stock_for_followup_chart(self):
        plan = build_analysis_plan("用這個資訊生成一張圖", "用這個資訊生成一張圖", "ASSISTANT: 1717 長興目前成交價 78.9")
        self.assertEqual(plan.stock, "1717")
        self.assertEqual(plan.sections, ["visualization"])

    def test_prompt_store_renders_input_template(self):
        prompt = render_prompt(
            "financial_analysis.input",
            stock="2330",
            question="Analyze valuation.",
            sections="valuation",
            collected_data="{}",
        )
        self.assertIn("Analyze valuation.", prompt)
        self.assertIn("2330", prompt)

    def test_prompt_store_lists_dispatch_prompt(self):
        names = {prompt.name for prompt in list_prompts()}
        self.assertIn("manager_dispatch.instructions", names)

    def test_extract_image_payload_from_response_item(self):
        class FakeResult:
            final_output = ""
            new_items = []
            raw_responses = [{"output": [{"type": "image_generation_call", "result": "abc123"}]}]

        image = extract_image_payload(FakeResult())
        self.assertIsNotNone(image)
        self.assertEqual(image["b64_json"], "abc123")
        self.assertEqual(image["image_url"], "data:image/png;base64,abc123")


if __name__ == "__main__":
    unittest.main()
