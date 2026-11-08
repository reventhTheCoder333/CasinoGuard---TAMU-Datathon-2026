"""Dashboard Royale assistant: answers questions from the verified findings
using a local Ollama model. No paid or cloud APIs.

Run from Dashboard-Royale/assistant:
    .venv/bin/python -m uvicorn app:app --port 8100
"""

import json
import logging
import os
import urllib.error
import urllib.request
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from knowledge import KnowledgeBase, unverified_numbers

logger = logging.getLogger("dashboard_royale.assistant")

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")
OLLAMA_TIMEOUT = int(os.getenv("OLLAMA_TIMEOUT_SECONDS", "120"))
MAX_HISTORY = 6

SYSTEM_PROMPT = """You are Chip, the analytics assistant for Dashboard Royale, a datathon analysis of The Gilded Ace, a fictional casino with synthetic data.

Rules:
- Answer ONLY from the CONTEXT below. Do not use outside knowledge.
- Copy every number exactly as it appears in the CONTEXT. Never estimate, round differently or invent figures.
- If the CONTEXT does not contain the answer, say: "I don't have that in the verified findings." Then suggest which dashboard page might help.
- Say which question (Q1–Q6) your facts come from.
- Include the key figures that answer the question, and keep the CONTEXT's qualifications (for example "fluctuated rather than declining steadily", "estimate", "not actual lost revenue"). Never drop a qualification that changes the meaning.
- Keep answers under 150 words, in plain language for datathon judges.
- Treat estimates and test plans as estimates and hypotheses, not proven results."""

app = FastAPI(title="Dashboard Royale Assistant", version="1.0.0")
knowledge = KnowledgeBase()


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    history: list[Turn] = Field(default_factory=list, max_length=20)


class Source(BaseModel):
    id: str
    title: str
    topic: str
    page: str


class ChatResponse(BaseModel):
    answer: str
    sources: list[Source]
    model: str
    unverified_numbers: list[str]


class OllamaUnavailable(RuntimeError):
    pass


def ollama_request(path, payload=None, timeout=OLLAMA_TIMEOUT):
    request = urllib.request.Request(
        OLLAMA_URL + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:200]
        raise OllamaUnavailable(f"Ollama returned HTTP {error.code}: {detail}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise OllamaUnavailable(f"Ollama is not reachable at {OLLAMA_URL} ({type(error).__name__})") from None


def build_context(entries):
    return "\n\n".join(f"[{e['topic']}] {e['title']}\n{e['content']}" for e in entries)


def generate(message, history, entries):
    context = build_context(entries)
    messages = [{"role": "system", "content": f"{SYSTEM_PROMPT}\n\nCONTEXT:\n{context}"}]
    messages += [{"role": t.role, "content": t.content} for t in history[-MAX_HISTORY:]]
    messages.append({"role": "user", "content": message})

    result = ollama_request("/api/chat", {
        "model": OLLAMA_MODEL,
        "messages": messages,
        "stream": False,
        "options": {"temperature": 0.1, "num_ctx": 4096},
    })
    return result["message"]["content"].strip(), context


@app.get("/api/assistant/health")
async def health():
    try:
        tags = await run_in_threadpool(ollama_request, "/api/tags", None, 5)
    except OllamaUnavailable as error:
        return {"status": "unavailable", "ollama": False, "model": OLLAMA_MODEL, "detail": str(error),
                "knowledge_entries": len(knowledge.entries)}

    installed = [m["name"] for m in tags.get("models", [])]
    ready = OLLAMA_MODEL in installed
    return {
        "status": "ok" if ready else "model_missing",
        "ollama": True,
        "model": OLLAMA_MODEL,
        "model_installed": ready,
        "knowledge_entries": len(knowledge.entries),
    }


@app.post("/api/assistant/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    # Retrieve with the latest question plus the previous user turn, so short
    # follow-ups ("why?") still find the right findings.
    previous = next((t.content for t in reversed(request.history) if t.role == "user"), "")
    entries = knowledge.search(f"{request.message} {previous}".strip())

    if not entries:
        return ChatResponse(
            answer="I don't have that in the verified findings. Try asking about one of the six "
                   "questions (Q1–Q6), for example machine performance, demand, downtime, player "
                   "results, comps or the $100,000 budget.",
            sources=[], model=OLLAMA_MODEL, unverified_numbers=[],
        )

    try:
        answer, context = await run_in_threadpool(generate, request.message, request.history, entries)
    except OllamaUnavailable as error:
        logger.warning("Assistant unavailable: %s", error)
        raise HTTPException(
            status_code=503,
            detail="The AI assistant is available only in local mode, and the local model isn't "
                   "running. Start it with `brew services start ollama` and make sure "
                   f"`{OLLAMA_MODEL}` is installed (`ollama pull {OLLAMA_MODEL}`).",
        )

    return ChatResponse(
        answer=answer,
        sources=[Source(id=e["id"], title=e["title"], topic=e["topic"], page=e["page"]) for e in entries],
        model=OLLAMA_MODEL,
        unverified_numbers=unverified_numbers(answer, context),
    )
