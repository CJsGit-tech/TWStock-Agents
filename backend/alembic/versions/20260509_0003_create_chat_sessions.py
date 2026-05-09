"""create chat sessions table

Revision ID: 20260509_0003
Revises: 20260507_0002
Create Date: 2026-05-09
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260509_0003"
down_revision: str | None = "20260507_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "chat_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("messages_json", sa.JSON(), nullable=False),
        sa.Column("events_json", sa.JSON(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_chat_sessions_is_active"), "chat_sessions", ["is_active"], unique=False)
    op.create_index(op.f("ix_chat_sessions_title"), "chat_sessions", ["title"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_chat_sessions_title"), table_name="chat_sessions")
    op.drop_index(op.f("ix_chat_sessions_is_active"), table_name="chat_sessions")
    op.drop_table("chat_sessions")
