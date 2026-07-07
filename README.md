# SRBMiner Rig Monitor Dashboard

A modern, responsive, and beautiful glassmorphism web dashboard to monitor GPU mining rigs running **SRBMiner-Multi**. 

This application aggregates stats from multiple rig endpoints on demand (on-page access), calculating total network hashrate, active rig count, and max/current temperatures without requiring a database.

---

## Features
- **Modern UI**: Dark-themed space aesthetic utilizing custom CSS glassmorphism cards and Outfit typography.
- **Global Overview**: Quick summary card showing total active rigs, total cumulative hashrate, absolute max temperature, and total GPU count.
- **Live Stats Aggregation**: Fetches and parses statistics on-demand directly from the backend server to avoid CORS blocks in browser-level requests.
- **Robust Parser**: Supports multiple SRBMiner JSON schemas (such as `gpu_devices` or standard `devices` arrays) and gracefully handles offline rigs.
- **Temperature Heatmaps**: Color-coded GPU temperature boxes highlighting safe (green), warning (yellow), and hot (red) threshold levels.
- **Docker-Ready**: Packaged with a lightweight `Dockerfile` and `docker-compose.yml` for instant deployment.
- **Mock Mode**: Built-in simulator mode to preview and test the UI immediately without being on the same local network as the rigs.

---

## Quick Start (with Docker Compose)

The easiest way to run the dashboard is with Docker Compose.

1. **Clone the repository** (or copy the files to your target server).
2. **Review configurations** in `docker-compose.yml` to specify your target rig IP addresses.
3. **Start the container**:
   ```bash
   docker compose up -d
   ```
4. **Access the web dashboard** in your browser at:
   `http://localhost:21551`

---

## Configuration

You can customize the monitoring behavior using environment variables. These can be set inside the `docker-compose.yml` file under `environment:`:

| Environment Variable | Default Value | Description |
| :--- | :--- | :--- |
| `RIG_IPS` | `192.168.1.101:21550,192.168.1.102:21550,192.168.1.113:21550,192.168.1.114:21550,192.168.1.122:21550,192.168.1.123:21550` | Comma-separated list of target SRBMiner API IP addresses and ports. |
| `PORT` | `21551` | The port the Node.js application runs on. |

---

## How to Enable API on SRBMiner-Multi

For the dashboard to retrieve stats from your rigs, the SRBMiner instances must have their HTTP API enabled. When launching SRBMiner, ensure you append the `--api-enable` flag to your startup script or command:

```bash
SRBMiner-MULTI.exe --algorithm autolykos2 --pool pool.example.com:port --wallet your_wallet_address --api-enable
```

*Note: The default API port is `21550`. If you configure a custom port via `--api-port`, ensure you update the `RIG_IPS` variable accordingly.*

---

## Local Development (without Docker)

If you wish to run the project locally without containerization:

1. **Install dependencies**:
   ```bash
   npm install
   ```
2. **Run in development mode**:
   ```bash
   npm run dev
   ```
   ```
   PORT=21551 npm run dev
   ```
