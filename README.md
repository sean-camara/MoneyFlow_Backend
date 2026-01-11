# FlowMoney Backend

Backend API for FlowMoney personal finance application.

## Tech Stack

- Node.js 18+
- Express.js
- MongoDB (Atlas)
- Socket.IO for real-time features
- Firebase Admin SDK for push notifications
- OpenRouter API for AI features

## Getting Started

### Prerequisites

- Node.js 18 or higher
- MongoDB Atlas account
- Docker & Docker Compose (for containerized deployment)

### Local Development

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

3. Update environment variables in `.env` file

4. Start development server:
```bash
npm run dev
```

Server will run on `http://localhost:5000`

## Docker Deployment

### Build and Run with Docker Compose

1. Ensure `.env` file is configured with production values

2. Build and start the container:
```bash
docker-compose up -d --build
```

3. View logs:
```bash
docker-compose logs -f backend
```

4. Stop the container:
```bash
docker-compose down
```

### Manual Docker Build

```bash
# Build image
docker build -t flowmoney-backend .

# Run container
docker run -d \
  --name flowmoney-backend \
  -p 5000:5000 \
  --env-file .env \
  flowmoney-backend
```

## Deployment to DigitalOcean VPS

### 1. Initial VPS Setup

SSH into your VPS:
```bash
ssh root@165.22.247.85
```

Install Docker and Docker Compose:
```bash
# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
apt install docker-compose -y

# Verify installation
docker --version
docker-compose --version
```

### 2. Clone Repository

```bash
# Create app directory
mkdir -p /home/flowmoney
cd /home/flowmoney

# Clone your repository (or upload files via SCP/SFTP)
git clone <your-repo-url> backend
cd backend
```

### 3. Configure Environment

```bash
# Create .env file with production credentials
nano .env
```

Copy all values from `.env.example` and update with production credentials.

### 4. Start Application

```bash
# Build and start
docker-compose up -d --build

# Check status
docker-compose ps

# View logs
docker-compose logs -f backend
```

### 5. Setup Nginx Reverse Proxy (Optional but Recommended)

Install Nginx:
```bash
apt install nginx -y
```

Create Nginx configuration:
```bash
nano /etc/nginx/sites-available/flowmoney
```

Add configuration:
```nginx
server {
    listen 80;
    server_name api.flowmoneyap.me;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable site and restart Nginx:
```bash
ln -s /etc/nginx/sites-available/flowmoney /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

### 6. Setup SSL with Let's Encrypt

```bash
# Install Certbot
apt install certbot python3-certbot-nginx -y

# Obtain SSL certificate
certbot --nginx -d api.flowmoneyap.me

# Auto-renewal is configured automatically
```

### 7. Setup Auto-restart on Server Reboot

Docker containers with `restart: unless-stopped` will automatically start on server reboot.

Verify:
```bash
docker-compose ps
```

## Updating the Application

```bash
cd /home/flowmoney/backend

# Pull latest changes
git pull

# Rebuild and restart
docker-compose up -d --build

# View logs to ensure successful startup
docker-compose logs -f backend
```

## Health Check

The application includes a health check endpoint:
```
GET /api/health
```

Returns: `{ "status": "ok", "timestamp": "..." }`

## Monitoring

### View Logs
```bash
# Follow logs
docker-compose logs -f backend

# Last 100 lines
docker-compose logs --tail=100 backend
```

### Container Status
```bash
docker-compose ps
```

### Resource Usage
```bash
docker stats flowmoney-backend
```

## Troubleshooting

### Container won't start
```bash
# Check logs
docker-compose logs backend

# Verify environment variables
docker-compose config
```

### Database connection issues
- Verify MongoDB Atlas IP whitelist includes VPS IP
- Check MONGODB_URI in .env file
- Ensure network connectivity: `curl -I https://cloud.mongodb.com`

### Port already in use
```bash
# Check what's using port 5000
lsof -i :5000

# Kill the process or change port in .env and docker-compose.yml
```

## Environment Variables

See `.env.example` for all required environment variables.

Key variables:
- `MONGODB_URI` - MongoDB Atlas connection string
- `JWT_SECRET` - Secret key for JWT tokens (use strong random string)
- `FRONTEND_URL` - Your frontend URL for CORS
- `FIREBASE_SERVICE_ACCOUNT` - Firebase service account JSON
- `OPENROUTER_API_KEY` - API key for AI features

## API Documentation

Base URL: `https://api.flowmoneyap.me`

### Health Check
```
GET /api/health
```

### Authentication
```
POST /api/auth/register
POST /api/auth/login
POST /api/auth/google
```

### Transactions
```
GET    /api/transactions
POST   /api/transactions
PUT    /api/transactions/:id
DELETE /api/transactions/:id
```

More endpoints documented in the source code.

## Security Notes

- Never commit `.env` file to version control
- Use strong JWT_SECRET (minimum 32 characters)
- Keep Firebase service account credentials secure
- Regularly update dependencies: `npm audit fix`
- Monitor logs for suspicious activity

## Support

For issues or questions, contact the development team.

## License

Proprietary - All rights reserved
