# DEPLOY.md, Tanya (putting Intelli on a dev server)

Plain-English guide to standing up Intelli on a shared dev server so other
people (for example the team in Atlanta) can reach it and verify the data, in
their browser or with a database tool like DBeaver. No coding background assumed.
Hand this whole file to an IT person if one is helping; the copy-paste commands
are all here.

The big idea: our whole app already runs with one command inside "Docker," and
it reads its passwords from the server's environment (we set that up earlier on
purpose). So putting it on a server is mostly: copy the code, set strong
passwords, run one command, load the data.

---

## 1. What the dev server needs (check this first)

- A **Linux server** you can log into (usually over SSH). Most cloud dev boxes
  are Ubuntu; that is fine.
- **Docker** and the **Docker Compose** plugin installed. Check with:
  ```
  docker --version
  docker compose version
  ```
  If those print version numbers, you are set. If not, install Docker first
  (on Ubuntu: `curl -fsSL https://get.docker.com | sh`), then re-check.
- A way for the code to get there: either `git clone` of this repo, or copy the
  folder up with `scp`. Either is fine.
- Knowing the server's **address** (an IP like `203.0.113.10`, or a hostname).
  Atlanta will point their tools at that address.

---

## 2. Put the code on the server and set strong secrets

1. Get the code onto the server (one of):
   ```
   git clone <your-repo-url> intelli-app
   cd intelli-app
   ```
   or copy your local folder up with `scp` and `cd` into it.

2. Create the server's `.env` file. **Do NOT reuse the dev passwords** from your
   laptop. Generate fresh strong ones:
   ```
   # a strong database password:
   openssl rand -base64 32
   # a strong login secret (JWT):
   openssl rand -hex 32
   ```
   Then make `.env` (copy the template and fill it in):
   ```
   cp .env.example .env
   nano .env
   ```
   Set these two lines to the values you just generated:
   ```
   POSTGRES_PASSWORD=<the rand -base64 value>
   JWT_SECRET=<the rand -hex value>
   ```
   Save and close. This file is never committed to git, by design. Keep these
   values somewhere safe (a password manager); Atlanta will need the database
   password to connect with DBeaver.

---

## 3. Start it and load the data

From the project folder on the server:
```
docker compose up -d            # start the database + backend
docker compose run --rm migrate up    # build the tables
docker compose exec api python -m app.seed   # load the demo data
```
Check it is alive (on the server):
```
curl http://localhost:8000/health      # should print {"status":"ok",...}
```
From your own browser, once the network is open (next section):
`http://<server-address>:8000/docs` is the clickable backend page. Anyone can
log in there with the demo account (`dana@lumenbeauty.com` / `demo1234`) and
browse `/surveys`, `/nodes`, `/skus` to verify the data, with no tools to
install.

---

## 4. Letting Atlanta connect with DBeaver

DBeaver is a database viewer. It connects to the Postgres database running on the
server. The connection values are:

| Field | Value |
|-------|-------|
| Host | the server's address (IP or hostname) |
| Port | `5432` |
| Database | `intelli` |
| Username | `intelli` |
| Password | the strong `POSTGRES_PASSWORD` you set in `.env` |

There are two ways to make port `5432` reachable from Atlanta. Pick one.

### Option A (recommended, safer): SSH tunnel, database stays closed
The database port is NOT opened to the internet. Each Atlanta person connects
through SSH, which DBeaver does for you:
1. In DBeaver, New Database Connection > PostgreSQL.
2. On the **Main** tab, use Host `localhost`, Port `5432`, Database `intelli`,
   Username `intelli`, Password (the one from `.env`).
3. On the **SSH** tab, tick "Use SSH Tunnel" and enter the server's SSH host,
   their SSH username, and key/password. DBeaver then reaches the database as if
   it were local, over the encrypted SSH connection.
This needs no firewall changes and never exposes the raw database to the world.

For this to work cleanly, make the database listen only locally on the server by
editing `docker-compose.yml` so the `db` service publishes to localhost only:
```
    ports:
      - "127.0.0.1:5432:5432"
```
(then `docker compose up -d` again). This still works for the SSH tunnel and for
the backend, and keeps the database off the open internet.

### Option B (simpler, less safe): open the port to Atlanta's IPs
Open port `5432` in the server's firewall / cloud security group, **restricted
to Atlanta's office IP range**, not the whole world. Then DBeaver connects
directly with the values in the table above (no SSH tab). Only do this if a
network person can lock it to known IPs; an open `5432` is a common way databases
get attacked.

---

## 5. Safety must-dos (short and non-negotiable)

- **Fresh strong secrets** on the server (Section 2). The dev values are
  throwaway and must never be used where other people can reach it.
- **Do not expose the raw database (5432) to the whole internet.** Use the SSH
  tunnel (Option A) or a locked-down firewall (Option B).
- The demo login (`demo1234`) is fine for a verification sandbox with demo data.
  Before any real client data goes in, change demo passwords and tighten access.

---

## 6. Everyday commands on the server

| I want to... | Command (from the project folder) |
|--------------|-----------------------------------|
| See what is running | `docker compose ps` |
| Read the backend logs | `docker compose logs -f api` |
| Restart the backend | `docker compose restart api` |
| Stop everything | `docker compose down` (data is kept) |
| Start again | `docker compose up -d` |
| Re-load demo data | `docker compose exec api python -m app.seed` |

---

## 7. A note for later (not needed for verification)

If someday the Admin **web screens** (not just the data) are opened from this
server, the backend's "guest list" (CORS, in `api/app/main.py`) currently only
allows local addresses. That list would need the server's web address added.
Not relevant for the DBeaver / `/docs` verification this guide covers; noted so
it is not a surprise later.
