# Use the official lightweight Python image.
FROM python:3.10-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user (Hugging Face Spaces runs as user 1000)
RUN useradd -m -u 1000 user
WORKDIR /app

# Copy requirements and install
COPY requirements.txt /app/
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY --chown=user:user . /app

# Ensure required runtime directories exist and have proper permissions
RUN mkdir -p /app/uploads /app/chroma_db && \
    chown -R user:user /app

# Switch to the non-root user
USER user

# Expose Hugging Face's default port
EXPOSE 7860

# Run the application
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
