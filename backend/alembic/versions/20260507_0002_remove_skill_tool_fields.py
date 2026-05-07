"""remove skill tool fields

Revision ID: 20260507_0002
Revises: 20260506_0001
Create Date: 2026-05-07
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260507_0002"
down_revision: str | None = "20260506_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("skills", "enabled_builtin_tools")
    op.drop_column("skills", "enabled_mcp_servers")


def downgrade() -> None:
    op.add_column("skills", sa.Column("enabled_mcp_servers", sa.JSON(), nullable=False, server_default="[]"))
    op.add_column("skills", sa.Column("enabled_builtin_tools", sa.JSON(), nullable=False, server_default="[]"))
