import httpx

from app.config import settings
from app.schemas.task import RetrievalNode


class LLMServiceError(RuntimeError):
    pass


class LLMService:
    def __init__(self) -> None:
        self.base_url = settings.openai_base_url.rstrip("/")
        self.api_key = settings.openai_api_key
        self.model = settings.openai_model

    def has_credentials(self) -> bool:
        return bool(self.api_key)

    def generate_summary(self, ticker: str, query: str, nodes: list[RetrievalNode]) -> str:
        if not self.api_key:
            raise LLMServiceError("OPENAI_API_KEY is not configured")
        if not nodes:
            raise LLMServiceError("Cannot generate summary with empty node list")

        sections = []
        for node in nodes:
            sections.append(
                f"Section: {node.title} (Page {node.page_index})\n{node.relevant_content}"
            )
        sources = "\n---\n".join(sections)

        system_prompt = (
            "You are a financial analyst assistant. Generate a concise risk summary "
            "based ONLY on the provided document sections. Every claim must be traceable "
            "to a specific source section. Do not infer facts not present in the sources. "
            "Format citations as [Section Title, Page N]."
        )
        user_prompt = (
            f"Ticker: {ticker}\n"
            f"Query: {query}\n\n"
            "Relevant Document Sections:\n"
            "---\n"
            f"{sources}\n"
            "---\n\n"
            "Generate a structured risk summary (300-500 words) with:\n"
            "1. Executive overview\n"
            "2. Key risk categories identified\n"
            "3. Specific risk details with inline citations [Section Title, Page N]\n"
            "4. Potential impact assessment based on disclosed information"
        )

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.2,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        try:
            with httpx.Client(timeout=60) as client:
                response = client.post(f"{self.base_url}/chat/completions", json=payload, headers=headers)
                response.raise_for_status()
                data = response.json()
        except httpx.HTTPError as exc:
            raise LLMServiceError(f"OpenAI HTTP error: {exc}") from exc

        choices = data.get("choices", [])
        if not choices:
            raise LLMServiceError("OpenAI response contained no choices")
        content = choices[0].get("message", {}).get("content", "")
        if not content:
            raise LLMServiceError("OpenAI response contained empty content")
        return str(content)
