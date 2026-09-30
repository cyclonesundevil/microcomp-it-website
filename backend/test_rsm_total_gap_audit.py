from rsm.total_gap_audit import TotalGapRecord, is_under_watch, summarize_records, total_gap_bucket


def _record(total_gap, actual_total=40.0, market_total=42.0):
    return TotalGapRecord(
        game_id=f"game-{total_gap}",
        season=2025,
        week=1,
        game_type="REG",
        source_artifact="fixture.csv",
        rsm_predicted_total=market_total - total_gap,
        market_total=market_total,
        actual_total=actual_total,
        total_gap=total_gap,
        original_ou_pick="UNDER",
        original_ou_result="WIN",
        prediction_confidence="LOW",
    )


def test_total_gap_bucket_boundaries():
    assert total_gap_bucket(_record(-0.1)) == "market below RSM"
    assert total_gap_bucket(_record(0.0)) == "0 to +1.5"
    assert total_gap_bucket(_record(1.49)) == "0 to +1.5"
    assert total_gap_bucket(_record(1.5)) == "+1.5 to +3.5"
    assert total_gap_bucket(_record(3.49)) == "+1.5 to +3.5"
    assert total_gap_bucket(_record(3.5)) == "+3.5 to +5.5"
    assert total_gap_bucket(_record(5.49)) == "+3.5 to +5.5"
    assert total_gap_bucket(_record(5.5)) == "+5.5 or greater"


def test_under_watch_is_only_the_narrow_positive_gap_bucket():
    assert is_under_watch(_record(-0.01)) is False
    assert is_under_watch(_record(0.0)) is True
    assert is_under_watch(_record(1.49)) is True
    assert is_under_watch(_record(1.5)) is False


def test_summarize_records_reports_under_accuracy_and_averages():
    records = [
        _record(2.0, actual_total=39.0, market_total=42.0),  # Under
        _record(3.0, actual_total=45.0, market_total=42.0),  # Over
        _record(4.0, actual_total=42.0, market_total=42.0),  # Push
    ]

    summary = summarize_records(records, "fixture", "all")

    assert summary["games"] == 3
    assert summary["under_wins"] == 1
    assert summary["over_wins"] == 1
    assert summary["pushes"] == 1
    assert summary["under_accuracy"] == 0.5
    assert summary["average_market_total"] == 42.0
    assert summary["average_total_gap"] == 3.0
    assert summary["average_rsm_total"] == 39.0
