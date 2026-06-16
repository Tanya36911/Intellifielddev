"""Pure pass/fail scoring. No database, no request state: given raw answer
values and a question's pass rule, decide pass / fail / not-counted.

Pass/fail is NEVER stored; it is recomputed here on every read, so changing a
rule changes the verdict immediately. That property is the Phase 4a gate.
"""

_NUMERIC_OPS = {
    ">=": lambda a, b: a >= b,
    "<=": lambda a, b: a <= b,
    ">": lambda a, b: a > b,
    "<": lambda a, b: a < b,
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
}


def _compare(value, operator, target) -> bool:
    if operator in _NUMERIC_OPS:
        # Guard Python's truthiness trap (True == 1, False == 0): a numeric
        # comparison between a boolean and a non-boolean is a type mismatch, so
        # treat it as not passing rather than silently coercing. A genuine
        # boolean rule (e.g. == True against a boolean answer) still works,
        # because both sides are bool.
        if isinstance(value, bool) != isinstance(target, bool):
            return False
        return _NUMERIC_OPS[operator](value, target)
    if operator == "in":
        return value in target
    if operator == "not_in":
        return value not in target
    raise ValueError(f"unknown operator: {operator}")


def evaluate_value(value, rule) -> bool | None:
    """One answer value against one pass rule. None = not counted (no rule, or
    a blank answer)."""
    if rule is None or value is None:
        return None
    return _compare(value, rule["operator"], rule["value"])


def evaluate_question(values, rule, per_sku, pass_scope) -> bool | None:
    """All the answer values for one question (a per-product question has
    several) against its pass rule. None = not counted (no rule or all blank).
    'total' sums the values first (per-product only); every other case ('each',
    or any non-per-product question, which has a single value) requires each
    answered value to pass."""
    if rule is None:
        return None
    present = [v for v in values if v is not None]
    if not present:
        return None
    if per_sku and pass_scope == "total":
        return _compare(sum(present), rule["operator"], rule["value"])
    return all(_compare(v, rule["operator"], rule["value"]) for v in present)


def evaluate_response(questions, items) -> dict:
    """Score a whole response. questions = the version's question dicts;
    items = list of {question_id, sku_id, value}. Returns:
      - items: each item with an added per-item 'pass' (bool/None),
      - questions: {question_id: verdict bool/None},
      - overall: True only if every countable question passes; None if nothing
        countable; False if any countable question fails.
    """
    by_q: dict[str, list] = {}
    for it in items:
        by_q.setdefault(it["question_id"], []).append(it)
    q_index = {q["id"]: q for q in questions}

    question_verdicts = {}
    for q in questions:
        rule = q.get("pass")
        per_sku = q.get("perSku", False)
        pass_scope = q.get("passScope", "each")
        values = [i["value"] for i in by_q.get(q["id"], [])]
        question_verdicts[q["id"]] = evaluate_question(values, rule, per_sku, pass_scope)

    item_verdicts = []
    for it in items:
        question = q_index.get(it["question_id"], {})
        item_verdicts.append({**it, "pass": evaluate_value(it["value"], question.get("pass"))})

    countable = [v for v in question_verdicts.values() if v is not None]
    overall = all(countable) if countable else None
    return {"items": item_verdicts, "questions": question_verdicts, "overall": overall}
