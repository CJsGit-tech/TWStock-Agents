import os
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
    from fastapi.testclient import TestClient
except ModuleNotFoundError:  # pragma: no cover - host test env may not include FastAPI.
    TestClient = None

try:
    import app as backend_app
except ModuleNotFoundError:  # pragma: no cover - host test env may not include app dependencies.
    backend_app = None


class OpenAISettingsTests(unittest.TestCase):
    def test_runtime_api_key_updates_tracing_exporter(self):
        if TestClient is None or backend_app is None:
            self.skipTest("FastAPI app dependencies are not installed in this Python environment.")

        with patch.dict(os.environ, {"SKILLS_DB_AUTO_INIT": "false"}), patch(
            "app.configure_tracing_api_key"
        ) as configure_tracing_api_key:
            client = TestClient(backend_app.app)
            response = client.post("/api/settings/openai-key", json={"api_key": "test-key"})
            self.assertEqual(os.environ["OPENAI_API_KEY"], "test-key")

        self.assertEqual(response.status_code, 200)
        configure_tracing_api_key.assert_called_once_with("test-key")


if __name__ == "__main__":
    unittest.main()
