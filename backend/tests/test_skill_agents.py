import asyncio
import unittest
import os
from contextlib import contextmanager
from unittest.mock import patch

from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from skill_agents.models import Base, ChatSession, Skill
from skill_agents.orchestrator import (
    MAX_EXECUTED_SKILLS,
    _builtin_tools,
    _required_only_plan,
    _run_specialist,
    run_skill_visualizations,
)
from skill_agents.schemas import AgenticTaskRequest, VisualizationRequest
from skill_agents.seeds import DEFAULT_SKILLS, seed_default_skills


class SkillAgentPersistenceTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(bind=engine)
        self.Session = sessionmaker(bind=engine)

    def test_default_skill_seeds_are_idempotent(self):
        with self.Session() as session:
            seed_default_skills(session)
            seed_default_skills(session)
            skills = list(session.scalars(select(Skill)))

        self.assertEqual(len(skills), len(DEFAULT_SKILLS))
        self.assertFalse(hasattr(skills[0], "enabled_mcp_servers"))
        self.assertFalse(hasattr(skills[0], "enabled_builtin_tools"))

    def test_inactive_skills_can_be_filtered_out(self):
        with self.Session() as session:
            seed_default_skills(session)
            skill = session.scalar(select(Skill).limit(1))
            skill.is_active = False
            session.commit()

            active = list(session.scalars(select(Skill).where(Skill.is_active.is_(True))))

        self.assertEqual(len(active), len(DEFAULT_SKILLS) - 1)


class ChatSessionPersistenceTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(bind=engine)
        self.Session = sessionmaker(bind=engine)

    def test_chat_session_json_round_trip(self):
        with self.Session() as session:
            chat_session = ChatSession(
                title="2330 analysis",
                messages_json=[{"id": "m1", "role": "user", "content": "分析 2330"}],
                events_json=[{"id": "e1", "messageId": "m2", "type": "tool_called"}],
            )
            session.add(chat_session)
            session.commit()

            loaded = session.get(ChatSession, chat_session.id)

        self.assertEqual(loaded.title, "2330 analysis")
        self.assertEqual(loaded.messages_json[0]["content"], "分析 2330")
        self.assertEqual(loaded.events_json[0]["messageId"], "m2")

    def test_chat_session_soft_delete_flag(self):
        with self.Session() as session:
            chat_session = ChatSession(title="delete me", messages_json=[], events_json=[])
            session.add(chat_session)
            session.commit()

            chat_session.is_active = False
            session.commit()
            active = list(session.scalars(select(ChatSession).where(ChatSession.is_active.is_(True))))

        self.assertEqual(active, [])


class AgenticTaskSchemaTests(unittest.TestCase):
    def test_allows_zero_required_skills(self):
        request = AgenticTaskRequest(prompt="分析 2330")

        self.assertEqual(request.required_skill_ids, [])
        self.assertEqual(request.skill_ids, [])

    def test_enforces_max_five_skills(self):
        with self.assertRaises(ValidationError):
            AgenticTaskRequest(prompt="分析 2330", skill_ids=["1", "2", "3", "4", "5", "6"])

    def test_treats_skill_ids_as_required_skill_alias(self):
        request = AgenticTaskRequest(prompt="分析 2330", skill_ids=["a", "b"], stock="2330")
        self.assertEqual(request.prompt, "分析 2330")
        self.assertEqual(request.skill_ids, ["a", "b"])
        self.assertEqual(request.required_skill_ids, ["a", "b"])

    def test_prefers_required_skill_ids_when_both_fields_exist(self):
        request = AgenticTaskRequest(prompt="分析 2330", skill_ids=["a"], required_skill_ids=["b"])

        self.assertEqual(request.required_skill_ids, ["b"])


class VisualizationRequestSchemaTests(unittest.TestCase):
    def test_requires_at_least_one_required_skill(self):
        with self.assertRaises(ValidationError):
            VisualizationRequest(prompt="分析 2330", answer="完成", required_skill_ids=[])

    def test_deduplicates_required_skill_ids(self):
        request = VisualizationRequest(prompt="分析 2330", answer="完成", required_skill_ids=["a", "a", "b"])

        self.assertEqual(request.required_skill_ids, ["a", "b"])


