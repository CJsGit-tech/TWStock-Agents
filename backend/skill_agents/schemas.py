from datetime import datetime

from pydantic import BaseModel, Field, model_validator


MAX_SELECTED_SKILLS = 5


class SkillBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str = ""
    instructions: str = Field(..., min_length=1)


class SkillCreate(SkillBase):
    pass


class SkillUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    instructions: str | None = Field(default=None, min_length=1)
    is_active: bool | None = None


class SkillRead(SkillBase):
    id: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AgenticTaskRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    skill_ids: list[str] = Field(default_factory=list, max_length=MAX_SELECTED_SKILLS)
    required_skill_ids: list[str] = Field(default_factory=list, max_length=MAX_SELECTED_SKILLS)
    stock: str | None = None
    context: str | None = None

    @model_validator(mode="after")
    def normalize_required_skills(self) -> "AgenticTaskRequest":
        required = self.required_skill_ids or self.skill_ids
        self.required_skill_ids = list(dict.fromkeys(required))
        self.skill_ids = list(dict.fromkeys(self.skill_ids))
        return self


class SkillDraftRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    context: str | None = None


class SkillDraftResponse(SkillBase):
    pass
