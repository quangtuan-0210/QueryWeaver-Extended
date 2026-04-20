# QueryWeaver - MSSQL Extension & 100% Local AI Edition 🚀

This is an extended and highly customized version of the open-source **QueryWeaver** project (a Graph-based Text-to-SQL system).
🔗 **Original Project:** https://github.com/FalkorDB/QueryWeaver

## 🌟 Key Enhancements (My Contributions)

The original project primarily relies on external Cloud APIs (OpenAI/Azure) and supports only MySQL/PostgreSQL. In this fork, I have successfully researched, refactored, and deployed a **Zero-Cloud, 100% Local Architecture** while integrating **Microsoft SQL Server (MSSQL)** into the system, comprehensively resolving barriers related to T-SQL syntax, API dependencies, and vector database mismatches:

### 🗄️ Database Integration & Hardening
* **MSSQL Driver Integration:** Initialized `MSSQLLoader` using `pymssql` to accurately extract the entire database Schema (Tables, Columns, Foreign Keys) from SQL Server.
* **T-SQL Conflict Resolution:** Restructured the sample query logic using Subqueries and `ORDER BY NEWID()`, successfully bypassing SQL Server's strict `DISTINCT` syntax limitations.
* **Connection String Hardening:** Resolved critical UI parsing bugs where special characters in passwords (e.g., `@`) caused database authentication failures. Implemented backend connection URL overrides to securely bypass frontend encoding errors and establish stable remote database connections.

### 🧠 100% Local AI Architecture & Localization
* **Local LLM Migration (Qwen3-30B):** Successfully replaced Azure/OpenAI dependencies with a locally hosted large language model (Qwen 30B via vLLM) for both SQL generation and natural language summarization.
* **Self-Hosted Lightweight Embeddings:** Eliminated external API `NoneType` and `400 Bad Request` errors by replacing OpenAI's embedding API with a localized HuggingFace model (`sentence-transformers/all-MiniLM-L6-v2`) running directly inside the Docker container.
* **Graphiti Memory Tool Override:** Deeply debugged and fixed a critical 404 API error caused by hardcoded ghost models (e.g., `gpt-4.1-mini`) within the Graphiti conversation memory tool, enforcing environment variable overrides (`LLM_MODEL`) to utilize the local LLM.
* **Strict Vietnamese Localization:** Customized the Relevancy Agent prompts (`RELEVANCY_PROMPT`) with critical strict rules to force the LLM to output its internal JSON reasoning and suggestions entirely in Vietnamese. This prevents language drift and ensures a native user experience when handling off-topic or inappropriate queries.

### ⚙️ System Optimization & Bug Fixes
* **Async Logic Fix:** Fully resolved asynchronous execution errors within Python's Generator process while traversing and embedding data schemas into GraphDB.
* **FalkorDB Vector Index Reset Strategy:** Resolved vector dimension mismatch errors (`queryNodes` invalid arguments) caused by embedding model transitions, managing Docker volume lifecycles to allow FalkorDB to safely rebuild its index schema.
* **Docker-to-Host Networking:** Configured TCP/IP ports and implemented `host.docker.internal` routing, allowing the Docker container to communicate seamlessly with both local (On-Premise) and remote SQL Servers.

## ⚖️ License
This project strictly adheres to the **GNU AGPLv3** license from the original authors. The source code remains fully open to ensure transparency and community sharing. Please refer to the `LICENSE` file for detailed information.