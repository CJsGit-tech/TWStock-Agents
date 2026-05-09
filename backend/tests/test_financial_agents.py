import unittest
import asyncio
import os
from dataclasses import dataclass
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from financial_agents.orchestrator import (
    coerce_specialist_result,
    serialize_results,
)
from financial_agents.schemas import DISCLAIMER, FinalReport, SpecialistResult, normalize_stock_input


class FinancialAgentSchemaTests(unittest.TestCase):
    def test_normalize_stock_input_prefers_stock_code(self):
        self.assertEqual(normalize_stock_input("完整分析 2330 台積電"), "2330")
        self.assertEqual(normalize_stock_input("台積電"), "台積電")

    def test_specialist_result_coercion_from_text(self):
        result = coerce_specialist_result("資料不足，需補充來源。")
        self.assertEqual(result.summary, "資料不足，需補充來源。")
        self.assertEqual(result.confidence, "medium")

    def test_specialist_result_coercion_from_dict(self):
        result = coerce_specialist_result({"summary": "完成", "confidence": "high"})
        self.assertEqual(result.summary, "完成")
        self.assertEqual(result.confidence, "high")

    def test_specialist_result_coercion_passthrough(self):
        original = SpecialistResult(summary="test")
        result = coerce_specialist_result(original)
        self.assertIs(result, original)

    def test_final_report_defaults_disclaimer(self):
        report = FinalReport(stock="2330")
        self.assertEqual(report.disclaimer, DISCLAIMER)
        self.assertEqual(report.sections, {})

    def test_serialize_results_uses_jsonable_models(self):
        result = SpecialistResult(summary="完成", table_rows=[{"指標": "EPS", "數據": "10"}])
        serialized = serialize_results({"financial_health": result})
        self.assertEqual(serialized["financial_health"]["summary"], "完成")
        self.assertEqual(serialized["financial_health"]["table_rows"][0]["指標"], "EPS")


class VisualizationDetectionTests(unittest.TestCase):
    def test_detects_chinese_chart_request(self):
        from financial_agents.orchestrator import _is_visualization_request
        self.assertTrue(_is_visualization_request("用這個資訊生成一張圖"))
        self.assertTrue(_is_visualization_request("畫一張圖表"))
        self.assertTrue(_is_visualization_request("視覺化"))

    def test_detects_english_chart_request(self):
        from financial_agents.orchestrator import _is_visualization_request
        self.assertTrue(_is_visualization_request("generate a chart"))
        self.assertTrue(_is_visualization_request("visualize this data"))

    def test_does_not_detect_analysis_request(self):
        from financial_agents.orchestrator import _is_visualization_request
        self.assertFalse(_is_visualization_request("完整分析 2330 台積電"))
        self.assertFalse(_is_visualization_request("只看估值"))


class ImageModelConfigTests(unittest.TestCase):
    def test_default_image_model_is_gpt_image_2(self):
        from financial_agents.agents import image_model

        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(image_model(), "gpt-image-2")

    def test_image_model_override_is_preserved(self):
        from financial_agents.agents import image_model

        with patch.dict(os.environ, {"OPENAI_IMAGE_MODEL": "custom-image-model"}):
            self.assertEqual(image_model(), "custom-image-model")


class ImagePayloadExtractionTests(unittest.TestCase):
    def test_extract_image_payload_from_response_item(self):
        from financial_agents.orchestrator import _extract_image_payload, _extract_image_payloads

        class FakeResponse:
            output = [
                {"type": "image_generation_call", "result": "abc123" + "x" * 200},
                {"type": "image_generation_call", "result": "def456" + "y" * 200},
            ]

        class FakeResult:
            final_output = ""
            new_items = []
            raw_responses = [FakeResponse()]

        image = _extract_image_payload(FakeResult())
        self.assertIsNotNone(image)
        self.assertTrue(image["b64_json"].startswith("abc123"))
        self.assertTrue(image["image_url"].startswith("data:image/png;base64,"))
        images = _extract_image_payloads(FakeResult())
        self.assertEqual(len(images), 2)
        self.assertTrue(images[1]["b64_json"].startswith("def456"))

    def test_extract_image_payload_from_new_items(self):
        from financial_agents.orchestrator import _extract_image_payload

        class FakeItem:
            raw_item = {"type": "image_generation_call", "result": "img_data_" + "A" * 200}
            output = None

        class FakeResult:
            final_output = ""
            new_items = [FakeItem()]
            raw_responses = []

        image = _extract_image_payload(FakeResult())
        self.assertIsNotNone(image)
        self.assertTrue(image["b64_json"].startswith("img_data_"))

    def test_extract_image_payload_returns_none_when_no_image(self):
        from financial_agents.orchestrator import _extract_image_payload

        class FakeResult:
            final_output = "just text"
            new_items = []
            raw_responses = []

        self.assertIsNone(_extract_image_payload(FakeResult()))


class EventSerializationTests(unittest.TestCase):
    def test_jsonable_does_not_deepcopy_asyncio_future(self):
        from financial_agents.orchestrator import _to_jsonable

        @dataclass
        class RuntimeCarrier:
            future: asyncio.Future

        loop = asyncio.new_event_loop()
        self.addCleanup(loop.close)

        value = _to_jsonable(RuntimeCarrier(future=loop.create_future()))

        self.assertIn("Future", value["future"])


if __name__ == "__main__":
    unittest.main()
