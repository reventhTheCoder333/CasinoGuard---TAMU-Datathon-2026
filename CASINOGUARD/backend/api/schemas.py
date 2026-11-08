"""Request validation. Invalid data is rejected before it reaches the detectors."""

from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from backend.services.simulator import SCENARIOS
from detectors.constants import is_house_account


Identifier = Annotated[
    str,
    StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:\-]{0,63}$"),
]

MAX_FUTURE_SKEW = timedelta(minutes=5)


class Transaction(BaseModel):

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    id: Identifier
    account: Identifier
    from_account: Identifier = Field(alias="from")
    to: Identifier
    amount: float = Field(gt=0, le=1_000_000_000, allow_inf_nan=False)
    timestamp: datetime
    type: Literal["deposit", "wager", "withdrawal", "transfer"] = "transfer"

    @field_validator("timestamp")
    @classmethod
    def timestamp_is_not_in_future(cls, value):
        aware = (
            value.replace(tzinfo=timezone.utc)
            if value.tzinfo is None
            else value
        )

        if aware > datetime.now(timezone.utc) + MAX_FUTURE_SKEW:
            raise ValueError("timestamp is in the future")

        return value

    @model_validator(mode="after")
    def parties_are_consistent(self):
        if self.from_account == self.to:
            raise ValueError("from and to must be different accounts")

        if self.account not in (self.from_account, self.to):
            raise ValueError("account must be either from or to")

        if is_house_account(self.account):
            raise ValueError("account must be the customer, not a house account")

        if self.type in ("deposit", "wager") and self.from_account != self.account:
            raise ValueError(f"a {self.type} must be sent by the account")

        if self.type == "withdrawal" and self.to != self.account:
            raise ValueError("a withdrawal must be received by the account")

        return self


class Account(BaseModel):

    model_config = ConfigDict(extra="forbid")

    account: Identifier
    phone: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=32)] | None = None
    email: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=254)] | None = None
    payment_card: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)] | None = None

    @field_validator("account")
    @classmethod
    def not_house_account(cls, value):
        if is_house_account(value):
            raise ValueError("house accounts cannot be registered")
        return value


class SimulatorRun(BaseModel):

    model_config = ConfigDict(extra="forbid")

    scenario: str = Field(description="A scenario key, or 'all'")
    interval: float = Field(default=0.8, ge=0, le=10, allow_inf_nan=False)

    @field_validator("scenario")
    @classmethod
    def known_scenario(cls, value):
        if value != "all" and value not in SCENARIOS:
            raise ValueError(f"unknown scenario: {value}")
        return value


class TrafficSettings(BaseModel):

    model_config = ConfigDict(extra="forbid")

    enabled: bool
    interval: float | None = Field(default=None, ge=0.1, le=30, allow_inf_nan=False)


class DatabricksSimulationRequest(BaseModel):

    model_config = ConfigDict(extra="forbid")

    scenario: Literal[
        "full",
        "transaction_structuring",
        "transaction_chains",
        "rapid_cashouts",
        "unusual_volume",
        "circular_transactions",
    ] = "full"
    seed: int | None = Field(default=None, ge=0, lt=2**31)
