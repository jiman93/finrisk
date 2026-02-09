from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[3]
ROOT_ENV_FILE = PROJECT_ROOT / ".env"


class Settings(BaseSettings):
    database_url: str = "sqlite:///./finrisk.db"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    pageindex_api_key: str = ""
    pageindex_base_url: str = "https://api.pageindex.ai"
    pageindex_doc_map: str = ""
    pageindex_poll_interval_seconds: float = 1.0
    pageindex_poll_timeout_seconds: int = 45
    pageindex_enable_thinking: bool = False
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"
    enable_mock_fallback: bool = True
    mock_retrieval_scenario: str = "happy_path"
    mock_seed_salt: str = "finrisk"
    synthetic_enabled: bool = True
    synthetic_retrieval_latency_min_ms: int = 450
    synthetic_retrieval_latency_max_ms: int = 1300
    synthetic_generation_latency_min_ms: int = 650
    synthetic_generation_latency_max_ms: int = 1700

    model_config = SettingsConfigDict(
        env_file=(str(ROOT_ENV_FILE), ".env"),
        extra="ignore",
    )


settings = Settings()
