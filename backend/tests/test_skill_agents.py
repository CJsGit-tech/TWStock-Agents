import unittest
import os
from unittest.mock import patch

from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from skill_agents.models import Base, ChatSession, Skill
from skill_agents.orchestrator import MAX_EXECUTED_SKILLS, _required_only_plan
from skill_agents.schemas import AgenticTaskRequest
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


class SkillPlanningTests(unittest.TestCase):
    def test_required_only_plan_preserves_required_skills_under_limit(self):
        skills = [
            Skill(id=str(index), name=f"skill {index}", description="", instructions="analyze")
            for index in range(MAX_EXECUTED_SKILLS + 1)
        ]

        plan = _required_only_plan(skills)

        self.assertEqual(len(plan.planned_skills), MAX_EXECUTED_SKILLS)
        self.assertTrue(all(planned.source == "required" for planned in plan.planned_skills))


class SkillAgentImageModelTests(unittest.TestCase):
    def test_default_image_model_is_gpt_image_2(self):
        from skill_agents.orchestrator import image_model

        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(image_model(), "gpt-image-2")

    def test_image_model_override_is_preserved(self):
        from skill_agents.orchestrator import image_model

        with patch.dict(os.environ, {"OPENAI_IMAGE_MODEL": "custom-image-model"}):
            self.assertEqual(image_model(), "custom-image-model")


if __name__ == "__main__":
    unittest.main()
