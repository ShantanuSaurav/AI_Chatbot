---
title: PDF Copilot Chatbot
emoji: 📄
colorFrom: green
colorTo: blue
sdk: docker
pinned: false
license: mit
---

# PDF Copilot - Intelligent RAG Document Chatbot

PDF Copilot is a powerful Retrieval-Augmented Generation (RAG) chatbot that allows users to seamlessly upload PDF documents and ask questions across them. It uses advanced machine learning models to extract paragraphs relevant to your questions and synthesizes natural language answers.

## 🚀 Features

- **Multi-Document Support:** Upload multiple PDFs and maintain an organized document library in the sidebar.
- **Global & Specific Scope:**
  - *Global Search:* Ask questions across your entire library of uploaded PDFs simultaneously. The bot will intelligently fetch relevant sections from multiple documents to construct a comprehensive answer.
  - *Specific Document Scope:* Click on any document in your library to open a dedicated, side-by-side interactive PDF reader. Questions asked in this view are strictly isolated to the selected document.
- **Strict Fact-Binding:** The AI is strictly prompted to only answer based on the provided document context. It will not hallucinate answers from its pre-trained knowledge base.
- **Beautiful Mathematical Rendering:** Fully supports and elegantly renders complex mathematical formulas, equations, and expressions using KaTeX.
- **Session Privacy:** Uploads and chat logs are completely isolated per session. When you close the browser tab, a cleanup beacon securely wipes your temporary files and vector embeddings.

## 🛠️ Technology Stack

- **Backend Framework:** FastAPI
- **LLM AI Provider:** Google Gemini (Gemini 2.5 Flash) via \langchain-google-genai- **Embeddings:** HuggingFace \sentence-transformers/all-MiniLM-L6-v2\ (Local generation)
- **Vector Database:** ChromaDB
- **Frontend UI:** Vanilla JavaScript, HTML, CSS with Lucide Icons and PDF.js

## 💻 Local Installation

To run this project locally on your machine:

1. **Clone the repository:**
   \\ash
   git clone https://github.com/ShantanuSaurav/AI_Chatbot.git
   cd AI_Chatbot
   \
2. **Set up a virtual environment (Optional but recommended):**
   \\ash
   python -m venv venv
   source venv/bin/activate  # On Windows use: venv\Scriptsctivate
   \
3. **Install the dependencies:**
   \\ash
   pip install -r requirements.txt
   \
4. **Configure your API Keys:**
   Create a folder named \ackend\ and a file inside it called \.env\.
   \\ash
   mkdir backend
   touch backend/.env
   \   Add your Google Gemini API key to the \.env\ file:
   \\env
   GEMINI_API_KEY=your_gemini_api_key_here
   \
5. **Run the application:**
   \\ash
   python app.py
   \   The app will start on \http://127.0.0.1:8000\.

## ☁️ Hugging Face Space Deployment

This application is fully compatible with Hugging Face Spaces using the Docker SDK. To deploy it:
1. Create a new Space on Hugging Face (SDK: Docker).
2. Push this repository's files to the Space.
3. Go to the Space **Settings** -> **Variables and secrets**.
4. Create a new Secret named \GEMINI_API_KEY\ and paste your Google Gemini API key.
5. The Space will automatically build and securely inject the keys into the application.

## 📜 License

This project is licensed under the MIT License.
