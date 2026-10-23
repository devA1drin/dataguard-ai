# Build context: repository root (needs data/ for the generator and policy docs)
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HOME=/app/.hf
COPY ml-service/requirements.txt ml-service/requirements-extras.txt ml-service/
# CPU-only torch keeps the image much smaller than the default CUDA build
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch \
 && pip install --no-cache-dir -r ml-service/requirements.txt -r ml-service/requirements-extras.txt
COPY data/generate.py data/generate.py
COPY data/policies data/policies
COPY ml-service ml-service
WORKDIR /app/ml-service
# Generate synthetic data + train + evaluate at build time (takes ~10 s)
RUN python -m training.run_all
# Try to cache the embedding model in the image; if there is no network the
# service falls back to TF-IDF retrieval at runtime.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')" || echo "embedding model not downloaded - TF-IDF fallback will be used"
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
