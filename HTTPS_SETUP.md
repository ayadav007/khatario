# HTTPS Setup Guide for Local Development

This guide will help you set up HTTPS for local development so that the barcode scanner can access the camera.

## Prerequisites

1. **Install mkcert** (creates local SSL certificates):
   
   **Windows (using Chocolatey):**
   ```bash
   choco install mkcert
   ```
   
   **Windows (using Scoop):**
   ```bash
   scoop install mkcert
   ```
   
   **macOS:**
   ```bash
   brew install mkcert
   ```
   
   **Linux:**
   ```bash
   # Ubuntu/Debian
   sudo apt install libnss3-tools
   wget -O mkcert https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v1.4.4-linux-amd64
   chmod +x mkcert
   sudo mv mkcert /usr/local/bin/
   ```

2. **Install the local CA (Certificate Authority):**
   ```bash
   mkcert -install
   ```
   This will install a local CA that your browser will trust.

## Setup Steps

1. **Generate SSL certificates:**
   ```bash
   npm run setup:https
   ```
   This will create SSL certificates in the `certs` folder.

2. **Start the development server with HTTPS:**
   ```bash
   npm run dev:https
   ```

3. **Access your app:**
   Open your browser and go to: `https://localhost:3000`
   
   ⚠️ **Important:** You may see a security warning the first time. This is normal for local certificates. Click "Advanced" and then "Proceed to localhost" (or similar).

## Mobile Testing

To test on mobile devices:

1. **Find your computer's local IP address:**
   - Windows: `ipconfig` (look for IPv4 Address)
   - macOS/Linux: `ifconfig` or `ip addr` (look for inet address)

2. **Update server.js** to allow connections from your network:
   - Change `hostname: 'localhost'` to `hostname: '0.0.0.0'`
   - Or add your IP address to the certificate

3. **Access from mobile:**
   - Use `https://YOUR_IP:3000` (e.g., `https://192.168.1.100:3000`)
   - You may need to accept the certificate warning on mobile

## Troubleshooting

### Certificate errors
- Make sure you ran `mkcert -install` first
- Try regenerating certificates: Delete the `certs` folder and run `npm run setup:https` again

### Port already in use
- Change the port in `server.js` (currently 3000)
- Or stop any other process using port 3000

### Mobile can't connect
- Make sure your mobile device is on the same network
- Check your firewall settings
- Try accessing via IP address instead of localhost

## Regular Development vs HTTPS Development

- **Regular development (HTTP):** `npm run dev` → `http://localhost:3000`
- **HTTPS development:** `npm run dev:https` → `https://localhost:3000`

Use HTTPS development when you need to test camera/microphone features.