class SkillPlanningTests(unittest.TestCase):
    def test_required_only_plan_preserves_required_skills_under_limit(self):
        skills = [
            Skill(id=str(index), name=f"skill {index}", description="", instructions="analyze")
            for index in range(MAX_EXECUTED_SKILLS + 1)
        ]

        plan = _required_only_plan(skills)

        self.assertEqual(len(plan.planned_skills), MAX_EXECUTED_SKILLS)
        self.assertTrue(all(planned.source == "required" for planned in plan.planned_skills))

    def test_specialist_runs_in_dedicated_trace(self):
        skill = Skill(id="skill-1", name="PE/PB 分析", description="估值分析", instructions="分析 PE/PB")
        queue = asyncio.Queue()

        class FakeStreamResult:
            final_output = "PE/PB specialist output"

            async def stream_events(self):
                if False:
                    yield None

        @contextmanager
        def fake_workflow_trace(*args, **kwargs):
            yield None

        async def run_specialist():
            return await _run_specialist(
                skill,
                "分析 2330",
                [],
                queue,
                stock="2330",
                trace_id="trace_parent",
                trace_metadata={"endpoint": "/api/agentic-task/stream"},
            )

        with patch("skill_agents.orchestrator.new_trace_id", return_value="trace_skill"), patch(
            "skill_agents.orchestrator.workflow_trace",
            side_effect=fake_workflow_trace,
        ) as workflow_trace, patch(
            "skill_agents.orchestrator.Runner.run_streamed",
            return_value=FakeStreamResult(),
        ) as run_streamed:
            result = asyncio.run(run_specialist())

        workflow_trace.assert_called_once()
        self.assertEqual(workflow_trace.call_args.args[0], "Skill agent: PE/PB 分析")
        self.assertEqual(workflow_trace.call_args.kwargs["trace_id"], "trace_skill")
        self.assertEqual(workflow_trace.call_args.kwargs["metadata"]["parent_trace_id"], "trace_parent")
        run_config = run_streamed.call_args.kwargs["run_config"]
        self.assertEqual(run_config.trace_id, "trace_skill")
        self.assertEqual(run_config.trace_metadata["parent_trace_id"], "trace_parent")
        self.assertEqual(result.output, "PE/PB specialist output")
        queued_events = []
        while not queue.empty():
            queued_events.append(queue.get_nowait())
        self.assertEqual(queued_events[0]["type"], "trace_started")
        self.assertEqual(queued_events[0]["payload"]["workflow"], "Skill agent: PE/PB 分析")
        self.assertEqual(queued_events[-2]["type"], "trace_completed")
        self.assertEqual(queued_events[-2]["payload"]["trace_id"], "trace_skill")


class SkillAgentImageModelTests(unittest.TestCase):
    def test_default_image_model_is_gpt_image_2(self):
        from skill_agents.orchestrator import image_model

        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(image_model(), "gpt-image-2")

    def test_image_model_override_is_preserved(self):
        from skill_agents.orchestrator import image_model

        with patch.dict(os.environ, {"OPENAI_IMAGE_MODEL": "custom-image-model"}):
            self.assertEqual(image_model(), "custom-image-model")

    def test_default_agentic_tools_do_not_include_image_generation(self):
        tool_names = [tool.__class__.__name__ for tool in _builtin_tools()]

        self.assertIn("WebSearchTool", tool_names)
        self.assertNotIn("ImageGenerationTool", tool_names)


class SkillVisualizationTests(unittest.TestCase):
    def test_visualization_stream_emits_one_image_per_required_skill(self):
        skill = Skill(id="skill-1", name="PE/PB 分析", description="估值分析", instructions="分析 PE/PB")

        class FakeResult:
            final_output = "估值圖表"

        async def fake_run(*args, **kwargs):
            return FakeResult()

        async def collect_events():
            events = []
            async for event in run_skill_visualizations(
                "分析 2330",
                "PE/PB 分析結果",
                [skill],
                stock="2330",
                trace_id="trace_123",
            ):
                events.append(event)
            return events

        with patch("skill_agents.orchestrator.Runner.run", side_effect=fake_run), patch(
            "skill_agents.orchestrator._extract_image_payloads",
            return_value=[{"b64_json": "abc" + "x" * 200, "image_url": "data:image/png;base64,abc"}],
        ):
            events = asyncio.run(collect_events())

        self.assertEqual([event["type"] for event in events], ["image_generation_started", "image_generated"])
        generated = events[1]["payload"]
        self.assertEqual(generated["skill_id"], "skill-1")
        self.assertEqual(generated["skill_name"], "PE/PB 分析")
        self.assertEqual(generated["trace_id"], "trace_123")


if __name__ == "__main__":
    unittest.main()
