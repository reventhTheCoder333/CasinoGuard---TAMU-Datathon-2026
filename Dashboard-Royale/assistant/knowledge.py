"""Keyword retrieval over the knowledge base, and a check on numbers in answers.

The knowledge base is small (a few dozen entries), so a weighted keyword
score is enough; no embeddings or vector database are needed.
"""

import json
import math
import re
from collections import Counter
from pathlib import Path

KNOWLEDGE_PATH = Path(__file__).resolve().parent / "knowledge_base.json"

STOPWORDS = set("""
a an and are as at be by did do does for from how i in is it its me of on or our that the this
to was we were what when where which who why will with would you your about can could tell much
many show give there their they them than then so if any all
""".split())

QUESTION_REF = re.compile(r"\b(?:q|question)\s*([1-6])\b", re.IGNORECASE)


def tokenize(text):
    words = re.findall(r"[a-z0-9][a-z0-9\-]*", text.lower())
    return [w for w in words if w not in STOPWORDS and len(w) > 1]


class KnowledgeBase:

    def __init__(self, path=KNOWLEDGE_PATH):
        data = json.loads(Path(path).read_text())
        self.entries = data["entries"]
        self._docs = []

        for entry in self.entries:
            # Titles and keywords count more than body text.
            tokens = Counter(tokenize(entry["content"]))
            for word in tokenize(entry["title"] + " " + " ".join(entry["keywords"])):
                tokens[word] += 3
            self._docs.append(tokens)

        document_frequency = Counter(w for doc in self._docs for w in doc)
        total = len(self._docs)
        self._idf = {w: math.log(1 + total / n) for w, n in document_frequency.items()}

    def search(self, query, limit=4):
        """Return the most relevant entries, best first."""
        terms = tokenize(query)
        topics = {f"Q{n}" for n in QUESTION_REF.findall(query)}
        scored = []

        for entry, doc in zip(self.entries, self._docs):
            score = sum(self._idf.get(t, 0) * math.log(1 + doc.get(t, 0)) for t in terms)
            if entry["topic"] in topics:
                score += 10  # An explicit "Q3" means the user wants that question.
            if score > 0:
                scored.append((score, entry))

        scored.sort(key=lambda item: -item[0])
        results = [entry for _, entry in scored[:limit]]

        # Always include the main answer for any question the user named.
        for topic in sorted(topics):
            main = next((e for e in self.entries if e["topic"] == topic and e["id"].endswith(("-answer", "-plan"))), None)
            if main and main not in results:
                results = [main] + results[: limit - 1]

        return results


# ---------------------------------------------------------------------------
# Number check: flag figures in an answer that do not appear in its context.
# ---------------------------------------------------------------------------

NUMBER = re.compile(r"(?<![A-Za-z])\$?(\d[\d,]*(?:\.\d+)?)\s*(%|percent|million|m\b|k\b|thousand|billion|bn)?", re.IGNORECASE)
MULTIPLIERS = {"million": 1e6, "m": 1e6, "k": 1e3, "thousand": 1e3, "billion": 1e9, "bn": 1e9}


def _numbers(text):
    text = re.sub(r"\b[QA]-?[A-Z0-9]*\d\b|\bQ[1-6]\b|\b20\d\d-\d\d(-\d\d)?\b|\bM-\d+\b", " ", text)
    values = []

    for raw, unit in NUMBER.findall(text):
        try:
            value = float(raw.replace(",", ""))
        except ValueError:
            continue
        scale = MULTIPLIERS.get((unit or "").lower(), 1)
        decimals = len(raw.split(".")[1]) if "." in raw else 0
        values.append((raw + (unit or ""), value * scale, scale, decimals))

    return values


def _matches(value, scale, decimals, known):
    """True if `known`, written at the answer's precision, gives `value`."""
    shown = value / scale
    exact = known / scale
    factor = 10 ** decimals
    candidates = {round(exact, decimals), math.trunc(exact * factor) / factor}
    return any(abs(shown - c) < 0.5 / factor / 10 for c in candidates)


def unverified_numbers(answer, context):
    """Numbers in the answer that match nothing in the context.

    A number passes if some context value, rounded or truncated to the
    precision the answer uses, equals it: "$15.6 million" matches
    $15,585,460.60, but "$99,999" does not match $100,000.
    """
    known = [value for _, value, _, _ in _numbers(context)]
    flagged = []

    for label, value, scale, decimals in _numbers(answer):
        if value <= 31 and float(value).is_integer():
            continue  # Small counts, days and ordinals are too ambiguous to check.
        if not any(_matches(value, scale, decimals, k) for k in known):
            flagged.append(label.strip())

    return sorted(set(flagged))
