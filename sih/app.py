import os
import re
import csv
import math
import time
from collections import Counter
from flask import Flask, render_template, request, jsonify
from pdf_ingest import extract_text_from_pdf, clean_extracted_text, append_entry_to_csv
from gem_integration import get_gem_tenders, get_gem_tender_by_id, generate_gem_procurement_clause, get_gem_search_url

app = Flask(__name__)
DATA_PATH = os.path.join(os.path.dirname(__file__), 'data', 'standard.csv')

SKLEARN_AVAILABLE = False
try:
    import pandas as pd
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
    _v = TfidfVectorizer()
    _v.fit_transform(["test document"])
    SKLEARN_AVAILABLE = True
except Exception as e:
    SKLEARN_AVAILABLE = False
    print(f"StandardMatch AI Engine: Running Pure-Python NLP vectorizer (C-DLL notice: {str(e)})")

ENGLISH_STOP_WORDS = {
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t',
    'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
    'can', 'could', 'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from',
    'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself',
    'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'more', 'most',
    'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours',
    'ourselves', 'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some', 'such', 'than', 'that',
    'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those',
    'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where',
    'which', 'while', 'who', 'whom', 'why', 'with', 'would', 'you', 'your', 'yours', 'yourself', 'yourselves'
}

def tokenize_text(text):
    """Tokenizes text into unigrams and bigrams, filtering out stop words."""
    if not text:
        return []
    words = re.findall(r'\b[a-zA-Z0-9]+\b', str(text).lower())
    filtered_words = [w for w in words if w not in ENGLISH_STOP_WORDS and len(w) > 1]
    bigrams = [f"{filtered_words[i]}_{filtered_words[i+1]}" for i in range(len(filtered_words)-1)]
    return filtered_words + bigrams

