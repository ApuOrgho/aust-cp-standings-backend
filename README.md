# Competitive Programming Backend API

This project is a **Node.js backend server** that fetches competitive programming contest standings and ratings data from **CodeChef**, **Codeforces**, and **AtCoder**. It supports institution-based filtering, uses both API and headless browser scraping, and exposes easy-to-use REST API endpoints.

---

## Features

- Fetch contest standings filtered by institution (AUST or others).
- Fetch all user ratings filtered by institution.
- Supports multiple platforms:
  - **CodeChef** (scraping with Puppeteer)
  - **Codeforces** (official API + Puppeteer fallback)
  - **AtCoder** (scraping with Puppeteer)
- Handles pagination gracefully for large rating lists and standings.
- Implements filtering by user handles or affiliations.
- Built with Express.js for lightweight and scalable API service.

---

## Requirements

- Node.js v20 or higher (recommended for best Puppeteer support)
- Microsoft Edge installed (required by Puppeteer for scraping CodeChef and AtCoder)
- Internet access to reach CodeChef, Codeforces, and AtCoder websites and APIs

---

## Setup & Installation

1. Clone the repository:

   ```
   git clone <your-repo-url>
   cd <your-repo-folder>
   ```

2. Install dependencies:

   ```
   npm install
   ```

3. Ensure Microsoft Edge is installed and available at the path set in `server.js`:

   ```
   // Example path in server.js
   const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
   ```

## Usage

Start the server:

```bash
npm start
```

By default, the server runs on:  
http://localhost:3000

## API Endpoints

### CodeChef

- `GET /codechef/standings?code=<contest_code>`  
  Fetch CodeChef contest standings filtered by institution.

- `GET /codechef/codechef_ratings_all`  
  Fetch all CodeChef user ratings filtered by institution.

### Codeforces

- `GET /codeforces_standings/<contestId>`  
  Fetch Codeforces contest standings using the official API, filtered by institution handles.

- `GET /codeforces_ratings_all`  
  Fetch all Codeforces ratings filtered by institution, handling pagination and duplicates.

### AtCoder

- `GET /atcoder_ratings_all`  
  Fetch all AtCoder ratings filtered by institution (affiliation).

- `GET /atcoder_standings?contestId=<contest_id>&handles=<handle1,handle2,...>`  
  Fetch contest participation info for given handles and contest ID.

---

## Deployment

This backend can be deployed easily to cloud services such as Railway, Heroku, or any VPS supporting Node.js.

### Deployment tips:

- Use `.gitignore` to exclude `node_modules`.
- Set the start command to `npm start`.
- Make sure environment variables or config files provide the correct Microsoft Edge path if different.

---

## Notes & Best Practices

- Puppeteer depends on the installed Microsoft Edge browser; ensure it's available.
- API rate limits and site structure changes may affect scraping reliability.
- Use responsibly to avoid overwhelming external servers.
- Institution filtering can be customized by updating the handle lists in the source code.
- Consider caching data or adding a database for scalability.

---

## Contribution

Feel free to open issues or pull requests for bugs, new features, or improvements.

---

## Quick Clone & Setup

```
git clone <your-repo-url>
cd <your-repo-folder>
```
