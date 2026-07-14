import pytest

from pickmeup.gtfs import GTFSTimeError, format_gtfs_time, gtfs_duration, parse_gtfs_time


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("00:00:00", 0),
        ("06:30:15", 23_415),
        ("24:15:00", 87_300),
        ("27:30:45", 99_045),
    ],
)
def test_parse_gtfs_time(value: str, expected: int) -> None:
    assert parse_gtfs_time(value) == expected
    assert format_gtfs_time(expected) == value


@pytest.mark.parametrize("value", ["", "-01:00:00", "12:60:00", "12:00", "hello"])
def test_parse_gtfs_time_rejects_malformed_values(value: str) -> None:
    with pytest.raises(GTFSTimeError):
        parse_gtfs_time(value)


def test_duration_does_not_wrap_at_midnight() -> None:
    assert gtfs_duration("23:55:00", "24:15:00") == 20 * 60
