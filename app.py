import os
import io
import json
import uuid
from datetime import datetime
from fastapi import FastAPI, UploadFile, File, HTTPException, Header
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel
from typing import List, Optional
from dotenv import load_dotenv

# LangChain, Chroma & Gemini imports
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_classic.chains import create_retrieval_chain
from langchain_classic.chains.combine_documents import create_stuff_documents_chain
from langchain_community.vectorstores import Chroma
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_google_genai import ChatGoogleGenerativeAI
from PyPDF2 import PdfReader
from langchain_text_splitters import RecursiveCharacterTextSplitter

# Load environment configuration from backend/.env (if present)
env_path = os.path.join("backend", ".env")
if os.path.exists(env_path):
    load_dotenv(dotenv_path=env_path)
else:
    load_dotenv()

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
HF_TOKEN = os.environ.get("HF_TOKEN", "")
HF_MODEL_ID = os.environ.get("HF_MODEL_ID", "Qwen/Qwen2.5-72B-Instruct")

# Initialize FastAPI App
app = FastAPI(title="PDF Copilot API")

# Ensure static and uploads directories exist
os.makedirs("static", exist_ok=True)
os.makedirs("uploads", exist_ok=True)

# Mount static folder for CSS, JS, and Assets
app.mount("/static", StaticFiles(directory="static"), name="static")

# Local JSON Database Path
DB_FILE = "db.json"

def load_db():
    if not os.path.exists(DB_FILE):
        with open(DB_FILE, "w") as f:
            json.dump({"documents": [], "chats": {}}, f)
    with open(DB_FILE, "r") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return {"documents": [], "chats": {}}

def save_db(db_data):
    with open(DB_FILE, "w") as f:
        json.dump(db_data, f, indent=4)

# Initialize Embeddings & Chroma on startup
print("Initializing HuggingFace Embeddings model locally...")
embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")

print("Loading Chroma Database...")
vector_store = Chroma(
    persist_directory="./chroma_db",
    embedding_function=embeddings,
    collection_name="pdf_documents"
)

# PDF Processing Helper Functions
def extract_text_from_pdf(file_bytes: bytes) -> str:
    text = ""
    pdf_reader = PdfReader(io.BytesIO(file_bytes))
    for page in pdf_reader.pages:
        page_text = page.extract_text() or ""
        text += page_text
    return text

def split_text_into_chunks(text: str):
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=150,
        separators=["\n\n", "\n", " ", ""],
    )
    return text_splitter.split_text(text)

# --- REST ENDPOINTS ---

# Serve Landing Page
@app.get("/", response_class=HTMLResponse)
async def read_index():
    return FileResponse("static/index.html")

# Upload Document Files
@app.post("/api/upload")
async def upload_documents(files: List[UploadFile] = File(...)):
    db = load_db()
    responses = []

    for file in files:
        if not file.filename.endswith('.pdf'):
            continue
            
        file_bytes = await file.read()
        
        # Extract text
        text = extract_text_from_pdf(file_bytes)
        
        if not text.strip():
            raise HTTPException(status_code=400, detail=f"No text could be extracted from {file.filename}")

        doc_id = str(uuid.uuid4())

        # Save physical PDF locally
        file_path = os.path.join("uploads", f"{doc_id}.pdf")
        with open(file_path, "wb") as f:
            f.write(file_bytes)

        # Add to local db metadata
        doc_entry = {
            "id": doc_id,
            "filename": file.filename,
            "size": len(file_bytes),
            "upload_date": datetime.utcnow().isoformat()
        }
        db["documents"].append(doc_entry)

        # Chunk and embed into Chroma
        chunks = split_text_into_chunks(text)
        metadatas = [{"doc_id": doc_id, "filename": file.filename} for _ in chunks]
        
        vector_store.add_texts(texts=chunks, metadatas=metadatas)

        responses.append(doc_entry)
        
    save_db(db)
    return responses

# List Uploaded Documents
@app.get("/api/documents")
async def list_documents():
    db = load_db()
    return db["documents"]

# Stream PDF File
@app.get("/api/documents/{doc_id}/file")
async def get_document_file(doc_id: str):
    file_path = os.path.join("uploads", f"{doc_id}.pdf")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="PDF file not found")
        
    return FileResponse(
        path=file_path,
        media_type="application/pdf"
    )

# Delete Document
@app.delete("/api/documents/{doc_id}")
async def delete_document(doc_id: str):
    db = load_db()
    
    # 1. Remove document metadata
    doc_to_delete = None
    for doc in db["documents"]:
        if doc["id"] == doc_id:
            doc_to_delete = doc
            break
            
    if not doc_to_delete:
        raise HTTPException(status_code=404, detail="Document not found")
        
    db["documents"].remove(doc_to_delete)
    
    # 2. Remove associated chats
    if doc_id in db["chats"]:
        del db["chats"][doc_id]
        
    save_db(db)
    
    # 3. Delete local physical file
    file_path = os.path.join("uploads", f"{doc_id}.pdf")
    if os.path.exists(file_path):
        try:
            os.remove(file_path)
        except Exception as e:
            print(f"Error removing physical file: {e}")
            
    # 4. Clean up Chroma vector store
    try:
        vector_store.delete(where={"doc_id": doc_id})
    except Exception as e:
        print(f"Error removing from Chroma: {e}")
        
    return {"message": "Document deleted successfully"}

# Chat with PDFs (RAG query)
from langchain_core.language_models.llms import LLM
from huggingface_hub import InferenceClient
from typing import Any

