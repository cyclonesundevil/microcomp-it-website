from rsm.total_inversion_audit import AuditRecord, _summarize


def test_total_inversion_summary_swaps_non_push_results():
    records = [
        AuditRecord("g1", 2025, 1, "REG", "fixture.csv", "WIN", 44.5, 3.0, "HIGH"),
        AuditRecord("g2", 2025, 1, "REG", "fixture.csv", "LOSS", 44.5, -2.0, "LOW"),
        AuditRecord("g3", 2025, 1, "REG", "fixture.csv", "LOSS", 44.5, 5.0, "MEDIUM"),
        AuditRecord("g4", 2025, 1, "REG", "fixture.csv", "PUSH", 44.5, 0.0, "LOW"),
    ]

    summary = _summarize(records, "fixture", "all")

    assert summary["original_wins"] == 1
    assert summary["original_losses"] == 2
    assert summary["pushes"] == 1
    assert summary["original_accuracy"] == 1 / 3
    assert summary["inverted_wins"] == 2
    assert summary["inverted_losses"] == 1
    assert summary["inverted_accuracy"] == 2 / 3
