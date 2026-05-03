import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from financial_agents.orchestrator import coerce_specialist_result, serialize_results
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


if __name__ == "__main__":
    unittest.main()
