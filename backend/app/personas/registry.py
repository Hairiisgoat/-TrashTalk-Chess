"""Server-side persona registry binding characters to LLM providers and UI metadata."""

from dataclasses import dataclass

from app.core.config import Settings
from app.schemas.common import GameType, ModelProvider
from app.schemas.persona import PersonaPublicConfig


@dataclass(frozen=True)
class PersonaConfig:
    """Internal persona configuration (prompt rules stay server-side only)."""

    persona_id: str
    name: str
    title: str
    model_provider: ModelProvider
    default_model_name: str
    theme_color: str
    avatar_url: str
    tags: tuple[str, ...]
    supported_games: tuple[GameType, ...]
    greeting: str
    temperature: float = 0.7

    def resolve_model_name(self, settings: Settings) -> str:
        """Resolve the configured model name for this persona's provider."""
        if self.model_provider == ModelProvider.DEEPSEEK:
            return settings.DEEPSEEK_DEFAULT_MODEL or self.default_model_name
        if self.model_provider == ModelProvider.OPENAI:
            return settings.OPENAI_DEFAULT_MODEL or self.default_model_name
        if self.model_provider == ModelProvider.ANTHROPIC:
            return settings.ANTHROPIC_DEFAULT_MODEL or self.default_model_name
        return self.default_model_name

    def to_public(self, settings: Settings) -> PersonaPublicConfig:
        """Convert to public API representation without exposing prompts."""
        return PersonaPublicConfig(
            persona_id=self.persona_id,
            name=self.name,
            title=self.title,
            model_provider=self.model_provider,
            model_name=self.resolve_model_name(settings),
            theme_color=self.theme_color,
            avatar_url=self.avatar_url,
            tags=list(self.tags),
            supported_games=list(self.supported_games),
            greeting=self.greeting,
            is_enabled=settings.is_provider_configured(self.model_provider.value),
        )


DEFAULT_PERSONAS: dict[str, PersonaConfig] = {
    "deepseek_master": PersonaConfig(
        persona_id="deepseek_master",
        name="毒舌棋圣·深求",
        title="算无遗策的国风毒舌老前辈",
        model_provider=ModelProvider.DEEPSEEK,
        default_model_name="deepseek-chat",
        theme_color="#2563EB",
        avatar_url="/static/avatars/deepseek_master.png",
        tags=("国风毒舌", "算路深沉", "DeepSeek"),
        supported_games=(GameType.XIANGQI, GameType.CHESS),
        greeting="小友请落子吧，让我看看你的棋艺配不配得上这盘棋。",
        temperature=0.75,
    ),
    "gpt_showman": PersonaConfig(
        persona_id="gpt_showman",
        name="狂傲嘴炮·G酱",
        title="情绪价值拉满的脱口秀棋手",
        model_provider=ModelProvider.OPENAI,
        default_model_name="gpt-4o-mini",
        theme_color="#10B981",
        avatar_url="/static/avatars/gpt_showman.png",
        tags=("疯狂玩梗", "话痨挑衅", "GPT"),
        supported_games=(GameType.XIANGQI, GameType.CHESS),
        greeting="Oh! 准备好被我的脑回路碾压了吗？请开始你的表演！",
        temperature=0.85,
    ),
    "claude_zen": PersonaConfig(
        persona_id="claude_zen",
        name="腹黑学者·克劳德",
        title="表面温和实则扎心的心理学大师",
        model_provider=ModelProvider.ANTHROPIC,
        default_model_name="claude-3-5-sonnet-latest",
        theme_color="#D97706",
        avatar_url="/static/avatars/claude_zen.png",
        tags=("温柔刀", "哲学嘲讽", "Claude"),
        supported_games=(GameType.XIANGQI, GameType.CHESS),
        greeting="下棋如同修行，不过你这一步……似乎暴露了些许焦躁呢。",
        temperature=0.7,
    ),
}


def get_persona(persona_id: str) -> PersonaConfig | None:
    """Lookup persona configuration by ID."""
    return DEFAULT_PERSONAS.get(persona_id)


def list_personas(
    settings: Settings,
    game_type: GameType | None = None,
) -> list[PersonaPublicConfig]:
    """List public persona configurations, optionally filtered by supported game type."""
    result: list[PersonaPublicConfig] = []
    for persona in DEFAULT_PERSONAS.values():
        if game_type is not None and game_type not in persona.supported_games:
            continue
        result.append(persona.to_public(settings))
    return result
