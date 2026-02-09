from dataclasses import dataclass
from hashlib import sha256
import random
import re
from typing import Literal
from uuid import uuid4

from app.schemas.task import RetrievalNode
from app.services.pageindex_service import normalize_pageindex_nodes

try:
    from faker import Faker  # type: ignore
except ImportError:  # pragma: no cover - optional dependency
    Faker = None


MockScenario = Literal[
    "happy_path",
    "slow_processing",
    "empty_completed",
    "failed_retrieval",
    "limit_reached",
    "mixed_relevance",
    "long_context",
]

SUPPORTED_SCENARIOS: tuple[MockScenario, ...] = (
    "happy_path",
    "slow_processing",
    "empty_completed",
    "failed_retrieval",
    "limit_reached",
    "mixed_relevance",
    "long_context",
)

TOPIC_LIBRARY = (
    {
        "key": "regulatory",
        "title": "Item 1A. Risk Factors - Regulatory and Compliance",
        "path": "PART I > ITEM 1A. Risk Factors > Regulatory",
        "templates": (
            "{ticker} indicates that {focus} may increase compliance costs across {region} and create legal exposure if control frameworks lag.",
            "Management notes evolving privacy, AI, and cross-border data rules that may delay launches and require additional audit coverage.",
            "The filing cites policy divergence across jurisdictions as a source of execution friction and periodic remediation spend.",
        ),
    },
    {
        "key": "cyber",
        "title": "Item 1A. Risk Factors - Technology and Cybersecurity",
        "path": "PART I > ITEM 1A. Risk Factors > Technology",
        "templates": (
            "{ticker} reports that cyber incidents, service outages, and third-party software defects could weaken customer trust and require significant recovery costs.",
            "The filing emphasizes dependency on secure identity, telemetry, and incident-response systems to preserve business continuity.",
            "Management highlights increased attack surface from cloud-scale infrastructure and supply-chain software integrations.",
        ),
    },
    {
        "key": "operations",
        "title": "Item 7. Management's Discussion and Analysis - Operational Risks",
        "path": "PART II > ITEM 7. MD&A > Operating Context",
        "templates": (
            "Operational performance remains sensitive to demand shifts in {region}, execution bottlenecks, and partner dependencies tied to {focus}.",
            "The company notes that uneven capacity planning can pressure service levels and extend delivery timelines in strategic segments.",
            "Leadership frames resilience programs as necessary to reduce volatility from external providers and constrained talent pools.",
        ),
    },
    {
        "key": "supply_chain",
        "title": "Item 1. Business - Supply Chain and External Dependencies",
        "path": "PART I > ITEM 1. Business > Supply Chain",
        "templates": (
            "{ticker} describes exposure to supplier concentration, logistics volatility, and input-cost inflation that may affect margin and fulfillment.",
            "The filing references geopolitical disruptions and long lead times for specialized components as recurring operational risks.",
            "Management indicates continuity planning for critical vendors, but acknowledges potential delivery and quality variability.",
        ),
    },
    {
        "key": "financial",
        "title": "Item 7A. Quantitative and Qualitative Market Risk",
        "path": "PART II > ITEM 7A. Market Risk",
        "templates": (
            "Foreign exchange, rate movements, and commodity variability could alter cost structure and reduce forecasting confidence.",
            "The company reports that macro uncertainty may affect enterprise spending cycles and near-term demand conversion.",
            "Management identifies sensitivity to capital-market conditions that can influence investment pace and risk appetite.",
        ),
    },
)


class MockRetrievalError(RuntimeError):
    def __init__(self, message: str, status_code: int = 503) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass
class MockRetrievalResult:
    retrieval_id: str
    doc_id: str
    status: str
    query: str
    raw_nodes: list[dict]
    nodes: list[RetrievalNode]
    scenario: str
    processing_polls: int


class _MiniFaker:
    def __init__(self, rng: random.Random) -> None:
        self.rng = rng
        self._companies = (
            "Northwind Dynamics",
            "Granite Cloud Systems",
            "Summit Horizon Labs",
            "Blue Harbor Technologies",
            "Evercrest Holdings",
            "Vector Peak Analytics",
        )
        self._cities = ("Seattle", "Austin", "Chicago", "London", "Singapore", "Dublin")
        self._countries = ("United States", "United Kingdom", "Germany", "Japan", "Singapore", "Canada")
        self._regions = ("North America", "EMEA", "APAC", "Latin America")
        self._words = (
            "operational",
            "resilience",
            "compliance",
            "platform",
            "security",
            "forecast",
            "execution",
            "continuity",
            "governance",
            "oversight",
            "dependency",
            "scalability",
        )

    def company(self) -> str:
        return self.rng.choice(self._companies)

    def city(self) -> str:
        return self.rng.choice(self._cities)

    def country(self) -> str:
        return self.rng.choice(self._countries)

    def region(self) -> str:
        return self.rng.choice(self._regions)

    def sentence(self, nb_words: int = 12) -> str:
        words = [self.rng.choice(self._words) for _ in range(max(5, nb_words))]
        sentence = " ".join(words)
        return sentence[:1].upper() + sentence[1:] + "."


def _stable_seed(*parts: str) -> int:
    key = "::".join(part.strip().lower() for part in parts).encode("utf-8")
    return int(sha256(key).hexdigest(), 16) & 0xFFFFFFFF


def _focus_phrase(query: str) -> str:
    cleaned = " ".join(query.strip().split())
    return cleaned[:140] if cleaned else "the requested risk area"


