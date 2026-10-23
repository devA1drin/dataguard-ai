"""Retrieval over the sample privacy-policy markdown docs.

Primary path : sentence-transformers all-MiniLM-L6-v2 embeddings + FAISS (inner product on
               normalized vectors == cosine similarity).
Fallback path: TF-IDF cosine similarity (used if the embedding model or FAISS cannot be
               loaded, e.g. no internet to download the model). Set RAG_BACKEND=tfidf to force it.

The assistant is *extractive by default*: it returns the retrieved policy passages
with citations. If OPENAI_API_KEY is set it additionally asks an LLM to summarize
ONLY those passages. If retrieval confidence is below a threshold it refuses with
"not covered by policy" instead of guessing.
"""
from __future__ import annotations

import json
import logging
import os
import re
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np

log = logging.getLogger("rag")
def _policy_dir() -> Path:
    """POLICY_DIR env, else the repo's data/policies (Docker/local), else the copy bundled
    inside ml-service/policies (Vercel: a service only ships files under its own root)."""
    if os.getenv("POLICY_DIR"):
        return Path(os.environ["POLICY_DIR"])
    here = Path(__file__).resolve()
    for cand in (here.parents[2] / "data" / "policies", here.parents[1] / "policies"):
        if cand.is_dir() and any(cand.glob("*.md")):
            return cand
    return here.parents[1] / "policies"


POLICY_DIR = _policy_dir()


@dataclass
class Chunk:
    doc: str
    title: str
    section: str
    text: str


def load_chunks(policy_dir: Path = POLICY_DIR) -> list[Chunk]:
    """Split each markdown doc into one chunk per '## ' section."""
    chunks: list[Chunk] = []
    for path in sorted(policy_dir.glob("*.md")):
        raw = path.read_text(encoding="utf-8")
        title = re.search(r"^# (.+)$", raw, re.M).group(1).strip()
        for part in re.split(r"^## ", raw, flags=re.M)[1:]:
            heading, _, body = part.partition("\n")
            body = " ".join(body.split())
            if body:
                chunks.append(Chunk(path.name, title, heading.strip(), body))
    return chunks


# Lexical retrieval can match a single generic word ("year", "time") in an off-topic question.
# In TF-IDF mode a question must therefore also mention a privacy/customer-data topic (prefix
# match on these stems) or share at least two content terms with the best passage.
_TOPIC_STEMS = (
    "privacy", "personal", "data", "information", "info", "consent", "marketing", "email", "sms",
    "newsletter", "promo", "delet", "eras", "remov", "retent", "retain", "keep", "kept", "stor",
    "shar", "third", "partner", "vendor", "access", "request", "correct", "rectif", "updat", "copy",
    "portab", "breach", "leak", "cookie", "track", "account", "order", "purchas", "dpo", "officer",
    "complain", "npc", "right", "withdraw", "opt", "unsubscrib", "profil", "loyalty", "payment",
    "card", "address", "phone", "secur", "protect", "policy", "polici", "sell", "transfer", "process",
    "collect", "cctv", "record", "history", "minor", "child", "notif", "law", "dpa", "republic",
)


def _on_topic(question: str, matched_terms: set[str]) -> bool:
    words = re.findall(r"[a-z]+", question.lower())
    if any(w.startswith(_TOPIC_STEMS) for w in words):
        return True
    return len(matched_terms) >= 2


