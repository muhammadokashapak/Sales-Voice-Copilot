# rag_engine.py
"""
RAG Engine for Local Real-Time AI Sales Assistant.
Handles PDF parsing, ChromaDB vector indexing/retrieval, Ollama LLM queries,
and strict sales guardrails with language preservation.
"""

import os
import re
import time
import json
import logging
from typing import List, Dict, Any, Optional
import requests
from pypdf import PdfReader

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("RAGEngine")

class RAGEngine:
    def __init__(
        self,
        pdf_path: str = "zoom.pdf",
        chroma_path: str = "chroma_db_v2",
        min_relevance: float = 0.35,
        ollama_base_url: str = "http://127.0.0.1:11434",
        llm_model: str = "llama3.2:3b",
        embedding_model: str = "nomic-embed-text"
    ):
        self.pdf_path = pdf_path
        self.chroma_path = chroma_path
        self.min_relevance = min_relevance
        self.ollama_base_url = ollama_base_url.rstrip("/")
        self.llm_model = llm_model
        self.embedding_model = embedding_model
        
        self.documents: List[Dict[str, Any]] = []
        self.vectorstore = None
        self.query_cache: Dict[str, Dict[str, Any]] = {}
        
        # Stopwords for conversational filtering
        self.stopwords = set([
            "a", "an", "the", "is", "are", "was", "were", "in", "on", "at", "to", "for", "of", "with",
            "by", "from", "and", "or", "but", "if", "that", "this", "it", "you", "your", "we", "our",
            "i", "my", "me", "us", "they", "them", "their", "how", "what", "when", "where", "why",
            "who", "which", "would", "could", "should", "do", "does", "did", "can", "will", "be",
            "been", "being", "have", "has", "had", "take", "need", "get", "give", "make", "agar",
            "kya", "hum", "aap", "ko", "se", "ka", "ki", "ke", "hai", "hain", "toh", "aur", "karo",
            "karein", "bhi", "yeh", "woh", "kar", "rahe", "raha", "meri", "mera", "apna"
        ])
        
        # Core Sales Concept Groups for deep semantic synergy
        self.synonym_groups = [
            {"name": "billing_charges", "words": {"payment", "pay", "billed", "bill", "billing", "charge", "charges", "charging", "fee", "fees", "cost", "costs", "price", "rate", "rates", "invoice", "overtime", "deposit", "money", "dollar", "dollars"}},
            {"name": "timeline_delay", "words": {"deadline", "deadlines", "timeline", "timelines", "schedule", "schedules", "missed", "miss", "exceeds", "exceed", "delay", "delayed", "delays", "late", "eta", "urgent", "hurry", "rush", "speed", "fast", "days", "weeks", "months"}},
            {"name": "hours_extra", "words": {"hours", "hour", "working", "work", "overtime", "extra", "additional", "more", "increase", "increased", "overtime"}},
            {"name": "scope_cr", "words": {"scope", "sow", "feature", "features", "change", "changes", "cr", "custom", "customization", "addition", "additions", "revision", "revisions", "requirement", "requirements"}},
            {"name": "contract_type", "words": {"fixed", "fixed-price", "fixed-scope", "hourly", "retainer", "contract", "contracts", "milestone", "milestones", "terms"}},
            {"name": "trust_nda", "words": {"nda", "ip", "intellectual property", "security", "source code", "code", "confidential", "confidentiality", "ownership", "rights", "steal", "leak", "privacy"}},
            {"name": "discount_cost", "words": {"discount", "discounts", "concession", "cheaper", "cheap", "less", "lower", "reduce", "reduction", "expensive", "costly", "tight budget"}},
            {"name": "competitor_freelancer", "words": {"freelancer", "freelancers", "upwork", "fiverr", "competitor", "competitors", "another agency", "other agency", "other company"}}
        ]
        
        # Load documents and initialize vectorstore/in-memory fallback
        self._initialize_knowledge_base()

    def _extract_qa_from_pdf(self, pdf_path: str) -> List[Dict[str, Any]]:
        """Parses zoom.pdf into structured Q&A objects."""
        if not os.path.exists(pdf_path):
            logger.warning(f"PDF not found at {pdf_path}. Returning empty list.")
            return []

        try:
            reader = PdfReader(pdf_path)
            full_text = "\n".join([page.extract_text() or "" for page in reader.pages])
            
            full_text = full_text.replace("\ufffd", "-")
            full_text = full_text.replace("\u00ad", "")
            
            blocks = [b.strip() for b in re.split(r'(?=Q\d+\.)', full_text) if re.match(r'^Q\d+\.', b.strip())]
            
            structured_qa = []
            for b in blocks:
                m = re.search(r'Q(\d+)\.\s*(.+?)\n\s*Context\s*/\s*Rationale\s*\n+(.+?)\n+\s*Exact\s*Strategy\s*/\s*Pitch\s*\n+(.+)', b, re.DOTALL)
                if m:
                    q_number = int(m.group(1))
                    question = " ".join(m.group(2).strip().split())
                    context = m.group(3).strip()
                    pitch = m.group(4).strip()
                    structured_qa.append({
                        "q_number": q_number,
                        "question": question,
                        "context": context,
                        "pitch": pitch,
                        "full_text": f"Question:\n{question}\n\nContext / Rationale:\n{context}\n\nExact Strategy / Pitch:\n{pitch}",
                        "source": "Enterprise Sales & Client Handling Knowledge Base"
                    })
            logger.info(f"Successfully extracted {len(structured_qa)} structured Q&A battlecards from {pdf_path}")
            return structured_qa
        except Exception as e:
            logger.error(f"Error extracting PDF Q&A: {e}")
            return []

    def _initialize_knowledge_base(self):
        """Loads structured documents and tries to initialize ChromaDB."""
        self.documents = self._extract_qa_from_pdf(self.pdf_path)
        
        # Try initializing ChromaDB if available
        try:
            from langchain_community.vectorstores import Chroma
            from langchain_community.embeddings import OllamaEmbeddings
            from langchain_core.documents import Document
            
            if self.check_ollama():
                embeddings = OllamaEmbeddings(
                    model=self.embedding_model,
                    base_url=self.ollama_base_url
                )
                
                if os.path.exists(self.chroma_path) and os.listdir(self.chroma_path):
                    logger.info(f"Loading existing ChromaDB from {self.chroma_path}")
                    self.vectorstore = Chroma(
                        persist_directory=self.chroma_path,
                        embedding_function=embeddings,
                        collection_name="sales_qa_v2"
                    )
                elif self.documents:
                    logger.info(f"Creating new ChromaDB at {self.chroma_path}")
                    os.makedirs(self.chroma_path, exist_ok=True)
                    langchain_docs = [
                        Document(
                            page_content=doc["full_text"],
                            metadata={
                                "q_number": doc["q_number"],
                                "question": doc["question"],
                                "context": doc["context"],
                                "pitch": doc["pitch"],
                                "source": doc["source"]
                            }
                        ) for doc in self.documents
                    ]
                    self.vectorstore = Chroma.from_documents(
                        documents=langchain_docs,
                        embedding=embeddings,
                        collection_name="sales_qa_v2",
                        persist_directory=self.chroma_path
                    )
        except Exception as e:
            logger.warning(f"ChromaDB initialization deferred or using in-memory hybrid matcher: {e}")

    def check_ollama(self) -> bool:
        """Checks if local Ollama server is responsive."""
        try:
            res = requests.get(f"{self.ollama_base_url}/api/tags", timeout=1.5)
            return res.status_code == 200
        except Exception:
            return False

    def get_ollama_models(self) -> List[str]:
        """Returns available Ollama model tags."""
        try:
            res = requests.get(f"{self.ollama_base_url}/api/tags", timeout=2.0)
            if res.status_code == 200:
                data = res.json()
                return [m["name"] for m in data.get("models", [])]
        except Exception:
            pass
        return ["llama3.2:3b", "llama3.2:1b", "phi3:latest", "nomic-embed-text"]

    def _fallback_lexical_match(self, query: str) -> Optional[Dict[str, Any]]:
        """Smart keyword/concept synergy relevance matcher with stopword removal."""
        if not self.documents:
            return None
            
        clean_query = query.lower().strip()
        raw_words = re.findall(r'[a-z0-9\-]+', clean_query)
        content_words = [w for w in raw_words if w not in self.stopwords and len(w) > 2]
        if not content_words:
            return None

        query_set = set(content_words)

        # Identify active concepts in query
        query_active_concepts = set()
        for group in self.synonym_groups:
            if any(w in clean_query or w in query_set for w in group["words"]):
                query_active_concepts.add(group["name"])

        best_doc = None
        best_score = 0.0

        for doc in self.documents:
            doc_q = doc["question"].lower()
            doc_c = doc["context"].lower()
            doc_p = doc["pitch"].lower()
            doc_full = f"{doc_q} {doc_c} {doc_p}"
            
            # Direct question match boost
            if clean_query in doc_q or doc_q in clean_query:
                return {"doc": doc, "score": 0.95}

            # Question content word overlap
            doc_raw_words = re.findall(r'[a-z0-9\-]+', doc_q)
            doc_q_content = set(w for w in doc_raw_words if w not in self.stopwords and len(w) > 2)
            
            inter_q = query_set.intersection(doc_q_content)
            q_recall = len(inter_q) / max(len(doc_q_content), 1)
            q_prec = len(inter_q) / max(len(query_set), 1)
            q_score = (q_recall * 0.6) + (q_prec * 0.4)

            # Body content word overlap
            doc_body_raw = re.findall(r'[a-z0-9\-]+', doc_c + " " + doc_p)
            doc_body_content = set(w for w in doc_body_raw if w not in self.stopwords and len(w) > 2)
            inter_body = query_set.intersection(doc_body_content)
            body_score = len(inter_body) / max(len(query_set), 1)

            # Concept synergy boost
            doc_active_concepts = set()
            for group in self.synonym_groups:
                if any(w in doc_full for w in group["words"]):
                    doc_active_concepts.add(group["name"])

            shared_concepts = query_active_concepts.intersection(doc_active_concepts)
            concept_boost = 0.0
            if len(shared_concepts) >= 2:
                concept_boost = 0.35 * (len(shared_concepts) / len(query_active_concepts))
            elif len(shared_concepts) == 1:
                concept_boost = 0.15

            # Phrase keyword synergy
            phrase_boost = 0.0
            if any(term in doc_q for term in ["extra", "schedule", "billed", "hours", "timeline", "price", "nda", "delay", "exceeds", "scope"]):
                if any(term in clean_query for term in ["extra", "schedule", "billed", "hours", "timeline", "price", "nda", "delay", "exceeds", "scope"]):
                    phrase_boost = 0.10

            score = (q_score * 0.45) + (body_score * 0.20) + concept_boost + phrase_boost

            if score > best_score:
                best_score = score
                best_doc = doc

        if best_doc and best_score >= 0.22:
            return {"doc": best_doc, "score": min(best_score, 0.98)}
        return None

    def query(self, user_question: str, top_k: int = 3) -> Dict[str, Any]:
        """
        Executes end-to-end RAG retrieval + Ollama LLM answer synthesis.
        Returns comprehensive telemetry and strict sales pitch output.
        """
        start_time = time.time()
        clean_question = user_question.strip()
        
        if not clean_question:
            return {
                "success": False,
                "response": "Please speak or type a client question.",
                "pitch": "",
                "context": "",
                "question_matched": "",
                "q_number": None,
                "relevance_score": 0.0,
                "confidence_percent": 0,
                "rag_latency_ms": 0,
                "llm_latency_ms": 0,
                "total_latency_ms": 0,
                "match_source": "None",
                "ollama_used": False,
                "cached": False
            }

        # Check in-memory cache for instant <10ms replay
        cache_key = clean_question.lower()
        if cache_key in self.query_cache:
            cached = dict(self.query_cache[cache_key])
            cached["cached"] = True
            cached["total_latency_ms"] = int((time.time() - start_time) * 1000)
            return cached

        rag_start = time.time()
        best_doc = None
        relevance_score = 0.0
        match_source = "None"

        # 1. Try ChromaDB if initialized
        if self.vectorstore is not None:
            try:
                results = self.vectorstore.similarity_search_with_relevance_scores(
                    clean_question,
                    k=top_k
                )
                if results:
                    top_doc, score = results[0]
                    relevance_score = float(score)
                    best_doc = {
                        "q_number": top_doc.metadata.get("q_number", 0),
                        "question": top_doc.metadata.get("question", ""),
                        "context": top_doc.metadata.get("context", ""),
                        "pitch": top_doc.metadata.get("pitch", ""),
                        "source": top_doc.metadata.get("source", "Knowledge Base")
                    }
                    match_source = "ChromaDB"
            except Exception as e:
                logger.warning(f"Vector search failed, falling back to lexical matcher: {e}")

        # 2. Fallback to in-memory matcher if ChromaDB didn't match or is uninitialized
        if best_doc is None or relevance_score < self.min_relevance:
            fallback_res = self._fallback_lexical_match(clean_question)
            if fallback_res and fallback_res["score"] > relevance_score:
                best_doc = fallback_res["doc"]
                relevance_score = fallback_res["score"]
                match_source = "KnowledgeBase_Lexical"

        rag_latency_ms = int((time.time() - rag_start) * 1000)

        # Check threshold
        if best_doc is None or relevance_score < self.min_relevance:
            total_latency_ms = int((time.time() - start_time) * 1000)
            return {
                "success": False,
                "response": "No matching strategy in Knowledge Base. Feel free to rephrase or consult team leadership.",
                "pitch": "",
                "context": "",
                "question_matched": "",
                "q_number": None,
                "relevance_score": round(relevance_score, 4),
                "confidence_percent": int(relevance_score * 100),
                "rag_latency_ms": rag_latency_ms,
                "llm_latency_ms": 0,
                "total_latency_ms": total_latency_ms,
                "match_source": match_source,
                "ollama_used": False,
                "cached": False
            }

        pitch = best_doc["pitch"]
        context = best_doc["context"]
        matched_question = best_doc["question"]
        q_number = best_doc["q_number"]

        # 3. Synthesize response via Ollama if available
        llm_start = time.time()
        ollama_used = False
        final_response = pitch

        if self.check_ollama():
            try:
                system_prompt = (
                    "You are a professional AI Sales Assistant co-pilot on a live client call.\n"
                    "STRICT RULES:\n"
                    "1. Use ONLY the provided Exact Strategy / Pitch.\n"
                    "2. Do NOT invent new info, pricing, timelines, or technologies.\n"
                    "3. Preserve the original language, tone, and wording of the Exact Strategy / Pitch.\n"
                    "4. If the pitch has Roman Urdu + English, keep the exact Roman Urdu + English style.\n"
                    "5. Keep the response concise, punchy, and ready for the sales rep to speak to the client.\n"
                    "6. Return ONLY the client-facing response."
                )
                
                user_prompt = f"EXACT STRATEGY / PITCH:\n{pitch}\n\nUSER QUESTION / SITUATION:\n{clean_question}\n\nRecommended Client Response:"

                payload = {
                    "model": self.llm_model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    "options": {
                        "temperature": 0.1,
                        "num_predict": 120
                    },
                    "stream": False
                }

                res = requests.post(
                    f"{self.ollama_base_url}/api/chat",
                    json=payload,
                    timeout=5.0
                )
                if res.status_code == 200:
                    resp_json = res.json()
                    ai_content = resp_json.get("message", {}).get("content", "").strip()
                    if ai_content:
                        final_response = ai_content
                        ollama_used = True
            except Exception as e:
                logger.warning(f"Ollama chat invocation failed ({e}). Using direct exact pitch.")
                final_response = pitch

        llm_latency_ms = int((time.time() - llm_start) * 1000)
        total_latency_ms = int((time.time() - start_time) * 1000)

        result_payload = {
            "success": True,
            "response": final_response,
            "pitch": pitch,
            "context": context,
            "question_matched": matched_question,
            "q_number": q_number,
            "relevance_score": round(relevance_score, 4),
            "confidence_percent": min(int(relevance_score * 100), 100),
            "rag_latency_ms": rag_latency_ms,
            "llm_latency_ms": llm_latency_ms,
            "total_latency_ms": total_latency_ms,
            "match_source": match_source,
            "ollama_used": ollama_used,
            "cached": False
        }

        # Save in cache
        if len(self.query_cache) > 200:
            self.query_cache.clear()
        self.query_cache[cache_key] = result_payload

        return result_payload

    def analyze_intent(self, text: str) -> Dict[str, Any]:
        """
        Analyzes client input text to determine core intent, psychological friction points,
        sentiment, and recommended sales strategy & pitch.
        """
        start_time = time.time()
        clean_text = text.strip()
        if not clean_text:
            return {
                "success": False,
                "error": "Input text cannot be empty.",
                "intent_title": "Unknown Intent",
                "intent_category": "General",
                "confidence_percent": 0
            }

        # 1. First retrieve best matching battlecard via RAG
        rag_res = self.query(clean_text)
        
        # 2. Heuristic Intent Categorization
        text_lower = clean_text.lower()
        matched_q_text = (rag_res.get("question_matched") or "").lower()
        
        # Comprehensive Intent Rules with expanded vocabulary and contextual weighting
        intent_rules = [
            {
                "category": "Trust, IP Security & NDA",
                "badge_color": "cyan",
                "icon": "fa-shield-halved",
                "keywords": ["nda", "ip", "intellectual property", "security", "code theft", "steal", "stealing", "leak", "leaking", "copy", "privacy", "confidential", "confidentiality", "contract", "ownership", "source code", "code safe", "rights", "secure", "trust"],
                "client_mindset": "Risk-averse, highly protective of proprietary intellectual property and code confidentiality.",
                "hidden_concern": "Afraid their proprietary concept or source code might be leaked, reused, or compromised.",
                "dos": ["Offer a mutual NDA signed before conducting any technical deep-dive", "Explicitly confirm that 100% IP rights and source code belong to the client upon milestone payment"],
                "donts": ["Never dismiss or treat legal and security concerns casually", "Avoid vague or informal verbal promises"]
            },
            {
                "category": "Price Resistance & Budget Constraint",
                "badge_color": "amber",
                "icon": "fa-coins",
                "keywords": ["price", "cost", "expensive", "high", "rate", "budget", "charge", "afford", "quotation", "pricing", "dollar", "hourly", "costly", "affordability", "too much"],
                "client_mindset": "Cost-conscious, analyzing return on investment against upfront capital expenditure.",
                "hidden_concern": "Afraid of overpaying, project failure, or not achieving their expected return on investment.",
                "dos": ["Anchor on total cost of ownership, QA, automated testing, and production stability", "Offer milestone-based phased delivery or MVP rollout"],
                "donts": ["Never drop rates without proportionally adjusting scope", "Do not get defensive about professional agency pricing"]
            },
            {
                "category": "Discount & Commercial Negotiation",
                "badge_color": "amber",
                "icon": "fa-tags",
                "keywords": ["discount", "concession", "deal", "reduce", "package", "margin", "lump sum", "budget tight", "cheaper rate", "cut price", "offer"],
                "client_mindset": "Commercial negotiator testing pricing flexibility and seeking the best possible financial terms.",
                "hidden_concern": "Wants assurance they secured maximum value and a winning deal before signing.",
                "dos": ["Offer value add-ons or scope trimming rather than flat discounts", "Protect project margins by highlighting dedicated enterprise engineering standards"],
                "donts": ["Never commit to arbitrary discounts on the initial discovery call", "Avoid sounding desperate to close the agreement"]
            },
            {
                "category": "Timeline & Delivery Urgency",
                "badge_color": "rose",
                "icon": "fa-stopwatch-20",
                "keywords": ["timeline", "deadline", "delivery", "deliver", "fast", "urgent", "hurry", "rush", "when", "days", "weeks", "launch", "eta", "asap", "schedule", "friday", "month", "speed", "quick", "quickly"],
                "client_mindset": "Under intense market pressure, anxious about delivery windows and launch milestones.",
                "hidden_concern": "Afraid missed deadlines will harm their business launch, investor relations, or live operations.",
                "dos": ["Break delivery into fast iterative sprints and release a functional MVP first", "Demonstrate clear sprint schedule, dedicated engineers, and daily progress tracking"],
                "donts": ["Never promise unrealistic deadlines that jeopardize code quality", "Avoid giving vague date estimates without technical breakdown"]
            },
            {
                "category": "Competitor & Freelancer Comparison",
                "badge_color": "rose",
                "icon": "fa-users-slash",
                "keywords": ["competitor", "freelancer", "freelancers", "other agency", "cheaper", "upwork", "fiverr", "india", "overseas", "another company", "another vendor", "competitors"],
                "client_mindset": "Comparing agency engineering against low-cost individual freelancers without accounting for risk.",
                "hidden_concern": "Skeptical whether agency pricing delivers tangible risk reduction, security, and superior code.",
                "dos": ["Highlight architecture durability, security audits, dedicated PM, and code warranty", "Emphasize dedicated backup engineers and long-term business continuity"],
                "donts": ["Never criticize competitors directly", "Avoid making unverified generic claims"]
            },
            {
                "category": "Technical Capability & Scalability",
                "badge_color": "emerald",
                "icon": "fa-microchip",
                "keywords": ["tech stack", "python", "react", "ai", "architecture", "scalability", "scale", "load", "traffic", "bugs", "testing", "performance", "api", "database", "infrastructure", "backend", "cloud"],
                "client_mindset": "Seeking engineering authority, architectural robustness, and technical proof.",
                "hidden_concern": "Worried the product will crash under high user load or fail modern scalability benchmarks.",
                "dos": ["Provide architecture diagrams, CI/CD pipeline breakdown, and automated test coverage", "Speak with engineering precision and reference proven tech stacks"],
                "donts": ["Avoid overusing technical buzzwords; provide direct architectural clarity"]
            },
            {
                "category": "Scope Creep & Change Management",
                "badge_color": "amber",
                "icon": "fa-arrows-split-up-and-left",
                "keywords": ["changes", "revisions", "scope", "extra", "features", "maintenance", "support", "post launch", "customization", "modifications", "warranty"],
                "client_mindset": "Wants development flexibility without unexpected surprise invoices.",
                "hidden_concern": "Afraid of hidden fees, inflexible contract lock-in, and post-launch abandonment.",
                "dos": ["Define a clear sprint scope accompanied by a transparent change-order policy", "Include 30 days of post-launch warranty and bug fixes in writing"],
                "donts": ["Do not become confrontational over minor change requests; clarify scope transparently"]
            }
        ]

        # Multi-factor score matching: Text keyword count + Matched Q synergy
        best_rule = None
        highest_score = 0

        for rule in intent_rules:
            # Direct keyword occurrences in user text
            score = 0
            for kw in rule["keywords"]:
                if re.search(rf"\b{re.escape(kw)}", text_lower):
                    score += 3
                elif kw in text_lower:
                    score += 1

            # Synergy with matched battlecard
            for kw in rule["keywords"]:
                if kw in matched_q_text:
                    score += 1.5

            if score > highest_score:
                highest_score = score
                best_rule = rule

        # Fallback rule if no keyword strongly matched
        is_relevant_sales_query = highest_score > 0 or rag_res.get("success", False)
        if not best_rule or not is_relevant_sales_query:
            best_rule = {
                "category": "Non-Relevant / General Inquiry",
                "badge_color": "cyan",
                "icon": "fa-compass",
                "keywords": [],
                "client_mindset": "The statement appears unrelated to software development, sales, pricing, timeline, or agency services.",
                "hidden_concern": "No clear sales or project friction point detected.",
                "dos": ["Rephrase the question to focus on pricing, timeline, NDA, or technical scope", "Consult sales leadership for non-standard queries"],
                "donts": ["Do not provide random engineering pitches for unrelated queries"]
            }

        # Pitch resolution:
        matched_pitch = ""
        matched_q = ""
        q_num = None
        
        if rag_res.get("success") and rag_res.get("pitch"):
            matched_pitch = rag_res.get("response") or rag_res.get("pitch")
            matched_q = rag_res.get("question_matched") or ""
            q_num = rag_res.get("q_number")
            confidence = max(rag_res.get("confidence_percent", 85), 85)
        elif is_relevant_sales_query:
            # Check if lexical matcher found a card
            fallback_match = self._fallback_lexical_match(clean_text)
            if fallback_match and fallback_match.get("doc"):
                doc = fallback_match["doc"]
                matched_pitch = doc["pitch"]
                matched_q = doc["question"]
                q_num = doc["q_number"]
                confidence = min(82 + int(highest_score * 2), 95)
            else:
                matched_pitch = (
                    "Our engineering team operates on fixed-scope, milestone-based sprint contracts. "
                    "We guarantee complete quality assurance, testing, and production stability without unexpected extra billing."
                )
                matched_q = "General Sales & Project Policy"
                confidence = 80
        else:
            # Completely non-relevant question
            matched_pitch = "No matching strategy in Knowledge Base. This query is outside sales, pricing, and project scope."
            matched_q = "Non-Relevant Statement"
            confidence = 10

        # 3. LLM Deep Synthesis if Ollama is online
        ollama_enhanced = False
        final_pitch = matched_pitch
        summary_intent = best_rule["client_mindset"]

        if self.check_ollama():
            try:
                system_prompt = (
                    "You are an expert Executive Sales Strategist.\n"
                    "Analyze the client's statement and output STRICT JSON with keys:\n"
                    "{\n"
                    '  "intent_title": "short 3-5 word title",\n'
                    '  "client_psychology": "1 sentence on subconscious fear or desire",\n'
                    '  "strategy_pitch": "persuasive client response in professional English matching knowledge base style",\n'
                    '  "tactical_tip": "1 key advice for the sales rep"\n'
                    "}"
                )
                user_msg = (
                    f"CLIENT STATEMENT: \"{clean_text}\"\n"
                    f"DETECTED CATEGORY: {best_rule['category']}\n"
                    f"RELEVANT BASE PITCH: {matched_pitch}\n"
                )

                payload = {
                    "model": self.llm_model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_msg}
                    ],
                    "options": {"temperature": 0.15, "num_predict": 200},
                    "format": "json",
                    "stream": False
                }

                res = requests.post(f"{self.ollama_base_url}/api/chat", json=payload, timeout=4.0)
                if res.status_code == 200:
                    data = res.json()
                    parsed = json.loads(data.get("message", {}).get("content", "{}"))
                    if parsed.get("strategy_pitch"):
                        final_pitch = parsed["strategy_pitch"]
                    if parsed.get("client_psychology"):
                        summary_intent = parsed["client_psychology"]
                    if parsed.get("tactical_tip"):
                        best_rule["dos"].insert(0, parsed["tactical_tip"])
                    ollama_enhanced = True
            except Exception as e:
                logger.warning(f"Ollama intent enhancement skipped ({e}). Using rule-based synthesis.")

        latency_ms = int((time.time() - start_time) * 1000)

        return {
            "success": True,
            "input_text": clean_text,
            "intent_title": best_rule["category"],
            "badge_color": best_rule["badge_color"],
            "icon": best_rule["icon"],
            "confidence_percent": confidence,
            "client_mindset": summary_intent,
            "hidden_concern": best_rule["hidden_concern"],
            "recommended_pitch": final_pitch,
            "dos": best_rule["dos"][:3],
            "donts": best_rule["donts"][:2],
            "matched_question": matched_q,
            "q_number": q_num,
            "context": rag_res.get("context", ""),
            "latency_ms": latency_ms,
            "ollama_enhanced": ollama_enhanced
        }

    def get_all_battlecards(self) -> List[Dict[str, Any]]:
        """Returns all Q&A battlecards for knowledge base explorer."""
        return [
            {
                "q_number": doc["q_number"],
                "question": doc["question"],
                "context": doc["context"],
                "pitch": doc["pitch"],
                "source": doc.get("source", "zoom.pdf")
            }
            for doc in self.documents
        ]

