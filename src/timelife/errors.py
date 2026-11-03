from typing import Any


class AppError(Exception):
    """Expected API error rendered as ``{"code": ..., "fields"?: ..., "detail"?: ...}``."""

    def __init__(
        self,
        code: str,
        status: int = 422,
        *,
        fields: dict[str, str] | None = None,
        detail: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(code)
        self.code = code
        self.status = status
        self.fields = fields
        self.detail = detail
        self.headers = headers

    @property
    def payload(self) -> dict[str, Any]:
        content: dict[str, Any] = {"code": self.code}
        if self.fields:
            content["fields"] = self.fields
        if self.detail:
            content["detail"] = self.detail
        return content
