"""Phase 4a gate: pass/fail is a pure function of (answer, rule), never stored.
The same stored answer must score differently when the rule differs."""
import pytest
from app.compliance import evaluate_value, evaluate_question, evaluate_response


def test_operators_numeric():
    assert evaluate_value(5, {"operator": ">=", "value": 4}) is True
    assert evaluate_value(3, {"operator": ">=", "value": 4}) is False
    assert evaluate_value(3, {"operator": "<", "value": 4}) is True
    assert evaluate_value(4, {"operator": "==", "value": 4}) is True
    assert evaluate_value(4, {"operator": "!=", "value": 4}) is False


def test_operators_membership():
    assert evaluate_value("clean", {"operator": "in", "value": ["clean", "tidy"]}) is True
    assert evaluate_value("dirty", {"operator": "in", "value": ["clean", "tidy"]}) is False
    assert evaluate_value("dirty", {"operator": "not_in", "value": ["clean"]}) is True


def test_blank_or_no_rule_is_not_counted():
    assert evaluate_value(None, {"operator": ">=", "value": 4}) is None
    assert evaluate_value(5, None) is None


def test_question_each_mode():
    rule = {"operator": ">=", "value": 4}
    assert evaluate_question([5, 6, 4], rule, per_sku=True, pass_scope="each") is True
    assert evaluate_question([5, 2, 4], rule, per_sku=True, pass_scope="each") is False
    assert evaluate_question([5, None], rule, per_sku=True, pass_scope="each") is True
    assert evaluate_question([None, None], rule, per_sku=True, pass_scope="each") is None


def test_question_total_mode():
    rule = {"operator": ">=", "value": 12}
    assert evaluate_question([5, 4, 4], rule, per_sku=True, pass_scope="total") is True
    assert evaluate_question([5, 4, 2], rule, per_sku=True, pass_scope="total") is False


def test_same_answer_different_rule_flips_verdict():
    answer = 4
    assert evaluate_value(answer, {"operator": ">=", "value": 4}) is True
    assert evaluate_value(answer, {"operator": ">=", "value": 6}) is False


def test_evaluate_response_overall():
    questions = [
        {"id": "q1", "type": "number", "perSku": True, "passScope": "each",
         "pass": {"operator": ">=", "value": 4}},
        {"id": "q2", "type": "boolean", "pass": {"operator": "==", "value": True}},
        {"id": "q3", "type": "text"},
    ]
    items = [
        {"question_id": "q1", "sku_id": "s1", "value": 5},
        {"question_id": "q1", "sku_id": "s2", "value": 3},
        {"question_id": "q2", "sku_id": None, "value": True},
        {"question_id": "q3", "sku_id": None, "value": "note"},
    ]
    scored = evaluate_response(questions, items)
    assert scored["questions"]["q1"] is False
    assert scored["questions"]["q2"] is True
    assert scored["questions"]["q3"] is None
    assert scored["overall"] is False
    verdicts = {(i["question_id"], i["value"]): i["pass"] for i in scored["items"]}
    assert verdicts[("q1", 5)] is True
    assert verdicts[("q1", 3)] is False


def test_evaluate_response_overall_pass_and_none():
    questions = [{"id": "q1", "type": "number",
                  "pass": {"operator": ">=", "value": 4}}]
    assert evaluate_response(questions, [{"question_id": "q1", "sku_id": None, "value": 5}])["overall"] is True
    assert evaluate_response([{"id": "q1", "type": "text"}],
                             [{"question_id": "q1", "sku_id": None, "value": "x"}])["overall"] is None


def test_unknown_operator_raises():
    with pytest.raises(ValueError):
        evaluate_value(5, {"operator": "BETWEEN", "value": [1, 10]})


def test_boolean_not_coerced_to_number():
    # Python's True == 1 trap: a boolean answer must NOT satisfy a numeric rule.
    assert evaluate_value(True, {"operator": ">=", "value": 1}) is False
    # but a genuine boolean rule still works
    assert evaluate_value(True, {"operator": "==", "value": True}) is True