class PolicyRetriever:
    def __init__(self):
        self.chunks = load_chunks()
        self.backend = "tfidf"
        texts = [f"{c.section}. {c.text}" for c in self.chunks]
        if os.getenv("RAG_BACKEND", "embeddings") != "tfidf":
            try:
                import faiss
                from sentence_transformers import SentenceTransformer
                self.encoder = SentenceTransformer(os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"))
                emb = self.encoder.encode(texts, normalize_embeddings=True).astype("float32")
                self.index = faiss.IndexFlatIP(emb.shape[1])
                self.index.add(emb)
                self.backend = "minilm+faiss"
                # cosine similarity below this -> "not covered by policy"
                self.min_score = float(os.getenv("RAG_MIN_SCORE", "0.40"))
            except Exception as e:  # pragma: no cover - depends on environment
                log.warning("Embedding backend unavailable (%s); falling back to TF-IDF", e)
        # TF-IDF is always built: it is the fallback retriever and, when embeddings are
        # available, a lexical re-ranking signal (hybrid retrieval).
        from sklearn.feature_extraction.text import TfidfVectorizer
        self.vec = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), sublinear_tf=True)
        self.mat = self.vec.fit_transform(texts)
        if self.backend == "tfidf":
            self.min_score = float(os.getenv("RAG_MIN_SCORE_TFIDF", "0.12"))

    def search(self, query: str, k: int = 3) -> list[tuple[Chunk, float]]:
        """Returns (chunk, confidence) pairs. With embeddings: FAISS dense search for
        candidates, re-ranked by 0.75*cosine + 0.25*tfidf; confidence reported = cosine."""
        sims = (self.mat @ self.vec.transform([query]).T).toarray().ravel()
        if self.backend == "minilm+faiss":
            q = self.encoder.encode([query], normalize_embeddings=True).astype("float32")
            scores, idx = self.index.search(q, min(8, len(self.chunks)))
            cand = [(int(i), float(s)) for i, s in zip(idx[0], scores[0]) if i >= 0]
            cand.sort(key=lambda c: -(0.75 * c[1] + 0.25 * sims[c[0]]))
            return [(self.chunks[i], s) for i, s in cand[:k]]
        top = np.argsort(-sims)[:k]
        return [(self.chunks[i], float(sims[i])) for i in top]

    def ask(self, question: str, k: int = 3) -> dict:
        hits = self.search(question, k)
        best = hits[0][1] if hits else 0.0
        citations = [{"doc": c.doc, "title": c.title, "section": c.section, "score": round(s, 3),
                      "passage": c.text} for c, s in hits if s >= self.min_score * 0.8]
        off_topic = False
        if self.backend == "tfidf" and hits:
            q_terms = set(self.vec.build_analyzer()(question)) & set(self.vec.vocabulary_)
            top_i = self.chunks.index(hits[0][0])
            row = self.mat[top_i]
            inv = {v: k for k, v in self.vec.vocabulary_.items() if v in set(row.indices)}
            matched = {t for t in q_terms if " " not in t} & set(inv.values())
            off_topic = not _on_topic(question, matched)
        if best < self.min_score or not citations or off_topic:
            return {"answer": "This question does not appear to be covered by the Acme Retail PH privacy "
                              "policy documents. Please contact the Data Protection Officer for help.",
                    "covered": False, "confidence": round(best, 3), "citations": [],
                    "mode": "refusal", "retrieval_backend": self.backend}
        answer, mode = None, "extractive"
        if os.getenv("OPENAI_API_KEY"):
            answer = _llm_summarize(question, citations)
            mode = "llm_summary" if answer else "extractive"
        if not answer:
            top = citations[0]
            answer = f"According to \"{top['title']}\" — {top['section']}: {top['passage']}"
            # If a second passage is almost as relevant, quote it too (extractive, no generation).
            if len(citations) > 1 and citations[1]["score"] >= top["score"] - 0.05:
                nxt = citations[1]
                answer += f"\n\nAlso relevant — {nxt['section']}: {nxt['passage']}"
        return {"answer": answer, "covered": True, "confidence": round(best, 3), "citations": citations,
                "mode": mode, "retrieval_backend": self.backend}


def _llm_summarize(question: str, citations: list[dict]) -> str | None:
    """Optional: summarize retrieved passages with an OpenAI-compatible chat API.
    The prompt restricts the model to the provided passages. Any failure -> None (extractive fallback)."""
    context = "\n\n".join(f"[{i+1}] {c['title']} / {c['section']}: {c['passage']}" for i, c in enumerate(citations))
    body = {"model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"), "temperature": 0,
            "messages": [{"role": "system", "content": "Answer ONLY from the numbered policy passages. Cite like [1]. "
                          "If the passages do not answer the question, say it is not covered by policy."},
                         {"role": "user", "content": f"Passages:\n{context}\n\nQuestion: {question}"}]}
    req = urllib.request.Request(os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1") + "/chat/completions",
                                 data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json",
                                          "Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)["choices"][0]["message"]["content"].strip()
    except Exception as e:  # pragma: no cover
        log.warning("LLM summarization failed: %s", e)
        return None
