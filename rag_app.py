# rag_app.py

import os
import re
import requests
import subprocess
import time
import shutil

from langchain_core.documents import Document
from langchain_chroma import Chroma
from langchain_ollama import OllamaEmbeddings, ChatOllama
from langchain_core.prompts import ChatPromptTemplate
from langchain_community.document_loaders import PyPDFLoader

# --- Configuration ---
PDF_PATH = "zoom.pdf"
CHROMA_PATH = "." + os.sep + "chroma_db_v2" # Adjusted for local
MIN_RELEVANCE = 0.45 # From kernel state
EMBEDDING_MODEL = "nomic-embed-text"
LLM_MODEL = "llama3.2:3b"
OLLAMA_BASE_URL = "http://127.0.0.1:11434"

# --- Document Loading and Processing ---
def load_and_process_pdf(pdf_file_path):
    loader = PyPDFLoader(pdf_file_path)
    documents = loader.load()

    full_text = "\n".join(doc.page_content for doc in documents)

    full_text = full_text.replace("￾", "-")
    full_text = full_text.replace("\u00ad", "")

    question_blocks = re.split(r'(?=Q\d+\.)', full_text)
    question_blocks = [block.strip() for block in question_blocks if re.match(r'^Q\d+\.', block.strip())]

    structured_qa = []
    for block in question_blocks:
        # Regex to capture Q_number, Question, Context, and Pitch
        q_match = re.match(r'Q(\d+)\.\s*(.+?)\nContext / Rationale\s*(.+?)\nExact Strategy / Pitch\s*(.+)', block, re.DOTALL)
        if q_match:
            q_number = int(q_match.group(1))
            question = q_match.group(2).strip()
            context = q_match.group(3).strip()
            pitch = q_match.group(4).strip()
            structured_qa.append({
                "q_number": q_number,
                "question": question,
                "context": context,
                "pitch": pitch
            })
    
    qa_documents = []
    for item in structured_qa:
        retrieval_text = f"""
Question:
{item["question"]}

Context / Rationale:
{item["context"]}

Exact Strategy / Pitch:
{item["pitch"]}
""".strip()
        doc = Document(
            page_content=retrieval_text,
            metadata={
                "q_number": item["q_number"],
                "question": item["question"],
                "context": item["context"],
                "pitch": item["pitch"],
                "source": "Enterprise Sales & Client Handling Knowledge Base"
            }
        )
        qa_documents.append(doc)
    return qa_documents

# --- Ollama Server Check (Simplified for local setup, user is expected to run 'ollama serve') ---
def check_ollama_status():
    try:
        response = requests.get(OLLAMA_BASE_URL, timeout=1)
        return response.status_code == 200
    except requests.exceptions.ConnectionError:
        return False

# --- Main RAG Setup ---
if __name__ == "__main__":
    print("Starting local RAG Sales Assistant...")
    if not check_ollama_status():
        print(f"Ollama server not running at {OLLAMA_BASE_URL}.")
        print("Please ensure Ollama is installed and running (`ollama serve`) before executing this script.")
        exit()

    print("Initializing Ollama embeddings and LLM...")
    embeddings = OllamaEmbeddings(
        model=EMBEDDING_MODEL,
        base_url=OLLAMA_BASE_URL
    )

    llm = ChatOllama(
        model=LLM_MODEL,
        base_url=OLLAMA_BASE_URL,
        temperature=0,
        num_predict=150
    )
    print("Ollama models loaded.")

    # Check if ChromaDB exists, if not, create it
    if not os.path.exists(CHROMA_PATH) or not os.listdir(CHROMA_PATH): # Check if directory is empty
        print(f"ChromaDB not found at {CHROMA_PATH} or is empty. Creating new one...")
        if os.path.exists(CHROMA_PATH): # Clean up if empty but exists
            shutil.rmtree(CHROMA_PATH)
        os.makedirs(CHROMA_PATH, exist_ok=True)

        if not os.path.exists(PDF_PATH):
            print(f"Error: {PDF_PATH} not found. Please ensure 'zoom.pdf' is in the same directory as this script.")
            exit()

        qa_documents = load_and_process_pdf(PDF_PATH)
        vectorstore = Chroma.from_documents(
            documents=qa_documents,
            embedding=embeddings,
            collection_name="sales_qa_v2",
            persist_directory=CHROMA_PATH
        )
        print(f"New Q&A-based ChromaDB created with {len(qa_documents)} documents.")
    else:
        print(f"Loading existing ChromaDB from {CHROMA_PATH}...")
        vectorstore = Chroma(
            persist_directory=CHROMA_PATH,
            embedding_function=embeddings,
            collection_name="sales_qa_v2"
        )
        print("ChromaDB loaded.")

    rag_prompt = ChatPromptTemplate.from_template("""
You are a professional AI Sales Assistant.
Your task is to provide the response that the sales representative
should give to the client.

STRICT RULES:
1. Use ONLY the provided Exact Strategy / Pitch.
2. Do NOT use outside knowledge.
3. Do NOT invent new information.
4. Do NOT add new claims, pricing, timelines, guarantees,
   features, technologies, or policies.
5. Preserve the original language, wording, tone, and style
   of the Exact Strategy / Pitch.
6. DO NOT translate the pitch.
7. DO NOT change Roman Urdu into English.
8. DO NOT change English into Roman Urdu.
9. If the Exact Strategy / Pitch contains English + Roman Urdu,
   keep that same English + Roman Urdu style.
10. The user's question is ONLY used to understand which response
    is required. It does NOT determine the response language.

The response should stay as close as possible to the original
Exact Strategy / Pitch while being natural as a direct client response.

EXACT STRATEGY / PITCH:
{pitch}

USER QUESTION:
{question}

Return ONLY the recommended client-facing response.
    """)

    def ask_rag(question, k=3):
        results = vectorstore.similarity_search_with_relevance_scores(
            question,
            k=k
        )

        if not results:
            return (
                "I don’t have enough information about that in my knowledge base. "
                "Feel free to ask me something else, and I’ll do my best to help."
            )

        best_doc, best_score = results[0]

        print(f"Best match: Q{best_doc.metadata['q_number']}")
        print(f"Relevance score: {best_score:.4f}")

        if best_score < MIN_RELEVANCE:
            return (
                "I don’t have enough information about that in my knowledge base. "
                "Feel free to ask me something else, and I’ll do my best to help."
            )

        pitch = best_doc.metadata["pitch"]

        messages = rag_prompt.format_messages(
            pitch=pitch,
            question=question
        )

        response = llm.invoke(messages)

        return response.content.strip()

    print("=" * 80)
    print("LOCAL AI SALES ASSISTANT")
    print("=" * 80)
    print("Ask a sales/client question.")
    print("Type 'exit' to stop.\n")

    while True:
        question = input("Team Lead: ").strip()

        if question.lower() == "exit":
            print("\nAssistant stopped.")
            break

        if not question:
            continue

        try:
            answer = ask_rag(question)
        except requests.exceptions.ConnectionError:
            answer = "Connection to Ollama server lost. Please ensure Ollama is running (`ollama serve`)."
            print(answer)
        except Exception as e:
            answer = f"An unexpected error occurred during RAG query: {e}"
            print(answer)

        print("\nAssistant:")
        print(answer)
        print("\n" + "-" * 80 + "\n")
