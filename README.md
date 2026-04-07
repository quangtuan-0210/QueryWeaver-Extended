# QueryWeaver - MSSQL Extension Edition 🚀

This is an extended and customized version of the open-source **QueryWeaver** project (a Graph-based Text-to-SQL system).
🔗 **Original Project:** https://github.com/FalkorDB/QueryWeaver

## 🌟 Key Enhancements (My Contributions)
The original project only supports MySQL and PostgreSQL. In this fork, I have successfully researched and integrated **Microsoft SQL Server (MSSQL)** into the system, comprehensively resolving barriers related to T-SQL syntax and network infrastructure:

* **MSSQL Driver Integration:** Initialized `MSSQLLoader` using `pymssql` to accurately extract the entire database Schema (Tables, Columns, Foreign Keys) from SQL Server.
* **T-SQL Conflict Resolution:** Restructured the sample query logic using Subqueries and `ORDER BY NEWID()`, successfully bypassing SQL Server's strict `DISTINCT` syntax limitations.
* **Async Logic Fix:** Fully resolved asynchronous execution errors within Python's Generator process while traversing and embedding data schemas into GraphDB.
* **Docker-to-Host Networking:** Configured TCP/IP port 1433 and implemented `host.docker.internal` routing, allowing the Docker container to communicate seamlessly with the local (On-Premise) SQL Server.

## ⚖️ License
This project strictly adheres to the **GNU AGPLv3** license from the original authors. The source code remains fully open to ensure transparency and community sharing. Please refer to the `LICENSE` file for detailed information.
