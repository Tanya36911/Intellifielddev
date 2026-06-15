"""The config helper must fail loudly when a required secret is missing, rather
than silently falling back to a weak default."""
import pytest

from app.config import _required


def test_required_returns_the_value(monkeypatch):
    monkeypatch.setenv("INTELLI_TEST_VAR", "hello")
    assert _required("INTELLI_TEST_VAR") == "hello"


def test_required_raises_when_missing(monkeypatch):
    monkeypatch.delenv("INTELLI_TEST_VAR", raising=False)
    with pytest.raises(RuntimeError):
        _required("INTELLI_TEST_VAR")


def test_required_raises_when_empty(monkeypatch):
    monkeypatch.setenv("INTELLI_TEST_VAR", "")
    with pytest.raises(RuntimeError):
        _required("INTELLI_TEST_VAR")