def _extract_scenario_override(query: str) -> tuple[str | None, str]:
    # Optional inline override for quick manual testing:
    #   "scenario:empty_completed::what are key risks?"
    match = re.match(r"^\s*scenario:([a-z_]+)::(.*)$", query, flags=re.IGNORECASE)
    if not match:
        return None, query
    return match.group(1).strip().lower(), match.group(2).strip()


class MockRetrievalEngine:
    def __init__(self, scenario: str, seed_salt: str = "finrisk") -> None:
        self.scenario = scenario.strip().lower()
        self.seed_salt = seed_salt.strip() or "finrisk"

    def retrieve(self, ticker: str, query: str) -> MockRetrievalResult:
        scenario_override, clean_query = _extract_scenario_override(query)
        scenario = self._normalize_scenario(scenario_override or self.scenario)

        if scenario == "failed_retrieval":
            raise MockRetrievalError("Mock retrieval failed (scenario=failed_retrieval)", status_code=502)
        if scenario == "limit_reached":
            raise MockRetrievalError("LimitReached", status_code=429)

        retrieval_id = f"sr-mock-{uuid4().hex[:18]}"
        doc_id = f"pi-mock-{ticker.lower()}"

        seed = _stable_seed(self.seed_salt, ticker, clean_query, scenario)
        rng = random.Random(seed)
        faker = self._make_faker(seed, rng)

        processing_polls = rng.randint(3, 6) if scenario == "slow_processing" else 1

        if scenario == "empty_completed":
            raw_nodes: list[dict] = []
        else:
            raw_nodes = self._build_raw_nodes(
                ticker=ticker.upper(),
                query=clean_query,
                rng=rng,
                faker=faker,
                scenario=scenario,
            )

        nodes = normalize_pageindex_nodes(ticker.upper(), raw_nodes)

        return MockRetrievalResult(
            retrieval_id=retrieval_id,
            doc_id=doc_id,
            status="completed",
            query=clean_query,
            raw_nodes=raw_nodes,
            nodes=nodes,
            scenario=scenario,
            processing_polls=processing_polls,
        )

    def _normalize_scenario(self, scenario: str) -> MockScenario:
        if scenario in SUPPORTED_SCENARIOS:
            return scenario  # type: ignore[return-value]
        return "happy_path"

    def _make_faker(self, seed: int, rng: random.Random):
        if Faker is None:
            return _MiniFaker(rng)
        faker = Faker()
        faker.seed_instance(seed)
        return faker

    def _build_raw_nodes(
        self,
        ticker: str,
        query: str,
        rng: random.Random,
        faker,
        scenario: MockScenario,
    ) -> list[dict]:
        if scenario == "long_context":
            node_count = rng.randint(9, 12)
        elif scenario == "mixed_relevance":
            node_count = rng.randint(6, 9)
        else:
            node_count = rng.randint(4, 8)

        focus = _focus_phrase(query)
        base_page = 12 + rng.randint(0, 5)

        node_ids = [f"{idx + 1:04d}" for idx in range(node_count)]
        raw_nodes: list[dict] = []

        for idx, node_id in enumerate(node_ids):
            topic = TOPIC_LIBRARY[idx % len(TOPIC_LIBRARY)]
            relevant_count = 1
            if scenario in {"happy_path", "slow_processing", "mixed_relevance"} and idx % 3 == 0:
                relevant_count = 2
            if scenario == "long_context":
                relevant_count = 2 + (1 if idx % 2 == 0 else 0)

            relevant_contents = []
            for content_index in range(relevant_count):
                page_index = base_page + idx * 2 + content_index
                text = self._compose_content(
                    ticker=ticker,
                    focus=focus,
                    topic=topic,
                    query=query,
                    rng=rng,
                    faker=faker,
                    mixed_relevance=(scenario == "mixed_relevance"),
                    long_context=(scenario == "long_context"),
                )
                relevant_contents.append(
                    {
                        "content_index": content_index,
                        "page_index": page_index,
                        "relevant_content": text,
                    }
                )

            raw_nodes.append(
                {
                    "title": topic["title"],
                    "node_id": node_id,
                    "parent_node_id": None,
                    "children_node_ids": [],
                    "next_node_id": node_ids[idx + 1] if idx + 1 < len(node_ids) else None,
                    "prev_node_id": node_ids[idx - 1] if idx > 0 else None,
                    "path": topic["path"],
                    "text": "",
                    "relevant_contents": relevant_contents,
                }
            )

        return raw_nodes

    def _compose_content(
        self,
        ticker: str,
        focus: str,
        topic: dict,
        query: str,
        rng: random.Random,
        faker,
        mixed_relevance: bool,
        long_context: bool,
    ) -> str:
        if mixed_relevance and rng.random() < 0.32:
            return (
                f"Context note: {faker.company()} updated internal reporting rhythms in {faker.city()}. "
                f"This disclosure has weak direct relevance to '{query}'."
            )

        template = rng.choice(topic["templates"])
        rendered = template.format(
            ticker=ticker,
            focus=focus,
            region=faker.region() if hasattr(faker, "region") else "global markets",
        )

        sentence_two = (
            f"Supporting detail from {faker.country()} and {faker.city()} operations indicates "
            f"continued dependence on third-party controls and execution quality."
        )

        if not long_context:
            return f"{rendered} {sentence_two}"

        sentence_three = (
            f"The filing also describes scenario planning assumptions, governance checkpoints, and "
            f"contingency actions that may influence timeline and cost outcomes under stressed conditions."
        )
        sentence_four = faker.sentence(nb_words=16)
        return f"{rendered} {sentence_two} {sentence_three} {sentence_four}"
