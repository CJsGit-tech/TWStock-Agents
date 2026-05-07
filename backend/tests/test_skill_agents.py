import unittest

from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from skill_agents.models import Base, Skill
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


if __name__ == "__main__":
    unittest.main()
