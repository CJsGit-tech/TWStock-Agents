"""create skills table

Revision ID: 20260506_0001
Revises:
Create Date: 2026-05-06
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260506_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "skills",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("enabled_mcp_servers", sa.JSON(), nullable=False),
        sa.Column("enabled_builtin_tools", sa.JSON(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_skills_is_active"), "skills", ["is_active"], unique=False)
    op.create_index(op.f("ix_skills_name"), "skills", ["name"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_skills_name"), table_name="skills")
    op.drop_index(op.f("ix_skills_is_active"), table_name="skills")
    op.drop_table("skills")
