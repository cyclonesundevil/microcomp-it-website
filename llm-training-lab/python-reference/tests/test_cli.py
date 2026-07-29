from __future__ import annotations

import json

from microcomp_llm.cli import main


def test_count_command_reports_layer_breakdown(capsys) -> None:
    result = main(
        [
            "count",
            "--vocab-size",
            "35",
            "--context-length",
            "16",
            "--embedding-dim",
            "16",
            "--attention-heads",
            "2",
            "--transformer-blocks",
            "1",
            "--feed-forward-dim",
            "32",
        ]
    )
    assert result == 0
    output = json.loads(capsys.readouterr().out)
    assert output["total"] == 3_667
    assert output["layers"]["blocks.0.attention.qkv"] == 816


def test_count_command_rejects_over_limit(capsys) -> None:
    result = main(
        [
            "count",
            "--vocab-size",
            "256",
            "--context-length",
            "256",
            "--embedding-dim",
            "128",
            "--attention-heads",
            "8",
            "--transformer-blocks",
            "4",
            "--feed-forward-dim",
            "512",
        ]
    )
    assert result == 2
    assert "maximum" in capsys.readouterr().err