class CustomHFClientLLM(LLM):
    model_id: str
    token: str
    temperature: float = 0.1
    max_tokens: int = 512

    @property
    def _llm_type(self) -> str:
        return "custom_hf_client"

    def _call(
        self,
        prompt: str,
        stop: Optional[List[str]] = None,
        run_manager: Optional[Any] = None,
        **kwargs: Any,
    ) -> str:
        client = InferenceClient(api_key=self.token)
        response = client.chat.completions.create(
            model=self.model_id,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=self.max_tokens,
            temperature=self.temperature
        )
        return response.choices[0].message.content

class ChatRequest(BaseModel):
    message: str
    doc_id: Optional[str] = None

@app.post("/api/chat")
async def chat_with_docs(request: ChatRequest):
    db = load_db()
    
    # Fetch chat session history
    chat_key = request.doc_id if request.doc_id else "global"
    if chat_key not in db["chats"]:
        db["chats"][chat_key] = []
        
    chat_history = []
    # Grab last 6 turns for conversational context
    for msg in db["chats"][chat_key][-6:]:
        role = "human" if msg["role"] == "user" else "ai"
        chat_history.append((role, msg["content"]))

    # Initialize LLM dynamically based on configured keys
    llm = None
    if GEMINI_API_KEY and GEMINI_API_KEY != "your_gemini_api_key_here":
        try:
            # Initialize Google GenAI Chat Model
            llm = ChatGoogleGenerativeAI(
                model="gemini-1.5-pro",
                temperature=0,
                google_api_key=GEMINI_API_KEY
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Google LLM init error: {str(e)}")
    elif HF_TOKEN and HF_TOKEN != "your_huggingface_token_here":
        try:
            # Initialize Custom HuggingFace Serverless Inference Endpoint
            llm = CustomHFClientLLM(
                model_id=HF_MODEL_ID,
                token=HF_TOKEN,
                temperature=0.1,
                max_tokens=512
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"HuggingFace Endpoint init error: {str(e)}")
    else:
        raise HTTPException(
            status_code=400, 
            detail="No API Key configured. Please open `backend/.env` and configure EITHER a valid `GEMINI_API_KEY` OR a free Hugging Face `HF_TOKEN` to start chatting!"
        )

    # System prompt setup
    system_prompt = (
        "You are a strict document-bound AI assistant. Your sole purpose is to answer the user's question using ONLY the provided retrieved context blocks.\n"
        "CRITICAL RULES FOR SOURCE INTEGRITY:\n"
        "1. Answer the question based strictly on the provided Context. Do NOT use any external knowledge, outside facts, assumptions, or extrapolations.\n"
        "2. If the answer cannot be found in the Context, or if the Context is insufficient, state clearly: 'I am sorry, but the uploaded documents do not contain information to answer this question.' Do not attempt to answer or hallucinate.\n"
        "3. Every fact or statement in your response must be explicitly supported by the Context.\n\n"
        "CRITICAL RULES FOR MATHEMATICAL CALCULATIONS AND FORMULAS:\n"
        "1. Calculations, formulas, and math expressions must be written in standard publication-quality LaTeX math notation so they render perfectly as general mathematical forms (comparable to clean handwritten or textbook style).\n"
        "2. DO NOT use raw text symbols like '*' or '\\times' for multiplication. Always use '\\cdot' (centered dot) to represent multiplication (e.g. use 'a \\cdot b' instead of 'a * b' or 'a \\times b').\n"
        "3. For division or fractions, DO NOT use slash division (e.g. '5/3'). Always use standard fraction notation '\\frac{{5}}{{3}}' to render as a vertical stacked fraction.\n"
        "4. For exponents, use superscript notation, e.g., '10^4' or '10^{{power}}'.\n"
        "5. For modulo arithmetic, use '\\bmod' or '\\pmod', e.g. '10^4 \\bmod 13'.\n"
        "6. Enclose all block/centered equations in '$$ ... $$' or '\\[ ... \\]' delimiters.\n"
        "7. Enclose all inline equations and mathematical variables/constants in '$ ... $' or '\\( ... \\)' delimiters.\n"
        "8. Show calculations in full, detailed, step-by-step mathematical expansion form, displaying all intermediate steps clearly so the user can easily follow.\n\n"
        "Context:\n{context}"
    )
    prompt_template = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        MessagesPlaceholder("chat_history"),
        ("human", "{input}")
    ])

    # Establish Retriever with optional metadata scope filter
    search_kwargs = {"k": 6}
    if request.doc_id:
        search_kwargs["filter"] = {"doc_id": request.doc_id}
        
    retriever = vector_store.as_retriever(search_kwargs=search_kwargs)

    try:
        # Construct and invoke retrieval chain
        question_answer_chain = create_stuff_documents_chain(llm, prompt_template)
        rag_chain = create_retrieval_chain(retriever, question_answer_chain)
        
        response = rag_chain.invoke({
            "input": request.message,
            "chat_history": chat_history
        })
        
        answer = response["answer"]
        sources = [
            {
                "content": doc.page_content,
                "filename": doc.metadata.get("filename", "Unknown Document")
            }
            for doc in response["context"]
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"RAG query execution error: {str(e)}")

    # Save turn to local json chat database
    timestamp = datetime.utcnow().isoformat()
    db["chats"][chat_key].append({"role": "user", "content": request.message, "timestamp": timestamp})
    db["chats"][chat_key].append({"role": "ai", "content": answer, "sources": sources, "timestamp": timestamp})
    save_db(db)

    return {"answer": answer, "sources": sources}

# Get Chat History
@app.get("/api/chat/history")
async def get_chat_history(doc_id: Optional[str] = None):
    db = load_db()
    chat_key = doc_id if doc_id else "global"
    if chat_key in db["chats"]:
        return db["chats"][chat_key]
    return []

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