def load_csv_data():
    """Reads dataset standard.csv cleanly."""
    if not os.path.exists(DATA_PATH):
        raise FileNotFoundError(f"Dataset standard.csv not found at {DATA_PATH}")
    
    records = []
    with open(DATA_PATH, mode='r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            title = str(row.get('title', '') or '')
            desc = str(row.get('description', '') or '')
            cat = str(row.get('category', '') or '')
            std_no = str(row.get('standard_number', '') or '')
            
            row['combined_text'] = f"{title} {desc} {cat} {std_no}"
            records.append(row)
    return records

def pure_python_tfidf_matcher(query, records):
    """Pure Python implementation of TF-IDF Vectorization & Cosine Similarity."""
    query_tokens = tokenize_text(query)
    if not query_tokens:
        return []

    doc_tokens_list = [tokenize_text(rec['combined_text']) for rec in records]
    N = len(records)
    if N == 0:
        return []

    df_counts = Counter()
    for tokens in doc_tokens_list:
        for term in set(tokens):
            df_counts[term] += 1

    idf = {}
    all_vocab = set(df_counts.keys()).union(set(query_tokens))
    for term in all_vocab:
        df_val = df_counts.get(term, 0)
        idf[term] = math.log((1 + N) / (1 + df_val)) + 1.0

    query_tf = Counter(query_tokens)
    query_vec = {}
    query_norm_sq = 0.0
    for term, count in query_tf.items():
        tf_val = 1.0 + math.log(count)
        weight = tf_val * idf.get(term, 1.0)
        query_vec[term] = weight
        query_norm_sq += weight * weight
    query_norm = math.sqrt(query_norm_sq) if query_norm_sq > 0 else 1.0

    query_is_codes = [c.lower().replace(' ', '') for c in re.findall(r'is\s*\d+', query, re.I)]

    scored_records = []
    for idx, rec in enumerate(records):
        doc_tokens = doc_tokens_list[idx]
        if not doc_tokens:
            rec_copy = dict(rec)
            rec_copy['score'] = 0.0
            scored_records.append(rec_copy)
            continue

        doc_tf = Counter(doc_tokens)
        dot_product = 0.0
        doc_norm_sq = 0.0

        for term, count in doc_tf.items():
            tf_val = 1.0 + math.log(count)
            weight = tf_val * idf.get(term, 1.0)
            doc_norm_sq += weight * weight
            if term in query_vec:
                dot_product += query_vec[term] * weight

        doc_norm = math.sqrt(doc_norm_sq) if doc_norm_sq > 0 else 1.0
        similarity = dot_product / (query_norm * doc_norm) if (query_norm * doc_norm) > 0 else 0.0
        
        std_no_raw = str(rec.get('standard_number', '')).lower().replace(' ', '')
        for code in query_is_codes:
            if code in std_no_raw:
                similarity = min(0.98, similarity + 0.45)
                break

        rec_copy = dict(rec)
        rec_copy['score'] = round(float(similarity), 4)
        scored_records.append(rec_copy)

    return scored_records

@app.route('/')
def index():
    """Renders the Single Page Application (SPA)."""
    return render_template('index.html')

@app.route('/recommend', methods=['POST'])
def recommend():
    """
    POST API endpoint to match procurement query against BIS standards.
    Accepts JSON payload: { "query": "text spec", "threshold": 0.01, "top_n": 3 }
    Returns JSON response containing top matches with similarity scores.
    """
    start_time = time.time()
    try:
        data = request.get_json()
        if not data or 'query' not in data:
            return jsonify({
                "success": False,
                "error": "Missing 'query' parameter in JSON payload."
            }), 400

        user_query = str(data['query']).strip()
        if not user_query:
            return jsonify({
                "success": False,
                "error": "Query string cannot be empty."
            }), 400

        threshold = float(data.get('threshold', 0.01))
        top_n = int(data.get('top_n', 3))

        records = load_csv_data()
        if not records:
            return jsonify({
                "success": True,
                "matches": [],
                "total_standards": 0,
                "execution_time_ms": 0
            })

        if SKLEARN_AVAILABLE:
            try:
                df = pd.DataFrame(records)
                vectorizer = TfidfVectorizer(stop_words='english', ngram_range=(1, 2), sublinear_tf=True)
                tfidf_matrix = vectorizer.fit_transform(df['combined_text'])
                query_vector = vectorizer.transform([user_query])
                sim_scores = cosine_similarity(query_vector, tfidf_matrix).flatten()
                df['score'] = sim_scores
                filtered_df = df[df['score'] >= threshold].sort_values(by='score', ascending=False).head(top_n)
                raw_matches = filtered_df.to_dict(orient='records')
            except Exception:
                raw_matches = pure_python_tfidf_matcher(user_query, records)
        else:
            raw_matches = pure_python_tfidf_matcher(user_query, records)

        filtered = [r for r in raw_matches if float(r.get('score', 0.0)) >= threshold]
        filtered.sort(key=lambda x: float(x.get('score', 0.0)), reverse=True)
        top_matches = filtered[:top_n]

        matches = []
        for item in top_matches:
            std_no = str(item.get('standard_number', ''))
            std_title = str(item.get('title', ''))
            matches.append({
                "standard_id": str(item.get('standard_id', '')),
                "standard_number": std_no,
                "title": std_title,
                "description": str(item.get('description', '')),
                "status": str(item.get('status', '')),
                "category": str(item.get('category', '')),
                "version_year": str(item.get('version_year', '')),
                "score": float(item.get('score', 0.0)),
                "gem_search_url": get_gem_search_url(f"{std_no} {std_title}"),
                "gem_clause": generate_gem_procurement_clause(std_no, std_title, item.get('category', ''))
            })

        elapsed_ms = round((time.time() - start_time) * 1000, 2)

        return jsonify({
            "success": True,
            "query": user_query,
            "total_standards": len(records),
            "matches_found": len(matches),
            "matches": matches,
            "execution_time_ms": elapsed_ms
        }), 200

    except Exception as e:
        app.logger.error(f"Error in /recommend endpoint: {str(e)}")
        return jsonify({
            "success": False,
            "error": f"An error occurred while computing recommendations: {str(e)}"
        }), 500

# ==============================================================================
# GeM (Government e-Marketplace) PORTAL INTEGRATION ENDPOINTS
# ==============================================================================

@app.route('/api/gem/tenders', methods=['GET'])
def get_gem_tenders_api():
    """GET API endpoint returning active GeM procurement tenders."""
    try:
        tenders = get_gem_tenders()
        return jsonify({
            "success": True,
            "count": len(tenders),
            "tenders": tenders
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/gem/match', methods=['POST'])
def match_gem_tender_api():
    """
    POST API endpoint accepting a GeM Bid ID.
    Extracts the GeM tender specifications and runs the TF-IDF vectorizer engine
    against the BIS database to recommend matching Indian Standards!
    """
    try:
        data = request.get_json() or {}
        gem_bid_id = data.get('gem_bid_id', '').strip()
        
        tender = get_gem_tender_by_id(gem_bid_id)
        if not tender:
            return jsonify({"success": False, "error": f"GeM Tender '{gem_bid_id}' not found."}), 404

        # Combine GeM tender item name and detailed specs for matching
        gem_query = f"{tender['item_name']} {tender['specifications']}"

        records = load_csv_data()
        raw_matches = pure_python_tfidf_matcher(gem_query, records)
        raw_matches.sort(key=lambda x: float(x.get('score', 0.0)), reverse=True)
        top_matches = raw_matches[:3]

        matches = []
        for item in top_matches:
            std_no = str(item.get('standard_number', ''))
            std_title = str(item.get('title', ''))
            matches.append({
                "standard_id": str(item.get('standard_id', '')),
                "standard_number": std_no,
                "title": std_title,
                "description": str(item.get('description', '')),
                "status": str(item.get('status', '')),
                "category": str(item.get('category', '')),
                "version_year": str(item.get('version_year', '')),
                "score": float(item.get('score', 0.0)),
                "gem_search_url": get_gem_search_url(f"{std_no} {std_title}"),
                "gem_clause": generate_gem_procurement_clause(std_no, std_title, item.get('category', ''))
            })

        return jsonify({
            "success": True,
            "gem_bid": tender,
            "matches": matches
        })

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/upload_pdf', methods=['POST'])
def upload_pdf():
    """POST API endpoint to ingest a regulatory PDF document using PyPDF2."""
    try:
        if 'file' not in request.files:
            return jsonify({"success": False, "error": "No PDF file uploaded."}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({"success": False, "error": "No selected file."}), 400

        standard_number = request.form.get('standard_number', '').strip() or f"IS-REG-{int(time.time() % 10000)}"
        title = request.form.get('title', '').strip() or file.filename.rsplit('.', 1)[0]
        category = request.form.get('category', 'Electrical & Procurement').strip()
        status = request.form.get('status', 'Active').strip()
        version_year = request.form.get('version_year', '2026').strip()

        raw_text = extract_text_from_pdf(file.stream if hasattr(file, 'stream') else file)
        cleaned_text = clean_extracted_text(raw_text)

        if not cleaned_text:
            cleaned_text = f"Regulatory specification document for tender compliance: {file.filename}"

        snippet = cleaned_text[:800]

        entry = {
            "standard_id": f"BIS-PDF-{int(time.time())}",
            "standard_number": standard_number,
            "title": title,
            "description": snippet,
            "status": status,
            "category": category,
            "version_year": str(version_year)
        }

        append_entry_to_csv(entry, DATA_PATH)

        return jsonify({
            "success": True,
            "message": "PDF parsed & indexed into BIS database for live hot-reload matching!",
            "entry": entry
        }), 200

    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Failed to ingest PDF document: {str(e)}"
        }), 500

@app.route('/standards', methods=['GET'])
def get_standards():
    """GET API endpoint returning all current standards for stats."""
    try:
        records = load_csv_data()
        clean_records = []
        for r in records:
            clean_records.append({
                "standard_id": r.get("standard_id", ""),
                "standard_number": r.get("standard_number", ""),
                "title": r.get("title", ""),
                "category": r.get("category", ""),
                "status": r.get("status", ""),
                "version_year": r.get("version_year", "")
            })
        return jsonify({
            "success": True,
            "count": len(clean_records),
            "standards": clean_records
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    print("==================================================================")
    print(" StandardMatch AI - BIS & GeM Portal Recommendation Engine Running ")
    print(" Server URL: http://127.0.0.1:5000 ")
    print("==================================================================")
    app.run(host='127.0.0.1', port=5000, debug=False, use_reloader=False)
