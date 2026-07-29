"""Pre-normalized decoder-only Transformer reference model."""

from __future__ import annotations

import math

import torch
from torch import Tensor, nn
from torch.nn import functional as F

from .config import MAX_TRAINABLE_PARAMETERS, ModelConfig
from .parameters import verify_parameter_count


class CausalSelfAttention(nn.Module):
    def __init__(self, config: ModelConfig) -> None:
        super().__init__()
        self.heads = config.attention_heads
        self.head_dim = config.embedding_dim // config.attention_heads
        width = config.embedding_dim
        self.q_proj = nn.Linear(width, width, bias=True)
        self.k_proj = nn.Linear(width, width, bias=True)
        self.v_proj = nn.Linear(width, width, bias=True)
        self.out_proj = nn.Linear(width, width, bias=True)
        self.attention_dropout = nn.Dropout(config.dropout)
        self.output_dropout = nn.Dropout(config.dropout)
        mask = torch.tril(
            torch.ones(config.context_length, config.context_length, dtype=torch.bool)
        )
        self.register_buffer("causal_mask", mask.view(1, 1, config.context_length, config.context_length))

    def forward(self, inputs: Tensor, *, return_attention: bool = False) -> tuple[Tensor, Tensor | None]:
        batch, sequence, width = inputs.shape

        def split_heads(value: Tensor) -> Tensor:
            return value.view(batch, sequence, self.heads, self.head_dim).transpose(1, 2)

        query = split_heads(self.q_proj(inputs))
        key = split_heads(self.k_proj(inputs))
        value = split_heads(self.v_proj(inputs))
        scores = query @ key.transpose(-2, -1)
        scores = scores / math.sqrt(self.head_dim)
        scores = scores.masked_fill(~self.causal_mask[:, :, :sequence, :sequence], float("-inf"))
        weights = F.softmax(scores, dim=-1)
        weights = self.attention_dropout(weights)
        attended = weights @ value
        attended = attended.transpose(1, 2).contiguous().view(batch, sequence, width)
        output = self.output_dropout(self.out_proj(attended))
        return output, weights if return_attention else None


class DecoderBlock(nn.Module):
    """Pre-norm block: LN → attention → residual, LN → FFN → residual."""

    def __init__(self, config: ModelConfig) -> None:
        super().__init__()
        width = config.embedding_dim
        self.ln1 = nn.LayerNorm(width, eps=1e-5, elementwise_affine=True)
        self.attention = CausalSelfAttention(config)
        self.ln2 = nn.LayerNorm(width, eps=1e-5, elementwise_affine=True)
        self.ff_up = nn.Linear(width, config.feed_forward_dim, bias=True)
        self.ff_down = nn.Linear(config.feed_forward_dim, width, bias=True)
        self.ff_dropout = nn.Dropout(config.dropout)

    def forward(self, inputs: Tensor, *, return_attention: bool = False) -> tuple[Tensor, Tensor | None]:
        attention_output, weights = self.attention(
            self.ln1(inputs), return_attention=return_attention
        )
        hidden = inputs + attention_output
        feed_forward = self.ff_down(
            F.gelu(self.ff_up(self.ln2(hidden)), approximate="none")
        )
        hidden = hidden + self.ff_dropout(feed_forward)
        return hidden, weights


class TinyDecoderLM(nn.Module):
    """Character-level autoregressive model capped at 200,000 parameters."""

    def __init__(self, config: ModelConfig) -> None:
        super().__init__()
        self.config = config
        self.token_embedding = nn.Embedding(config.vocab_size, config.embedding_dim)
        self.position_embedding = nn.Embedding(config.context_length, config.embedding_dim)
        self.embedding_dropout = nn.Dropout(config.dropout)
        self.blocks = nn.ModuleList(
            DecoderBlock(config) for _ in range(config.transformer_blocks)
        )
        self.final_norm = nn.LayerNorm(
            config.embedding_dim, eps=1e-5, elementwise_affine=True
        )
        self.lm_head = nn.Linear(config.embedding_dim, config.vocab_size, bias=True)
        if config.tie_embeddings:
            self.lm_head.weight = self.token_embedding.weight
        self.to(dtype=torch.float32)
        self.apply(self._initialize_weights)
        actual = verify_parameter_count(self, config)
        if actual > MAX_TRAINABLE_PARAMETERS:
            raise ValueError("Actual model parameter count exceeds the hard limit.")

    @staticmethod
    def _initialize_weights(module: nn.Module) -> None:
        if isinstance(module, (nn.Linear, nn.Embedding)):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)
            if isinstance(module, nn.Linear) and module.bias is not None:
                nn.init.zeros_(module.bias)

    def forward(
        self,
        token_ids: Tensor,
        targets: Tensor | None = None,
        *,
        return_attentions: bool = False,
    ) -> tuple[Tensor, Tensor | None, list[Tensor] | None]:
        if token_ids.ndim != 2:
            raise ValueError("token_ids must have shape [batch, sequence].")
        _, sequence = token_ids.shape
        if sequence < 1 or sequence > self.config.context_length:
            raise ValueError(
                f"sequence length must be between 1 and {self.config.context_length}."
            )
        positions = torch.arange(sequence, device=token_ids.device)
        hidden = self.token_embedding(token_ids) + self.position_embedding(positions)
        hidden = self.embedding_dropout(hidden)
        attentions: list[Tensor] = []
        for block in self.blocks:
            hidden, weights = block(hidden, return_attention=return_attentions)
            if weights is not None:
                attentions.append(weights)
        logits = self.lm_head(self.final_norm(hidden))
        loss = None
        if targets is not None:
            if targets.shape != token_ids.shape:
                raise ValueError("targets must match token_ids shape.")
            loss = F.cross_entropy(
                logits.reshape(-1, self.config.vocab_size), targets.reshape(-1)
            )
        return logits, loss, attentions if return_attentions else None
